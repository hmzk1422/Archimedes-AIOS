'use client'

import dynamic from 'next/dynamic'

const DashboardCharts = dynamic(
  () => import('@/components/dashboard/dashboard-charts').then((mod) => mod.DashboardCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border bg-card p-6 animate-pulse">
          <div className="h-4 w-48 bg-muted rounded mb-3" />
          <div className="h-3 w-64 bg-muted/50 rounded mb-6" />
          <div className="h-[280px] bg-muted/30 rounded" />
        </div>
        <div className="rounded-xl border bg-card p-6 animate-pulse">
          <div className="h-4 w-32 bg-muted rounded mb-3" />
          <div className="h-3 w-40 bg-muted/50 rounded mb-6" />
          <div className="h-[220px] bg-muted/30 rounded" />
        </div>
        <div className="lg:col-span-3 rounded-xl border bg-card p-6 animate-pulse">
          <div className="h-4 w-44 bg-muted rounded mb-3" />
          <div className="h-3 w-52 bg-muted/50 rounded mb-6" />
          <div className="h-[240px] bg-muted/30 rounded" />
        </div>
      </div>
    ),
  }
)

export default function ChartsWrapper() {
  return <DashboardCharts />
}