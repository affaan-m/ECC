/**
 * Email template definitions and send function signature.
 *
 * Template implementations live in src/emails/ as React Email components.
 * This file defines the type-safe contract between the email system and callers.
 */

export interface WelcomeEmailData {
  userName: string
  organizationName?: string
  loginUrl: string
}

export interface InvitationEmailData {
  inviterName: string
  organizationName: string
  role: string
  acceptUrl: string
}

export interface NotificationEmailData {
  type: string
  title: string
  body?: string
  linkPath?: string
}

export interface EntryConfirmationEmailData {
  studioName: string
  eventName: string
  routineName: string
  entryNumber: string
  confirmationUrl: string
}

export interface InvoiceEmailData {
  studioName: string
  organizationName: string
  invoiceNumber: string
  totalAmountFormatted: string
  dueDate: string
  paymentUrl: string
}

export interface PasswordResetEmailData {
  resetUrl: string
  expiresInMinutes: number
}

export interface EventReminderEmailData {
  eventName: string
  eventDate: string
  venueName?: string
  eventUrl: string
}

/** Union of all email template data types */
export type EmailTemplate =
  | { template: 'welcome'; data: WelcomeEmailData }
  | { template: 'invitation'; data: InvitationEmailData }
  | { template: 'notification'; data: NotificationEmailData }
  | { template: 'entry-confirmation'; data: EntryConfirmationEmailData }
  | { template: 'invoice'; data: InvoiceEmailData }
  | { template: 'password-reset'; data: PasswordResetEmailData }
  | { template: 'event-reminder'; data: EventReminderEmailData }

export interface SendEmailParams {
  /** Recipient email address */
  to: string
  /** Email subject line */
  subject: string
  /** Template and its typed data */
  email: EmailTemplate
  /** Optional reply-to address */
  replyTo?: string
  /** Organization context for branding */
  organizationId?: string
}

export interface SendEmailResult {
  id: string
  success: boolean
  error?: string
}

/**
 * Send a transactional email using the configured email provider (Resend).
 *
 * Implementation is in src/lib/emails/send.ts — this file only defines the types.
 */
export type SendEmailFn = (params: SendEmailParams) => Promise<SendEmailResult>
