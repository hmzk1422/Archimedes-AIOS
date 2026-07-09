const steps = [
  {
    n: '01',
    title: 'Connect your data',
    desc: 'Point Relay at your docs, tickets, CRM, and files. It ingests and normalizes everything automatically.',
  },
  {
    n: '02',
    title: 'Equip your tools',
    desc: 'Pick prebuilt and community actions, or define your own. Set guardrails and approval rules.',
  },
  {
    n: '03',
    title: 'Let it resolve',
    desc: 'Relay handles conversations across channels, takes action, and escalates only when it should.',
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="max-w-2xl">
        <span className="text-sm font-semibold uppercase tracking-widest text-primary">
          How it works
        </span>
        <h2 className="mt-4 text-balance font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Live in a day, not a quarter.
        </h2>
      </div>

      <div className="mt-14 grid gap-8 md:grid-cols-3">
        {steps.map((step) => (
          <div key={step.n} className="border-t border-border pt-6">
            <span className="font-display text-4xl font-bold text-primary">{step.n}</span>
            <h3 className="mt-4 font-display text-xl font-bold tracking-tight">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
