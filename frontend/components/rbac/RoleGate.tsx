'use client'

/**
 * RoleGate — conditionally renders children based on the user's role/permission.
 *
 * Usage:
 *   <RoleGate permission="knowledge:manage">
 *     <UploadForm />
 *   </RoleGate>
 *
 *   <RoleGate roles={['admin', 'developer']} fallback={<ReadOnlyView />}>
 *     <Editor />
 *   </RoleGate>
 */
import { type ReactNode } from 'react'
import { useRole } from '@/hooks/useRole'
import { hasPermission as checkPermission, type Role, type Permission } from '@/lib/rbac'
import { Loader2 } from 'lucide-react'

interface RoleGateProps {
  children: ReactNode
  /** Require a specific permission */
  permission?: Permission
  /** OR require one of these roles */
  roles?: Role[]
  /** Fallback content when access is denied (defaults to null) */
  fallback?: ReactNode
  /** Show a loading spinner while checking (defaults to true) */
  showLoading?: boolean
}

export function RoleGate({
  children,
  permission,
  roles,
  fallback = null,
  showLoading = true,
}: RoleGateProps) {
  const { role, loading } = useRole()

  if (loading && showLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  let allowed = false
  if (permission) {
    allowed = checkPermission(role, permission)
  } else if (roles) {
    allowed = role !== null && roles.includes(role)
  }

  return <>{allowed ? children : fallback}</>
}