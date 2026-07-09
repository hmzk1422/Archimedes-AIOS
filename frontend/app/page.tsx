import { SiteHeader } from '@/components/site-header'
import { Hero } from '@/components/hero'
import { LogoCloud } from '@/components/logo-cloud'
import { DataIngestion } from '@/components/data-ingestion'
import { CustomActions } from '@/components/custom-actions'
import { HowItWorks } from '@/components/how-it-works'
import { CtaFooter } from '@/components/cta-footer'

export default function Page() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>
        <Hero />
        <LogoCloud />
        <DataIngestion />
        <CustomActions />
        <HowItWorks />
      </main>
      <CtaFooter />
    </div>
  )
}
