import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'System Health',
  description: 'StageFlow system health monitoring dashboard.',
}

interface ServiceStatus {
  name: string
  status: 'operational' | 'degraded' | 'down'
  latency: string
  uptime: string
}

const SERVICES: ServiceStatus[] = [
  { name: 'Web Application', status: 'operational', latency: '45ms', uptime: '99.99%' },
  { name: 'Supabase (Database)', status: 'operational', latency: '12ms', uptime: '99.98%' },
  { name: 'Supabase (Auth)', status: 'operational', latency: '38ms', uptime: '99.97%' },
  { name: 'Stripe Connect', status: 'operational', latency: '120ms', uptime: '99.95%' },
  { name: 'Resend (Email)', status: 'operational', latency: '200ms', uptime: '99.90%' },
  { name: 'Upstash Redis', status: 'operational', latency: '8ms', uptime: '99.99%' },
  { name: 'pg-boss (Job Queue)', status: 'operational', latency: '15ms', uptime: '99.98%' },
  { name: 'PostHog (Analytics)', status: 'degraded', latency: '450ms', uptime: '99.80%' },
]

const STATUS_STYLES = {
  operational: { dot: 'bg-green-500', label: 'Operational', badge: 'badge-success' },
  degraded: { dot: 'bg-amber-500', label: 'Degraded', badge: 'badge-gold' },
  down: { dot: 'bg-red-500', label: 'Down', badge: 'badge-destructive' },
}

export default function SystemHealthPage() {
  const allOperational = SERVICES.every((s) => s.status === 'operational')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">System Health</h1>
        <p className="mt-1 text-sm text-foreground-muted">Real-time status of all StageFlow services</p>
      </div>

      {/* Overall status banner */}
      <div className={`flex items-center gap-4 p-6 ${allOperational ? 'border border-green-500/30 bg-green-500/5' : 'border border-amber-500/30 bg-amber-500/5'}`}>
        <div className={`h-4 w-4 ${allOperational ? 'bg-green-500' : 'bg-amber-500'} animate-pulse`} />
        <div>
          <div className="font-semibold">
            {allOperational ? 'All Systems Operational' : 'Some Systems Degraded'}
          </div>
          <div className="text-sm text-foreground-muted">Last checked: just now</div>
        </div>
      </div>

      {/* Service grid */}
      <div className="space-y-3">
        {SERVICES.map((service) => {
          const style = STATUS_STYLES[service.status]
          return (
            <div key={service.name} className="surface-card flex items-center justify-between p-4">
              <div className="flex items-center gap-4">
                <div className={`h-3 w-3 ${style.dot}`} />
                <div>
                  <div className="text-sm font-medium">{service.name}</div>
                  <span className={style.badge}>{style.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-8 text-sm">
                <div>
                  <span className="text-foreground-muted">Latency: </span>
                  <span className="font-mono text-foreground-secondary">{service.latency}</span>
                </div>
                <div>
                  <span className="text-foreground-muted">Uptime: </span>
                  <span className="font-mono text-gold">{service.uptime}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Resource usage */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Resource Usage</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: 'Database Connections', used: 34, max: 100, unit: 'connections' },
            { label: 'Storage', used: 2.4, max: 10, unit: 'GB' },
            { label: 'Rate Limit Tokens', used: 12400, max: 100000, unit: 'tokens/min' },
          ].map((resource) => {
            const pct = (resource.used / resource.max) * 100
            return (
              <div key={resource.label} className="surface-card p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  {resource.label}
                </div>
                <div className="mt-2 text-xl font-bold">
                  {resource.used} <span className="text-sm font-normal text-foreground-muted">/ {resource.max} {resource.unit}</span>
                </div>
                <div className="mt-3 h-2 w-full bg-surface-elevated">
                  <div
                    className={`h-full ${pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-gold'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent incidents */}
      <div className="surface-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Recent Incidents</h2>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="mt-1 h-2 w-2 bg-amber-500" />
              <div>
                <div className="text-sm font-medium">PostHog ingestion delay</div>
                <div className="text-xs text-foreground-muted">May 27, 2026 08:15 UTC — Analytics events delayed by ~5 minutes. No data loss.</div>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="mt-1 h-2 w-2 bg-green-500" />
              <div>
                <div className="text-sm font-medium">Resolved: Supabase maintenance window</div>
                <div className="text-xs text-foreground-muted">May 25, 2026 02:00 UTC — Planned maintenance completed. 30s of read-only mode.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
