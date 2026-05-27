import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Plan Management',
  description: 'Manage subscription plans and pricing.',
}

interface Plan {
  id: string
  name: string
  stripePriceId: string
  monthlyPrice: number
  activeSubscriptions: number
  maxEvents: string
  maxEntries: string
  features: string[]
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    stripePriceId: 'price_starter_monthly',
    monthlyPrice: 49,
    activeSubscriptions: 89,
    maxEvents: '1 per year',
    maxEntries: '500',
    features: ['Studio portal', 'Basic invoicing', 'Email support'],
  },
  {
    id: 'professional',
    name: 'Professional',
    stripePriceId: 'price_pro_monthly',
    monthlyPrice: 149,
    activeSubscriptions: 142,
    maxEvents: 'Unlimited',
    maxEntries: 'Unlimited',
    features: ['Everything in Starter', 'Custom branding', 'Custom domain', 'Priority support', 'Advanced invoicing'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    stripePriceId: 'price_enterprise_custom',
    monthlyPrice: 499,
    activeSubscriptions: 16,
    maxEvents: 'Unlimited',
    maxEntries: 'Unlimited',
    features: ['Everything in Professional', 'API access', 'SSO/SAML', 'Dedicated account manager', 'SLA guarantee', 'Multi-region'],
  },
]

export default function PlansPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Plan Management</h1>
          <p className="mt-1 text-sm text-foreground-muted">Configure subscription plans and pricing tiers</p>
        </div>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">
          CREATE PLAN
        </button>
      </div>

      {/* Plan cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div key={plan.id} className="surface-card flex flex-col p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-gold">${plan.monthlyPrice}</span>
                  <span className="text-sm text-foreground-muted">/mo</span>
                </div>
              </div>
              <button type="button" className="text-xs text-gold hover:text-gold-hover">
                Edit
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-surface-elevated p-3">
                <div className="text-xs text-foreground-muted">Active Subs</div>
                <div className="text-lg font-bold">{plan.activeSubscriptions}</div>
              </div>
              <div className="bg-surface-elevated p-3">
                <div className="text-xs text-foreground-muted">MRR</div>
                <div className="text-lg font-bold text-gold">
                  ${(plan.monthlyPrice * plan.activeSubscriptions).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between text-foreground-muted">
                <span>Max Events</span>
                <span className="text-foreground-secondary">{plan.maxEvents}</span>
              </div>
              <div className="flex justify-between text-foreground-muted">
                <span>Max Entries</span>
                <span className="text-foreground-secondary">{plan.maxEntries}</span>
              </div>
              <div className="flex justify-between text-foreground-muted">
                <span>Stripe Price ID</span>
                <code className="font-mono text-xs text-foreground-muted">{plan.stripePriceId}</code>
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Features</div>
              <ul className="mt-2 space-y-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-foreground-secondary">
                    <span className="text-gold">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
