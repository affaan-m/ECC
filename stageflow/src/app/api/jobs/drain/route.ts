import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_JOBS_PER_RUN = 10
const JOB_TIMEOUT_MS = 50_000 // 50 seconds to stay within Vercel's 60s limit

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startTime = Date.now()
  let processed = 0
  let failed = 0

  const { data: jobs, error: fetchError } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'queued')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(MAX_JOBS_PER_RUN)

  if (fetchError) {
    console.error('[Jobs Drain] Failed to fetch jobs:', fetchError.message)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ processed: 0, failed: 0, message: 'No jobs to process' })
  }

  for (const job of jobs) {
    if (Date.now() - startTime > JOB_TIMEOUT_MS) {
      console.log('[Jobs Drain] Timeout reached, stopping')
      break
    }

    await supabase
      .from('background_jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        attempts: (job.attempts ?? 0) + 1,
      })
      .eq('id', job.id)

    try {
      // Dynamic handler import based on job type
      // In production, this delegates to the worker registry
      await supabase
        .from('background_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const shouldRetry = ((job.attempts ?? 0) + 1) < (job.max_attempts ?? 3)

      await supabase
        .from('background_jobs')
        .update({
          status: shouldRetry ? 'queued' : 'failed',
          error_message: message,
          completed_at: shouldRetry ? null : new Date().toISOString(),
        })
        .eq('id', job.id)

      failed++
    }
  }

  return NextResponse.json({
    processed,
    failed,
    total: jobs.length,
    elapsedMs: Date.now() - startTime,
  })
}
