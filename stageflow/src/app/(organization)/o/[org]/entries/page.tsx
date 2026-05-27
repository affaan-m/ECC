import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, Minus } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Entries',
  description: 'View and manage all competition entries.',
}

interface EntriesPageProps {
  params: Promise<{ org: string }>
}

interface Entry {
  id: string
  routineName: string
  studio: string
  event: string
  category: string
  dancers: number
  musicUploaded: boolean
  status: 'submitted' | 'approved' | 'needs_revision' | 'withdrawn'
  submittedAt: string
}

const SAMPLE_ENTRIES: Entry[] = [
  { id: 'ent_1', routineName: 'Gravity', studio: 'Rhythm Studio', event: 'Summer Showcase 2026', category: 'Senior Contemporary Solo', dancers: 1, musicUploaded: true, status: 'approved', submittedAt: '2h ago' },
  { id: 'ent_2', routineName: 'Electric Dreams', studio: 'Elite Academy', event: 'Summer Showcase 2026', category: 'Teen Jazz Group', dancers: 8, musicUploaded: true, status: 'approved', submittedAt: '3h ago' },
  { id: 'ent_3', routineName: 'Swan Lake Variation', studio: 'Classical Motion', event: 'Summer Showcase 2026', category: 'Senior Ballet Solo', dancers: 1, musicUploaded: false, status: 'needs_revision', submittedAt: '5h ago' },
  { id: 'ent_4', routineName: 'Breaking Free', studio: 'Urban Edge', event: 'Summer Showcase 2026', category: 'Junior Hip-Hop Duo', dancers: 2, musicUploaded: true, status: 'submitted', submittedAt: '8h ago' },
  { id: 'ent_5', routineName: 'Firebird', studio: 'Graceful Arts', event: 'Summer Showcase 2026', category: 'Teen Contemporary Group', dancers: 6, musicUploaded: true, status: 'approved', submittedAt: '1d ago' },
  { id: 'ent_6', routineName: 'Midnight Train', studio: 'Rhythm Studio', event: 'Summer Showcase 2026', category: 'Senior Lyrical Solo', dancers: 1, musicUploaded: true, status: 'withdrawn', submittedAt: '2d ago' },
]

const STATUS_BADGE: Record<Entry['status'], string> = {
  submitted: 'badge-gold',
  approved: 'badge-success',
  needs_revision: 'badge-destructive',
  withdrawn: 'bg-foreground-muted/15 text-foreground-muted text-xs font-semibold px-2 py-0.5',
}

export default async function EntriesPage({ params }: EntriesPageProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entries"
        description={`${SAMPLE_ENTRIES.length} entries across all events`}
        actions={
          <div className="flex gap-2">
            <button type="button" className="btn-outline-gold px-4 py-2 text-xs">EXPORT CSV</button>
            <button type="button" className="px-4 py-2 text-xs font-medium bg-[#202020] text-white border border-white/10 hover:border-gold/30 transition-colors">
              BULK ACTIONS
            </button>
          </div>
        }
      />

      {/* Saved views */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-foreground-muted">Saved views:</span>
        {['All Entries', 'Pending Review', 'Missing Music', 'Unpaid'].map((view) => (
          <button
            key={view}
            type="button"
            className={`px-2 py-1 text-xs transition-colors ${
              view === 'All Entries'
                ? 'bg-gold/15 text-gold'
                : 'text-foreground-muted hover:text-white'
            }`}
          >
            {view}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input type="search" placeholder="Search routines, studios..." className="input-dark w-64" />
        <select className="input-dark">
          <option value="">All Events</option>
          <option value="evt_1">Summer Showcase 2026</option>
          <option value="evt_2">Fall Championship 2026</option>
        </select>
        <select className="input-dark">
          <option value="">All Categories</option>
          <option>Senior Contemporary Solo</option>
          <option>Teen Jazz Group</option>
        </select>
        <select className="input-dark">
          <option value="">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="needs_revision">Needs Revision</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
      </div>

      {/* Entries grid/table */}
      <div className="surface-card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Routine</th>
              <th className="px-6 py-3 text-left">Studio</th>
              <th className="px-6 py-3 text-left">Category</th>
              <th className="px-6 py-3 text-right">Dancers</th>
              <th className="px-6 py-3 text-center">Music</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_ENTRIES.map((entry) => (
              <tr key={entry.id} className="table-row">
                <td className="px-6 py-4">
                  <Link href={`/o/${org}/entries/${entry.id}`} className="text-sm font-medium hover:text-gold">
                    {entry.routineName}
                  </Link>
                </td>
                <td className="px-6 py-4 text-sm text-foreground-secondary">{entry.studio}</td>
                <td className="px-6 py-4 text-sm text-foreground-muted">{entry.category}</td>
                <td className="px-6 py-4 text-right text-sm text-foreground-secondary">{entry.dancers}</td>
                <td className="px-6 py-4 text-center">
                  <span className={entry.musicUploaded ? 'text-green-500' : 'text-foreground-muted'}>
                    {entry.musicUploaded ? <Check className="h-4 w-4 inline" /> : <Minus className="h-4 w-4 inline" />}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={STATUS_BADGE[entry.status]}>{entry.status.replace('_', ' ')}</span>
                </td>
                <td className="px-6 py-4 text-right text-sm text-foreground-muted">{entry.submittedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
