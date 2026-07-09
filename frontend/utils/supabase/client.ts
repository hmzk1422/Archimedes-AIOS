// utils/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://your-actual-project-id.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "your-actual-public-anon-key";

console.log("DEBUG - Forced URL:", URL);

export function createClient() {
  return createBrowserClient(URL, KEY)
}