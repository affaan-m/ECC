import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Events',
  description: 'Manage your competition events.',
}

interface OrgEventsProps {
  params: Promise<{ org: string }>
}

interface Event {
  id: string
  name: string
  startDate: string
  endDate: string
  venue: string
  entries: number
  studios: number
  status: 'draft' | 'open' | 'closed' | 'in_progress' | 'completed'
}

const SAMPLE_EVENTS: Event[] = [
  { id: 'evt_1', name: 'Summer Showcase 2026', startDate: 'Jul 12, 2026', endDate: 'Jul 14, 2026', venue: 'Grand Ballroom, Chicago', entries: 342, studios: 18, status: 'open' },
  { id: 'evt_2', name: 'Fall Championship 2026', startDate: 'Oct 4, 2026', endDate: 'Oct 6, 2026', venue: 'Convention Center, Atlanta', entries: 0, studios: 0, status: 'draft' },
  { id: 'evt_3', name: 'Spring Classic 2026', startDate: 'Mar 8, 2026', endDate: 'Mar 10, 2026', venue: 'Performing Arts Center, Nashville', entries: 289, studios: 22, status: 'completed' },
  { id: 'evt_4', name: 'Winter Gala 2025', startDate: 'Dec 1, 2025', endDate: 'Dec 3, 2025', venue: 'Hilton Ballroom, Orlando', entries: 356, studios: 25, status: 'completed' },
]

const STATUS_STYLES: Record<Event['status'], string> = {
  draft: 'bg-foreground-muted/15 text-foreground-muted',
  open: 'badge-success',
  closed: 'badge-gold',
  in_progress: 'bg-blue-500/15 text-blue-400',
  completed: 'bg-foreground-muted/15 text-foreground-muted',
}

const STATUS_LABELS: Record<Event['status'], string> = {
  draft: 'Draft',
  open: 'Entries Open',
  closed: 'Entries Closed',
  in_progress: 'In Progress',
  completed: 'Completed',
}

export default async function OrgEventsPage({ params }: OrgEventsProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description={`${SAMPLE_EVENTS.length} events total`}
        actions={
          <button type="button" className="btn-gold px-5 py-2.5 text-xs">
            CREATE EVENT
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        {['All', 'Active', 'Draft', 'Completed'].map((filter) => (
          <button
            key={filter}
            type="button"
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === 'All'
                ? 'bg-gold text-black'
                : 'bg-[#202020] text-white/60 hover:text-white'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {SAMPLE_EVENTS.map((event) => (
          <Link
            key={event.id}
            href={`/o/${org}/events/${event.id}`}
            className="surface-card flex items-center justify-between p-6 transition-colors hover:border-gold/30"
          >
            <div className="flex items-center gap-6">
              <div className="flex h-14 w-14 flex-col items-center justify-center bg-gold-muted text-gold">
                <div className="text-xs font-bold">{event.startDate.split(' ')[0]}</div>
                <div className="text-lg font-bold">{event.startDate.split(' ')[1]?.replace(',', '')}</div>
              </div>
              <div>
                <h3 className="text-base font-semibold">{event.name}</h3>
                <div className="mt-1 text-sm text-foreground-muted">{event.venue}</div>
                <div className="mt-1 text-xs text-foreground-muted">{event.startDate} — {event.endDate}</div>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <div className="text-right">
                <div className="text-lg font-bold text-gold">{event.entries}</div>
                <div className="text-xs text-foreground-muted">entries</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{event.studios}</div>
                <div className="text-xs text-foreground-muted">studios</div>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 ${STATUS_STYLES[event.status]}`}>
                {STATUS_LABELS[event.status]}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
