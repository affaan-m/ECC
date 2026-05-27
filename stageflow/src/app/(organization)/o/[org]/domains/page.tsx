import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Custom Domains',
  description: 'Configure custom domains for your competition portal.',
}

interface Domain {
  id: string
  domain: string
  status: 'verified' | 'pending_verification' | 'failed'
  sslStatus: 'active' | 'provisioning' | 'none'
  addedAt: string
}

const SAMPLE_DOMAINS: Domain[] = [
  { id: '1', domain: 'register.starlight-dance.com', status: 'verified', sslStatus: 'active', addedAt: 'Jan 10, 2025' },
  { id: '2', domain: 'entries.starlight-dance.com', status: 'pending_verification', sslStatus: 'provisioning', addedAt: 'May 25, 2026' },
]

export default function DomainsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Custom Domains</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Point your own domain to your StageFlow competition portal
          </p>
        </div>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">ADD DOMAIN</button>
      </div>

      {/* Default domain */}
      <div className="surface-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Default Domain</div>
            <div className="mt-1 font-mono text-sm text-gold">starlight.stageflow.app</div>
          </div>
          <span className="badge-success">Active</span>
        </div>
      </div>

      {/* Custom domains */}
      <div className="space-y-4">
        {SAMPLE_DOMAINS.map((domain) => (
          <div key={domain.id} className="surface-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-sm font-medium">{domain.domain}</div>
                <div className="mt-1 text-xs text-foreground-muted">Added {domain.addedAt}</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className={domain.status === 'verified' ? 'badge-success' : domain.status === 'pending_verification' ? 'badge-gold' : 'badge-destructive'}>
                    {domain.status === 'verified' ? 'Verified' : domain.status === 'pending_verification' ? 'Pending' : 'Failed'}
                  </span>
                  <div className="mt-1 text-xs text-foreground-muted">SSL: {domain.sslStatus}</div>
                </div>
                <button type="button" className="text-xs text-destructive hover:text-destructive-hover">Remove</button>
              </div>
            </div>

            {domain.status === 'pending_verification' && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">DNS Configuration Required</div>
                <div className="mt-2 space-y-2 bg-surface-elevated p-4 font-mono text-xs">
                  <div className="flex gap-4">
                    <span className="text-foreground-muted">Type:</span>
                    <span className="text-foreground-secondary">CNAME</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-foreground-muted">Name:</span>
                    <span className="text-foreground-secondary">entries</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-foreground-muted">Value:</span>
                    <span className="text-gold">cname.stageflow.app</span>
                  </div>
                </div>
                <button type="button" className="mt-3 btn-outline-gold px-4 py-2 text-xs">VERIFY NOW</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
