import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Billing',
  description: 'Manage your StageFlow subscription and billing.',
}

export default function BillingPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="mt-1 text-sm text-foreground-muted">Manage your StageFlow subscription</p>
      </div>

      {/* Current plan */}
      <div className="surface-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Current Plan</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gold">Professional</span>
              <span className="text-foreground-muted">$149/month</span>
            </div>
            <p className="mt-2 text-sm text-foreground-muted">
              Unlimited events, unlimited entries, custom branding, custom domain, priority support.
            </p>
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn-outline-gold px-4 py-2 text-xs">CHANGE PLAN</button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="bg-surface-elevated p-4">
            <div className="text-xs text-foreground-muted">Next payment</div>
            <div className="mt-1 text-sm font-medium">Jun 1, 2026</div>
          </div>
          <div className="bg-surface-elevated p-4">
            <div className="text-xs text-foreground-muted">Billing period</div>
            <div className="mt-1 text-sm font-medium">Monthly</div>
          </div>
          <div className="bg-surface-elevated p-4">
            <div className="text-xs text-foreground-muted">Member since</div>
            <div className="mt-1 text-sm font-medium">March 15, 2024</div>
          </div>
        </div>
      </div>

      {/* Payment method */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Payment Method</h2>
        <div className="flex items-center justify-between bg-surface-elevated p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-14 items-center justify-center border border-border bg-background text-xs font-bold text-gold">
              VISA
            </div>
            <div>
              <div className="text-sm font-medium">Visa ending in 4242</div>
              <div className="text-xs text-foreground-muted">Expires 12/2027</div>
            </div>
          </div>
          <button type="button" className="text-xs text-gold hover:text-gold-hover">Update</button>
        </div>
      </div>

      {/* Invoice history */}
      <div className="surface-card overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Invoice History</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Date</th>
              <th className="px-6 py-3 text-left">Description</th>
              <th className="px-6 py-3 text-right">Amount</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {[
              { date: 'May 1, 2026', desc: 'Professional Plan — Monthly', amount: '$149.00', status: 'Paid' },
              { date: 'Apr 1, 2026', desc: 'Professional Plan — Monthly', amount: '$149.00', status: 'Paid' },
              { date: 'Mar 1, 2026', desc: 'Professional Plan — Monthly', amount: '$149.00', status: 'Paid' },
              { date: 'Feb 1, 2026', desc: 'Professional Plan — Monthly', amount: '$149.00', status: 'Paid' },
            ].map((inv, i) => (
              <tr key={i} className="table-row">
                <td className="px-6 py-3 text-sm text-foreground-secondary">{inv.date}</td>
                <td className="px-6 py-3 text-sm text-foreground-secondary">{inv.desc}</td>
                <td className="px-6 py-3 text-right text-sm font-medium text-gold">{inv.amount}</td>
                <td className="px-6 py-3"><span className="badge-success">{inv.status}</span></td>
                <td className="px-6 py-3 text-right">
                  <button type="button" className="text-xs text-gold hover:text-gold-hover">Download</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Danger zone */}
      <div className="border border-destructive/30 bg-destructive/5 p-6">
        <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          Cancelling your subscription will disable all features at the end of your current billing period.
        </p>
        <button type="button" className="mt-4 border border-destructive px-4 py-2 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10">
          CANCEL SUBSCRIPTION
        </button>
      </div>
    </div>
  )
}
