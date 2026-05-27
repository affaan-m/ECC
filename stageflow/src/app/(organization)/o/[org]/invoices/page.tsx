import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Invoices',
  description: 'Manage invoices sent to studios.',
}

interface Invoice {
  id: string
  number: string
  studio: string
  event: string
  amount: string
  status: 'paid' | 'pending' | 'overdue' | 'draft'
  dueDate: string
  paidDate: string | null
}

const SAMPLE_INVOICES: Invoice[] = [
  { id: '1', number: 'INV-1042', studio: 'Elite Academy', event: 'Summer Showcase 2026', amount: '$385.00', status: 'paid', dueDate: 'Jun 15, 2026', paidDate: 'May 25, 2026' },
  { id: '2', number: 'INV-1041', studio: 'Rhythm Studio', event: 'Summer Showcase 2026', amount: '$850.00', status: 'paid', dueDate: 'Jun 15, 2026', paidDate: 'May 20, 2026' },
  { id: '3', number: 'INV-1040', studio: 'Urban Edge', event: 'Summer Showcase 2026', amount: '$125.00', status: 'overdue', dueDate: 'May 15, 2026', paidDate: null },
  { id: '4', number: 'INV-1039', studio: 'Classical Motion', event: 'Summer Showcase 2026', amount: '$550.00', status: 'pending', dueDate: 'Jun 30, 2026', paidDate: null },
  { id: '5', number: 'INV-1038', studio: 'Graceful Arts', event: 'Summer Showcase 2026', amount: '$375.00', status: 'pending', dueDate: 'Jun 30, 2026', paidDate: null },
]

const STATUS_BADGE: Record<Invoice['status'], string> = {
  paid: 'badge-success',
  pending: 'badge-gold',
  overdue: 'badge-destructive',
  draft: 'bg-foreground-muted/15 text-foreground-muted text-xs font-semibold px-2 py-0.5',
}

export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="mt-1 text-sm text-foreground-muted">Track payments from studios</p>
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn-outline-gold px-4 py-2 text-xs">EXPORT</button>
          <button type="button" className="btn-gold px-5 py-2.5 text-xs">CREATE INVOICE</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Total Collected', value: '$1,235.00', color: 'text-green-500' },
          { label: 'Pending', value: '$925.00', color: 'text-gold' },
          { label: 'Overdue', value: '$125.00', color: 'text-destructive' },
          { label: 'Draft', value: '$0.00', color: 'text-foreground-muted' },
        ].map((s) => (
          <div key={s.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{s.label}</div>
            <div className={`mt-2 text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="surface-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Invoice</th>
              <th className="px-6 py-3 text-left">Studio</th>
              <th className="px-6 py-3 text-left">Event</th>
              <th className="px-6 py-3 text-right">Amount</th>
              <th className="px-6 py-3 text-left">Due Date</th>
              <th className="px-6 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_INVOICES.map((inv) => (
              <tr key={inv.id} className="table-row">
                <td className="px-6 py-4 font-mono text-sm text-gold">{inv.number}</td>
                <td className="px-6 py-4 text-sm text-foreground-secondary">{inv.studio}</td>
                <td className="px-6 py-4 text-sm text-foreground-muted">{inv.event}</td>
                <td className="px-6 py-4 text-right text-sm font-medium">{inv.amount}</td>
                <td className="px-6 py-4 text-sm text-foreground-muted">{inv.dueDate}</td>
                <td className="px-6 py-4"><span className={STATUS_BADGE[inv.status]}>{inv.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
