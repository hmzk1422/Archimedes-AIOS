'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { resolveTenantId } from '@/lib/tenant'
import { createDefaultWidget, getWidgetDefinition } from '@/components/dashboard/widgets/widget-registry'
import type { DashboardWidget } from '@/components/dashboard/widgets/types'
import type { WidgetDataPayload } from '@/components/dashboard/widgets/chart-data-utils'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'

const DEFAULT_WIDGETS: DashboardWidget[] = []

/**
 * Hook for managing the draggable dashboard state.
 * - Fetches saved layout + widget data from the backend on mount.
 * - Auto-saves layout with debouncing on any change.
 * - Provides add/remove/reposition handlers.
 */
export function useDashboard() {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(DEFAULT_WIDGETS)
  const [widgetData, setWidgetData] = useState<WidgetDataPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const [dataLoading, setDataLoading] = useState(false)

  // ── Resolve tenant on mount ─────────────────────────────────────────────────
  useEffect(() => {
    const resolve = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setError('Not authenticated')
          setLoading(false)
          return
        }
        setUserId(user.id)
        const tid = await resolveTenantId(user.id)
        setTenantId(tid)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to resolve tenant')
        setLoading(false)
      }
    }
    resolve()
  }, [])

  // ── Fetch saved layout ──────────────────────────────────────────────────────
  const fetchLayout = useCallback(async (tid: string) => {
    try {
      const resp = await fetch(`${API_URL}/dashboard/layout/${tid}`)
      const data = await resp.json()
      if (data.status === 'ok') {
        const savedWidgets: DashboardWidget[] = Array.isArray(data.layout) ? data.layout : []
        setWidgets(savedWidgets.length > 0 ? savedWidgets : [...DEFAULT_WIDGETS])
      }
    } catch (err) {
      console.error('Failed to fetch dashboard layout:', err)
      setWidgets([...DEFAULT_WIDGETS])
    }
  }, [])

  // ── Fetch widget data ───────────────────────────────────────────────────────
  const fetchWidgetData = useCallback(async (tid: string) => {
    setDataLoading(true)
    try {
      const resp = await fetch(`${API_URL}/dashboard/widget-data/${tid}`)
      const data = await resp.json()
      if (data.status === 'ok') {
        setWidgetData(data as WidgetDataPayload)
      } else {
        setWidgetData(null)
      }
    } catch (err) {
      console.error('Failed to fetch widget data:', err)
            setWidgetData(null)
    } finally {
      setDataLoading(false)
    }
  }, [])

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return
    setLoading(true)
    Promise.all([fetchLayout(tenantId), fetchWidgetData(tenantId)]).finally(() => {
      setLoading(false)
    })
  }, [tenantId, fetchLayout, fetchWidgetData])

  // ── Auto-save (debounced) ───────────────────────────────────────────────────
  const saveLayout = useCallback(async (layout: DashboardWidget[], tid: string) => {
    setSaving(true)
    try {
      const resp = await fetch(`${API_URL}/dashboard/layout/${tid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout }),
      })
      const data = await resp.json()
      if (data.status !== 'ok') console.error('Save failed:', data.message)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [])

  const debouncedSave = useCallback((layout: DashboardWidget[], tid: string) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveLayout(layout, tid), 1500)
  }, [saveLayout])

  // ── Widget actions ───────────────────────────────────────────────────────────
  const addWidget = useCallback((type: string) => {
    const def = getWidgetDefinition(type)
    if (!def) return
    setWidgets((prev) => {
      const newWidget = createDefaultWidget(type)
      const maxX = Math.max(0, ...prev.map((w) => w.x + w.w))
      newWidget.x = maxX
      newWidget.y = 0
      const newWidgets = [...prev, newWidget]
      if (tenantId) debouncedSave(newWidgets, tenantId)
      return newWidgets
    })
  }, [tenantId, debouncedSave])

  const removeWidget = useCallback((id: string) => {
    setWidgets((prev) => {
      const nw = prev.filter((w) => w.id !== id)
      if (tenantId) debouncedSave(nw, tenantId)
      return nw
    })
  }, [tenantId, debouncedSave])

  const updateWidget = useCallback((id: string, updates: Partial<DashboardWidget>) => {
    setWidgets((prev) => {
      const nw = prev.map((w) => (w.id === id ? { ...w, ...updates } : w))
      if (tenantId) debouncedSave(nw, tenantId)
      return nw
    })
  }, [tenantId, debouncedSave])

  const moveWidget = useCallback((id: string, x: number, y: number) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, x, y } : w)))
  }, [])

  /**
   * Replace the entire widget layout in one shot (used after drag-and-drop so
   * all repositioned widgets are committed and saved together).
   */
  const applyLayout = useCallback((layout: DashboardWidget[]) => {
    setWidgets(layout)
    if (tenantId) debouncedSave(layout, tenantId)
  }, [tenantId, debouncedSave])

  const saveNow = useCallback(async () => {
    if (!tenantId) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    await saveLayout(widgets, tenantId)
  }, [tenantId, widgets, saveLayout])

  const refreshData = useCallback(async () => {
    if (!tenantId) return
    await fetchWidgetData(tenantId)
  }, [tenantId, fetchWidgetData])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  return {
    widgets, widgetData, loading, saving, dataLoading, error,
    tenantId, userId,
    addWidget, removeWidget, updateWidget, moveWidget, applyLayout,
    saveNow, refreshData, debouncedSave,
  }
}
