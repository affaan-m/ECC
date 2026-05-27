import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Organization settings and configuration.',
}

interface SettingsPageProps {
  params: Promise<{ org: string }>
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { org } = await params

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-foreground-muted">Organization configuration and preferences</p>
      </div>

      {/* General */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">General</h2>
        <form className="space-y-4">
          <div>
            <label htmlFor="org-name" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
              Organization Name
            </label>
            <input id="org-name" type="text" defaultValue="Starlight Dance Championships" className="input-dark w-full max-w-md" />
          </div>
          <div>
            <label htmlFor="org-slug" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
              URL Slug
            </label>
            <div className="flex items-center gap-0">
              <span className="bg-surface-elevated border border-r-0 border-border px-3 py-2.5 text-sm text-foreground-muted">stageflow.app/o/</span>
              <input id="org-slug" type="text" defaultValue={org} className="input-dark w-48" />
            </div>
          </div>
          <div>
            <label htmlFor="org-email" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
              Contact Email
            </label>
            <input id="org-email" type="email" defaultValue="info@starlight-dance.com" className="input-dark w-full max-w-md" />
          </div>
          <div>
            <label htmlFor="org-timezone" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
              Timezone
            </label>
            <select id="org-timezone" className="input-dark w-full max-w-md">
              <option>America/Chicago (Central)</option>
              <option>America/New_York (Eastern)</option>
              <option>America/Los_Angeles (Pacific)</option>
              <option>America/Denver (Mountain)</option>
            </select>
          </div>
          <button type="submit" className="btn-gold px-5 py-2.5 text-xs">SAVE CHANGES</button>
        </form>
      </div>

      {/* Entry settings */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Entry Defaults</h2>
        <form className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground-secondary">Auto-approve entries</div>
              <div className="text-xs text-foreground-muted">Automatically approve entries when submitted</div>
            </div>
            <div className="h-6 w-11 bg-surface-elevated" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground-secondary">Require music upload</div>
              <div className="text-xs text-foreground-muted">Music must be uploaded before entry can be approved</div>
            </div>
            <div className="h-6 w-11 bg-gold" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground-secondary">Allow late entries</div>
              <div className="text-xs text-foreground-muted">Accept entries after the deadline with a late fee</div>
            </div>
            <div className="h-6 w-11 bg-gold" />
          </div>
          <div>
            <label htmlFor="late-fee" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
              Late Entry Fee
            </label>
            <input id="late-fee" type="text" defaultValue="$5.00" className="input-dark w-32" />
          </div>
          <button type="submit" className="btn-gold px-5 py-2.5 text-xs">SAVE CHANGES</button>
        </form>
      </div>

      {/* Danger zone */}
      <div className="border border-destructive/30 bg-destructive/5 p-6">
        <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground-secondary">Transfer ownership</div>
              <div className="text-xs text-foreground-muted">Transfer this organization to another admin</div>
            </div>
            <button type="button" className="border border-destructive px-4 py-2 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10">
              TRANSFER
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground-secondary">Delete organization</div>
              <div className="text-xs text-foreground-muted">Permanently delete this organization and all its data</div>
            </div>
            <button type="button" className="border border-destructive px-4 py-2 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10">
              DELETE
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
