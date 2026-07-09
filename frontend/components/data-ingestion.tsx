import {
  FileText,
  Image as ImageIcon,
  Database,
  Mail,
  Table2,
  Mic,
  ArrowRight,
} from 'lucide-react'

const sources = [
  { icon: FileText, label: 'PDFs & docs' },
  { icon: Table2, label: 'Messy CSVs' },
  { icon: ImageIcon, label: 'Screenshots' },
  { icon: Mail, label: 'Email threads' },
  { icon: Database, label: 'Legacy DBs' },
  { icon: Mic, label: 'Call recordings' },
]

export function DataIngestion() {
  return (
    <section id="ingestion" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <span className="text-sm font-semibold uppercase tracking-widest text-primary">
            Ingest anything
          </span>
          <h2 className="mt-4 text-balance font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Drop in any data. No formatting required.
          </h2>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
            Forget schemas, templates, and cleanup jobs. Relay reads PDFs, spreadsheets, images,
            emails, and half-broken exports the way a person would — then structures them
            automatically so your agent always has the full picture.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              'Auto-detects structure from unstructured files',
              'Handles typos, mixed columns, and missing fields',
              'Connects to knowledge bases and legacy systems in minutes',
            ].map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-foreground">
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sources.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 text-center transition-colors hover:border-primary/50"
              >
                <Icon className="size-6 text-primary" />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-3 rounded-xl bg-primary/10 p-4 text-center text-sm font-medium text-primary">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            Normalized &amp; ready in seconds
          </div>
        </div>
      </div>
    </section>
  )
}
