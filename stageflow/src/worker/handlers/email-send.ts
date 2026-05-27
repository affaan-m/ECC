import { registerHandler } from '../registry'
import type { JobPayload, JobResult } from '../types'

async function handleEmailSend(payload: JobPayload): Promise<JobResult> {
  const { to, subject, template, props, organizationId } = payload as {
    to: string
    subject: string
    template: string
    props: Record<string, unknown>
    organizationId?: string
  }

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'noreply@stageflow.app',
      to,
      subject,
      html: `<p>Template: ${template}</p><pre>${JSON.stringify(props, null, 2)}</pre>`,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      metadata: { resendMessageId: data?.id, organizationId },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Email send failed',
    }
  }
}

registerHandler('email.send', handleEmailSend)
