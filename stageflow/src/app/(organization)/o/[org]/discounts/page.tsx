import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Discount Codes',
  description: 'Create and manage discount codes for entry fees.',
}

interface DiscountCode {
  id: string
  code: string
  type: 'percentage' | 'fixed'
  value: string
  usageCount: number
  maxUses: number | null
  validUntil: string | null
  status: 'active' | 'expired' | 'disabled'
}

const SAMPLE_CODES: DiscountCode[] = [
  { id: '1', code: 'EARLYBIRD2026', type: 'percentage', value: '15%', usageCount: 34, maxUses: null, validUntil: 'Jun 1, 2026', status: 'active' },
  { id: '2', code: 'LOYALTY10', type: 'percentage', value: '10%', usageCount: 12, maxUses: 50, validUntil: null, status: 'active' },
  { id: '3', code: 'FREEENTRY', type: 'fixed', value: '$25.00', usageCount: 3, maxUses: 5, validUntil: null, status: 'active' },
  { id: '4', code: 'SPRING2026', type: 'percentage', value: '20%', usageCount: 48, maxUses: 50, validUntil: 'Mar 1, 2026', status: 'expired' },
]

export default function DiscountsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Discount Codes</h1>
          <p className="mt-1 text-sm text-foreground-muted">Manage promotional and loyalty discount codes</p>
        </div>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">CREATE CODE</button>
      </div>

      <div className="surface-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Code</th>
              <th className="px-6 py-3 text-left">Type</th>
              <th className="px-6 py-3 text-left">Value</th>
              <th className="px-6 py-3 text-right">Usage</th>
              <th className="px-6 py-3 text-left">Expires</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CODES.map((code) => (
              <tr key={code.id} className="table-row">
                <td className="px-6 py-4">
                  <code className="bg-surface-elevated px-2 py-1 font-mono text-sm text-gold">{code.code}</code>
                </td>
                <td className="px-6 py-4 text-sm capitalize text-foreground-secondary">{code.type}</td>
                <td className="px-6 py-4 text-sm font-medium">{code.value}</td>
                <td className="px-6 py-4 text-right text-sm text-foreground-secondary">
                  {code.usageCount}{code.maxUses ? ` / ${code.maxUses}` : ''}
                </td>
                <td className="px-6 py-4 text-sm text-foreground-muted">{code.validUntil ?? 'No expiry'}</td>
                <td className="px-6 py-4">
                  <span className={code.status === 'active' ? 'badge-success' : code.status === 'expired' ? 'badge-gold' : 'badge-destructive'}>
                    {code.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button type="button" className="text-xs text-gold hover:text-gold-hover">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
