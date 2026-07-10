import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Upload, Activity } from 'lucide-react'

// Supabase & Actions
import { createClient } from '@/utils/supabase/server'
import { deleteAccountAction } from '@/app/actions'

// Components
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { MetricCards } from '@/components/dashboard/metric-cards'
import { DashboardCharts } from '@/components/dashboard/dashboard-charts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import LogoutButton from '@/components/LogoutButton'
import ChatInterface from '@/components/ChatInterface'

const activity = [
  { time: '2m ago', text: 'Resolved refund request', meta: 'billing · email' },
  { time: '14m ago', text: 'Escalated integration bug to on-call', meta: 'engineering · slack' },
  { time: '38m ago', text: 'Ingested 3 PDFs into "returns_policy"', meta: 'knowledge base' },
  { time: '1h ago', text: 'Triggered "create_shipping_label" tool', meta: 'custom action' },
  { time: '2h ago', text: 'Answered 42 chat conversations', meta: 'web chat' },
]

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth')

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_name, email, created_at')
    .eq('id', user.id)
    .single()

  const tenantName = profile?.tenant_name ?? 'there'

  return (
    <div className="min-h-screen bg-background">
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

          {/* Integrated Actions: Delete, Logout, and Upload */}
          <div className="flex items-center gap-4">
            <form action={deleteAccountAction}>
              <button 
                type="submit"   
                className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
              >
                Delete Account
              </button>
            </form>
            <LogoutButton />
            <Link
              href="/upload"
              className={buttonVariants({
                size: 'lg',
                className: 'bg-primary text-primary-foreground hover:bg-primary/90 hidden sm:flex',
              })}
            >
              <Upload className="mr-2 size-4" />
              Upload knowledge
            </Link>
          </div>
        </div>

        <div className="mt-8 space-y-4">
          
          {/* Integrated Tenant Details Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <div className="p-5 bg-card border border-border rounded-lg shadow-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Tenant ID</p>
              <p className="text-sm font-semibold text-foreground truncate">{user.id}</p>
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
          <DashboardCharts />

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

          {/* Integrated Chat Interface */}
          <div className="mt-10">
            <ChatInterface tenantId={user.id} />
          </div>
          
        </div>
      </main>
    </div>
  )
}