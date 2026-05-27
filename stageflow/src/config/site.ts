/**
 * Site-wide configuration constants.
 *
 * Values that vary by environment should read from `process.env` with a
 * sensible default. Everything else is a plain constant.
 */

export const siteConfig = {
  /** Application name */
  name: 'StageFlow',

  /** Short description for meta tags */
  description:
    'The all-in-one platform for dance competition management — entries, scheduling, judging, payments, and more.',

  /** Root URL (no trailing slash) */
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',

  /** Root domain for subdomain-based tenancy */
  rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'stageflow.app',

  /** OG image default */
  ogImage: '/og-default.png',

  /** Support email */
  supportEmail: 'support@stageflow.app',

  /** Links */
  links: {
    docs: 'https://docs.stageflow.app',
    github: 'https://github.com/stageflow',
    twitter: 'https://twitter.com/stageflowapp',
    privacy: '/legal/privacy',
    terms: '/legal/terms',
  },

  /** Default locale */
  locale: 'en-US',

  /** Default currency */
  currency: 'USD',

  /** Default timezone */
  timezone: 'America/New_York',
} as const

export type SiteConfig = typeof siteConfig
