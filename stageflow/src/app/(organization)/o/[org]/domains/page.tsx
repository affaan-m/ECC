import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Custom Domains',
  description: 'Configure custom domains for your competition portal.',
}

interface DomainsProps {
  params: Promise<{ org: string }>
}

const DOMAINS = [
  { domain: 'compete.summershowcase.com', status: 'active' as const, ssl: true, primary: true, addedAt: 'Jan 15, 2026' },
  { domain: 'register.summershowcase.com', status: 'pending_dns' as const, ssl: false, primary: false, addedAt: 'May 20, 2026' },
]

const STATUS_STYLES = {
  active: 'badge-success',
  pending_dns: 'badge-gold',
  error: 'badge-destructive',
}

export default async function DomainsPage({ params }: DomainsProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom Domains"
        description="Point your own domain to your StageFlow competition portal"
        actions={
          <button type="button" className="btn-gold px-5 py-2.5 text-xs">ADD DOMAIN</button>
        }
      />

      {/* Default domain */}
      <div className="surface-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Default Domain</h3>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 bg-green-500" />
            <code className="text-sm text-gold">{org}.stageflow.app</code>
          </div>
          <span className="text-xs text-foreground-muted">Always active</span>
        </div>
      </div>

      {/* Custom domains */}
      <div className="space-y-4">
        {DOMAINS.map((d) => (
          <div key={d.domain} className="surface-card p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`h-2 w-2 ${d.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-medium text-white">{d.domain}</code>
                    {d.primary && <span className="bg-gold/15 px-2 py-0.5 text-xs text-gold">Primary</span>}
                  </div>
                  <div className="mt-1 text-xs text-foreground-muted">Added {d.addedAt}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right text-xs">
                  <div className={d.ssl ? 'text-green-400' : 'text-foreground-muted'}>
                    SSL: {d.ssl ? 'Active' : 'Pending'}
                  </div>
                </div>
                <span className={`${STATUS_STYLES[d.status]} text-xs font-semibold px-2 py-0.5`}>
                  {d.status === 'active' ? 'Active' : 'Pending DNS'}
                </span>
                <button type="button" className="text-xs text-foreground-muted hover:text-destructive">Remove</button>
              </div>
            </div>

            {d.status === 'pending_dns' && (
              <div className="mt-4 border-t border-border pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">DNS Configuration Required</h4>
                <div className="mt-3 bg-[#181818] p-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-foreground-muted">
                        <th className="pb-2 text-left">Type</th>
                        <th className="pb-2 text-left">Name</th>
                        <th className="pb-2 text-left">Value</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-white">
                      <tr>
                        <td className="py-1">CNAME</td>
                        <td className="py-1">register</td>
                        <td className="py-1 text-gold">cname.stageflow.app</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <button type="button" className="mt-3 text-xs text-gold hover:text-gold-hover">Verify DNS</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
