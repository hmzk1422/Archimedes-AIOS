/**
 * Server-side RBAC helpers — fetches the user's role, account type, and workspace from the profiles table.
 */
import { createClient } from '@/utils/supabase/server'
import {
  normalizeRole,
  normalizeAccountType,
  hasPermission,
  canAccessRoute,
  generateInviteCode,
  type Role,
  type AccountType,
  type Permission,
} from './rbac'

export interface AuthUser {
  id: string
  email: string | undefined
  role: Role
  accountType: AccountType
  /** The workspace ID — for admins this is their own id, for team members it's the admin's id */
  workspaceId: string
  /** Invite code — only set for admin accounts */
  inviteCode: string | null
  tenantName: string | null
}

/**
 * Get the authenticated user with their role, account type, and workspace.
 * Returns null if not authenticated.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_name, role, account_type, workspace_id, invite_code')
    .eq('id', user.id)
    .single()

  const role = normalizeRole(profile?.role)
  const accountType = normalizeAccountType(profile?.account_type)

  // For admins, workspace_id is their own id. For standard users, it's the admin's id.
  // Fall back to user.id for backward compatibility.
  const workspaceId = profile?.workspace_id ?? user.id

  // Self-heal: every admin must always have an invite code so teammates can join.
  // Covers admins created before the invite-code feature existed (their code is NULL).
  let inviteCode = profile?.invite_code ?? null
  if (accountType === 'admin' && !inviteCode) {
    const newCode = generateInviteCode()
    await supabase
      .from('profiles')
      .update({
        invite_code: newCode,
        account_type: 'admin',
        workspace_id: user.id,
      })
      .eq('id', user.id)
    inviteCode = newCode
  }

  return {
    id: user.id,
    email: user.email,
    role,
    accountType,
    workspaceId,
    inviteCode,
    tenantName: profile?.tenant_name ?? null,
  }
}

/**
 * Require authentication. Redirects to /auth if not logged in.
 */
export async function requireAuth(): Promise<AuthUser> {
  const authUser = await getAuthUser()
  if (!authUser) {
    const { redirect } = await import('next/navigation')
    redirect('/auth')
    throw new Error('unreachable — redirect() throws')
  }
  return authUser
}

/**
 * Require a specific permission. Redirects to /dashboard if insufficient.
 */
export async function requirePermission(permission: Permission): Promise<AuthUser> {
  const authUser = await requireAuth()
  if (!hasPermission(authUser.role, permission)) {
    const { redirect } = await import('next/navigation')
    redirect('/dashboard')
    throw new Error('unreachable — redirect() throws')
  }
  return authUser
}

/**
 * Require access to a route. Redirects to /dashboard if insufficient.
 */
export async function requireRouteAccess(pathname: string): Promise<AuthUser> {
  const authUser = await requireAuth()
  if (!canAccessRoute(authUser.role, pathname)) {
    const { redirect } = await import('next/navigation')
    redirect('/dashboard')
    throw new Error('unreachable — redirect() throws')
  }
  return authUser
}

export { hasPermission, canAccessRoute, normalizeRole, normalizeAccountType }
export type { Role, AccountType, Permission }