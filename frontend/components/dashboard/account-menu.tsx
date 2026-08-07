'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut, Trash2, Settings as SettingsIcon, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { deleteAccountAction } from '@/app/actions'
import { useRole } from '@/hooks/useRole'
import { RoleBadge } from '@/components/rbac/RoleBadge'
import { hasPermission } from '@/lib/rbac'
import { cn } from '@/lib/utils'

export function AccountMenu({ tenantName }: { tenantName: string }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { role } = useRole()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  const handleDeleteAccount = () => {
    if (confirm('Are you sure? This will permanently delete your account and cannot be undone.')) {
      startTransition(async () => {
        await deleteAccountAction()
      })
    }
  }

  const canManageSettings = hasPermission(role, 'settings:manage')
  const canDelete = hasPermission(role, 'account:delete')

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5 transition-colors hover:border-foreground/20"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
          {tenantName.charAt(0)}
        </span>
        <span className="max-w-[10rem] truncate text-sm font-medium">{tenantName}</span>
        <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border/60 bg-card shadow-xl">
          <div className="border-b border-border/60 px-4 py-3">
            <p className="truncate text-sm font-semibold text-foreground">{tenantName}</p>
            {role && (
              <div className="mt-1.5">
                <RoleBadge role={role} size="sm" />
              </div>
            )}
          </div>

          <div className="p-1.5">
            {canManageSettings && (
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <SettingsIcon className="size-4 text-muted-foreground" />
                Settings
              </Link>
            )}

            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <LogOut className="size-4 text-muted-foreground" />
              Sign out
            </button>

            {canDelete && (
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={isPending}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {isPending ? 'Deleting...' : 'Delete account'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
