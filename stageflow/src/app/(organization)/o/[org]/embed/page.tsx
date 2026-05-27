import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Embed Widget',
  description: 'Configure and generate embed snippets for your website.',
}

interface EmbedProps {
  params: Promise<{ org: string }>
}

export default async function EmbedPage({ params }: EmbedProps) {
  const { org } = await params

  const embedCode = `<script src="https://cdn.stageflow.app/embed.js" data-org="${org}" data-theme="dark"></script>
<div id="stageflow-widget"></div>`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Embed Widget"
        description="Add a registration widget to your existing website"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Settings */}
        <div className="space-y-6">
          <div className="surface-card p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Widget Settings</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="embed-event" className="mb-1.5 block text-sm font-medium">Event</label>
                <select id="embed-event" className="w-full h-10 bg-[#202020] border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-gold">
                  <option>Summer Showcase 2026</option>
                  <option>Fall Championship 2026</option>
                  <option>All Events</option>
                </select>
              </div>
              <div>
                <label htmlFor="embed-theme" className="mb-1.5 block text-sm font-medium">Theme</label>
                <select id="embed-theme" className="w-full h-10 bg-[#202020] border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-gold">
                  <option>Dark (match your branding)</option>
                  <option>Light</option>
                  <option>Auto (system preference)</option>
                </select>
              </div>
              <div>
                <label htmlFor="embed-width" className="mb-1.5 block text-sm font-medium">Max Width</label>
                <input id="embed-width" type="text" defaultValue="100%" className="w-full h-10 bg-[#202020] border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-gold" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Show event selector</div>
                  <div className="text-xs text-foreground-muted">Let visitors switch between events</div>
                </div>
                <div className="h-6 w-11 bg-gold rounded-full relative cursor-pointer">
                  <div className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-black" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Show pricing</div>
                  <div className="text-xs text-foreground-muted">Display entry fees in the widget</div>
                </div>
                <div className="h-6 w-11 bg-gold rounded-full relative cursor-pointer">
                  <div className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-black" />
                </div>
              </div>
            </div>
          </div>

          {/* Code snippet */}
          <div className="surface-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Embed Code</h3>
              <button type="button" className="text-xs text-gold hover:text-gold-hover">Copy to clipboard</button>
            </div>
            <pre className="bg-[#181818] p-4 text-xs text-green-400 overflow-x-auto">
              <code>{embedCode}</code>
            </pre>
          </div>
        </div>

        {/* Preview */}
        <div className="surface-card p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Live Preview</h3>
          <div className="border border-border bg-background p-6">
            <div className="mx-auto max-w-sm space-y-4">
              <div className="text-center">
                <div className="mx-auto mb-3 h-10 w-10 bg-gold-muted" />
                <h4 className="text-lg font-bold">Summer Showcase 2026</h4>
                <p className="text-xs text-foreground-muted">Jul 12-14, 2026 — Chicago, IL</p>
              </div>
              <div className="space-y-2">
                {['Solo — $25/entry', 'Duo/Trio — $20/dancer', 'Group — $15/dancer'].map((item) => (
                  <div key={item} className="flex justify-between border-b border-border py-2 text-xs">
                    <span>{item.split(' — ')[0]}</span>
                    <span className="text-gold">{item.split(' — ')[1]}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-gold w-full py-2.5 text-xs">REGISTER YOUR STUDIO</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
