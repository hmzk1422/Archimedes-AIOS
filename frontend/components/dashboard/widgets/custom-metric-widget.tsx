'use client'

import { useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus, Plus, Settings2 } from 'lucide-react'
import { WidgetCard } from './widget-card'
import type { DashboardWidget } from './types'
import { aggregateMetric } from './chart-data-utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CustomMetricWidget({ widget, data }: { widget: DashboardWidget; data: unknown }) {
  const [configOpen, setConfigOpen] = useState(false)
  const [metricName, setMetricName] = useState((widget.config?.metricName as string) || 'Custom Metric')
  const [metricField, setMetricField] = useState((widget.config?.metricField as string) || 'value')
  const [aggregation, setAggregation] = useState((widget.config?.aggregation as string) || 'avg')

  const payload = data as Record<string, unknown>
  const conversations = (payload.conversations || []) as Record<string, unknown>[]
  const metrics = (payload.telemetry_metrics || []) as Record<string, unknown>[]

  const value = useMemo(() => {
    const records = metricField === 'conversations' ? conversations : metrics
    return aggregateMetric(records, metricField, aggregation as 'avg' | 'sum' | 'max' | 'count')
  }, [conversations, metrics, metricField, aggregation])

  const previousValue = useMemo(() => {
    const records = metricField === 'conversations' ? conversations : metrics
    const allValues = records
      .map((r) => Number(r[metricField]))
      .filter((v) => !isNaN(v))
    if (allValues.length < 2) return null
    const last = allValues[allValues.length - 1]
    const prev = allValues[allValues.length - 2]
    return prev
  }, [conversations, metrics, metricField])

  const change = previousValue !== null && value !== null ? value - previousValue : null
  const changePercent = previousValue && change !== null ? ((change / previousValue) * 100).toFixed(1) : null

  const TrendIcon = change === null ? Minus : change > 0 ? TrendingUp : TrendingDown
  const trendColor = change === null ? 'text-muted-foreground' : change > 0 ? 'text-green-600' : 'text-red-600'

  return (
    <WidgetCard widget={widget}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-2xl font-bold tabular-nums">
              {value !== null ? value.toFixed(2) : '—'}
            </p>
            <p className="text-sm text-muted-foreground">{metricName}</p>
          </div>
          <Dialog open={configOpen} onOpenChange={setConfigOpen}>
            <DialogTrigger className="size-7">
              <Settings2 className="size-4" />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Configure Custom Metric</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="metricName">Metric Name</Label>
                  <Input
                    id="metricName"
                    value={metricName}
                    onChange={(e) => setMetricName(e.target.value)}
                    placeholder="e.g., Deflection Rate"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metricField">Data Field</Label>
                  <Input
                    id="metricField"
                    value={metricField}
                    onChange={(e) => setMetricField(e.target.value)}
                    placeholder="e.g., resolved_count, cost, latency"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aggregation">Aggregation</Label>
                  <select
                    id="aggregation"
                    value={aggregation}
                    onChange={(e) => setAggregation(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background p-2 text-sm"
                  >
                    <option value="avg">Average</option>
                    <option value="sum">Sum</option>
                    <option value="max">Maximum</option>
                    <option value="count">Count</option>
                  </select>
                </div>
                <Button
                  onClick={() => {
                    widget.config = { ...(widget.config || {}), metricName, metricField, aggregation } as DashboardWidget['config']
                    setConfigOpen(false)
                  }}
                  className="w-full"
                >
                  Save Configuration
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {changePercent !== null && (
          <div className={`flex items-center gap-1 text-sm ${trendColor}`}>
            <TrendIcon className="size-4" />
            <span className="font-medium">{Math.abs(Number(changePercent))}%</span>
            <span className="text-muted-foreground">vs. previous</span>
          </div>
        )}

        <div className="pt-2 border-t border-border/60">
          <p className="text-xs text-muted-foreground">
            Tracking: {metricField} ({aggregation})
          </p>
        </div>
      </div>
    </WidgetCard>
  )
}
