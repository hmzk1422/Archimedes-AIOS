import { createClient } from '@/utils/supabase/client'

/**
 * Resolve the AI/knowledge-base tenant id for a signed-in user.
 *
 * The tenant is the WORKSPACE (the id the admin owns, stored as
 * `profiles.workspace_id`), which is SHARED by the admin and every team member
 * (developer/viewer). It must NOT be the per-user id — otherwise a developer
 * uploading docs would create a separate, isolated knowledge base from the
 * admin, splitting the same AI into two (the "developer tenant vs admin tenant"
 * problem).
 */
export async function resolveTenantId(userId: string): Promise<string> {
  try {
    const supabase = createClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('id', userId)
      .maybeSingle()
    // workspace_id is the admin's id for team members, or the user's own id for admins.
    return profile?.workspace_id ?? userId
  } catch {
    // Fall back to the user id if the profile lookup fails (backward compatible).
    return userId
  }
}
