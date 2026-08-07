import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Activity } from 'lucide-react'

// Supabase
import { createClient } from '@/utils/supabase/server'

// RBAC
import { getAuthUser } from '@/lib/rbac-server'
import { RoleBadge } from '@/components/rbac/RoleBadge'

// Components
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { MetricCards } from '@/components/dashboard/metric-cards'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageBackground } from '@/components/page-background'
import ChartsWrapper from '@/components/dashboard/charts-wrapper'

const activity = [
  { time: '2m ago', text: 'Resolved refund request', meta: 'billing · email' },
  { time: '14m ago', text: 'Escalated integration bug to on-call', meta: 'engineering · slack' },
  { time: '38m ago', text: 'Ingested 3 PDFs into "returns_policy"', meta: 'knowledge base' },
  { time: '1h ago', text: 'Triggered "create_shipping_label" tool', meta: 'custom action' },
  { time: '2h ago', text: 'Answered 42 chat conversations', meta: 'web chat' },
]

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
    <div className="relative min-h-screen overflow-hidden bg-background">
      <PageBackground />
      <DashboardNav tenantName={tenantName} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        
        {/* Header Section */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Overview</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-balance">
              Welcome back, {tenantName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Here&apos;s how your support agent is performing across every channel.
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-4">
          
          {/* Integrated Tenant Details Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
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

          {/* New GUI Metrics & Charts */}
          <MetricCards />
          <Suspense fallback={null}>
            <ChartsWrapper />
          </Suspense>

          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <Activity className="size-4 text-primary" />
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border/60">
                {activity.map((item, i) => (
                  <li key={i} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                    <span className="size-2 shrink-0 rounded-full bg-primary" />
                    <span className="text-sm font-medium text-foreground">{item.text}</span>
                    <span className="ml-auto hidden text-xs text-muted-foreground sm:block">{item.meta}</span>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{item.time}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}