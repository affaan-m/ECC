import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Platform Admin',
  description: 'StageFlow platform administration dashboard.',
}

interface KpiCard {
  label: string
  value: string
  change: string
  trend: 'up' | 'down' | 'neutral'
}

const KPI_CARDS: KpiCard[] = [
  { label: 'Total Organizations', value: '247', change: '+12 this month', trend: 'up' },
  { label: 'Monthly Recurring Revenue', value: '$36,753', change: '+8.2%', trend: 'up' },
  { label: 'New Signups (30d)', value: '34', change: '+5 vs last month', trend: 'up' },
  { label: 'Total Entries', value: '128,492', change: '+4,231 this week', trend: 'up' },
  { label: 'Failed Payments', value: '3', change: '-2 from last week', trend: 'down' },
  { label: 'Active Events', value: '18', change: '6 upcoming', trend: 'neutral' },
]

export default function PlatformDashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Platform Dashboard</h1>
        <p className="mt-1 text-sm text-foreground-muted">Overview of all StageFlow activity</p>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {KPI_CARDS.map((kpi) => (
          <div key={kpi.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{kpi.label}</div>
            <div className="mt-2 text-3xl font-bold text-gold">{kpi.value}</div>
            <div
              className={`mt-1 text-xs ${
                kpi.trend === 'up'
                  ? 'text-green-500'
                  : kpi.trend === 'down'
                    ? 'text-red-500'
                    : 'text-foreground-muted'
              }`}
            >
              {kpi.change}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="surface-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Recent Activity</h2>
        </div>
        <div className="divide-y divide-border">
          {[
            { time: '2 min ago', event: 'New organization registered', detail: 'Elite Dance Series', type: 'signup' },
            { time: '15 min ago', event: 'Payment failed', detail: 'Starlight Championships — $149.00', type: 'error' },
            { time: '1 hr ago', event: 'Plan upgrade', detail: 'Rhythm Nation → Professional', type: 'upgrade' },
            { time: '2 hr ago', event: 'New event created', detail: 'Summer Showcase 2026 — Elevate Comp.', type: 'event' },
            { time: '3 hr ago', event: 'Impersonation session', detail: 'admin@stageflow.app → studios@rhythm.com', type: 'audit' },
          ].map((activity, i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-3">
              <div
                className={`flex h-8 w-8 items-center justify-center text-xs font-bold ${
                  activity.type === 'error'
                    ? 'bg-red-500/15 text-red-500'
                    : activity.type === 'signup'
                      ? 'bg-green-500/15 text-green-500'
                      : 'bg-gold-muted text-gold'
                }`}
              >
                {activity.type === 'error' ? '!' : activity.type === 'signup' ? '+' : '→'}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground-secondary">{activity.event}</div>
                <div className="text-xs text-foreground-muted">{activity.detail}</div>
              </div>
              <div className="text-xs text-foreground-muted">{activity.time}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'View Organizations', href: '/admin/organizations' },
          { label: 'Search Users', href: '/admin/users' },
          { label: 'Audit Logs', href: '/admin/audit-logs' },
          { label: 'System Health', href: '/admin/system-health' },
        ].map((action) => (
          <a
            key={action.label}
            href={action.href}
            className="surface-card flex items-center justify-between p-4 transition-colors hover:border-gold/30"
          >
            <span className="text-sm font-medium">{action.label}</span>
            <span className="text-gold">→</span>
          </a>
        ))}
      </div>
    </div>
  )
}
