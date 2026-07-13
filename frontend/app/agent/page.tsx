'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// Supabase
import { createClient } from '@/utils/supabase/client'

// Components
import ChatInterface from '@/components/ChatInterface'
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { PageBackground } from '@/components/page-background'

export default function Home() {
  const router = useRouter()

  // Auth & Profile State
  const [userId, setUserId] = useState<string | null>(null)
  const [tenantName, setTenantName] = useState<string>('there')
  const [checkingUser, setCheckingUser] = useState(true)

  useEffect(() => {
    async function loadUser() {
      const supabase = createClient()
      const { data: { user }, error } = await supabase.auth.getUser()

      if (error || !user) {
        router.replace('/auth')
        return
      }

      setUserId(user.id)

      // Fetch tenant_name matching the dashboard requirements
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_name')
        .eq('id', user.id)
        .maybeSingle()

      if (profile?.tenant_name) {
        setTenantName(profile.tenant_name)
      }

      setCheckingUser(false)
    }

    loadUser()
  }, [router])

  // Show a full-screen loading state while we fetch the user ID
  if (checkingUser) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="mt-3 text-sm font-medium">Authenticating session...</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background">
      <PageBackground />
      {/* Top Navigation */}
      <DashboardNav tenantName={tenantName} />

      {/* Edge-to-edge full width and height main container */}
      <main className="flex w-full flex-1 flex-col overflow-hidden">

        {/* Chat Container taking exactly the remaining space, width-to-width */}
        <div className="flex min-h-0 flex-1 flex-col bg-background">
          {userId && <ChatInterface tenantId={userId} />}
        </div>
        
      </main>
    </div>
  )
}