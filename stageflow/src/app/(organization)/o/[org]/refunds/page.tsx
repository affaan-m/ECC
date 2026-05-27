import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Refunds',
  description: 'Process and manage refund requests.',
}

interface Refund {
  id: string
  studio: string
  entry: string
  amount: string
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'processed'
  requestedAt: string
}

const SAMPLE_REFUNDS: Refund[] = [
  { id: '1', studio: 'Dance Fusion', entry: 'Starlight (#892)', amount: '$45.00', reason: 'Dancer injury — withdrew from competition', status: 'pending', requestedAt: '6h ago' },
  { id: '2', studio: 'Urban Edge', entry: 'Neon Nights (#845)', amount: '$25.00', reason: 'Duplicate entry submitted', status: 'pending', requestedAt: '1d ago' },
  { id: '3', studio: 'Rhythm Studio', entry: 'Midnight Train (#830)', amount: '$25.00', reason: 'Routine withdrawn by studio', status: 'approved', requestedAt: '3d ago' },
  { id: '4', studio: 'Elite Academy', entry: 'Phoenix (#812)', amount: '$15.00', reason: 'Category cancelled by organizer', status: 'processed', requestedAt: '1w ago' },
]

const STATUS_BADGE: Record<Refund['status'], string> = {
  pending: 'badge-gold',
  approved: 'badge-success',
  rejected: 'badge-destructive',
  processed: 'bg-foreground-muted/15 text-foreground-muted text-xs font-semibold px-2 py-0.5',
}

export default function RefundsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description="Review and process refund requests from studios"
      />

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Pending', value: '2', amount: '$70.00' },
          { label: 'Approved (awaiting payout)', value: '1', amount: '$25.00' },
          { label: 'Processed this month', value: '1', amount: '$15.00' },
        ].map((s) => (
          <div key={s.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{s.label}</div>
            <div className="mt-2 text-2xl font-bold text-gold">{s.value}</div>
            <div className="mt-1 text-xs text-foreground-muted">{s.amount}</div>
          </div>
        ))}
      </div>

      <div className="surface-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Studio</th>
              <th className="px-6 py-3 text-left">Entry</th>
              <th className="px-6 py-3 text-right">Amount</th>
              <th className="px-6 py-3 text-left">Reason</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_REFUNDS.map((refund) => (
              <tr key={refund.id} className="table-row">
                <td className="px-6 py-4 text-sm font-medium">{refund.studio}</td>
                <td className="px-6 py-4 text-sm text-foreground-secondary">{refund.entry}</td>
                <td className="px-6 py-4 text-right text-sm font-medium text-gold">{refund.amount}</td>
                <td className="px-6 py-4 text-sm text-foreground-muted">{refund.reason}</td>
                <td className="px-6 py-4"><span className={STATUS_BADGE[refund.status]}>{refund.status}</span></td>
                <td className="px-6 py-4 text-right">
                  {refund.status === 'pending' && (
                    <div className="flex justify-end gap-2">
                      <button type="button" className="text-xs text-green-500 hover:text-green-400">Approve</button>
                      <button type="button" className="text-xs text-destructive hover:text-destructive-hover">Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
