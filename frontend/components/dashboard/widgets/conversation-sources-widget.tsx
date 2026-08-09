'use client'

import { useMemo } from 'react'
import { Pie, PieChart, Cell } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { buildBarData, type WidgetDataPayload } from './chart-data-utils'
import type { DashboardWidget } from './types'
import { WidgetCard } from './widget-card'

const chartConfig = {
  value: { label: 'Share' },
  'Docs & PDFs': { label: 'Docs & PDFs', color: 'var(--chart-1)' },
  Tickets: { label: 'Tickets', color: 'var(--chart-2)' },
  Spreadsheets: { label: 'Spreadsheets', color: 'var(--chart-3)' },
  'Web pages': { label: 'Web pages', color: 'var(--chart-4)' },
  'API sources': { label: 'API sources', color: 'var(--chart-5)' },
} satisfies ChartConfig

const FALLBACK_SOURCES = [
  { name: 'Docs & PDFs', value: 38, fill: 'var(--chart-1)' },
  { name: 'Tickets', value: 27, fill: 'var(--chart-2)' },
  { name: 'Spreadsheets', value: 19, fill: 'var(--chart-3)' },
  { name: 'Web pages', value: 16, fill: 'var(--chart-4)' },
]

export function ConversationSourcesWidget({
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

  // Look for source_type field in telemetry metrics
  const chartData = useMemo(() => {
    const metrics = payload.telemetry_metrics || []
    if (metrics.length === 0) return FALLBACK_SOURCES

    // Count metrics by source_type tag
    const grouped = new Map<string, number>()
    for (const m of metrics) {
      const tags = (m.tags as Record<string, unknown>) || {}
      const source = String(tags.source_type || m.source_type || (m as Record<string, unknown>).source || 'Unknown')
      const val = typeof m.value === 'number' ? m.value : 1
      grouped.set(source, (grouped.get(source) || 0) + val)
    }

    if (grouped.size === 0) return FALLBACK_SOURCES

    const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
    return Array.from(grouped.entries()).map(([name], i) => ({
      name,
      value: grouped.get(name) || 0,
      fill: colors[i % colors.length],
    }))
  }, [payload.telemetry_metrics])

  return (
    <WidgetCard
      widget={widget}
      onConfigChange={onConfigChange}
      onRemove={onRemove}
      onRefresh={onRefresh}
    >
      <div className="flex flex-col items-center">
        <p className="text-xs text-muted-foreground mb-2">Where answers are grounded</p>
        <ChartContainer config={chartConfig} className="h-[180px] aspect-square">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
            <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={38} strokeWidth={2}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <ChartLegend content={<ChartLegendContent />} />
          </PieChart>
        </ChartContainer>
        <div className="mt-2 grid w-full grid-cols-2 gap-2">
          {chartData.map((s) => (
            <div key={s.name} className="flex items-center gap-2 text-xs">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: s.fill }} />
              <span className="text-muted-foreground">{s.name}</span>
              <span className="ml-auto font-medium tabular-nums">{s.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </WidgetCard>
  )
}
