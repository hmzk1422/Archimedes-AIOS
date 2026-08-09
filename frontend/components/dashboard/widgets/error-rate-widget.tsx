'use client'

import { useMemo } from 'react'
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { aggregateMetric, type WidgetDataPayload } from './chart-data-utils'
import type { DashboardWidget } from './types'
import { WidgetCard } from './widget-card'

export function ErrorRateWidget({
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

  // Look for error_rate in telemetry metrics; if not found, compute from events
  const errorRate = useMemo(() => {
    const metrics = payload.telemetry_metrics || []
    const fromMetric = aggregateMetric(metrics, 'error_rate', 'avg')
    if (fromMetric !== null) return fromMetric

    // Fallback: count error events / total events
    const events = payload.telemetry_events || []
    const total = events.length
    if (total === 0) return null

    const errors = events.filter((e) => {
      const et = String(e.event_type || e.type || '').toLowerCase()
      return et.includes('error') || et.includes('exception')
    }).length

    return total > 0 ? (errors / total) * 100 : 0
  }, [payload])

  // Compute delta vs. previous period (compare first half vs second half)
  const delta = useMemo(() => {
    const events = payload.telemetry_events || []
    if (events.length < 2) return 0
    const mid = Math.floor(events.length / 2)
    const secondHalf = events.slice(mid)
    const firstHalf = events.slice(0, mid)

    const errCount = (arr: unknown[]) =>
      arr.filter(
        (e) =>
          String((e as Record<string, unknown>).event_type || (e as Record<string, unknown>).type || '').toLowerCase().includes('error'),
      ).length

    const secondRate = secondHalf.length > 0 ? errCount(secondHalf) / secondHalf.length : 0
    const firstRate = firstHalf.length > 0 ? errCount(firstHalf) / firstHalf.length : 0
    return secondRate - firstRate
  }, [payload.telemetry_events])

  const value = errorRate !== null ? `${errorRate.toFixed(1)}%` : '—'
  const hasData = errorRate !== null

  return (
    <WidgetCard
      widget={widget}
      onConfigChange={onConfigChange}
      onRemove={onRemove}
      onRefresh={onRefresh}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-sm text-muted-foreground">
            {hasData ? 'Error rate' : 'No error data available'}
          </p>
          {hasData && (
            <p className="text-xs text-muted-foreground mt-1">
              {delta >= 0 ? 'Increased' : 'Decreased'} vs. previous period
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle
            className={cn(
              'size-6',
              errorRate !== null && errorRate > 5
                ? 'text-destructive'
                : 'text-green-500',
            )}
          />
          {delta !== 0 && (
            <span className="text-xs font-medium">
              {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </WidgetCard>
  )
}
