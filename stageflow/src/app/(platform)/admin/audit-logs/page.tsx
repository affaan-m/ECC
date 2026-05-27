import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Audit Logs',
  description: 'Platform-wide audit log viewer.',
}

interface AuditEntry {
  id: string
  timestamp: string
  actor: string
  action: string
  resource: string
  detail: string
  ip: string
}

const SAMPLE_LOGS: AuditEntry[] = [
  { id: '1', timestamp: '2026-05-27 10:34:12', actor: 'admin@stageflow.app', action: 'impersonate.start', resource: 'user:sarah@starlight-dance.com', detail: 'Started impersonation session', ip: '192.168.1.100' },
  { id: '2', timestamp: '2026-05-27 10:30:05', actor: 'admin@stageflow.app', action: 'impersonate.end', resource: 'user:sarah@starlight-dance.com', detail: 'Ended impersonation session', ip: '192.168.1.100' },
  { id: '3', timestamp: '2026-05-27 09:15:33', actor: 'system', action: 'payment.failed', resource: 'org:premier', detail: 'Stripe charge failed — card declined', ip: '—' },
  { id: '4', timestamp: '2026-05-27 08:42:00', actor: 'james@elevate-comp.com', action: 'event.create', resource: 'event:summer-showcase-2026', detail: 'Created new event: Summer Showcase 2026', ip: '203.45.67.89' },
  { id: '5', timestamp: '2026-05-26 22:10:45', actor: 'system', action: 'org.plan_change', resource: 'org:rhythm-nation', detail: 'Plan changed: starter → professional', ip: '—' },
  { id: '6', timestamp: '2026-05-26 18:33:21', actor: 'lisa@cascade.com', action: 'user.invite', resource: 'user:mark@cascade.com', detail: 'Invited team member', ip: '10.0.0.42' },
]

const ACTION_COLORS: Record<string, string> = {
  'impersonate.start': 'text-amber-500',
  'impersonate.end': 'text-amber-500',
  'payment.failed': 'text-red-500',
  'event.create': 'text-green-500',
  'org.plan_change': 'text-gold',
  'user.invite': 'text-blue-400',
}

export default function AuditLogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="mt-1 text-sm text-foreground-muted">Platform-wide activity and security log</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input type="search" placeholder="Search logs..." className="input-dark w-64" />
        <select className="input-dark">
          <option value="">All Actions</option>
          <option value="impersonate">Impersonation</option>
          <option value="payment">Payment</option>
          <option value="event">Event</option>
          <option value="org">Organization</option>
          <option value="user">User</option>
        </select>
        <input type="date" className="input-dark" />
        <input type="date" className="input-dark" />
        <button type="button" className="btn-outline-gold px-4 py-2 text-xs">APPLY FILTERS</button>
      </div>

      {/* Log table */}
      <div className="surface-card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Timestamp</th>
              <th className="px-6 py-3 text-left">Actor</th>
              <th className="px-6 py-3 text-left">Action</th>
              <th className="px-6 py-3 text-left">Resource</th>
              <th className="px-6 py-3 text-left">Detail</th>
              <th className="px-6 py-3 text-left">IP</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_LOGS.map((log) => (
              <tr key={log.id} className="table-row">
                <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-foreground-muted">{log.timestamp}</td>
                <td className="px-6 py-3 text-sm text-foreground-secondary">{log.actor}</td>
                <td className="px-6 py-3">
                  <code className={`font-mono text-xs ${ACTION_COLORS[log.action] ?? 'text-foreground-secondary'}`}>
                    {log.action}
                  </code>
                </td>
                <td className="px-6 py-3 font-mono text-xs text-foreground-muted">{log.resource}</td>
                <td className="px-6 py-3 text-sm text-foreground-secondary">{log.detail}</td>
                <td className="px-6 py-3 font-mono text-xs text-foreground-muted">{log.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground-muted">Showing latest 6 entries</p>
        <button type="button" className="btn-outline-gold px-4 py-2 text-xs">LOAD MORE</button>
      </div>
    </div>
  )
}
