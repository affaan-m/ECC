export type JobType =
  | 'export.entries.csv'
  | 'export.entries.xlsx'
  | 'export.invoices.csv'
  | 'export.invoices.pdf'
  | 'zip.event.music'
  | 'email.send'
  | 'webhook.deliver'
  | 'stripe.reconcile'
  | 'document.expiry_reminder'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface JobResult {
  success: boolean
  resultPath?: string
  metadata?: Record<string, unknown>
  error?: string
}

export interface JobPayload {
  [key: string]: unknown
}

export type JobHandler = (payload: JobPayload) => Promise<JobResult>
