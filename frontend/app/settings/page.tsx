'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Settings,
  Shield,
  Code,
  Eye,
  Users,
  Loader2,
  Check,
  AlertCircle,
  Ticket,
  Copy,
  RefreshCw,
  Building2,
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { AppearanceSettings } from '@/components/settings/appearance-settings'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageBackground } from '@/components/page-background'
import { RoleBadge } from '@/components/rbac/RoleBadge'
import { useRole } from '@/hooks/useRole'
import {
  ALL_ROLES,
  ROLE_METADATA,
  ROLE_PERMISSIONS,
  hasPermission,
  generateInviteCode,
  type Role,
  type Permission,
} from '@/lib/rbac'
import { updateRoleAction, regenerateInviteCodeAction, listWorkspaceMembersAction } from '@/app/actions'

const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard:view': 'View Dashboard',
  'knowledge:manage': 'Manage Knowledge Base',
  'actions:manage': 'Manage Actions',
  'agent:use': 'Use Agent Chat',
  'marketplace:view': 'View Marketplace',
  'metrics:view': 'View Metrics',
  'metrics:manage': 'Manage Metrics',
  'workflow:edit': 'Edit Workflows (Drag & Drop)',
  'workflow:view': 'View Workflows',
  'users:manage': 'Manage Users',
  'settings:manage': 'Manage Settings',
  'account:delete': 'Delete Account',
}

interface UserProfile {
  id: string
  tenant_name: string | null
  email: string | null
  role: Role
}

