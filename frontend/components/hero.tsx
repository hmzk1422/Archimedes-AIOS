import { ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentPanel } from '@/components/agent-panel'

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* amber glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-0 h-[520px] w-[520px] rounded-full bg-primary/25 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/4 h-[380px] w-[380px] rounded-full bg-accent/15 blur-[120px]"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
        <div className="grid items-end gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              Customer service, fully agentic
            </span>
            <h1 className="mt-6 text-balance font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
              Support that speaks <span className="text-primary">every format.</span>
            </h1>
          </div>
          <p className="text-pretty text-lg leading-relaxed text-muted-foreground">
            Relay is the customer service AI agent that ingests any data you throw at it — no clean
            schema required — and takes real action with prebuilt, community, or self-built tools.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            className="h-12 bg-primary px-6 text-base text-primary-foreground hover:bg-primary/90"
          >
            Get started free
            <ArrowRight className="ml-1 size-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-12 border-border bg-card px-6 text-base text-foreground hover:bg-secondary"
          >
            Book a demo
          </Button>
        </div>

        <div className="mt-14">
          <AgentPanel />
        </div>
      </div>
    </section>
  )
}
