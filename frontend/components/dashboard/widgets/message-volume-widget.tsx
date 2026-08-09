'use client'

import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { buildBarData, type WidgetDataPayload } from './chart-data-utils'
import type { DashboardWidget } from './types'
import { WidgetCard } from './widget-card'

const chartConfig = {
  messages: { label: 'Messages', color: 'var(--chart-1)' },
} satisfies ChartConfig

const FALLBACK_CHANNELS = [
  { name: 'Telegram', value: 4210 },
  { name: 'WhatsApp', value: 3820 },
  { name: 'Email', value: 2140 },
  { name: 'Web Chat', value: 1680 },
  { name: 'Voice', value: 997 },
]

export function MessageVolumeWidget({
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

  const chartData = useMemo(
    () =>
      buildBarData(
        payload.telemetry_metrics,
        'channel',
        'message_count',
        FALLBACK_CHANNELS,
      ),
    [payload.telemetry_metrics],
  )

  return (
    <WidgetCard
      widget={widget}
      onConfigChange={onConfigChange}
      onRemove={onRemove}
      onRefresh={onRefresh}
    >
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Total messages handled per channel</p>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <BarChart data={chartData} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={44} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="value"
              fill="var(--color-messages)"
              radius={[6, 6, 0, 0]}
              maxBarSize={64}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </div>
    </WidgetCard>
  )
}
