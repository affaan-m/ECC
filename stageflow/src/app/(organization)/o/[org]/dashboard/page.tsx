import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Organization dashboard overview.',
}

interface OrgDashboardProps {
  params: Promise<{ org: string }>
}

export default async function OrgDashboardPage({ params }: OrgDashboardProps) {
  const { org } = await params

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={`Welcome back. Here is what is happening with ${org}.`}
      />

      {/* KPI row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'Upcoming Events', value: '3', sub: '1 this week', accent: true },
          { label: 'Total Entries', value: '1,283', sub: '+42 this week', accent: true },
          { label: 'Payment Status', value: '$18.4k', sub: 'collected this month', accent: false },
          { label: 'Unread Inbox', value: '7', sub: '3 new today', accent: false },
          { label: 'Pending Refunds', value: '4', sub: '$620 total', accent: false },
          { label: 'Active Studios', value: '42', sub: '+3 this month', accent: false },
        ].map((kpi) => (
          <div key={kpi.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{kpi.label}</div>
            <div className={`mt-2 text-3xl font-bold ${kpi.accent ? 'text-gold' : 'text-white'}`}>{kpi.value}</div>
            <div className="mt-1 text-xs text-foreground-muted">{kpi.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming events */}
        <div className="surface-card">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Upcoming Events</h2>
            <Link href={`/o/${org}/events`} className="text-xs text-gold hover:text-gold-hover">View all</Link>
          </div>
          <div className="divide-y divide-border">
            {[
              { name: 'Summer Showcase 2026', date: 'Jul 12-14, 2026', entries: 342, status: 'Entries Open' },
              { name: 'Fall Championship 2026', date: 'Oct 4-6, 2026', entries: 0, status: 'Coming Soon' },
            ].map((event) => (
              <div key={event.name} className="flex items-center justify-between px-6 py-4">
                <div>
                  <div className="text-sm font-medium">{event.name}</div>
                  <div className="text-xs text-foreground-muted">{event.date}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gold">{event.entries} entries</div>
                  <span className="badge-gold">{event.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent entries */}
        <div className="surface-card">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Recent Entries</h2>
            <Link href={`/o/${org}/entries`} className="text-xs text-gold hover:text-gold-hover">View all</Link>
          </div>
          <div className="divide-y divide-border">
            {[
              { routine: 'Gravity', studio: 'Rhythm Studio', category: 'Senior Contemporary Solo', time: '2h ago' },
              { routine: 'Electric Dreams', studio: 'Elite Academy', category: 'Teen Jazz Group', time: '3h ago' },
              { routine: 'Swan Lake Variation', studio: 'Classical Motion', category: 'Senior Ballet Solo', time: '5h ago' },
              { routine: 'Breaking Free', studio: 'Urban Edge', category: 'Junior Hip-Hop Duo', time: '8h ago' },
            ].map((entry) => (
              <div key={entry.routine} className="flex items-center justify-between px-6 py-3">
                <div>
                  <div className="text-sm font-medium">{entry.routine}</div>
                  <div className="text-xs text-foreground-muted">{entry.studio} — {entry.category}</div>
                </div>
                <div className="text-xs text-foreground-muted">{entry.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="surface-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Recent Activity</h2>
        </div>
        <div className="divide-y divide-border">
          {[
            { action: 'New entry submitted', detail: '"Gravity" by Rhythm Studio for Summer Showcase 2026', time: '2h ago' },
            { action: 'Invoice paid', detail: 'Elite Academy — Invoice #1042 ($385.00)', time: '4h ago' },
            { action: 'Refund requested', detail: 'Dance Fusion — Entry #892 ($45.00)', time: '6h ago' },
            { action: 'Studio registered', detail: 'Prestige Dance Co. joined your organization', time: '1d ago' },
            { action: 'Event updated', detail: 'Summer Showcase 2026 — added 3 new categories', time: '1d ago' },
          ].map((item) => (
            <div key={item.detail} className="flex items-center justify-between px-6 py-3">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 bg-gold" />
                <div>
                  <div className="text-sm font-medium">{item.action}</div>
                  <div className="text-xs text-foreground-muted">{item.detail}</div>
                </div>
              </div>
              <div className="text-xs text-foreground-muted">{item.time}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Create Event', href: `/o/${org}/events` },
          { label: 'View Invoices', href: `/o/${org}/invoices` },
          { label: 'Manage Studios', href: `/o/${org}/studios` },
          { label: 'Branding', href: `/o/${org}/branding` },
        ].map((action) => (
          <Link
            key={action.label}
            href={action.href}
            className="surface-card flex items-center justify-between p-4 transition-colors hover:border-gold/30"
          >
            <span className="text-sm font-medium">{action.label}</span>
            <ArrowRight className="h-4 w-4 text-gold" />
          </Link>
        ))}
      </div>
    </div>
  )
}
