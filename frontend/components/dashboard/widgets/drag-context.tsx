'use client'

import { createContext, useContext } from 'react'

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