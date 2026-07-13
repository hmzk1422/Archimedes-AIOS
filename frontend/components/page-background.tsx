import { cn } from '@/lib/utils'

type PageBackgroundProps = {
  className?: string
}

export function PageBackground({ className }: PageBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <div className="absolute -top-24 right-0 h-[420px] w-[420px] rounded-full bg-primary/20 blur-[120px] motion-safe:animate-[float-slow_16s_ease-in-out_infinite]" />
      <div className="absolute left-[-8%] top-[10%] h-[320px] w-[320px] rounded-full bg-accent/15 blur-[130px] motion-safe:animate-[float-slow_20s_ease-in-out_infinite]" />
      <div className="absolute bottom-[-10%] left-1/3 h-[360px] w-[360px] rounded-full bg-primary/10 blur-[140px] motion-safe:animate-[float-slow_18s_ease-in-out_infinite]" />
    </div>
  )
}
