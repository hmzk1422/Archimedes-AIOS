'use client'

import { useState, type ReactNode } from 'react'
import { GripVertical, Settings, Settings2, Trash2, RefreshCw, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useDragHandleProps, useWidgetConfig } from './drag-context'
import { getWidgetDefinition } from './widget-registry'
import { useAppearance } from '@/components/appearance/appearance-provider'
import type { DashboardWidget } from './types'

export interface WidgetCardProps {
  widget: DashboardWidget
  onRemove?: (id: string) => void
  onConfigChange?: (widget: DashboardWidget) => void
  onRefresh?: () => void
  children: ReactNode
}

const RANGE_OPTIONS = [
  { key: '7d', label: '7d' },
  { key: '14d', label: '14d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
]

export function WidgetCard({
  widget,
  onRemove,
  onConfigChange,
  onRefresh,
  children,
}: WidgetCardProps) {
  const [showConfig, setShowConfig] = useState(false)
  const dragHandleProps = useDragHandleProps()
  const { appearance } = useAppearance()
  const theme = appearance.theme
  const ctxConfig = useWidgetConfig()
  const configHandler = onConfigChange || ctxConfig?.onConfigChange

  const definition = getWidgetDefinition(widget.type)
  const title = widget.config?.title || definition?.name || widget.type
  const description = widget.config?.description
  const accent = (widget.config?.accent as string) || theme.primary
  const aiManaged = Boolean(widget.config?.aiManaged)

  const commit = (patch: Record<string, unknown>) => {
    if (!configHandler) return
    configHandler({
      ...widget,
      config: { ...widget.config, ...patch },
    })
  }

  return (
    <Card
      className={cn('relative h-full flex flex-col overflow-hidden')}
      style={aiManaged ? { boxShadow: `inset 0 2px 0 0 ${accent}` } : undefined}
    >
      {/* Accent highlight bar — follows the widget (or brand) color */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
        style={{ backgroundColor: accent }}
      />
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="cursor-grab rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
              title="Drag to move"
              {...dragHandleProps}
            >
              <GripVertical className="size-4" />
            </span>
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-1.5 truncate text-sm font-medium">
                {title}
                {aiManaged && (
                  <Sparkles className="size-3 shrink-0 text-primary" aria-label="AI-managed" />
                )}
              </CardTitle>
              {description && (
                <CardDescription className="mt-0.5 line-clamp-1 text-xs">
                  {description}
                </CardDescription>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <Button variant="ghost" size="xs" onClick={onRefresh} title="Refresh data">
                <RefreshCw className="size-3" />
              </Button>
            )}
            {configHandler && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setShowConfig((v) => !v)}
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

      <CardContent className="flex-1 overflow-hidden">{children}</CardContent>


      {showConfig && configHandler && (
        <div className="space-y-4 border-t border-border p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <Settings2 className="size-3.5" />
              Widget settings
            </p>
            <Button variant="ghost" size="xs" onClick={() => setShowConfig(false)}>
              Done
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${widget.id}-title`}>Title</Label>
              <Input
                id={`${widget.id}-title`}
                value={title}
                placeholder={definition?.name}
                onChange={(e) => commit({ title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${widget.id}-description`}>Description</Label>
              <Input
                id={`${widget.id}-description`}
                value={description || ''}
                placeholder="Optional subtitle"
                onChange={(e) => commit({ description: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${widget.id}-accent`}>Accent color</Label>
              <div className="flex items-center gap-2">
                <input
                  id={`${widget.id}-accent`}
                  type="color"
                  value={accent}
                  onChange={(e) => commit({ accent: e.target.value })}
                  className="size-8 cursor-pointer rounded border border-border bg-transparent"
                />
                <input
                  type="text"
                  value={accent}
                  onChange={(e) => commit({ accent: e.target.value })}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Time range</Label>
              <div className="flex gap-1">
                {RANGE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.key}
                    variant={String(widget.config?.range || '30d') === opt.key ? 'default' : 'outline'}
                    size="xs"
                    onClick={() => commit({ range: opt.key })}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Widget-specific fields from the registry schema */}
          {definition?.configSchema?.map((field) => {
            const value = widget.config?.[field.key]
            if (field.type === 'select') {
              return (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`${widget.id}-${field.key}`}>{field.label}</Label>
                  <select
                    id={`${widget.id}-${field.key}`}
                    value={String(value ?? field.options?.[0]?.value ?? '')}
                    onChange={(e) => commit({ [field.key]: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background p-2 text-sm"
                  >
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            }
            return (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`${widget.id}-${field.key}`}>{field.label}</Label>
                <Input
                  id={`${widget.id}-${field.key}`}
                  value={String(value ?? '')}
                  placeholder={field.placeholder}
                  onChange={(e) => commit({ [field.key]: e.target.value })}
                />
              </div>
            )
          })}

          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">AI-managed</p>
              <p className="text-xs text-muted-foreground">
                Let the AI auto-tune this widget&apos;s range &amp; placement.
              </p>
            </div>
            <Switch checked={aiManaged} onCheckedChange={(v) => commit({ aiManaged: v })} />
          </div>
        </div>
      )}
    </Card>
  )
}
