'use client'

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Cell,
} from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { buildTimeSeries, rangeToPoints, type WidgetDataPayload } from './chart-data-utils'
import type { DashboardWidget } from './types'
import { WidgetCard } from './widget-card'

const areaConfig = {
  resolved: { label: 'Auto-resolved', color: 'var(--chart-1)' },
  escalated: { label: 'Escalated', color: 'var(--chart-2)' },
} satisfies ChartConfig

const pieConfig = {
  value: { label: 'Share' },
  resolved: { label: 'Auto-resolved', color: 'var(--chart-1)' },
  escalated: { label: 'Escalated', color: 'var(--chart-2)' },
} satisfies ChartConfig

export function ResolutionRateWidget({
  widget,
  data,
  onConfigChange,
  onRemove,
  onRefresh,
}: {
  widget: DashboardWidget
  data: unknown
  onConfigChange?: (widget: DashboardWidget) => void
  onRemove?: (id: string) => void
  onRefresh?: () => void
}) {
  const payload = (data || {}) as WidgetDataPayload
  const range = String(widget.config?.range || '30d')
  const points = rangeToPoints(range)

  const resolvedSeries = useMemo(
    () => buildTimeSeries(payload.conversations, ['resolved_count', 'resolved'], 'resolved', 'var(--chart-1)', points),
    [payload.conversations, points],
  )

  const escalatedSeries = useMemo(
    () => buildTimeSeries(payload.conversations, ['escalated_count', 'escalated'], 'escalated', 'var(--chart-2)', points),
    [payload.conversations, points],
  )

  const mergedData = useMemo(() => {
    const map = new Map<string, { date: string; resolved: number; escalated: number }>()
    resolvedSeries.forEach((d) => map.set(d.date, { date: d.date, resolved: Number(d.resolved) || 0, escalated: 0 }))
    escalatedSeries.forEach((d) => {
      const ex = map.get(d.date)
      if (ex) {
        ex.escalated = Number(d.escalated) || 0
      } else {
        map.set(d.date, { date: d.date, resolved: 0, escalated: Number(d.escalated) || 0 })
      }
    })
    return Array.from(map.values()).sort()
  }, [resolvedSeries, escalatedSeries])

  // Pie chart data — total resolved vs escalated
  const pieData = useMemo(() => {
    const totalResolved = mergedData.reduce((sum, d) => sum + (d.resolved || 0), 0)
    const totalEscalated = mergedData.reduce((sum, d) => sum + (d.escalated || 0), 0)
    const total = totalResolved + totalEscalated
    if (total === 0) return [
      { name: 'Auto-resolved', value: 38, fill: 'var(--chart-1)' },
      { name: 'Escalated', value: 27, fill: 'var(--chart-2)' },
    ]
    return [
      { name: 'Auto-resolved', value: totalResolved, fill: 'var(--chart-1)' },
      { name: 'Escalated', value: totalEscalated, fill: 'var(--chart-2)' },
    ]
  }, [mergedData])

  const tickInterval = Math.max(0, Math.floor(points / 6) - 1)

  return (
    <WidgetCard widget={widget} onConfigChange={onConfigChange} onRemove={onRemove} onRefresh={onRefresh}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">Auto-resolved vs. escalated</p>

        <ChartContainer config={areaConfig} className="h-[140px] w-full">
          <AreaChart data={mergedData} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} interval={tickInterval} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <Area dataKey="resolved" type="monotone" stroke="var(--color-resolved)" fill="var(--color-resolved)" strokeWidth={2} stackId="a" isAnimationActive={false} />
            <Area dataKey="escalated" type="monotone" stroke="var(--color-escalated)" fill="var(--color-escalated)" strokeWidth={2} stackId="a" isAnimationActive={false} />
          </AreaChart>
        </ChartContainer>

        <ChartContainer config={pieConfig} className="mx-auto h-[120px] w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={36} strokeWidth={2}>
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <ChartLegend content={<ChartLegendContent />} />
          </PieChart>
        </ChartContainer>
      </div>
    </WidgetCard>
  )
}
