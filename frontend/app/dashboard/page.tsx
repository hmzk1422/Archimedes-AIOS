import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import LogoutButton from '@/components/LogoutButton'
import { deleteAccountAction } from '@/app/actions'
import ChatInterface from '@/components/ChatInterface'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth')

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_name, email, created_at')
    .eq('id', user.id)
    .single()

  return (
    <div className="min-h-screen bg-background p-8 lg:p-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-widest">
              Dashboard
            </h2>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">
              Welcome, {profile?.tenant_name ?? 'there'}
            </h1>
          </div>
          
          {/* Integrated Delete and Logout Actions */}
          <div className="flex items-center gap-4">
            <a
              href="/upload"
              className="text-sm font-medium text-primary hover:underline"
            >
              Upload PDF
            </a>
            <form action={deleteAccountAction}>
              <button 
                type="submit"   
                className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
              >
                Delete Account
              </button>
            </form>
            <LogoutButton />
          </div>
        </div>

        {/* ... rest of your grid code ... */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Tenant ID</p>
            <p className="text-lg font-semibold text-foreground">{user.id}</p>
          </div>
          <div className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Tenant Name</p>
            <p className="text-lg font-semibold text-foreground">{profile?.tenant_name}</p>
          </div>
          <div className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Email</p>
            <p className="text-lg font-semibold text-foreground">{profile?.email}</p>
          </div>
          <div className="p-5 bg-card border border-border rounded-lg">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Member Since</p>
            <p className="text-lg font-semibold text-foreground">
              {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>

        <div className="mt-10">
          <ChatInterface tenantId={user.id} />
        </div>
      </div>
    </div>
  )
}