/**
 * Plan configuration matching the seed data.
 *
 * Each plan defines limits and pricing for organization subscriptions.
 * The `stripePriceId` fields should be set per environment.
 */

export interface PlanConfig {
  /** Unique plan identifier (matches DB seed) */
  id: string
  /** Display name */
  name: string
  /** Short description */
  description: string
  /** Monthly price in cents (0 for free) */
  monthlyPriceCents: number
  /** Annual price in cents (0 for free) */
  annualPriceCents: number
  /** Stripe Price ID for monthly billing */
  stripeMonthlyPriceId: string | null
  /** Stripe Price ID for annual billing */
  stripeAnnualPriceId: string | null
  /** Maximum events allowed (null = unlimited) */
  maxEvents: number | null
  /** Maximum entries per event (null = unlimited) */
  maxEntriesPerEvent: number | null
  /** Maximum admin/staff seats (null = unlimited) */
  maxSeats: number | null
  /** Maximum storage in bytes (null = unlimited) */
  maxStorageBytes: number | null
  /** Feature flags enabled for this plan */
  features: string[]
  /** Whether this plan is visible on the pricing page */
  isPublic: boolean
  /** Sort order on the pricing page */
  sortOrder: number
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Get started with basic competition management.',
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    stripeMonthlyPriceId: null,
    stripeAnnualPriceId: null,
    maxEvents: 2,
    maxEntriesPerEvent: 50,
    maxSeats: 2,
    maxStorageBytes: 500 * 1024 * 1024, // 500 MB
    features: ['entries', 'basic_scheduling', 'email_notifications'],
    isPublic: true,
    sortOrder: 0,
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'For small competitions and regional events.',
    monthlyPriceCents: 4900,
    annualPriceCents: 47000,
    stripeMonthlyPriceId: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? null,
    stripeAnnualPriceId: process.env.STRIPE_PRICE_STARTER_ANNUAL ?? null,
    maxEvents: 10,
    maxEntriesPerEvent: 200,
    maxSeats: 5,
    maxStorageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    features: [
      'entries',
      'scheduling',
      'basic_judging',
      'invoicing',
      'email_notifications',
      'music_upload',
    ],
    isPublic: true,
    sortOrder: 1,
  },

  professional: {
    id: 'professional',
    name: 'Professional',
    description: 'For established competition organizers running multiple events.',
    monthlyPriceCents: 14900,
    annualPriceCents: 143000,
    stripeMonthlyPriceId: process.env.STRIPE_PRICE_PRO_MONTHLY ?? null,
    stripeAnnualPriceId: process.env.STRIPE_PRICE_PRO_ANNUAL ?? null,
    maxEvents: 50,
    maxEntriesPerEvent: 1000,
    maxSeats: 20,
    maxStorageBytes: 25 * 1024 * 1024 * 1024, // 25 GB
    features: [
      'entries',
      'scheduling',
      'advanced_judging',
      'invoicing',
      'stripe_connect',
      'email_notifications',
      'music_upload',
      'custom_domain',
      'webhooks',
      'api_access',
      'csv_export',
      'xlsx_export',
    ],
    isPublic: true,
    sortOrder: 2,
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For large-scale competition networks with custom needs.',
    monthlyPriceCents: 49900,
    annualPriceCents: 479000,
    stripeMonthlyPriceId: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? null,
    stripeAnnualPriceId: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL ?? null,
    maxEvents: null,
    maxEntriesPerEvent: null,
    maxSeats: null,
    maxStorageBytes: null,
    features: [
      'entries',
      'scheduling',
      'advanced_judging',
      'invoicing',
      'stripe_connect',
      'email_notifications',
      'music_upload',
      'custom_domain',
      'webhooks',
      'api_access',
      'csv_export',
      'xlsx_export',
      'pdf_export',
      'ticketing',
      'livestream',
      'media_sales',
      'sso',
      'priority_support',
      'dedicated_account_manager',
    ],
    isPublic: true,
    sortOrder: 3,
  },
} as const

/** Ordered list of plans for display */
export const PLAN_LIST = Object.values(PLANS).sort(
  (a, b) => a.sortOrder - b.sortOrder,
)

/** Get a plan config by ID, or undefined if not found */
export function getPlan(planId: string): PlanConfig | undefined {
  return PLANS[planId]
}

/** Check if an organization's plan includes a specific feature */
export function planHasFeature(planId: string, feature: string): boolean {
  const plan = getPlan(planId)
  return plan?.features.includes(feature) ?? false
}

/** Format a price in cents as a display string */
export function formatPlanPrice(cents: number, interval: 'month' | 'year'): string {
  if (cents === 0) return 'Free'
  const dollars = (cents / 100).toFixed(0)
  return `$${dollars}/${interval === 'month' ? 'mo' : 'yr'}`
}
