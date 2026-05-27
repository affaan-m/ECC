import type { Metadata } from 'next'
import { Check, Circle, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Stripe Connect',
  description: 'Manage your Stripe Connect integration for payment processing.',
}

interface StripeProps {
  params: Promise<{ org: string }>
}

export default async function StripePage({ params }: StripeProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stripe Connect"
        description={`Accept payments from studios through Stripe for ${org}`}
      />

      {/* Connection status */}
      <div className="surface-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center bg-[#635BFF]/15 text-lg font-bold text-[#635BFF]">S</div>
            <div>
              <h3 className="text-base font-semibold">Stripe Account Connected</h3>
              <p className="text-xs text-foreground-muted">acct_1234567890 — Summer Showcase LLC</p>
            </div>
          </div>
          <span className="badge-success text-xs font-semibold px-2 py-0.5">Active</span>
        </div>
      </div>

      {/* Onboarding checklist */}
      <div className="surface-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Onboarding Status</h3>
        <div className="mt-4 space-y-3">
          {[
            { step: 'Business details', complete: true },
            { step: 'Bank account connected', complete: true },
            { step: 'Identity verification', complete: true },
            { step: 'Tax information (W-9)', complete: true },
            { step: 'Payouts enabled', complete: true },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-3">
              <div className={`flex h-6 w-6 items-center justify-center text-xs ${
                item.complete ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-foreground-muted'
              }`}>
                {item.complete ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              </div>
              <span className={`text-sm ${item.complete ? 'text-white' : 'text-foreground-muted'}`}>
                {item.step}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Payout summary */}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Total Collected', value: '$18,430', sub: 'all time' },
          { label: 'Available Balance', value: '$2,340', sub: 'ready for payout' },
          { label: 'Next Payout', value: '$1,850', sub: 'Jun 1, 2026' },
        ].map((stat) => (
          <div key={stat.label} className="kpi-card">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{stat.label}</div>
            <div className="mt-2 text-2xl font-bold text-gold">{stat.value}</div>
            <div className="mt-1 text-xs text-foreground-muted">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Recent payouts */}
      <div className="surface-card overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Recent Payouts</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-[#181818]">
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Date</th>
              <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-foreground-muted">Amount</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Status</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Bank Account</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              { date: 'May 24, 2026', amount: '$2,150', status: 'paid', bank: 'Chase ****6789' },
              { date: 'May 17, 2026', amount: '$1,890', status: 'paid', bank: 'Chase ****6789' },
              { date: 'May 10, 2026', amount: '$3,210', status: 'paid', bank: 'Chase ****6789' },
            ].map((payout) => (
              <tr key={payout.date} className="hover:bg-white/[0.02]">
                <td className="px-6 py-3 text-foreground-muted">{payout.date}</td>
                <td className="px-6 py-3 text-right font-medium text-gold">{payout.amount}</td>
                <td className="px-6 py-3"><span className="badge-success text-xs font-semibold px-2 py-0.5">Paid</span></td>
                <td className="px-6 py-3 text-foreground-muted font-mono text-xs">{payout.bank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <a
          href="https://dashboard.stripe.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gold hover:text-gold-hover"
        >
          Open Stripe Dashboard <ExternalLink className="ml-1 inline h-3 w-3" />
        </a>
      </div>
    </div>
  )
}
