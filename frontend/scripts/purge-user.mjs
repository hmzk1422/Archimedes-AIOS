// scripts/purge-user.mjs
// ---------------------------------------------------------------
// Fully remove a user (auth + profile) so the email can be reused.
//
// Run from the frontend folder:
//   node scripts/purge-user.mjs youremail@example.com
//
// It needs these environment variables (set them in your shell or
// in a `.env.local` style file before running):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   <-- your secret service-role key
// ---------------------------------------------------------------
import { createClient } from '@supabase/supabase-js'

const email = (process.argv[2] || '').trim().toLowerCase()
if (!email) {
  console.error('Usage: node scripts/purge-user.mjs <email>')
  process.exit(1)
}

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.')
  process.exit(1)
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 1) Delete the auth user (removes auth.users + auth.identities).
const {
  data: { users },
} = await admin.auth.admin.listUsers()
const match = (users || []).find((u) => u.email?.toLowerCase() === email)

if (match) {
  const { error } = await admin.auth.admin.deleteUser(match.id)
  if (error) {
    console.error(`Auth delete failed for ${email}:`, error.message)
  } else {
    console.log(`Deleted auth user ${match.id} (${email})`)
  }
} else {
  console.log(`No auth user found for ${email} — already gone.`)
}

// 2) Delete any orphaned profile rows for that email.
const { data: profs, error: pErr } = await admin
  .from('profiles')
  .select('id, email')
  .eq('email', email)

if (pErr) {
  console.error('Profile query failed:', pErr.message)
} else {
  for (const p of profs || []) {
    const { error } = await admin.from('profiles').delete().eq('id', p.id)
    if (error) {
      console.error(`Profile delete failed for ${p.id}:`, error.message)
    } else {
      console.log(`Deleted profile ${p.id} (${email})`)
    }
  }
}

console.log(`\nDone. You can now register a fresh account with ${email}.`)
