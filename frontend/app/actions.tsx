'use server'

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { getAuthUser, hasPermission, normalizeRole, type Role } from '@/lib/rbac-server'
import { generateInviteCode } from '@/lib/rbac'

/**
 * Service-role client. Bypasses RLS so the app can read/link workspace members
 * across users (the browser/server clients use the anon key and are RLS-scoped to
 * the signed-in user's own row, which is exactly why the invite/member flows failed).
 */
function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Validate an invite code using the service role (RLS would hide the admin's row
 * from a brand-new user's anon-key client, causing a false "invalid invite code").
 * Called BEFORE signup so an invalid code never creates an orphan admin account.
 */
export async function validateInviteCodeAction(inviteCode: string) {
  const code = (inviteCode || '').trim().toUpperCase()
  if (!code) return { valid: false, workspaceId: null, tenantName: null }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, tenant_name')
    .eq('invite_code', code)
    .maybeSingle()

  if (error || !data) {
    return { valid: false, workspaceId: null, tenantName: null }
  }
  return { valid: true, workspaceId: data.id, tenantName: data.tenant_name }
}

/**
 * Link a just-created team-member account to the workspace owned by the invite code.
 * Uses the service role to bypass RLS so the new user can be assigned the admin's workspace.
 */
export async function finalizeTeamMemberAction(userId: string, inviteCode: string) {
  const code = (inviteCode || '').trim().toUpperCase()
  const supabase = createAdminClient()

  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('invite_code', code)
    .maybeSingle()

  if (!adminProfile) {
    // Best-effort cleanup: don't leave an orphan account that never joined.
    await supabase.auth.admin.deleteUser(userId).catch(() => {})
    throw new Error('Invalid invite code. Check with your workspace admin.')
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      workspace_id: adminProfile.id,
      account_type: 'standard',
      role: 'viewer',
    })
    .eq('id', userId)

  if (error) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {})
  }
  if (error) throw new Error(error.message)
}

/**
 * Join a workspace using an invite code (service-role path).
 */
export async function joinWorkspaceAction(formData: FormData) {
  const inviteCode = (formData.get('inviteCode') as string)?.trim().toUpperCase()
  const userId = formData.get('userId') as string

  // Team members join as viewer until an admin changes their role.
  // The 'admin' role is reserved for the workspace owner and can never be self-requested.
  const rawRole = (formData.get('role') as string)?.toLowerCase()
  const role: Role =
    rawRole && ['developer', 'viewer'].includes(rawRole)
      ? (rawRole as Role)
      : 'viewer'

  if (!inviteCode || !userId) {
    throw new Error('Missing invite code or user ID')
  }

  const supabase = createAdminClient()

  // Find the admin workspace by invite code.
  const { data: adminProfile, error: findError } = await supabase
    .from('profiles')
    .select('id, tenant_name')
    .eq('invite_code', inviteCode)
    .maybeSingle()

  if (findError || !adminProfile) {
    throw new Error('Invalid invite code. Check with your workspace admin.')
  }

  // Link this user to the admin's workspace
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      workspace_id: adminProfile.id,
      account_type: 'standard',
      role: role,
    })
    .eq('id', userId)

  if (updateError) throw new Error(updateError.message)
}

/**
 * Regenerate the invite code for the current admin's workspace.
 */
export async function regenerateInviteCodeAction() {
  const authUser = await getAuthUser()
  if (!authUser) throw new Error('Not authenticated')
  if (authUser.accountType !== 'admin') {
    throw new Error('Only workspace owners can regenerate invite codes')
  }

  const newCode = generateInviteCode()
  const supabase = await createServerClient()

  const { error } = await supabase
    .from('profiles')
    .update({ invite_code: newCode })
    .eq('id', authUser.id)

  if (error) throw new Error(error.message)
}

export async function updateRoleAction(formData: FormData) {
  const authUser = await getAuthUser()
  if (!authUser) throw new Error('Not authenticated')

  // Only admins can change roles
  if (!hasPermission(authUser.role, 'users:manage')) {
    throw new Error('Insufficient permissions — only admins can change roles')
  }

  const targetUserId = formData.get('userId') as string
  const newRole = normalizeRole(formData.get('role')) as Role

  if (!targetUserId || !newRole) {
    throw new Error('Missing userId or role')
  }

  // Admins can never change their own role — this prevents a workspace from being left without an owner.
  if (targetUserId === authUser.id) {
    throw new Error('Admins cannot change their own role from the member list')
  }

  // The Admin (owner) role is reserved — no one (not even another admin) can grant it.
  if (newRole === 'admin') {
    throw new Error('The Admin role is reserved for the workspace owner and cannot be granted to other members')
  }

  // Use the service role to bypass RLS so the admin can update a teammate's row.
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', targetUserId)

  if (error) throw new Error(error.message)
}

/**
 * List team members for the current admin's workspace using the service role.
 * The anon-key client is RLS-scoped to the user's own row, so it can't list
 * other members — that's why it only ever showed the admin themselves.
 */
export async function listWorkspaceMembersAction() {
  const authUser = await getAuthUser()
  if (!authUser) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, tenant_name, email, role, created_at')
    .eq('workspace_id', authUser.workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch workspace members:', error.message)
    return []
  }

  return (data || []).map((p) => ({
    ...p,
    role: (['admin', 'developer', 'viewer'].includes(p.role) ? p.role : 'admin') as Role,
  }))
}

export async function updateOwnRoleAction(formData: FormData) {
  const authUser = await getAuthUser()
  if (!authUser) throw new Error('Not authenticated')

  // An admin must never be able to demote themselves — otherwise the workspace could be left without an owner.
  if (authUser.role === 'admin' || authUser.accountType === 'admin') {
    throw new Error('Admins cannot change their own role. Only another admin can manage roles.')
  }

  const newRole = normalizeRole(formData.get('role')) as Role

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', authUser.id)

  if (error) throw new Error(error.message)
}

export async function deleteAccountAction() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('User not found')

  // Create an Admin client to perform the deletion
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Resolve the workspace (tenant) this user belongs to. The AI tenant is the
  // workspace id, so we know which knowledge data belongs to this account.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .maybeSingle()
  const workspaceId = profile?.workspace_id ?? user.id

  // Delete the user from Auth
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)

  if (error) throw new Error(error.message)

  // Clean up orphaned knowledge data ONLY if no other member remains in this
  // workspace. (A developer deleting their account must NOT wipe the shared
  // workspace AI data; the admin/workspace is the tenant.)
  // Deletes raw parsed rows + pgvector documents + storage files for the tenant.
  try {
    const { data: remaining } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .neq('id', user.id)
      .limit(1)

    if (!remaining || remaining.length === 0) {
      await fetch('http://localhost:8000/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: workspaceId }),
      }).catch(() => {})
    }
  } catch {
    // Knowledge cleanup is best-effort — never block account deletion on it.
  }

  // Sign out the current session
  await supabase.auth.signOut()

  // Redirect to auth page
  redirect('/auth')
}