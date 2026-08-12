'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Database,
  Wrench,
  Settings,
  Menu,
  X,
  Store,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole } from '@/hooks/useRole'
import { RoleBadge } from '@/components/rbac/RoleBadge'
import { hasPermission, type Permission } from '@/lib/rbac'
import { NotificationsMenu } from '@/components/dashboard/notifications-menu'
import { AccountMenu } from '@/components/dashboard/account-menu'
import { useAppearance } from '@/components/appearance/appearance-provider'

// Icon map — maps string names to components
const ICON_MAP: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard,
  Database,
  Wrench,
  Settings,
  Store,
}

interface NavLink {
  label: string
  href: string
  icon: string
  requiredPermission: Permission
}

const ALL_NAV_LINKS: NavLink[] = [
  { label: 'Overview', href: '/dashboard', icon: 'LayoutDashboard', requiredPermission: 'dashboard:view' },
  { label: 'Actions', href: '/actions', icon: 'Wrench', requiredPermission: 'actions:manage' },
  { label: 'Agent', href: '/agent', icon: 'Settings', requiredPermission: 'agent:use' },
  { label: 'Marketplace', href: '/marketplace', icon: 'Store', requiredPermission: 'marketplace:view' },
  { label: 'Settings', href: '/settings', icon: 'Settings', requiredPermission: 'settings:manage' },
]

export function DashboardNav({ tenantName = 'Acme Inc.' }: { tenantName?: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const { role, loading } = useRole()
  const { appearance } = useAppearance()
  const theme = appearance.theme

  // Filter nav links based on role
  const navLinks = ALL_NAV_LINKS.filter((link) =>
    hasPermission(role, link.requiredPermission),
  )

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            {theme.logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={theme.logoSrc}
                alt={theme.brandName}
                className="size-8 rounded-lg object-contain"
              />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-display font-bold">
                {theme.mark || theme.brandName.charAt(0)}
              </span>
            )}
            <span className="font-display text-lg font-bold tracking-tight">
              {theme.brandName}
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {loading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              navLinks.map((link) => {
                const active = pathname === link.href
                const Icon = ICON_MAP[link.icon] ?? LayoutDashboard
                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    {link.label}
                  </Link>
                )
              })
            )}
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <NotificationsMenu tenantName={tenantName} />
          <AccountMenu tenantName={tenantName} />
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex size-9 items-center justify-center rounded-md text-foreground md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/60 bg-background px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => {
              const active = pathname === link.href
              const Icon = ICON_MAP[link.icon] ?? LayoutDashboard
              return (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  {link.label}
                </Link>
              )
            })}
          </nav>
          {role && (
            <div className="mt-3 pt-3 border-t border-border/60">
              <RoleBadge role={role} size="md" />
            </div>
          )}
        </div>
      )}
    </header>
  )
}