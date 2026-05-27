import { createClient } from '@supabase/supabase-js'
import { getHandler } from './registry'
import type { JobType } from './types'

import './handlers/export-entries'
import './handlers/email-send'
import './handlers/webhook-deliver'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const POLL_INTERVAL_MS = 5_000
const JOB_TIMEOUT_MS = 5 * 60 * 1_000

async function claimAndRunJobs() {
  const { data: jobs, error } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'queued')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(10)

  if (error || !jobs?.length) return

  for (const job of jobs) {
    const handler = getHandler(job.job_type as JobType)
    if (!handler) {
      console.error(`[Worker] No handler for job type: ${job.job_type}`)
      await supabase
        .from('background_jobs')
        .update({ status: 'failed', error_message: `No handler for type: ${job.job_type}` })
        .eq('id', job.id)
      continue
    }

    await supabase
      .from('background_jobs')
      .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('id', job.id)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS)

      const result = await handler(job.payload)
      clearTimeout(timeout)

      await supabase
        .from('background_jobs')
        .update({
          status: result.success ? 'completed' : 'failed',
          completed_at: new Date().toISOString(),
          result_path: result.resultPath ?? null,
          result_metadata: result.metadata ?? {},
          error_message: result.error ?? null,
        })
        .eq('id', job.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const shouldRetry = job.attempts + 1 < job.max_attempts

      await supabase
        .from('background_jobs')
        .update({
          status: shouldRetry ? 'queued' : 'failed',
          error_message: message,
          completed_at: shouldRetry ? null : new Date().toISOString(),
        })
        .eq('id', job.id)
    }
  }
}

async function main() {
  console.log('[Worker] Starting background job worker...')
  console.log(`[Worker] Poll interval: ${POLL_INTERVAL_MS}ms`)
  console.log(`[Worker] Job timeout: ${JOB_TIMEOUT_MS}ms`)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await claimAndRunJobs()
    } catch (err) {
      console.error('[Worker] Poll error:', err)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

main()
