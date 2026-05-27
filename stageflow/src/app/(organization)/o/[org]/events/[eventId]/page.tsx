import type { Metadata } from 'next'
import Link from 'next/link'

interface EventDetailProps {
  params: Promise<{ org: string; eventId: string }>
}

export async function generateMetadata({ params }: EventDetailProps): Promise<Metadata> {
  const { eventId } = await params
  return { title: `Event ${eventId}`, description: `Event detail page for ${eventId}.` }
}

export default async function EventDetailPage({ params }: EventDetailProps) {
  const { org, eventId } = await params

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-muted">
        <Link href={`/o/${org}/events`} className="hover:text-gold">Events</Link>
        <span>/</span>
        <span className="text-foreground">Summer Showcase 2026</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Summer Showcase 2026</h1>
            <span className="badge-success">Entries Open</span>
          </div>
          <p className="mt-1 text-sm text-foreground-muted">
            Jul 12-14, 2026 — Grand Ballroom, Chicago
          </p>
        </div>
        <div className="flex gap-3">
          <Link href={`/o/${org}/events/${eventId}/categories`} className="btn-outline-gold px-4 py-2 text-xs">
            CATEGORIES
          </Link>
          <button type="button" className="btn-gold px-4 py-2 text-xs">
            EDIT EVENT
          </button>
        </div>
      </div>

      {/* Event KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Total Entries', value: '342' },
          { label: 'Studios Registered', value: '28' },
          { label: 'Categories', value: '24' },
          { label: 'Revenue', value: '$8,550' },
        ].map((kpi) => (
          <div key={kpi.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{kpi.label}</div>
            <div className="mt-2 text-3xl font-bold text-gold">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Entry breakdown */}
        <div className="surface-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Entry Breakdown by Category</h2>
          </div>
          <div className="divide-y divide-border">
            {[
              { category: 'Senior Contemporary Solo', count: 48 },
              { category: 'Teen Jazz Group', count: 32 },
              { category: 'Junior Hip-Hop Duo', count: 28 },
              { category: 'Senior Ballet Solo', count: 24 },
              { category: 'Mini Lyrical Solo', count: 22 },
              { category: 'Teen Contemporary Group', count: 18 },
            ].map((cat) => (
              <div key={cat.category} className="flex items-center justify-between px-6 py-3">
                <span className="text-sm text-foreground-secondary">{cat.category}</span>
                <span className="font-mono text-sm text-gold">{cat.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top studios */}
        <div className="surface-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Top Studios by Entries</h2>
          </div>
          <div className="divide-y divide-border">
            {[
              { studio: 'Rhythm Studio', entries: 34, amount: '$850' },
              { studio: 'Elite Academy', entries: 28, amount: '$700' },
              { studio: 'Classical Motion', entries: 22, amount: '$550' },
              { studio: 'Urban Edge', entries: 18, amount: '$450' },
              { studio: 'Graceful Arts', entries: 15, amount: '$375' },
            ].map((studio) => (
              <div key={studio.studio} className="flex items-center justify-between px-6 py-3">
                <div>
                  <div className="text-sm font-medium">{studio.studio}</div>
                  <div className="text-xs text-foreground-muted">{studio.entries} entries</div>
                </div>
                <span className="font-mono text-sm text-gold">{studio.amount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Event settings */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Event Details</h2>
        <dl className="grid gap-4 md:grid-cols-2">
          {[
            { dt: 'Event ID', dd: eventId },
            { dt: 'Venue', dd: 'Grand Ballroom, Chicago' },
            { dt: 'Entry Deadline', dd: 'Jun 30, 2026' },
            { dt: 'Music Deadline', dd: 'Jul 5, 2026' },
            { dt: 'Entry Fee (Solo)', dd: '$25.00' },
            { dt: 'Entry Fee (Group)', dd: '$15.00 per dancer' },
            { dt: 'Late Fee', dd: '$5.00 per entry' },
            { dt: 'Max Entries per Studio', dd: 'Unlimited' },
          ].map((item) => (
            <div key={item.dt} className="flex justify-between text-sm">
              <dt className="text-foreground-muted">{item.dt}</dt>
              <dd className="text-foreground-secondary">{item.dd}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
