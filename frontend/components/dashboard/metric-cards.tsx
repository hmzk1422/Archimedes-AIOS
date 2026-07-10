import { ArrowDownRight, ArrowUpRight, MessagesSquare, CheckCircle2, Timer, Database } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Metric = {
  label: string
  value: string
  delta: number
  hint: string
  icon: LucideIcon
}

const metrics: Metric[] = [
  { label: 'Total conversations', value: '12,847', delta: 12.4, hint: 'vs. previous period', icon: MessagesSquare },
  { label: 'Resolution rate', value: '91.2%', delta: 3.1, hint: 'auto-resolved by agent', icon: CheckCircle2 },
  { label: 'Avg. response time', value: '1.4s', delta: -18.6, hint: 'first token latency', icon: Timer },
  { label: 'Active datatypes', value: '24', delta: 4, hint: 'sources in knowledge base', icon: Database },
]

export function MetricCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m) => {
        const positive = m.delta >= 0
        return (
          <Card key={m.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <m.icon className="size-5" />
              </span>
              <span
                className={cn(
                  'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                  positive ? 'bg-primary/12 text-primary' : 'bg-accent/15 text-accent',
                )}
              >
                {positive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                {Math.abs(m.delta)}%
              </span>
            </div>
            <p className="mt-4 font-display text-3xl font-bold tracking-tight tabular-nums">{m.value}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{m.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{m.hint}</p>
          </Card>
        )
      })}
    </div>
  )
}
