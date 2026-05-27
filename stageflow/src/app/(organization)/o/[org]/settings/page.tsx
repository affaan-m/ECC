import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Organization settings and configuration.',
}

interface SettingsProps {
  params: Promise<{ org: string }>
}

export default async function SettingsPage({ params }: SettingsProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage organization settings and preferences"
        actions={
          <button type="button" className="btn-gold px-5 py-2.5 text-xs">SAVE CHANGES</button>
        }
      />

      {/* Organization info */}
      <div className="surface-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Organization Details</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="org-name" className="mb-1.5 block text-sm font-medium">Organization Name</label>
            <input id="org-name" type="text" defaultValue="Summer Showcase Productions" className="w-full h-10 bg-[#202020] border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-gold" />
          </div>
          <div>
            <label htmlFor="org-slug" className="mb-1.5 block text-sm font-medium">URL Slug</label>
            <div className="flex items-center">
              <span className="h-10 flex items-center bg-[#181818] border border-r-0 border-white/10 px-3 text-sm text-foreground-muted">stageflow.app/</span>
              <input id="org-slug" type="text" defaultValue={org} className="flex-1 h-10 bg-[#202020] border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-gold" />
            </div>
          </div>
          <div>
            <label htmlFor="org-email" className="mb-1.5 block text-sm font-medium">Contact Email</label>
            <input id="org-email" type="email" defaultValue="info@summershowcase.com" className="w-full h-10 bg-[#202020] border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-gold" />
          </div>
          <div>
            <label htmlFor="org-phone" className="mb-1.5 block text-sm font-medium">Phone Number</label>
            <input id="org-phone" type="tel" defaultValue="(555) 123-4567" className="w-full h-10 bg-[#202020] border border-white/10 px-3 text-sm text-white focus:outline-none focus:border-gold" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="org-desc" className="mb-1.5 block text-sm font-medium">Description</label>
            <textarea id="org-desc" rows={3} defaultValue="Premier dance competition organization based in Chicago, hosting regional and national events since 2018." className="w-full bg-[#202020] border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold" />
          </div>
        </div>
      </div>

      {/* Entry settings */}
      <div className="surface-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Entry Settings</h3>
        <div className="mt-4 space-y-4">
          {[
            { label: 'Auto-approve entries', desc: 'Automatically confirm new entries without manual review', checked: false },
            { label: 'Require music upload', desc: 'Studios must upload music before entry is confirmed', checked: true },
            { label: 'Allow late entries', desc: 'Accept entries after the deadline with a late fee', checked: true },
            { label: 'Require proof of age', desc: 'Dancers must submit age verification documents', checked: true },
          ].map((setting) => (
            <div key={setting.label} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium">{setting.label}</div>
                <div className="text-xs text-foreground-muted">{setting.desc}</div>
              </div>
              <div className={`h-6 w-11 rounded-full relative cursor-pointer ${setting.checked ? 'bg-gold' : 'bg-white/20'}`}>
                <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-transform ${setting.checked ? 'right-0.5' : 'left-0.5'}`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notification preferences */}
      <div className="surface-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Email Notifications</h3>
        <div className="mt-4 space-y-4">
          {[
            { label: 'New entry submitted', checked: true },
            { label: 'Invoice paid', checked: true },
            { label: 'Refund requested', checked: true },
            { label: 'New studio registered', checked: true },
            { label: 'Document uploaded', checked: false },
            { label: 'New inbox message', checked: true },
          ].map((notif) => (
            <div key={notif.label} className="flex items-center justify-between py-1">
              <span className="text-sm">{notif.label}</span>
              <div className={`h-6 w-11 rounded-full relative cursor-pointer ${notif.checked ? 'bg-gold' : 'bg-white/20'}`}>
                <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-transform ${notif.checked ? 'right-0.5' : 'left-0.5'}`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className="surface-card border-destructive/30 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-destructive">Danger Zone</h3>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Delete Organization</div>
            <div className="text-xs text-foreground-muted">Permanently delete this organization and all its data. This action cannot be undone.</div>
          </div>
          <button type="button" className="border border-destructive px-4 py-2 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10">
            DELETE
          </button>
        </div>
      </div>
    </div>
  )
}
