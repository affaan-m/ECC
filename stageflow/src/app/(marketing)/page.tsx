import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'StageFlow — Competition Management Built for Dance',
  description:
    'Entries, scheduling, invoicing, and real-time results. The all-in-one platform that dance competition organizers and studios trust.',
}

const FEATURES = [
  {
    title: 'Entry Management',
    description: 'Studios submit routines online. You review, approve, and track every entry from one dashboard.',
    icon: '01',
  },
  {
    title: 'Smart Scheduling',
    description: 'Auto-generate running orders with conflict detection. Drag, drop, publish — done.',
    icon: '02',
  },
  {
    title: 'Invoicing & Payments',
    description: 'Stripe-powered invoicing with automatic line items, deposits, and late-fee handling.',
    icon: '03',
  },
  {
    title: 'Multi-Event Support',
    description: 'Run regional qualifiers, nationals, and special events — all under one organization.',
    icon: '04',
  },
  {
    title: 'Studio Portal',
    description: 'Studios manage their own dancers, routines, music uploads, and invoice payments.',
    icon: '05',
  },
  {
    title: 'Custom Branding',
    description: 'White-label your competition with custom domains, logos, and color schemes.',
    icon: '06',
  },
] as const

const STATS = [
  { value: '50K+', label: 'Entries Processed' },
  { value: '200+', label: 'Competitions' },
  { value: '1,500+', label: 'Studios' },
  { value: '99.9%', label: 'Uptime' },
] as const

export default function MarketingHomePage() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 bg-gold/5 blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 pb-24 pt-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-block border border-gold/30 bg-gold-muted px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-gold">
              Now in Beta
            </div>
            <h1 className="text-5xl font-bold leading-tight tracking-tight md:text-7xl">
              Competition management,{' '}
              <span className="gold-text-gradient">perfected.</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-foreground-muted md:text-xl">
              Entries, scheduling, invoicing, and real-time results — the all-in-one platform
              that dance competition organizers and studios trust.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/signup" className="btn-gold px-8 py-3.5 text-sm">
                START FREE TRIAL
              </Link>
              <Link href="/pricing" className="btn-outline-gold px-8 py-3.5 text-sm">
                VIEW PRICING
              </Link>
            </div>
          </div>

          {/* Dashboard preview placeholder */}
          <div className="mx-auto mt-20 max-w-5xl">
            <div className="surface-card aspect-video w-full p-8">
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <div className="h-3 w-64 bg-surface-elevated" />
                <div className="grid w-full max-w-2xl grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-20 bg-surface-elevated" />
                  ))}
                </div>
                <div className="h-48 w-full max-w-2xl bg-surface-elevated" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-border bg-surface/50">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 py-16 md:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold text-gold md:text-4xl">{stat.value}</div>
              <div className="mt-1 text-sm text-foreground-muted">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Everything you need to run a{' '}
              <span className="text-gold">flawless</span> competition
            </h2>
            <p className="mt-4 text-foreground-muted">
              From entry submission to final results, StageFlow handles the entire competition lifecycle.
            </p>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="surface-card p-8 transition-colors hover:border-gold/30">
                <div className="mb-4 inline-block bg-gold-muted px-3 py-1 font-mono text-sm font-bold text-gold">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section id="testimonials" className="border-t border-border py-24">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
            Trusted by organizers <span className="text-gold">nationwide</span>
          </h2>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              {
                quote: 'StageFlow cut our admin time in half. The entry management alone is worth it.',
                name: 'Sarah Mitchell',
                role: 'Director, Starlight Dance Championships',
              },
              {
                quote: 'Finally, software that understands how dance competitions actually work.',
                name: 'James Rivera',
                role: 'Owner, Elevate Competition Series',
              },
              {
                quote: 'Our studios love the portal. Fewer emails, fewer mistakes, happier everyone.',
                name: 'Priya Chen',
                role: 'Operations Manager, National Dance Cup',
              },
            ].map((testimonial) => (
              <div key={testimonial.name} className="surface-card p-8">
                <div className="mb-4 text-gold">&ldquo;</div>
                <p className="text-sm leading-relaxed text-foreground-secondary">{testimonial.quote}</p>
                <div className="mt-6 border-t border-border pt-4">
                  <div className="font-semibold text-foreground">{testimonial.name}</div>
                  <div className="text-xs text-foreground-muted">{testimonial.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-border py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Ready to elevate your competition?
          </h2>
          <p className="mt-4 text-foreground-muted">
            Join hundreds of organizers who have switched to StageFlow. Start your free trial today.
          </p>
          <div className="mt-10">
            <Link href="/signup" className="btn-gold px-10 py-4 text-sm">
              GET STARTED FREE
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
