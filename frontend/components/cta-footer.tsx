import { ArrowRight, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'

const footerCols = [
  { title: 'Product', links: ['Overview', 'Actions', 'Integrations', 'Pricing'] },
  { title: 'Developers', links: ['Docs', 'Tool SDK', 'API reference', 'Marketplace'] },
  { title: 'Company', links: ['About', 'Blog', 'Careers', 'Contact'] },
]

export function CtaFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-border/60">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-1/2 h-[420px] w-[620px] -translate-x-1/2 rounded-full bg-primary/15 blur-[130px]"
      />

      <section id="pricing" className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Give every customer an agent that actually gets it done.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            Start free, connect your data, and watch Relay resolve real tickets in minutes.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
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
              Talk to sales
            </Button>
          </div>
        </div>
      </section>

      <div className="relative mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <div className="grid gap-10 border-t border-border/60 pt-12 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div>
            <a href="#" className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Waypoints className="size-5" />
              </span>
              <span className="font-display text-lg font-bold tracking-tight">Seneca</span>
            </a>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              The customer service AI agent that ingests any data and takes real action.
            </p>
          </div>
          {footerCols.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-6 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Seneca Labs, Inc. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="transition-colors hover:text-foreground">
              Privacy
            </a>
            <a href="#" className="transition-colors hover:text-foreground">
              Terms
            </a>
            <a href="#" className="transition-colors hover:text-foreground">
              Security
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
