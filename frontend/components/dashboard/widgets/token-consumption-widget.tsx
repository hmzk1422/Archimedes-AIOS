'use client'

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  buildTimeSeries,
  rangeToPoints,
  type WidgetDataPayload,
} from './chart-data-utils'
import type { DashboardWidget } from './types'
import { WidgetCard } from './widget-card'

const chartConfig = {
  resolved: { label: 'Auto-resolved', color: 'var(--chart-1)' },
  escalated: { label: 'Escalated', color: 'var(--chart-2)' },
} satisfies ChartConfig

export function TokenConsumptionWidget({
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

  const resolvedData = useMemo(
    () =>
      buildTimeSeries(
        payload.conversations,
        ['resolved_count', 'resolved'],
        'resolved',
        'var(--chart-1)',
        points,
      ),
    [payload.conversations, points],
  )

  const escalatedData = useMemo(
    () =>
      buildTimeSeries(
        payload.conversations,
        ['escalated_count', 'escalated'],
        'escalated',
        'var(--chart-2)',
        points,
      ),
    [payload.conversations, points],
  )

  // Merge into a single series array (by date)
  const mergedData = useMemo(() => {
    const map = new Map<string, { date: string; resolved: number; escalated: number }>()
    resolvedData.forEach((d) => {
      map.set(d.date, { date: d.date, resolved: Number(d.resolved) || 0, escalated: 0 })
    })
    escalatedData.forEach((d) => {
      const existing = map.get(d.date)
      if (existing) {
        existing.escalated = Number(d.escalated) || 0
      } else {
        map.set(d.date, { date: d.date, resolved: 0, escalated: Number(d.escalated) || 0 })
      }
    })
    return Array.from(map.values()).sort()
  }, [resolvedData, escalatedData])

  const tickInterval = Math.max(0, Math.floor(points / 6) - 1)

  return (
    <WidgetCard
      widget={widget}
      onConfigChange={onConfigChange}
      onRemove={onRemove}
      onRefresh={onRefresh}
    >
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Auto-resolved vs. escalated over time
        </p>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={mergedData} margin={{ left: 4, right: 4, top: 8 }}>
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
      </div>
    </WidgetCard>
  )
}
