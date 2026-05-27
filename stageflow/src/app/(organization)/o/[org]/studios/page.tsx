import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Studios',
  description: 'View and manage registered dance studios.',
}

interface StudiosPageProps {
  params: Promise<{ org: string }>
}

interface Studio {
  id: string
  name: string
  owner: string
  email: string
  dancers: number
  entries: number
  outstandingBalance: string
  status: 'active' | 'invited' | 'inactive'
}

const SAMPLE_STUDIOS: Studio[] = [
  { id: 's1', name: 'Rhythm Studio', owner: 'Emily Chen', email: 'emily@rhythm-studio.com', dancers: 45, entries: 34, outstandingBalance: '$0', status: 'active' },
  { id: 's2', name: 'Elite Academy', owner: 'Tom Harris', email: 'tom@elite-academy.com', dancers: 62, entries: 28, outstandingBalance: '$350', status: 'active' },
  { id: 's3', name: 'Classical Motion', owner: 'Nina Petrov', email: 'nina@classicalmotion.com', dancers: 30, entries: 22, outstandingBalance: '$0', status: 'active' },
  { id: 's4', name: 'Urban Edge', owner: 'Marcus Johnson', email: 'marcus@urbanedge.dance', dancers: 28, entries: 18, outstandingBalance: '$125', status: 'active' },
  { id: 's5', name: 'Graceful Arts', owner: 'Sophie Taylor', email: 'sophie@gracefularts.com', dancers: 20, entries: 15, outstandingBalance: '$0', status: 'active' },
  { id: 's6', name: 'New Horizons Dance', owner: 'Pending', email: 'info@newhorizons.dance', dancers: 0, entries: 0, outstandingBalance: '$0', status: 'invited' },
]

export default async function StudiosPage({ params }: StudiosPageProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Studios</h1>
          <p className="mt-1 text-sm text-foreground-muted">{SAMPLE_STUDIOS.length} studios registered</p>
        </div>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">INVITE STUDIO</button>
      </div>

      <div className="flex gap-3">
        <input type="search" placeholder="Search studios..." className="input-dark w-64" />
        <select className="input-dark">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="surface-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Studio</th>
              <th className="px-6 py-3 text-left">Owner</th>
              <th className="px-6 py-3 text-right">Dancers</th>
              <th className="px-6 py-3 text-right">Entries</th>
              <th className="px-6 py-3 text-right">Balance</th>
              <th className="px-6 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_STUDIOS.map((studio) => (
              <tr key={studio.id} className="table-row">
                <td className="px-6 py-4">
                  <Link href={`/o/${org}/studios/${studio.id}`} className="text-sm font-medium hover:text-gold">
                    {studio.name}
                  </Link>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-foreground-secondary">{studio.owner}</div>
                  <div className="text-xs text-foreground-muted">{studio.email}</div>
                </td>
                <td className="px-6 py-4 text-right text-sm text-foreground-secondary">{studio.dancers}</td>
                <td className="px-6 py-4 text-right text-sm text-gold">{studio.entries}</td>
                <td className="px-6 py-4 text-right text-sm">
                  <span className={studio.outstandingBalance === '$0' ? 'text-foreground-muted' : 'text-destructive font-medium'}>
                    {studio.outstandingBalance}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={studio.status === 'active' ? 'badge-success' : studio.status === 'invited' ? 'badge-gold' : 'badge-destructive'}>
                    {studio.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
