'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, Users, Ticket, CheckCircle2, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { cn } from '@/lib/utils'

interface NotificationItem {
  id: string
  kind: 'users' | 'ticket' | 'check'
  title: string
  description: string
}

const KIND_ICON = {
  users: Users,
  ticket: Ticket,
  check: CheckCircle2,
} as const

const KIND_COLOR: Record<NotificationItem['kind'], string> = {
  users: 'text-primary',
  ticket: 'text-amber-500',
  check: 'text-emerald-500',
}

export function NotificationsMenu({ tenantName }: { tenantName: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const ref = useRef<HTMLDivElement>(null)

  const loadNotifications = async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const next: NotificationItem[] = []

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('account_type, workspace_id')
          .eq('id', user.id)
          .single()

        if (profile) {
          const workspaceId = profile.workspace_id ?? user.id

          const { data: members } = await supabase
            .from('profiles')
            .select('id, tenant_name, created_at')
            .eq('workspace_id', workspaceId)
            .neq('id', user.id)
            .order('created_at', { ascending: false })
            .limit(5)

          if (members && members.length > 0) {
            members.forEach((m) => {
              next.push({
                id: `member-${m.id}`,
                kind: 'users',
                title: `${m.tenant_name || 'Someone'} joined your workspace`,
                description: `${tenantName || 'Your workspace'} now has a new team member.`,
              })
            })
          }

          if (profile.account_type === 'admin') {
            next.push({
              id: 'invite',
              kind: 'ticket',
              title: 'Grow your team',
              description: 'Share your invite code so teammates can join your workspace.',
            })
          }

          next.push({
            id: 'welcome',
            kind: 'check',
            title: `Welcome to ${tenantName || 'Relay'}`,
            description: 'Your AI customer service agent is ready to help.',
          })
        }
      }

      setItems(next.length > 0 ? next : [
        { id: 'empty', kind: 'check', title: "You're all caught up", description: 'No new notifications.' },
      ])
    } catch {
      setItems([
        { id: 'empty', kind: 'check', title: "You're all caught up", description: 'No new notifications.' },
      ])
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next && !loaded) {
      loadNotifications()
    }
  }

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Notifications"
        className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Bell className="size-5" />
        <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border/60 bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {items.length > 0 && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                {items.length} new
              </span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {items.map((item) => {
                  const Icon = KIND_ICON[item.kind]
                  return (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary/60', KIND_COLOR[item.kind])}>
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{item.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
