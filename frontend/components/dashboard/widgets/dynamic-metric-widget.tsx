'use client'

import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
  LineChart,
  Area,
  AreaChart,
  Pie,
  PieChart,
  Cell,
  Legend,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { DashboardWidget } from './types'
import { WidgetCard } from './widget-card'
import type { WidgetDataPayload } from './chart-data-utils'

const chartConfig = { value: { label: 'Value', color: 'var(--chart-1)' } } satisfies ChartConfig

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  '#f59e0b',
  '#10b981',
  '#ef4444',
]

type Viz = 'kpi' | 'chart' | 'table' | 'tagcloud' | 'score_gauge'
type Row = { name: string; value: number; count: number }

function numVal(v: unknown): number | null {
  if (typeof v === 'boolean') return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

/** Client-side mirror of the backend GET /metrics aggregator. */
function aggVals(vals: number[], agg: string): number | null {
  if (vals.length === 0) return null
  switch (agg) {
    case 'sum':
      return vals.reduce((a, b) => a + b, 0)
    case 'max':
      return Math.max(...vals)
    case 'min':
      return Math.min(...vals)
    case 'count':
      return vals.length
    case 'distinct':
      return new Set(vals).size
    default:
      return vals.reduce((a, b) => a + b, 0) / vals.length
  }
}

function groupKey(rec: Record<string, unknown>, gby: string): string {
  if (gby.startsWith('tags.')) {
    const t =
      rec.tags && typeof rec.tags === 'object'
        ? (rec.tags as Record<string, unknown>)
        : {}
    return String(t[gby.slice(5)] ?? '')
  }
  if (gby === 'metric_name') return String(rec.metric_name ?? '')
  return String(rec[gby] ?? '')
}

function formatNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

export function DynamicMetricWidget({
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
  const cfg = (widget.config || {}) as Record<string, unknown>

  const metricName = String(cfg.metricName || '').trim()
  const metricField = String(cfg.metricField || 'value')
  const groupBy = String(cfg.groupBy || '').trim()
  const aggregation = String(cfg.aggregation || 'avg')
  const viz = String(cfg.viz || 'kpi') as Viz
  const chartType = String(cfg.chartType || 'bar')
  const scoreMin = numVal(cfg.scoreMin)
  const scoreMax = numVal(cfg.scoreMax)

  // Tag filter from JSON config, e.g. {"risk":"high"}
  const filters = useMemo(() => {
    const raw = String(cfg.filters || '')
    if (!raw) return {} as Record<string, unknown>
    try {
      const p = JSON.parse(raw)
      return p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }, [cfg.filters])

  const records = (payload.telemetry_metrics || []) as Record<string, unknown>[]

  const filtered = useMemo(() => {
    let out = records
    if (metricName) out = out.filter((r) => String(r.metric_name) === metricName)
    const fkeys = Object.keys(filters)
    if (fkeys.length) {
      out = out.filter((r) => {
        const t =
          r.tags && typeof r.tags === 'object'
            ? (r.tags as Record<string, unknown>)
            : {}
        return fkeys.every((k) => String(t[k]) === String(filters[k]))
      })
    }
    return out
  }, [records, metricName, filters])

  const rows = useMemo<Row[]>(() => {
    const values = filtered
      .map((r) => numVal(r[metricField]))
      .filter((v): v is number => v !== null)

    if (!groupBy) {
      const v = aggVals(values, aggregation)
      return v === null
        ? []
        : [{ name: metricName || 'all', value: v, count: values.length }]
    }

    const map = new Map<string, number[]>()
    for (const r of filtered) {
      const v = numVal(r[metricField])
      if (v === null) continue
      const k = groupKey(r, groupBy) || '—'
      const arr = map.get(k)
      if (arr) arr.push(v)
      else map.set(k, [v])
    }
    return Array.from(map.entries()).map(([name, vals]) => ({
      name,
      value: aggVals(vals, aggregation) ?? 0,
      count: vals.length,
    }))
  }, [filtered, groupBy, metricField, aggregation, metricName])

  const primaryValue = rows.length ? rows[0].value : null
  const maxRow = rows.reduce((m, r) => Math.max(m, r.value), 0)
  const range = (scoreMax ?? 100) - (scoreMin ?? 0)
  const gaugePct = clamp(
    ((primaryValue ?? 0) - (scoreMin ?? 0)) / (range || 1),
    0,
    1,
  )
  const xTick = groupBy ? { angle: -20, height: 40 } : { tickMargin: 8 }

  const renderGroupedKpi = () => (
    <div className="space-y-1.5 p-3">
      <p className="text-xs text-muted-foreground">
        Top {rows.length} buckets ({aggregation}) by {groupBy}
      </p>
      {rows.slice(0, 6).map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="w-24 truncate text-sm">{r.name}</span>
          <div className="h-2 flex-1 rounded-full bg-secondary/50">
            <div
              className="h-2 rounded-full bg-primary/70"
              style={{ width: `${maxRow ? (r.value / maxRow) * 100 : 0}%` }}
            />
          </div>
          <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
            {formatNum(r.value)}
          </span>
        </div>
      ))}
    </div>
  )

  const renderBody = () => {
    if (!rows.length) {
      return (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          No data{metricName ? ` for "${metricName}"` : ''} yet.
        </div>
      )
    }

    if (viz === 'kpi' || viz === 'score_gauge') {
      if (groupBy) return renderGroupedKpi()
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4">
          {viz === 'score_gauge' ? (
            <svg viewBox="0 0 120 120" className="size-36">
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="var(--muted)"
                strokeWidth="10"
              />
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 50 * gaugePct} ${2 * Math.PI * 50}`}
                transform="rotate(-90 60 60)"
              />
              <text
                x="60"
                y="58"
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-2xl font-bold"
              >
                {formatNum(primaryValue ?? 0)}
              </text>
              <text
                x="60"
                y="78"
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground text-xs"
              >
                / {formatNum(scoreMax ?? 100)}
              </text>
            </svg>
          ) : (
            <p className="text-4xl font-bold tabular-nums">
              {formatNum(primaryValue ?? 0)}
            </p>
          )}
          <p className="text-sm font-medium text-muted-foreground">
            {metricName || 'Metric'}
          </p>
          {rows[0] && (
            <p className="text-xs text-muted-foreground">
              {rows[0].count} samples ({aggregation})
            </p>
          )}
        </div>
      )
    }

    if (viz === 'table') {
      return (
        <div className="max-h-64 overflow-auto px-2 pb-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Bucket</th>
                <th className="py-1 pr-3 text-right font-medium">Value</th>
                <th className="py-1 text-right font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-border/50">
                  <td className="py-1 pr-3">{r.name}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {formatNum(r.value)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">
                    {r.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (viz === 'tagcloud') {
      return (
        <div className="flex flex-wrap items-center gap-2 p-4">
          {rows.map((r) => {
            const p = maxRow > 0 ? r.value / maxRow : 0
            return (
              <span
                key={r.name}
                className="rounded-md bg-secondary/50 px-2 py-1 font-medium"
                style={{ fontSize: `${11 + p * 16}px`, opacity: 0.55 + p * 0.45 }}
                title={`${r.name}: ${formatNum(r.value)} (${r.count})`}
              >
                {r.name}
              </span>
            )
          })}
        </div>
      )
    }

    if (chartType === 'pie') {
      return (
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent />} />
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              innerRadius={45}
              outerRadius={80}
              isAnimationActive={false}
            >
              {rows.map((entry, i) => (
                <Cell key={entry.name} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Legend />
          </PieChart>
        </ChartContainer>
      )
    }

    if (chartType === 'line') {
      return (
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <LineChart data={rows} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} {...xTick} />
            <YAxis tickLine={false} axisLine={false} width={44} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      )
    }

    if (chartType === 'area') {
      return (
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={rows} margin={{ left: 4, right: 4, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} {...xTick} />
            <YAxis tickLine={false} axisLine={false} width={44} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              fill="var(--color-value)"
              fillOpacity={0.2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )
    }

    // bar (default)
    return (
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <BarChart data={rows} margin={{ left: 4, right: 4, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} {...xTick} />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
    )
  }

  return (
    <WidgetCard
      widget={widget}
      onConfigChange={onConfigChange}
      onRemove={onRemove}
      onRefresh={onRefresh}
    >
      <div className="space-y-1">{renderBody()}</div>
    </WidgetCard>
  )
}