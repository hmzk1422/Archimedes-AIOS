'use client'

import { useMemo } from 'react'
import { Clock, Bot, User, AlertCircle } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { type WidgetDataPayload } from './chart-data-utils'
import { WidgetCard } from './widget-card'
import type { DashboardWidget } from './types'

interface TelemetryEvent {
  event_type?: string
  type?: string
  timestamp?: string
  ts?: string
  attributes?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export function TracesWidget({
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
  const events = (payload.telemetry_events || []) as TelemetryEvent[]

  // Sort by timestamp descending (most recent first)
  const sorted = useMemo(() => {
    return [...events]
      .sort((a, b) => {
        const ta = new Date(a.timestamp || a.ts || 0).getTime()
        const tb = new Date(b.timestamp || b.ts || 0).getTime()
        return tb - ta
      })
      .slice(0, 50)
  }, [events])

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts)
      return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return ts
    }
  }

  const getEventIcon = (eventType: string) => {
    const t = eventType.toLowerCase()
    if (t.includes('error') || t.includes('exception')) return AlertCircle
    if (t.includes('user') || t.includes('message')) return User
    return Bot
  }

  const getEventTypeColor = (eventType: string) => {
    const t = eventType.toLowerCase()
    if (t.includes('error') || t.includes('exception')) return 'text-destructive'
    if (t.includes('user') || t.includes('message')) return 'text-blue-500'
    return 'text-muted-foreground'
  }

  return (
    <WidgetCard
      widget={widget}
      onConfigChange={onConfigChange}
      onRemove={onRemove}
      onRefresh={onRefresh}
    >
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {sorted.length} events recorded (showing latest 50)
        </p>
        <div className="max-h-[240px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Details</TableHead>
                <TableHead className="text-right text-xs">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-4">
                    No trace events available
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((evt, i) => {
                  const Icon = getEventIcon(evt.event_type || evt.type || 'event')
                  const colorClass = getEventTypeColor(evt.event_type || evt.type || '')
                  const attrs = evt.attributes || evt.metadata || {}
                  const detail = typeof attrs === 'object' ? JSON.stringify(attrs) : String(attrs || '')

                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Icon className={`size-4 ${colorClass}`} />
                          <span className="text-xs font-medium">
                            {evt.event_type || evt.type || 'unknown'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground font-mono">
                          {detail.length > 60 ? `${detail.slice(0, 60)}...` : detail}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-muted-foreground">
                          <Clock className="size-3 inline mr-1" />
                          {formatTime(evt.timestamp || evt.ts || '')}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </WidgetCard>
  )
}
