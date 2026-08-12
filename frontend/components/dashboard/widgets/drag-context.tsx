'use client'

import { createContext, useContext } from 'react'
import type { DashboardWidget } from './types'

/**
 * React context that carries @dnd-kit drag listeners/attributes down to the
 * widget's own drag handle (the grip icon rendered by WidgetCard).
 *
 * DashboardCanvas provides this context from `useDraggable` so that WidgetCard
 * can act as the drag activator without requiring every widget component to
 * forward the listeners manually.
 */
export const DragHandleContext = createContext<Record<string, unknown> | undefined>(undefined)

export function useDragHandleProps(): Record<string, unknown> {
  return useContext(DragHandleContext) ?? {}
}

/**
 * Context that lets the dashboard canvas drive the generic widget config panel.
 * WidgetCard uses this as a fallback when it isn't passed `onConfigChange` as a
 * prop (the registry components wrap their content in <WidgetCard> themselves,
 * so they don't forward a handler).
 */
export interface WidgetConfigContextValue {
  onConfigChange: (widget: DashboardWidget) => void
}

export const WidgetConfigContext = createContext<WidgetConfigContextValue | undefined>(undefined)

export function useWidgetConfig(): WidgetConfigContextValue | undefined {
  return useContext(WidgetConfigContext)
}
