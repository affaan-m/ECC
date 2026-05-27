import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  let userId: string
  try {
    userId = await getCurrentUserId()
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const rateLimitResult = await rateLimit(userId, 'api')
  if (!rateLimitResult.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const body = await request.json()
  const { eventId, format = 'csv', filters } = body as {
    eventId: string
    format?: 'csv' | 'xlsx'
    filters?: Record<string, unknown>
  }

  if (!eventId) {
    return NextResponse.json({ error: 'Missing required field: eventId' }, { status: 400 })
  }

  const supabase = await createClient()

  const jobType = format === 'xlsx' ? 'export.entries.xlsx' : 'export.entries.csv'

  const { data: job, error } = await supabase
    .from('background_jobs')
    .insert({
      job_type: jobType,
      payload: { eventId, format, filters, requestedBy: userId },
      status: 'queued',
      scheduled_for: new Date().toISOString(),
      attempts: 0,
      max_attempts: 3,
    })
    .select('id')
    .single()

  if (error || !job) {
    console.error('[Export Entries] Failed to enqueue job:', error?.message)
    return NextResponse.json({ error: 'Failed to enqueue export job' }, { status: 500 })
  }

  return NextResponse.json({
    jobId: job.id,
    status: 'queued',
    message: 'Export job has been queued. Check status using the job ID.',
  })
}
