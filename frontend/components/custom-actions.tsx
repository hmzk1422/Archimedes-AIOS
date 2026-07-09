import { Boxes, Users, Wrench, ArrowUpRight } from 'lucide-react'

const tiers = [
  {
    icon: Boxes,
    title: 'Prebuilt tools',
    desc: 'Refunds, order lookups, escalations, CRM updates, and 100+ actions maintained by our team — production-ready on day one.',
    tag: 'By Relay',
  },
  {
    icon: Users,
    title: 'Community tools',
    desc: 'Tap an open marketplace of connectors and workflows shared by other teams. Install with one click and customize as needed.',
    tag: 'Marketplace',
  },
  {
    icon: Wrench,
    title: 'Build your own',
    desc: 'Define custom tools in code or natural language. Relay wires up auth, inputs, and guardrails so your agent can act safely.',
    tag: 'Your logic',
  },
]

export function CustomActions() {
  return (
    <section id="actions" className="border-y border-border/60 bg-card/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-primary">
            Take action
          </span>
          <h2 className="mt-4 text-balance font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Not just answers. Real outcomes.
          </h2>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
            Relay resolves tickets end to end by calling tools. Use ours, borrow the community&apos;s,
            or build exactly what your product needs.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {tiers.map(({ icon: Icon, title, desc, tag }) => (
            <div
              key={title}
              className="group flex flex-col rounded-2xl border border-border bg-background p-6 transition-colors hover:border-primary/50"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-6" />
                </span>
                <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                  {tag}
                </span>
              </div>
              <h3 className="mt-5 font-display text-xl font-bold tracking-tight">{title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{desc}</p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Explore <ArrowUpRight className="size-4" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
