import type { Metadata } from 'next'
import Link from 'next/link'

interface OrganizationDetailPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: OrganizationDetailPageProps): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Organization ${id}`,
    description: `Detail view for organization ${id}.`,
  }
}

export default async function OrganizationDetailPage({ params }: OrganizationDetailPageProps) {
  const { id } = await params

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-muted">
        <Link href="/admin/organizations" className="hover:text-gold">Organizations</Link>
        <span>/</span>
        <span className="text-foreground">Organization #{id}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Starlight Dance Championships</h1>
          <p className="mt-1 text-sm text-foreground-muted">starlight.stageflow.app</p>
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn-outline-gold px-4 py-2 text-xs">
            IMPERSONATE
          </button>
          <button type="button" className="border border-destructive px-4 py-2 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10">
            SUSPEND
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Plan', value: 'Professional', extra: '$149/mo' },
          { label: 'Studios', value: '42', extra: '+3 this month' },
          { label: 'Total Entries', value: '1,283', extra: 'Across 4 events' },
          { label: 'Status', value: 'Active', extra: 'Since Mar 2024' },
        ].map((kpi) => (
          <div key={kpi.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{kpi.label}</div>
            <div className="mt-2 text-2xl font-bold text-gold">{kpi.value}</div>
            <div className="mt-1 text-xs text-foreground-muted">{kpi.extra}</div>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Organization Info */}
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Organization Info</h2>
          <dl className="space-y-3">
            {[
              { dt: 'Name', dd: 'Starlight Dance Championships' },
              { dt: 'Slug', dd: 'starlight' },
              { dt: 'Owner', dd: 'sarah@starlight-dance.com' },
              { dt: 'Created', dd: 'March 15, 2024' },
              { dt: 'Custom Domain', dd: 'register.starlight-dance.com' },
              { dt: 'Stripe Account', dd: 'acct_1Nq...connected' },
            ].map((item) => (
              <div key={item.dt} className="flex justify-between text-sm">
                <dt className="text-foreground-muted">{item.dt}</dt>
                <dd className="text-foreground-secondary">{item.dd}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Recent Events */}
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Recent Events</h2>
          <div className="space-y-3">
            {[
              { name: 'Summer Showcase 2026', date: 'Jul 12-14, 2026', entries: 342, status: 'Open' },
              { name: 'Spring Classic 2026', date: 'Mar 8-10, 2026', entries: 289, status: 'Closed' },
              { name: 'Winter Gala 2025', date: 'Dec 1-3, 2025', entries: 356, status: 'Completed' },
              { name: 'Fall Championship 2025', date: 'Oct 5-7, 2025', entries: 296, status: 'Completed' },
            ].map((event) => (
              <div key={event.name} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{event.name}</div>
                  <div className="text-xs text-foreground-muted">{event.date}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gold">{event.entries} entries</div>
                  <div className="text-xs text-foreground-muted">{event.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Billing History */}
      <div className="surface-card overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Billing History</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Date</th>
              <th className="px-6 py-3 text-left">Description</th>
              <th className="px-6 py-3 text-right">Amount</th>
              <th className="px-6 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              { date: 'May 1, 2026', desc: 'Professional Plan', amount: '$149.00', status: 'Paid' },
              { date: 'Apr 1, 2026', desc: 'Professional Plan', amount: '$149.00', status: 'Paid' },
              { date: 'Mar 1, 2026', desc: 'Professional Plan', amount: '$149.00', status: 'Paid' },
            ].map((invoice, i) => (
              <tr key={i} className="table-row">
                <td className="px-6 py-3 text-sm text-foreground-secondary">{invoice.date}</td>
                <td className="px-6 py-3 text-sm text-foreground-secondary">{invoice.desc}</td>
                <td className="px-6 py-3 text-right text-sm font-medium text-gold">{invoice.amount}</td>
                <td className="px-6 py-3 text-right"><span className="badge-success">{invoice.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
