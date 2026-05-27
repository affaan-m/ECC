import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Embed Settings',
  description: 'Configure the embeddable registration widget for your website.',
}

interface EmbedPageProps {
  params: Promise<{ org: string }>
}

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { org } = await params

  const embedCode = `<iframe
  src="https://${org}.stageflow.app/embed/${org}"
  width="100%"
  height="800"
  frameborder="0"
  style="border: none;"
  allow="payment"
></iframe>`

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Embed Settings</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Add the StageFlow registration widget directly to your existing website
        </p>
      </div>

      {/* Embed code */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Embed Code</h2>
        <p className="mb-4 text-sm text-foreground-muted">
          Copy and paste this code into your website where you want the registration form to appear.
        </p>
        <div className="relative">
          <pre className="overflow-x-auto bg-surface-elevated p-4 font-mono text-sm text-foreground-secondary">
            {embedCode}
          </pre>
          <button type="button" className="absolute right-3 top-3 btn-outline-gold px-3 py-1 text-xs">
            COPY
          </button>
        </div>
      </div>

      {/* Settings */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Appearance</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="embed-theme" className="mb-1.5 block text-sm font-medium text-foreground-secondary">Theme</label>
              <select id="embed-theme" className="input-dark w-full">
                <option>Dark (Default)</option>
                <option>Light</option>
                <option>Auto (match user preference)</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground-secondary">Show header</div>
                <div className="text-xs text-foreground-muted">Display organization name and logo</div>
              </div>
              <div className="h-6 w-11 bg-gold" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground-secondary">Show footer</div>
                <div className="text-xs text-foreground-muted">Display &ldquo;Powered by StageFlow&rdquo;</div>
              </div>
              <div className="h-6 w-11 bg-surface-elevated" />
            </div>
          </div>
        </div>

        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Allowed Origins</h2>
          <p className="mb-4 text-sm text-foreground-muted">
            Only these domains can embed your registration widget.
          </p>
          <div className="space-y-2">
            {['https://www.starlight-dance.com', 'https://starlight-dance.com'].map((origin) => (
              <div key={origin} className="flex items-center justify-between bg-surface-elevated px-4 py-2">
                <code className="font-mono text-sm text-foreground-secondary">{origin}</code>
                <button type="button" className="text-xs text-destructive hover:text-destructive-hover">Remove</button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <input type="url" placeholder="https://example.com" className="input-dark flex-1" />
            <button type="button" className="btn-outline-gold px-4 py-2 text-xs">ADD</button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Preview</h2>
        <div className="border border-border bg-background p-8">
          <div className="mx-auto max-w-md text-center">
            <p className="text-foreground-muted">Embed preview will render here showing the registration widget as it appears on external sites.</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">SAVE SETTINGS</button>
      </div>
    </div>
  )
}
