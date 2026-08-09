'use client'

import { useMemo } from 'react'
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
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
  latency: { label: 'Avg Latency', color: 'var(--chart-1)' },
} satisfies ChartConfig

export function LatencyWidget({
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

  const chartData = useMemo(
    () =>
      buildTimeSeries(
        payload.telemetry_metrics,
        ['latency_ms', 'response_time_ms', 'latency', 'p99_latency_ms'],
        'latency',
        'var(--chart-1)',
        points,
      ),
    [payload.telemetry_metrics, points],
  )

  const tickInterval = Math.max(0, Math.floor(points / 6) - 1)

  return (
    <WidgetCard
      widget={widget}
      onConfigChange={onConfigChange}
      onRemove={onRemove}
      onRefresh={onRefresh}
    >
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Average response latency over time</p>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <LineChart data={chartData} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={tickInterval}
              minTickGap={16}
            />
            <YAxis tickLine={false} axisLine={false} width={44} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="latency"
              type="monotone"
              stroke="var(--color-latency)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>
    </WidgetCard>
  )
}
