'use client'

import { useState, useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { useDashboard } from '@/hooks/useDashboard'
import { WIDGET_REGISTRY } from '@/components/dashboard/widgets/widget-registry'
import { DragHandleContext } from '@/components/dashboard/widgets/drag-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Save, X } from 'lucide-react'
import type { DashboardWidget } from '@/components/dashboard/widgets/types'

/** Number of columns in the dashboard grid. */
const GRID_COLS = 12
/** Pixel height of one grid row. */
const ROW_HEIGHT = 112

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function doRectsOverlap(a: DashboardWidget, b: DashboardWidget): boolean {
  return !(a.x >= b.x + b.w || a.x + a.w <= b.x || a.y >= b.y + b.h || a.y + a.h <= b.y)
}

/**
 * Repositions `movedId` to (nx, ny) and pushes any overlapping widgets below so
 * that nothing overlaps when the drop is committed.
 */
function resolveCollisions(
  widgets: DashboardWidget[],
  movedId: string,
  nx: number,
  ny: number
): DashboardWidget[] {
  const next = widgets.map((w) => ({ ...w }))
  const moved = next.find((w) => w.id === movedId)
  if (!moved) return next
  moved.x = nx
  moved.y = ny

  // Iteratively separate overlapping widgets until the layout is stable.
  let changed = true
  let guard = 0
  while (changed && guard < 500) {
    changed = false
    guard++
    for (let i = 0; i < next.length; i++) {
      for (let j = 0; j < next.length; j++) {
        if (i === j) continue
        if (!doRectsOverlap(next[i], next[j])) continue
        // Push the lower widget down; if they start at the same row, push j down.
        if (next[j].y >= next[i].y) {
          next[j].y = next[i].y + next[i].h
        } else {
          next[i].y = next[j].y + next[j].h
        }
        changed = true
      }
    }
  }
  return next
}

  function DraggableWidget({
  widget,
  data,
  onRemove,
  onResize,
}: {
  widget: DashboardWidget
  data: unknown
  onRemove: (id: string) => void
  onResize?: (id: string, w: number, h: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: widget.id,
  })
  const entry = WIDGET_REGISTRY[widget.type]
  const WidgetComponent = entry?.component

  // Live size override while dragging a resize handle (committed on pointer up).
  const [resizeOverride, setResizeOverride] = useState<{ w: number; h: number } | null>(null)
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const resizeRef = useRef<{
    startX: number
    startY: number
    w: number
    h: number
    cellW: number
    cellH: number
    homeX: number
    homeY: number
  } | null>(null)

  const w = clamp(resizeOverride?.w ?? (widget.w || 2), 1, GRID_COLS)
  const h = resizeOverride?.h ?? (widget.h || 2)

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const el = nodeRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const curW = widget.w || 2
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      w: curW,
      h: widget.h || 2,
      cellW: Math.max(1, rect.width / curW),
      cellH: ROW_HEIGHT,
      homeX: widget.x,
      homeY: widget.y,
    }

    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current
      if (!r) return
      const dx = ev.clientX - r.startX
      const dy = ev.clientY - r.startY
      const nw = clamp(r.w + Math.round(dx / r.cellW), 2, GRID_COLS - r.homeX)
      const nh = clamp(r.h + Math.round(dy / r.cellH), 2, 40 - r.homeY)
      setResizeOverride({ w: nw, h: nh })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const r = resizeRef.current
      resizeRef.current = null
      if (!r) return
      const dx = ev.clientX - r.startX
      const dy = ev.clientY - r.startY
      const nw = clamp(r.w + Math.round(dx / r.cellW), 2, GRID_COLS - r.homeX)
      const nh = clamp(r.h + Math.round(dy / r.cellH), 2, 40 - r.homeY)
      setResizeOverride(null)
      onResize?.(widget.id, nw, nh)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <DragHandleContext.Provider value={{ ...listeners, ...attributes }}>
      <div
        ref={(el) => {
          setNodeRef(el)
          nodeRef.current = el
        }}
        className="absolute"
        style={{
          left: `${(widget.x / GRID_COLS) * 100}%`,
          top: `${(widget.y || 0) * ROW_HEIGHT}px`,
          width: `${(w / GRID_COLS) * 100}%`,
          height: `${h * ROW_HEIGHT}px`,
          transform: CSS.Translate.toString(transform),
          zIndex: isDragging ? 40 : 10,
          opacity: isDragging ? 0.95 : 1,
        }}
      >
        <div className="h-full p-1.5">
          <div
            className={cn(
              'group relative h-full rounded-xl border border-border/60 bg-card shadow-sm transition-shadow',
              isDragging && 'shadow-xl ring-2 ring-primary/40'
            )}
          >
            <button
              onClick={() => onRemove(widget.id)}
              title="Remove widget"
              className="absolute right-2 top-2 z-30 rounded-md border border-border bg-background/90 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
            <div className="h-full overflow-hidden rounded-xl">
              {WidgetComponent ? <WidgetComponent widget={widget} data={data} /> : null}
            </div>
            {/* Resize handle (bottom-right corner) */}
                        <div
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                startResize(e)
              }}
              title="Drag to resize"
              className="absolute bottom-1 right-1 z-30 flex size-4 cursor-se-resize items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" className="fill-current">
                <path d="M0 10 L10 0 L10 10 Z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </DragHandleContext.Provider>
  )
}

