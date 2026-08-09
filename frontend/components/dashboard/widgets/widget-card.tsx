'use client'

import { useState, type ReactNode } from 'react'
import { GripVertical, Settings, Trash2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useDragHandleProps } from './drag-context'
import type { DashboardWidget } from './types'

export interface WidgetCardProps {
  widget: DashboardWidget
  onRemove?: (id: string) => void
  onConfigChange?: (widget: DashboardWidget) => void
  onRefresh?: () => void
  children: ReactNode
}

export function WidgetCard({
  widget,
  onRemove,
  onConfigChange,
  onRefresh,
  children,
}: WidgetCardProps) {
  const [showConfig, setShowConfig] = useState(false)
  const dragHandleProps = useDragHandleProps()
  const title = widget.config?.title || widget.type

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="cursor-grab rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
              title="Drag to move"
              {...dragHandleProps}
            >
              <GripVertical className="size-4" />
            </span>
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <Button
                variant="ghost"
                size="xs"
                onClick={onRefresh}
                title="Refresh data"
              >
                <RefreshCw className="size-3" />
              </Button>
            )}
            {onConfigChange && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setShowConfig(!showConfig)}
                title="Configure widget"
              >
                <Settings className="size-3" />
              </Button>
            )}
            {onRemove && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onRemove(widget.id)}
                title="Remove widget"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden">
        {children}
      </CardContent>

      {showConfig && onConfigChange && (
        <div className="border-t border-border p-3">
          <RangeSelector
            current={String(widget.config?.range || '30d')}
            onChange={(range) =>
              onConfigChange({
                ...widget,
                config: { ...widget.config, range },
              })
            }
          />
        </div>
      )}
    </Card>
  )
}

function RangeSelector({
  current,
  onChange,
}: {
  current: string
  onChange: (range: string) => void
}) {
  const options = [
    { key: '7d', label: '7 days' },
    { key: '14d', label: '14 days' },
    { key: '30d', label: '30 days' },
    { key: '90d', label: '90 days' },
  ]
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <Button
          key={opt.key}
          variant={current === opt.key ? 'default' : 'outline'}
          size="xs"
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  )
}
