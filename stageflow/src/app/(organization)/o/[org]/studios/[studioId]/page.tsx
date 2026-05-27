import type { Metadata } from 'next'
import Link from 'next/link'

interface StudioDetailProps {
  params: Promise<{ org: string; studioId: string }>
}

export async function generateMetadata({ params }: StudioDetailProps): Promise<Metadata> {
  const { studioId } = await params
  return { title: `Studio ${studioId}`, description: `Studio detail view.` }
}

export default async function StudioDetailPage({ params }: StudioDetailProps) {
  const { org, studioId } = await params

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-foreground-muted">
        <Link href={`/o/${org}/studios`} className="hover:text-gold">Studios</Link>
        <span>/</span>
        <span className="text-foreground">Rhythm Studio</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rhythm Studio</h1>
          <p className="mt-1 text-sm text-foreground-muted">Studio ID: {studioId}</p>
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn-outline-gold px-4 py-2 text-xs">MESSAGE</button>
          <button type="button" className="btn-gold px-4 py-2 text-xs">EDIT</button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Dancers', value: '45' },
          { label: 'Entries', value: '34' },
          { label: 'Total Spent', value: '$2,125' },
          { label: 'Outstanding', value: '$0' },
        ].map((kpi) => (
          <div key={kpi.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{kpi.label}</div>
            <div className="mt-2 text-2xl font-bold text-gold">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Contact Info</h2>
          <dl className="space-y-3 text-sm">
            {[
              { dt: 'Owner', dd: 'Emily Chen' },
              { dt: 'Email', dd: 'emily@rhythm-studio.com' },
              { dt: 'Phone', dd: '(555) 234-5678' },
              { dt: 'Address', dd: '123 Dance Ave, Chicago, IL 60601' },
              { dt: 'Joined', dd: 'January 15, 2025' },
            ].map((item) => (
              <div key={item.dt} className="flex justify-between">
                <dt className="text-foreground-muted">{item.dt}</dt>
                <dd className="text-foreground-secondary">{item.dd}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Recent Entries</h2>
          <div className="space-y-3">
            {[
              { routine: 'Gravity', category: 'Senior Contemporary Solo', dancers: 1 },
              { routine: 'Electric Dreams', category: 'Teen Jazz Group', dancers: 8 },
              { routine: 'Unwritten', category: 'Junior Lyrical Duo', dancers: 2 },
              { routine: 'Rise Up', category: 'Mini Jazz Group', dancers: 6 },
            ].map((entry) => (
              <div key={entry.routine} className="flex justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{entry.routine}</div>
                  <div className="text-xs text-foreground-muted">{entry.category}</div>
                </div>
                <div className="text-xs text-foreground-muted">{entry.dancers} dancer{entry.dancers !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
