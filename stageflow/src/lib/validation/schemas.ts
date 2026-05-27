import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** UUID v4 string */
const uuid = z.string().uuid()

/** Non-empty trimmed string with a reasonable max length */
const name = z.string().trim().min(1, 'Required').max(255)

/** Optional trimmed string */
const optionalText = z.string().trim().max(5000).optional().or(z.literal(''))

/** Positive integer for money amounts in cents */
const amountCents = z.number().int().nonneg()

/** Slug: lowercase alphanumeric + hyphens, 3-63 chars */
const slug = z
  .string()
  .trim()
  .min(3, 'Minimum 3 characters')
  .max(63, 'Maximum 63 characters')
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Must be lowercase alphanumeric with hyphens')

/** URL that must start with https */
const httpsUrl = z.string().url().startsWith('https://')

/** Email address */
const email = z.string().email().max(320)

/** Phone number (E.164 format) */
const phone = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Must be in E.164 format (e.g. +14155551234)')
  .optional()

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export const organizationSchema = z.object({
  name: name.max(100),
  slug,
  contactEmail: email,
  contactPhone: phone,
  website: httpsUrl.optional(),
  logoUrl: z.string().url().optional(),
  timezone: z.string().min(1).max(50).default('America/New_York'),
  currency: z.string().length(3).default('USD'),
  billingAddress: z
    .object({
      line1: z.string().min(1).max(200),
      line2: z.string().max(200).optional(),
      city: z.string().min(1).max(100),
      state: z.string().max(100).optional(),
      postalCode: z.string().min(1).max(20),
      country: z.string().length(2),
    })
    .optional(),
})

export type OrganizationInput = z.infer<typeof organizationSchema>

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

export const studioSchema = z.object({
  name: name.max(150),
  organizationId: uuid,
  contactName: name.max(100).optional(),
  contactEmail: email.optional(),
  contactPhone: phone,
  address: z
    .object({
      line1: z.string().min(1).max(200),
      line2: z.string().max(200).optional(),
      city: z.string().min(1).max(100),
      state: z.string().max(100).optional(),
      postalCode: z.string().min(1).max(20),
      country: z.string().length(2).default('US'),
    })
    .optional(),
})

export type StudioInput = z.infer<typeof studioSchema>

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export const eventSchema = z.object({
  name: name.max(200),
  organizationId: uuid,
  slug: slug.optional(),
  description: optionalText,
  venueName: z.string().trim().max(200).optional(),
  venueAddress: z.string().trim().max(500).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  timezone: z.string().min(1).max(50).default('America/New_York'),
  registrationOpensAt: z.coerce.date().optional(),
  registrationClosesAt: z.coerce.date().optional(),
  isPublished: z.boolean().default(false),
  maxEntries: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine(
  (data) => data.endDate >= data.startDate,
  { message: 'End date must be on or after start date', path: ['endDate'] },
)

export type EventInput = z.infer<typeof eventSchema>

// ---------------------------------------------------------------------------
// Dancer
// ---------------------------------------------------------------------------

export const dancerSchema = z.object({
  firstName: name.max(100),
  lastName: name.max(100),
  studioId: uuid,
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(['female', 'male', 'non_binary', 'prefer_not_to_say']).optional(),
  email: email.optional(),
  phone: phone,
  emergencyContactName: z.string().trim().max(200).optional(),
  emergencyContactPhone: phone,
  medicalNotes: z.string().trim().max(2000).optional(),
})

export type DancerInput = z.infer<typeof dancerSchema>

// ---------------------------------------------------------------------------
// Routine
// ---------------------------------------------------------------------------

export const routineSchema = z.object({
  name: name.max(200),
  studioId: uuid,
  styleCategory: z.string().trim().min(1).max(100),
  ageCategory: z.string().trim().min(1).max(100).optional(),
  performanceLevel: z.enum(['recreational', 'intermediate', 'competitive', 'elite']).optional(),
  entryType: z.enum(['solo', 'duo_trio', 'small_group', 'large_group', 'line', 'production']),
  dancerCount: z.number().int().positive(),
  musicTitle: z.string().trim().max(200).optional(),
  musicArtist: z.string().trim().max(200).optional(),
  durationSeconds: z.number().int().positive().max(600).optional(),
  choreographerName: z.string().trim().max(200).optional(),
})

export type RoutineInput = z.infer<typeof routineSchema>

// ---------------------------------------------------------------------------
// Entry (routine submitted to an event)
// ---------------------------------------------------------------------------

export const entrySchema = z.object({
  routineId: uuid,
  eventId: uuid,
  studioId: uuid,
  categoryId: uuid.optional(),
  specialRequests: z.string().trim().max(1000).optional(),
  status: z.enum([
    'draft',
    'submitted',
    'confirmed',
    'waitlisted',
    'cancelled',
    'withdrawn',
  ]).default('draft'),
})

export type EntryInput = z.infer<typeof entrySchema>

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export const invoiceLineItemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().int().positive(),
  unitAmountCents: amountCents,
})

export const invoiceSchema = z.object({
  organizationId: uuid,
  studioId: uuid,
  eventId: uuid.optional(),
  lineItems: z.array(invoiceLineItemSchema).min(1, 'At least one line item required'),
  dueDate: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  currency: z.string().length(3).default('USD'),
})

export type InvoiceInput = z.infer<typeof invoiceSchema>
export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>

// ---------------------------------------------------------------------------
// Category (competition category within an event)
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  eventId: uuid,
  name: name.max(200),
  styleCategory: z.string().trim().min(1).max(100),
  ageGroup: z.string().trim().min(1).max(100).optional(),
  performanceLevel: z.enum(['recreational', 'intermediate', 'competitive', 'elite']).optional(),
  entryType: z.enum(['solo', 'duo_trio', 'small_group', 'large_group', 'line', 'production']).optional(),
  maxEntries: z.number().int().positive().optional(),
  entryFeeCents: amountCents.optional(),
  sortOrder: z.number().int().nonneg().default(0),
})

export type CategoryInput = z.infer<typeof categorySchema>

// ---------------------------------------------------------------------------
// Webhook endpoint
// ---------------------------------------------------------------------------

export const webhookEndpointSchema = z.object({
  organizationId: uuid,
  url: httpsUrl.max(2048),
  subscribedEvents: z.array(z.string().min(1).max(100)).min(1),
  active: z.boolean().default(true),
})

export type WebhookEndpointInput = z.infer<typeof webhookEndpointSchema>
