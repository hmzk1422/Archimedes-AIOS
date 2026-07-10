'use server'

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export async function deleteAccountAction() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('User not found')

  // Create an Admin client to perform the deletion
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Delete the user from Auth
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)

  if (error) throw new Error(error.message)

  // Sign out the current session
  await supabase.auth.signOut()

  // Redirect to auth page
  redirect('/auth')
}