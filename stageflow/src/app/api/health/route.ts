import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  checks: {
    database: { ok: boolean; latencyMs: number }
    storage: { ok: boolean }
  }
}

export async function GET() {
  const timestamp = new Date().toISOString()
  const checks: HealthStatus['checks'] = {
    database: { ok: false, latencyMs: 0 },
    storage: { ok: false },
  }

  // Check database connectivity
  const dbStart = Date.now()
  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)

    checks.database.ok = !error
    checks.database.latencyMs = Date.now() - dbStart

    if (error) {
      console.error('[Health] Database check failed:', error.message)
    }
  } catch (err) {
    checks.database.latencyMs = Date.now() - dbStart
    console.error('[Health] Database check error:', err)
  }

  // Check storage connectivity
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.storage.listBuckets()
    checks.storage.ok = !error

    if (error) {
      console.error('[Health] Storage check failed:', error.message)
    }
  } catch (err) {
    console.error('[Health] Storage check error:', err)
  }

  const allOk = checks.database.ok && checks.storage.ok
  const anyOk = checks.database.ok || checks.storage.ok
  const status: HealthStatus['status'] = allOk ? 'healthy' : anyOk ? 'degraded' : 'unhealthy'

  const body: HealthStatus = { status, timestamp, checks }
  const httpStatus = status === 'unhealthy' ? 503 : 200

  return NextResponse.json(body, { status: httpStatus })
}
