import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Billing',
  description: 'Manage your StageFlow subscription and billing.',
}

interface BillingProps {
  params: Promise<{ org: string }>
}

export default async function BillingPage({ params }: BillingProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description={`Manage the StageFlow subscription and payment methods for ${org}`}
      />

      {/* Current plan */}
      <div className="surface-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Current Plan</h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gold">Pro</span>
              <span className="text-foreground-muted">— $79/month</span>
            </div>
            <p className="mt-1 text-xs text-foreground-muted">Billed monthly. Next payment: Jun 15, 2026</p>
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn-outline-gold px-4 py-2 text-xs">CHANGE PLAN</button>
            <button type="button" className="text-xs text-foreground-muted hover:text-destructive">Cancel subscription</button>
          </div>
        </div>
      </div>

      {/* Plan usage */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Events', used: 3, limit: 10, pct: 30 },
          { label: 'Entries', used: 1283, limit: 5000, pct: 26 },
          { label: 'Studios', used: 42, limit: 100, pct: 42 },
          { label: 'Team Members', used: 5, limit: 10, pct: 50 },
        ].map((item) => (
          <div key={item.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{item.label}</div>
            <div className="mt-2 text-xl font-bold">
              <span className="text-gold">{item.used.toLocaleString()}</span>
              <span className="text-foreground-muted"> / {item.limit.toLocaleString()}</span>
            </div>
            <div className="mt-2 h-1.5 w-full bg-white/10">
              <div className="h-full bg-gold" style={{ width: `${item.pct}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payment method */}
        <div className="surface-card p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Payment Method</h3>
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-16 items-center justify-center bg-[#181818] text-xs font-bold text-white">VISA</div>
              <div>
                <div className="text-sm font-medium">Visa ending in 4242</div>
                <div className="text-xs text-foreground-muted">Expires 12/2027</div>
              </div>
            </div>
            <button type="button" className="text-xs text-gold hover:text-gold-hover">Update</button>
          </div>
        </div>

        {/* Billing address */}
        <div className="surface-card p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Billing Address</h3>
          <div className="mt-4 space-y-1 text-sm">
            <div>Summer Showcase LLC</div>
            <div className="text-foreground-muted">123 Dance Ave, Suite 400</div>
            <div className="text-foreground-muted">Chicago, IL 60601</div>
            <div className="text-foreground-muted">United States</div>
          </div>
          <button type="button" className="mt-3 text-xs text-gold hover:text-gold-hover">Edit address</button>
        </div>
      </div>

      {/* Invoice history */}
      <div className="surface-card overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Billing History</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-[#181818]">
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Date</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Description</th>
              <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-foreground-muted">Amount</th>
              <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-foreground-muted">Receipt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              { date: 'May 15, 2026', desc: 'Pro Plan — Monthly', amount: '$79.00' },
              { date: 'Apr 15, 2026', desc: 'Pro Plan — Monthly', amount: '$79.00' },
              { date: 'Mar 15, 2026', desc: 'Pro Plan — Monthly', amount: '$79.00' },
              { date: 'Feb 15, 2026', desc: 'Pro Plan — Monthly', amount: '$79.00' },
            ].map((inv) => (
              <tr key={inv.date} className="hover:bg-white/[0.02]">
                <td className="px-6 py-3 text-foreground-muted">{inv.date}</td>
                <td className="px-6 py-3">{inv.desc}</td>
                <td className="px-6 py-3 text-right font-medium">{inv.amount}</td>
                <td className="px-6 py-3 text-right">
                  <button type="button" className="text-xs text-gold hover:text-gold-hover">Download</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
