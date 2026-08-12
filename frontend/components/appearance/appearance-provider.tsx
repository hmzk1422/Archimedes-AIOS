'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  getTenantAppearanceAction,
  updateTenantAppearanceAction,
} from '@/app/actions'
import {
  DEFAULT_APPEARANCE,
  themeToCssVars,
  type Appearance,
} from '@/lib/theme'

interface AppearanceContextValue {
  /** The active workspace appearance (currently applied to :root). */
  appearance: Appearance
  /** True while the stored appearance is being loaded. */
  loading: boolean
  /** Whether the signed-in user may edit the appearance (admin only). */
  canEdit: boolean
  /** Optimistically apply & persist a new appearance. No-op for non-admins. */
  update: (next: Appearance) => Promise<void>
  /** Re-fetch the stored appearance from the server. */
  refresh: () => Promise<void>
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

function mergeStored(raw: Appearance | null): Appearance {
  if (!raw) return DEFAULT_APPEARANCE
  // Defensive: merge over defaults so a partially-stored/migrating value can
  // never leave the UI without required fields.
  return {
    theme: { ...DEFAULT_APPEARANCE.theme, ...(raw.theme ?? {}) },
    canvas: { ...DEFAULT_APPEARANCE.canvas, ...(raw.canvas ?? {}) },
  }
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE)
  const [loading, setLoading] = useState(true)
  const [canEdit, setCanEdit] = useState(false)

  const applyVars = useCallback((a: Appearance) => {
    const vars = themeToCssVars(a)
    const root = document.documentElement
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value)
    }
  }, [])

  // Apply immediately (uses the default theme on first paint) then whenever it
  // changes — so there is never a flash of broken styling.
  useEffect(() => {
    applyVars(appearance)
  }, [appearance, applyVars])

  const refresh = useCallback(async () => {
    try {
      const res = await getTenantAppearanceAction()
      const next = mergeStored(res.appearance)
      setCanEdit(res.canEdit)
      setAppearance(next)
    } catch {
      // Keep the default theme if the lookup fails — never break the UI.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await getTenantAppearanceAction()
        if (cancelled) return
        setCanEdit(res.canEdit)
        setAppearance(mergeStored(res.appearance))
      } catch {
        // Keep the default theme if the lookup fails — never break the UI.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback(
    async (next: Appearance) => {
      if (!canEdit) return
      setAppearance(next)
      applyVars(next)
      try {
        await updateTenantAppearanceAction(next)
      } catch {
        // Best effort: keep the applied theme even if persistence failed.
      }
    },
    [canEdit, applyVars],
  )

  const value = useMemo<AppearanceContextValue>(
    () => ({ appearance, loading, canEdit, update, refresh }),
    [appearance, loading, canEdit, update, refresh],
  )

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  )
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) {
    throw new Error('useAppearance must be used within <AppearanceProvider>')
  }
  return ctx
}
