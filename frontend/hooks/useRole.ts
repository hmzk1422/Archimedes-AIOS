'use client'

/**
 * Client-side hook for fetching the current user's role and permissions.
 */
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import {
  hasPermission as checkPermission,
  normalizeRole,
  type Role,
  type Permission,
} from '@/lib/rbac'

interface UseRoleState {
  role: Role | null
  loading: boolean
  error: string | null
}

export function useRole() {
  const [state, setState] = useState<UseRoleState>({
    role: null,
    loading: true,
    error: null,
  })

  const fetchRole = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setState({ role: null, loading: false, error: null })
        return
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (error) throw error

      setState({
        role: normalizeRole(profile?.role),
        loading: false,
        error: null,
      })
    } catch (err) {
      setState({
        role: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch role',
      })
    }
  }, [])

  useEffect(() => {
    fetchRole()
  }, [fetchRole])

  const hasPermission = useCallback(
    (permission: Permission) => checkPermission(state.role, permission),
    [state.role],
  )

  return {
    role: state.role,
    loading: state.loading,
    error: state.error,
    hasPermission,
    refresh: fetchRole,
  }
}