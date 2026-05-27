import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, Minus } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Simple, transparent pricing for competition organizers of every size.',
}

interface PlanFeature {
  text: string
  included: boolean
}

interface Plan {
  name: string
  price: string
  period: string
  description: string
  cta: string
  featured: boolean
  features: PlanFeature[]
}

const PLANS: Plan[] = [
  {
    name: 'Starter',
    price: '$49',
    period: '/month',
    description: 'Perfect for small competitions and first-time organizers.',
    cta: 'Start Free Trial',
    featured: false,
    features: [
      { text: '1 event per year', included: true },
      { text: 'Up to 500 entries', included: true },
      { text: 'Studio portal', included: true },
      { text: 'Basic invoicing', included: true },
      { text: 'Email support', included: true },
      { text: 'Custom branding', included: false },
      { text: 'Custom domain', included: false },
      { text: 'API access', included: false },
    ],
  },
  {
    name: 'Professional',
    price: '$149',
    period: '/month',
    description: 'For established competitions that need the full toolkit.',
    cta: 'Start Free Trial',
    featured: true,
    features: [
      { text: 'Unlimited events', included: true },
      { text: 'Unlimited entries', included: true },
      { text: 'Studio portal', included: true },
      { text: 'Advanced invoicing & deposits', included: true },
      { text: 'Priority support', included: true },
      { text: 'Custom branding', included: true },
      { text: 'Custom domain', included: true },
      { text: 'API access', included: false },
    ],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For competition series and national organizations.',
    cta: 'Contact Sales',
    featured: false,
    features: [
      { text: 'Everything in Professional', included: true },
      { text: 'Multi-region support', included: true },
      { text: 'Dedicated account manager', included: true },
      { text: 'Custom integrations', included: true },
      { text: 'SLA guarantee', included: true },
      { text: 'Advanced analytics', included: true },
      { text: 'API access', included: true },
      { text: 'SSO / SAML', included: true },
    ],
  },
]

export default function PricingPage() {
  return (
    <div className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Simple, <span className="text-gold">transparent</span> pricing
          </h1>
          <p className="mt-4 text-lg text-foreground-muted">
            No hidden fees. No per-entry charges. Just one flat monthly price.
          </p>
        </div>

        {/* Plans grid */}
        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col p-8 ${
                plan.featured
                  ? 'border-2 border-gold bg-surface shadow-[0_0_40px_rgba(255,192,0,0.08)]'
                  : 'surface-card'
              }`}
            >
              {plan.featured && (
                <div className="absolute -top-3 left-8 bg-gold px-4 py-1 text-xs font-bold uppercase tracking-wider text-black">
                  Most Popular
                </div>
              )}

              <div>
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-gold">{plan.price}</span>
                  {plan.period && <span className="text-foreground-muted">{plan.period}</span>}
                </div>
                <p className="mt-3 text-sm text-foreground-muted">{plan.description}</p>
              </div>

              <ul className="mt-8 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature.text} className="flex items-start gap-3 text-sm">
                    <span className={feature.included ? 'text-gold' : 'text-foreground-muted/40'}>
                      {feature.included ? <Check className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </span>
                    <span className={feature.included ? 'text-foreground-secondary' : 'text-foreground-muted/40'}>
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <Link
                  href={plan.name === 'Enterprise' ? '#' : '/signup'}
                  className={`block w-full py-3 text-center text-sm font-semibold uppercase tracking-wider ${
                    plan.featured ? 'btn-gold' : 'btn-outline-gold'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* FAQ teaser */}
        <div className="mt-24 text-center">
          <h2 className="text-2xl font-bold">Questions?</h2>
          <p className="mt-2 text-foreground-muted">
            All plans include a 14-day free trial. No credit card required.
          </p>
          <div className="mt-8 grid gap-6 text-left md:grid-cols-2 lg:mx-auto lg:max-w-3xl">
            {[
              {
                q: 'Can I switch plans later?',
                a: 'Yes. Upgrade or downgrade at any time. Changes take effect on your next billing cycle.',
              },
              {
                q: 'Do you charge per entry?',
                a: 'No. StageFlow uses flat monthly pricing. Enter as many routines as you need.',
              },
              {
                q: 'What payment methods do you accept?',
                a: 'All major credit cards via Stripe. Enterprise plans can pay by invoice.',
              },
              {
                q: 'Is there a contract?',
                a: 'No long-term contracts. Pay month-to-month and cancel anytime.',
              },
            ].map((faq) => (
              <div key={faq.q} className="surface-card p-6">
                <h3 className="font-semibold">{faq.q}</h3>
                <p className="mt-2 text-sm text-foreground-muted">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
