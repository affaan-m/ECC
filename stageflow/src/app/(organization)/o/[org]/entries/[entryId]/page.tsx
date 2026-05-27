import type { Metadata } from 'next'
import Link from 'next/link'
import { Music } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'

interface EntryDetailProps {
  params: Promise<{ org: string; entryId: string }>
}

export async function generateMetadata({ params }: EntryDetailProps): Promise<Metadata> {
  const { entryId } = await params
  return { title: `Entry ${entryId}`, description: 'Entry detail view.' }
}

export default async function EntryDetailPage({ params }: EntryDetailProps) {
  const { org, entryId } = await params

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-foreground-muted">
        <Link href={`/o/${org}/entries`} className="hover:text-gold">Entries</Link>
        <span>/</span>
        <span className="text-foreground">Gravity</span>
      </div>

      <PageHeader
        title="Gravity"
        description={`Entry ID: ${entryId} — Rhythm Studio — Senior Contemporary Solo`}
        actions={
          <div className="flex items-center gap-3">
            <span className="badge-success">Approved</span>
            <button type="button" className="border border-destructive px-4 py-2 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10">
              REJECT
            </button>
            <button type="button" className="btn-gold px-4 py-2 text-xs">APPROVE</button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Entry details */}
        <div className="surface-card p-6 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Entry Details</h2>
          <dl className="grid gap-4 md:grid-cols-2">
            {[
              { dt: 'Routine Name', dd: 'Gravity' },
              { dt: 'Studio', dd: 'Rhythm Studio' },
              { dt: 'Event', dd: 'Summer Showcase 2026' },
              { dt: 'Category', dd: 'Senior Contemporary Solo' },
              { dt: 'Age Group', dd: 'Senior (15-19)' },
              { dt: 'Genre', dd: 'Contemporary' },
              { dt: 'Performer Type', dd: 'Solo' },
              { dt: 'Dancer Count', dd: '1' },
              { dt: 'Entry Fee', dd: '$25.00' },
              { dt: 'Submitted', dd: 'May 27, 2026 at 8:34 AM' },
            ].map((item) => (
              <div key={item.dt} className="flex justify-between text-sm">
                <dt className="text-foreground-muted">{item.dt}</dt>
                <dd className="text-foreground-secondary">{item.dd}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Music & Documents */}
        <div className="space-y-6">
          <div className="surface-card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Music</h2>
            <div className="flex items-center gap-3 bg-surface-elevated p-4">
              <div className="flex h-10 w-10 items-center justify-center bg-gold-muted text-gold"><Music className="h-5 w-5" /></div>
              <div className="flex-1">
                <div className="text-sm font-medium">gravity-mix.mp3</div>
                <div className="text-xs text-foreground-muted">2:45 — 4.2 MB</div>
              </div>
              <button type="button" className="text-xs text-gold hover:text-gold-hover">Play</button>
            </div>
          </div>

          <div className="surface-card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Dancers</h2>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center bg-surface-elevated text-xs font-bold text-gold">JD</div>
              <div>
                <div className="text-sm font-medium">Jane Doe</div>
                <div className="text-xs text-foreground-muted">Age 17 — DOB: Mar 12, 2009</div>
              </div>
            </div>
          </div>

          {/* Invoice */}
          <div className="surface-card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Invoice</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-foreground-muted">Entry Fee</span>
                <span>$25.00</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span className="text-gold">$25.00</span>
              </div>
              <div className="mt-2">
                <span className="badge-success">Paid</span>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="surface-card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Tags</h2>
            <div className="flex flex-wrap gap-2">
              {['featured', 'returning', 'scholarship'].map((tag) => (
                <span key={tag} className="bg-white/10 px-2 py-0.5 text-xs text-white">{tag}</span>
              ))}
            </div>
          </div>

          <div className="surface-card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">History</h2>
            <div className="space-y-3">
              {[
                { action: 'Approved by admin', time: '2h ago' },
                { action: 'Music uploaded', time: '3h ago' },
                { action: 'Entry submitted', time: '3h ago' },
              ].map((event, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">{event.action}</span>
                  <span className="text-foreground-muted">{event.time}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="surface-card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Actions</h2>
            <div className="space-y-2">
              {['Send Confirmation Email', 'Download Music', 'Print Entry Sheet', 'Request Refund'].map((action) => (
                <button
                  key={action}
                  type="button"
                  className="w-full px-3 py-2 text-left text-xs text-foreground-muted hover:text-white hover:bg-white/5 transition-colors"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