export default function SettingsPage() {
  const router = useRouter()
  const { role: currentUserRole, loading: roleLoading, refresh: refreshRole } = useRole()

  const [checkingUser, setCheckingUser] = useState(true)
  const [tenantName, setTenantName] = useState('Workspace')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [accountType, setAccountType] = useState<'admin' | 'standard'>('admin')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [regeneratingCode, setRegeneratingCode] = useState(false)
  const [users, setUsers] = useState<UserProfile[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  })

  const canManageUsers = hasPermission(currentUserRole, 'users:manage')

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/auth')
        return
      }
      setCurrentUserId(user.id)

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_name, invite_code, account_type, workspace_id')
        .eq('id', user.id)
        .single()

      if (profile?.tenant_name) setTenantName(profile.tenant_name)

      // Self-heal: every admin must always have an invite code to share with teammates.
      // This covers admins created before the invite-code feature existed (their code is null).
      const resolvedAccountType =
        (profile?.account_type as 'admin' | 'standard' | undefined) ?? 'admin'
      let resolvedInviteCode: string | null = profile?.invite_code ?? null

      if (resolvedAccountType === 'admin' && !resolvedInviteCode) {
        const newCode = generateInviteCode()
        const { error: upsertError } = await supabase
          .from('profiles')
          .update({
            invite_code: newCode,
            account_type: 'admin',
            workspace_id: user.id,
          })
          .eq('id', user.id)
        if (!upsertError) resolvedInviteCode = newCode
      }

      if (resolvedInviteCode) setInviteCode(resolvedInviteCode)
      setAccountType(resolvedAccountType)
      if (profile?.workspace_id) setWorkspaceId(profile.workspace_id)
      setCheckingUser(false)

      if (canManageUsers) {
        await fetchUsers()
      }
    }
    init()
  }, [router, canManageUsers])

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      // Use the service-role server action — the browser client is RLS-scoped to the
      // user's own row and would only ever return the admin themselves.
      const members = await listWorkspaceMembersAction()
      setUsers(members)
    } catch (err) {
      console.error('Failed to fetch users:', err)
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  async function handleUpdateRole(userId: string, newRole: Role) {
    setSavingUserId(userId)
    setStatus({ kind: 'idle', message: '' })

    try {
      const formData = new FormData()
      formData.set('userId', userId)
      formData.set('role', newRole)

      await updateRoleAction(formData)
      setStatus({ kind: 'success', message: 'Role updated successfully.' })
      await fetchUsers()
      if (userId === (await createClient().auth.getUser()).data.user?.id) {
        refreshRole()
      }
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to update role',
      })
    } finally {
      setSavingUserId(null)
    }
  }

  async function handleRegenerateInviteCode() {
    setRegeneratingCode(true)
    setStatus({ kind: 'idle', message: '' })

    try {
      await regenerateInviteCodeAction()
      // Refetch the invite code
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('invite_code')
          .eq('id', user.id)
          .single()
        if (profile?.invite_code) setInviteCode(profile.invite_code)
      }
      setStatus({ kind: 'success', message: 'Invite code regenerated. Share the new code with your team.' })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to regenerate invite code',
      })
    } finally {
      setRegeneratingCode(false)
    }
  }

  function handleCopyInviteCode() {
    if (inviteCode) {
      navigator.clipboard.writeText(inviteCode)
      setStatus({ kind: 'success', message: 'Invite code copied to clipboard.' })
    }
  }

  if (checkingUser || roleLoading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="mt-3 text-sm font-medium">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <PageBackground />
      <DashboardNav tenantName={tenantName} />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        {/* Header */}
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Configuration
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Manage your account role and {canManageUsers ? 'team member permissions.' : 'view your current permissions.'}
          </p>
        </div>

        {/* Status message */}
        {status.message && (
          <div
            className={cn(
              'mb-6 flex items-center gap-2 rounded-lg border p-3 text-sm',
              status.kind === 'success' && 'border-primary/30 bg-primary/10 text-foreground',
              status.kind === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            {status.kind === 'success' ? (
              <Check className="size-4 shrink-0 text-primary" />
            ) : (
              <AlertCircle className="size-4 shrink-0" />
            )}
            {status.message}
          </div>
        )}

        <div className="space-y-6">
          {/* ── Appearance (Admin only) ── */}
          {accountType === 'admin' && (
            <section className="space-y-3">
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight">
                  Appearance
                </h2>
                <p className="text-sm text-muted-foreground">
                  Customise the logo, color scheme and dashboard for your entire
                  workspace. The default theme is always one click away.
                </p>
              </div>
              <AppearanceSettings />
            </section>
          )}
          {/* ── Workspace & Invite Code Card (Admin only) ── */}
          {accountType === 'admin' && (
            <Card className="border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="size-5 text-primary" />
                  Workspace & Invite Code
                </CardTitle>
                <CardDescription>
                  Share this code with your team so they can join your workspace as developers or viewers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-secondary/20">
                  <Ticket className="size-6 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Your Invite Code</p>
                    <p className="text-2xl font-bold font-mono tracking-widest text-foreground mt-1">
                      {inviteCode || '—'}
                    </p>
                  </div>
                  {inviteCode && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCopyInviteCode}
                      >
                        <Copy className="mr-1.5 size-3.5" />
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleRegenerateInviteCode}
                        disabled={regeneratingCode}
                      >
                        {regeneratingCode ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  When a team member signs up, they choose "Team Member" and enter this code.
                  They'll be linked to your workspace and share your AI agent, knowledge base, and metrics.
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Workspace Info Card (Standard users) ── */}
          {accountType === 'standard' && (
            <Card className="border-primary/20 bg-primary/4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="size-5 text-primary" />
                  Workspace Member
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  You are a team member in this workspace. Your access level is determined by your role
                  ({currentUserRole}). Contact your workspace admin if you need elevated access.
                </p>
                {workspaceId && (
                  <p className="text-xs text-muted-foreground mt-2 font-mono">
                    Workspace ID: {workspaceId.slice(0, 8)}...
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Your Role Card (read-only — admins manage everyone's roles, including your own) ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="size-5 text-primary" />
                Your Role
              </CardTitle>
              <CardDescription>
                Your access level is managed by your workspace admin. You cannot change it yourself.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary">
                    {currentUserRole === 'admin' ? (
                      <Shield className="size-4" />
                    ) : currentUserRole === 'developer' ? (
                      <Code className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {currentUserRole ? ROLE_METADATA[currentUserRole].label : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {currentUserRole ? ROLE_METADATA[currentUserRole].description : ''}
                    </p>
                  </div>
                </div>
                {currentUserRole && (
                  <span className="shrink-0">
                    <RoleBadge role={currentUserRole} size="md" />
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {accountType === 'admin'
                  ? 'As the workspace owner, your role is fixed to Admin so the workspace always keeps an owner.'
                  : 'Contact your workspace admin to request a different access level.'}
              </p>
            </CardContent>
          </Card>

          {/* ── Permission Matrix Card ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="size-5 text-primary" />
                Permission Matrix
              </CardTitle>
              <CardDescription>
                What each role can do across the platform.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-2 pr-4 text-left font-medium text-muted-foreground">Permission</th>
                      {ALL_ROLES.map((r) => (
                        <th key={r} className="py-2 px-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <RoleBadge role={r} />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(PERMISSION_LABELS) as Permission[]).map((perm) => (
                      <tr key={perm} className="border-b border-border/40">
                        <td className="py-2.5 pr-4 text-foreground">{PERMISSION_LABELS[perm]}</td>
                        {ALL_ROLES.map((r) => {
                          const allowed = ROLE_PERMISSIONS[r].includes(perm)
                          return (
                            <td key={r} className="py-2.5 px-3 text-center">
                              {allowed ? (
                                <Check className="mx-auto size-4 text-primary" />
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── User Management (Admin only) ── */}
          {canManageUsers && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-5 text-primary" />
                  User Management
                </CardTitle>
                <CardDescription>
                  Change the role of any team member. Only admins can access this section. The Admin (owner) role is fixed and cannot be granted to other members.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingUsers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                ) : users.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No users found. Share your invite code to bring team members in.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {users.map((u) => (
                      <div
                        key={u.id}
                        className="flex flex-col gap-3 p-4 rounded-lg border border-border/60 bg-secondary/20 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary shrink-0">
                            {(u.tenant_name || u.email || '?').charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {u.tenant_name || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                          <RoleBadge role={u.role} />
                        </div>

                        <div className="flex items-center gap-1.5">
                          {u.id === currentUserId ? (
                            <span className="text-xs font-medium text-muted-foreground">
                              Owner — role is fixed
                            </span>
                          ) : (
                            ALL_ROLES.filter((r) => r !== 'admin').map((r) => {
                              const selected = u.role === r
                              const isSaving = savingUserId === u.id
                              return (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => handleUpdateRole(u.id, r)}
                                  disabled={isSaving}
                                  className={cn(
                                    'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                                    selected
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground',
                                  )}
                                >
                                  {isSaving ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    ROLE_METADATA[r].label
                                  )}
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Viewer Notice ── */}
          {currentUserRole === 'viewer' && (
            <Card className="border-primary/20 bg-primary/4">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <Eye className="size-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Viewer Access</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      You have read-only access. You can view dashboards, metrics, and workflow
                      visualizations, but cannot modify knowledge bases, actions, or edit workflows.
                      Contact an admin if you need elevated access.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
