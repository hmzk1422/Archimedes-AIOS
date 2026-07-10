'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

const RANGES = [
  { key: '7d', label: '7 days', points: 7 },
  { key: '30d', label: '30 days', points: 30 },
  { key: '90d', label: '90 days', points: 90 },
] as const

type RangeKey = (typeof RANGES)[number]['key']

// Deterministic pseudo-random so server/client render match and preview is stable.
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function buildVolumeSeries(points: number) {
  const rand = seeded(points)
  const today = new Date()
  return Array.from({ length: points }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - (points - 1 - i))
    const base = 220 + Math.sin(i / 4) * 60 + rand() * 90
    const resolved = Math.round(base)
    const escalated = Math.round(base * (0.06 + rand() * 0.06))
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      resolved,
      escalated,
    }
  })
}

const volumeConfig = {
  resolved: { label: 'Auto-resolved', color: 'var(--chart-1)' },
  escalated: { label: 'Escalated', color: 'var(--chart-2)' },
} satisfies ChartConfig

const channelData = [
  { channel: 'Email', conversations: 4210 },
  { channel: 'Chat', conversations: 3820 },
  { channel: 'Slack', conversations: 2140 },
  { channel: 'API', conversations: 1680 },
  { channel: 'Voice', conversations: 997 },
]

const channelConfig = {
  conversations: { label: 'Conversations', color: 'var(--chart-1)' },
} satisfies ChartConfig

const sourceData = [
  { name: 'Docs & PDFs', value: 38, fill: 'var(--chart-1)' },
  { name: 'Tickets', value: 27, fill: 'var(--chart-2)' },
  { name: 'Spreadsheets', value: 19, fill: 'var(--chart-3)' },
  { name: 'Web pages', value: 16, fill: 'var(--chart-4)' },
]

const sourceConfig = {
  value: { label: 'Share' },
  'Docs & PDFs': { label: 'Docs & PDFs', color: 'var(--chart-1)' },
  Tickets: { label: 'Tickets', color: 'var(--chart-2)' },
  Spreadsheets: { label: 'Spreadsheets', color: 'var(--chart-3)' },
  'Web pages': { label: 'Web pages', color: 'var(--chart-4)' },
} satisfies ChartConfig

export function DashboardCharts() {
  const [range, setRange] = useState<RangeKey>('30d')
  const activeRange = RANGES.find((r) => r.key === range) ?? RANGES[1]
  const volumeData = useMemo(() => buildVolumeSeries(activeRange.points), [activeRange.points])
  const tickInterval = Math.max(0, Math.floor(activeRange.points / 6) - 1)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle>Conversation volume</CardTitle>
            <CardDescription>Auto-resolved vs. escalated over time</CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/40 p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  range === r.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={volumeConfig} className="aspect-auto h-[280px] w-full">
            <AreaChart data={volumeData} margin={{ left: 4, right: 4, top: 8 }}>
              <defs>
                <linearGradient id="fillResolved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-resolved)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-resolved)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fillEscalated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-escalated)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-escalated)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={tickInterval}
                minTickGap={16}
              />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                dataKey="resolved"
                type="monotone"
                stroke="var(--color-resolved)"
                fill="url(#fillResolved)"
                strokeWidth={2}
                stackId="a"
                isAnimationActive={false}
              />
              <Area
                dataKey="escalated"
                type="monotone"
                stroke="var(--color-escalated)"
                fill="url(#fillEscalated)"
                strokeWidth={2}
                stackId="a"
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Knowledge sources</CardTitle>
          <CardDescription>Where answers are grounded</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          <ChartContainer config={sourceConfig} className="mx-auto aspect-square h-[220px]">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
              <Pie data={sourceData} dataKey="value" nameKey="name" innerRadius={58} strokeWidth={2}>
                {sourceData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="mt-2 grid w-full grid-cols-2 gap-2">
            {sourceData.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-xs">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: s.fill }} />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="ml-auto font-medium tabular-nums">{s.value}%</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="space-y-1">
          <CardTitle>Conversations by channel</CardTitle>
          <CardDescription>Total volume per connected channel</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={channelConfig} className="aspect-auto h-[240px] w-full">
            <BarChart data={channelData} margin={{ left: 4, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="channel" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={44} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="conversations"
                fill="var(--color-conversations)"
                radius={[6, 6, 0, 0]}
                maxBarSize={64}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
