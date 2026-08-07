'use client'

/**
 * RoleBadge — displays a colored badge for the user's role.
 */
import { Shield, Code, Eye } from 'lucide-react'
import { ROLE_METADATA, type Role } from '@/lib/rbac'
import { cn } from '@/lib/utils'

const ROLE_ICONS: Record<Role, typeof Shield> = {
  admin: Shield,
  developer: Code,
  viewer: Eye,
}

interface RoleBadgeProps {
  role: Role
  size?: 'sm' | 'md'
  showIcon?: boolean
  className?: string
}

export function RoleBadge({ role, size = 'sm', showIcon = true, className }: RoleBadgeProps) {
  const meta = ROLE_METADATA[role]
  const Icon = ROLE_ICONS[role]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        meta.badgeClass,
        size === 'sm' ? 'px-2 py-0.5 text-[10px] uppercase tracking-wider' : 'px-3 py-1 text-xs',
        className,
      )}
    >
      {showIcon && <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} />}
      {meta.label}
    </span>
  )
}