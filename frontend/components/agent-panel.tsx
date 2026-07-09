import { Check, FileSpreadsheet, Paperclip, Terminal, Waypoints } from 'lucide-react'

export function AgentPanel() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/40">
      {/* window bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex gap-1.5">
          <span className="size-3 rounded-full bg-muted-foreground/30" />
          <span className="size-3 rounded-full bg-muted-foreground/30" />
          <span className="size-3 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Waypoints className="size-3.5 text-primary" />
          relay · ticket #48291
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-[1.5fr_1fr]">
        {/* conversation */}
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-secondary px-4 py-3 text-sm">
              Hey, my invoice from last month looks wrong and I attached the PDF plus a screenshot of
              my dashboard. Can you fix it?
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
              <Paperclip className="size-3.5" /> invoice-final(2).pdf
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
              <FileSpreadsheet className="size-3.5" /> screenshot.png
            </span>
          </div>

          <div className="flex gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Waypoints className="size-4" />
            </span>
            <div className="max-w-[85%] space-y-3 rounded-2xl rounded-tl-sm bg-background px-4 py-3 text-sm">
              <p>
                Got it — I parsed both files. The PDF charged 3 seats but your account shows 2 active
                since March 4. I&apos;ve issued a prorated refund of{' '}
                <span className="font-medium text-primary">$42.00</span>.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  <Check className="size-3" /> parse_pdf
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  <Check className="size-3" /> lookup_subscription
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  <Check className="size-3" /> issue_refund
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* tool trace */}
        <div className="border-t border-border bg-background/60 p-5 font-mono text-xs md:border-l md:border-t-0 sm:p-6">
          <div className="mb-3 flex items-center gap-2 text-muted-foreground">
            <Terminal className="size-3.5" /> action trace
          </div>
          <ol className="space-y-3">
            {[
              { t: 'ingest', d: 'PDF + PNG → normalized JSON' },
              { t: 'tool', d: 'lookup_subscription(acct_88f2)' },
              { t: 'reason', d: 'billed 3 · active 2 · delta $42' },
              { t: 'tool', d: 'issue_refund(amount=42.00)' },
              { t: 'done', d: 'reply drafted + sent' },
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/40 text-[10px] text-primary">
                  {i + 1}
                </span>
                <div>
                  <span className="text-primary">{step.t}</span>
                  <span className="text-muted-foreground"> — {step.d}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
