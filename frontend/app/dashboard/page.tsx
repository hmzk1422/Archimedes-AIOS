import { redirect } from 'next/navigation'
import { Suspense } from 'react'

// Supabase
import { createClient } from '@/utils/supabase/server'

// RBAC
import { getAuthUser } from '@/lib/rbac-server'
import { RoleBadge } from '@/components/rbac/RoleBadge'

// Components
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { DashboardCanvas } from '@/components/dashboard/dashboard-canvas'
import { PageBackground } from '@/components/page-background'

export default async function DashboardPage() {
  const authUser = await getAuthUser()

  if (!authUser) redirect('/auth')

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_name, email, created_at')
    .eq('id', authUser.id)
    .single()

  const tenantName = profile?.tenant_name ?? 'there'

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <PageBackground />
      <DashboardNav tenantName={tenantName} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* Tenant Details Header - KEPT AS REQUIRED */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="p-5 bg-card border border-border rounded-lg shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Role</p>
            <div className="mt-1">
              <RoleBadge role={authUser.role} size="md" />
            </div>
          </div>
          <div className="p-5 bg-card border border-border rounded-lg shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Tenant ID</p>
            <p className="text-sm font-semibold text-foreground truncate">{authUser.id}</p>
          </div>
          <div className="p-5 bg-card border border-border rounded-lg shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Tenant Name</p>
            <p className="text-lg font-semibold text-foreground truncate">{profile?.tenant_name ?? '—'}</p>
          </div>
          <div className="p-5 bg-card border border-border rounded-lg shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Email</p>
            <p className="text-sm font-semibold text-foreground truncate">{profile?.email ?? '—'}</p>
          </div>
          <div className="p-5 bg-card border border-border rounded-lg shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Member Since</p>
            <p className="text-lg font-semibold text-foreground">
              {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>

        {/* Draggable, resizable dashboard canvas */}
        <Suspense
          fallback={
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-64 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
              ))}
            </div>
          }
        >
          <DashboardCanvas />
        </Suspense>
      </main>
    </div>
  )
}