export function DashboardCanvas() {
  const {
    widgets,
    loading,
    saving,
    dataLoading,
    error,
    addWidget,
    removeWidget,
    saveNow,
    refreshData,
    widgetData,
    applyLayout,
  } = useDashboard()

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const id = String(event.active.id)
      setActiveId(null)
      const widget = widgets.find((w) => w.id === id)
      if (!widget || !containerRef.current) return

      const containerWidth = containerRef.current.clientWidth
      const cellWidth = Math.max(1, containerWidth / GRID_COLS)
      const newX = clamp(widget.x + Math.round(event.delta.x / cellWidth), 0, GRID_COLS - (widget.w || 2))
      const newY = clamp(widget.y + Math.round(event.delta.y / ROW_HEIGHT), 0, 40)

      if (newX === widget.x && newY === widget.y) return
      const resolved = resolveCollisions(widgets, id, newX, newY)
      applyLayout(resolved)
    },
    [widgets, applyLayout]
  )

  const handleDragCancel = useCallback(() => setActiveId(null), [])

  const handleResizeEnd = useCallback(
    (id: string, nw: number, nh: number) => {
      const widget = widgets.find((w) => w.id === id)
      if (!widget || (nw === widget.w && nh === widget.h)) return
      const updated = widgets.map((w) =>
        w.id === id
          ? { ...w, w: clamp(nw, 2, GRID_COLS - w.x), h: clamp(nh, 2, 40 - w.y) }
          : w
      )
      const resolved = resolveCollisions(updated, id, widget.x, widget.y)
      applyLayout(resolved)
    },
    [widgets, applyLayout]
  )

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-12 text-center">
        <p className="text-sm font-medium text-destructive">{error}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
        ))}
      </div>
    )
  }

  const maxRows = Math.max(6, ...widgets.map((w) => (w.y || 0) + (w.h || 2)))
  const canvasHeight = maxRows * ROW_HEIGHT + ROW_HEIGHT

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPaletteOpen(!paletteOpen)}>
            <Plus className="size-4" />
            Add widget
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshData}
            disabled={dataLoading}
            className="gap-1.5"
          >
            {dataLoading ? (
              <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
          <Button size="sm" onClick={saveNow} disabled={saving} className="gap-1.5">
            <Save className="size-3.5" />
            Save layout
          </Button>
        </div>
      </div>

      {/* Widget Palette - CLOSED by default */}
      {paletteOpen && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Add Widget to Dashboard</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {Object.values(WIDGET_REGISTRY).map((entry) => (
              <button
                key={entry.definition.type}
                onClick={() => {
                  addWidget(entry.definition.type)
                  setPaletteOpen(false)
                }}
                className="flex items-start gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:bg-secondary/60"
              >
                <div className="mt-0.5 rounded-md bg-primary/12 p-1.5 text-primary">
                  <entry.definition.icon className="size-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium leading-tight">{entry.definition.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {entry.definition.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Draggable Grid */}
      {widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 p-16 text-center">
          <p className="text-sm text-muted-foreground">No widgets yet — grab the ⋮⋮ handle to place them anywhere.</p>
          <Button variant="secondary" size="sm" onClick={() => setPaletteOpen(true)} className="gap-1.5">
            <Plus className="size-4" />
            Add your first widget
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          modifiers={[restrictToParentElement]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-xl border border-dashed border-border/50 bg-muted/10"
            style={{ height: canvasHeight, minHeight: 480 }}
          >
            {/* Subtle grid background */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(to right, hsl(var(--border) / 0.18) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.18) 1px, transparent 1px)',
                backgroundSize: `calc(100% / ${GRID_COLS}) ${ROW_HEIGHT}px`,
              }}
            />
            <div className="absolute inset-0">
              {widgets.map((w) => (
                <DraggableWidget
                  key={w.id}
                  widget={w}
                  data={widgetData || {}}
                  onRemove={removeWidget}
                  onResize={handleResizeEnd}
                />
              ))}
            </div>
            {activeId && (
              <div className="pointer-events-none absolute bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                Drop to place widget — it snaps to the grid
              </div>
            )}
          </div>
        </DndContext>
      )}
    </div>
  )
}
