import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Stripe Connect',
  description: 'Manage your Stripe Connect integration for collecting payments.',
}

export default function StripePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Stripe Connect</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Connect your Stripe account to accept entry fee payments directly from studios
        </p>
      </div>

      {/* Connection status */}
      <div className="surface-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center bg-[#635BFF]/15 text-lg font-bold text-[#635BFF]">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Stripe Account Connected</span>
                <span className="badge-success">Active</span>
              </div>
              <div className="mt-1 font-mono text-xs text-foreground-muted">acct_1NqK4j2eZvKYlo2C</div>
            </div>
          </div>
          <button type="button" className="btn-outline-gold px-4 py-2 text-xs">
            OPEN STRIPE DASHBOARD
          </button>
        </div>
      </div>

      {/* Payout settings */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Payout Schedule</h2>
          <dl className="space-y-3 text-sm">
            {[
              { dt: 'Frequency', dd: 'Daily (automatic)' },
              { dt: 'Minimum payout', dd: '$1.00' },
              { dt: 'Bank account', dd: '****4321 (Chase)' },
              { dt: 'Currency', dd: 'USD' },
            ].map((item) => (
              <div key={item.dt} className="flex justify-between">
                <dt className="text-foreground-muted">{item.dt}</dt>
                <dd className="text-foreground-secondary">{item.dd}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Fee Configuration</h2>
          <dl className="space-y-3 text-sm">
            {[
              { dt: 'Platform fee', dd: '2.5% of transaction' },
              { dt: 'Stripe processing', dd: '2.9% + $0.30' },
              { dt: 'Fee payer', dd: 'Studio (pass-through)' },
              { dt: 'Refund policy', dd: 'Full refund minus Stripe fees' },
            ].map((item) => (
              <div key={item.dt} className="flex justify-between">
                <dt className="text-foreground-muted">{item.dt}</dt>
                <dd className="text-foreground-secondary">{item.dd}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="surface-card overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Recent Transactions</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Date</th>
              <th className="px-6 py-3 text-left">Studio</th>
              <th className="px-6 py-3 text-left">Description</th>
              <th className="px-6 py-3 text-right">Gross</th>
              <th className="px-6 py-3 text-right">Fee</th>
              <th className="px-6 py-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {[
              { date: 'May 27', studio: 'Elite Academy', desc: 'INV-1042', gross: '$385.00', fee: '$11.47', net: '$373.53' },
              { date: 'May 25', studio: 'Rhythm Studio', desc: 'INV-1041', gross: '$850.00', fee: '$24.95', net: '$825.05' },
              { date: 'May 22', studio: 'Graceful Arts', desc: 'INV-1038', gross: '$375.00', fee: '$11.18', net: '$363.82' },
            ].map((tx, i) => (
              <tr key={i} className="table-row">
                <td className="px-6 py-3 text-sm text-foreground-muted">{tx.date}</td>
                <td className="px-6 py-3 text-sm text-foreground-secondary">{tx.studio}</td>
                <td className="px-6 py-3 font-mono text-sm text-foreground-muted">{tx.desc}</td>
                <td className="px-6 py-3 text-right text-sm">{tx.gross}</td>
                <td className="px-6 py-3 text-right text-sm text-foreground-muted">{tx.fee}</td>
                <td className="px-6 py-3 text-right text-sm font-medium text-gold">{tx.net}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
