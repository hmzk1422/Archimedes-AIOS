'use client'

import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  buildBarData,
  rangeToPoints,
  type WidgetDataPayload,
} from './chart-data-utils'
import type { DashboardWidget } from './types'
import { WidgetCard } from './widget-card'

const chartConfig = {
  cost: { label: 'Cost', color: 'var(--chart-1)' },
} satisfies ChartConfig

const FALLBACK_COSTS = [
  { name: 'Telegram', value: 320 },
  { name: 'WhatsApp', value: 280 },
  { name: 'Email', value: 410 },
  { name: 'Web Chat', value: 190 },
]

export function CostPerSessionWidget({
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

  const chartData = useMemo(
    () =>
      buildBarData(
        payload.telemetry_metrics,
        'channel',
        'cost_usd',
        FALLBACK_COSTS,
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
        <p className="text-xs text-muted-foreground">Cost per session by channel</p>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <BarChart data={chartData} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={44} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="value"
              fill="var(--color-cost)"
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
