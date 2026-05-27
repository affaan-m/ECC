import Link from 'next/link'

interface OrgLayoutProps {
  children: React.ReactNode
  params: Promise<{ org: string }>
}

const NAV_SECTIONS = [
  {
    label: 'Main',
    items: [
      { label: 'Dashboard', segment: 'dashboard', icon: '◆' },
      { label: 'Events', segment: 'events', icon: '◇' },
      { label: 'Studios', segment: 'studios', icon: '○' },
      { label: 'Entries', segment: 'entries', icon: '▪' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Invoices', segment: 'invoices', icon: '□' },
      { label: 'Refunds', segment: 'refunds', icon: '↩' },
      { label: 'Discounts', segment: 'discounts', icon: '%' },
    ],
  },
  {
    label: 'Communications',
    items: [
      { label: 'Inbox', segment: 'inbox', icon: '✉' },
      { label: 'Notifications', segment: 'notifications', icon: '🔔' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Documents', segment: 'documents', icon: '📄' },
      { label: 'Tags', segment: 'tags', icon: '#' },
      { label: 'Running Orders', segment: 'running-orders', icon: '▶' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Branding', segment: 'branding', icon: '🎨' },
      { label: 'Domains', segment: 'domains', icon: '🌐' },
      { label: 'Embed', segment: 'embed', icon: '⟨/⟩' },
      { label: 'Team', segment: 'team', icon: '👥' },
      { label: 'Billing', segment: 'billing', icon: '💳' },
      { label: 'Stripe Connect', segment: 'stripe', icon: '⚡' },
      { label: 'Settings', segment: 'settings', icon: '⚙' },
    ],
  },
] as const

export default async function OrgSpecificLayout({ children, params }: OrgLayoutProps) {
  const { org } = await params

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <div className="h-6 w-6 gold-gradient" />
          <span className="text-sm font-bold tracking-tight text-foreground">
            STAGE<span className="text-gold">FLOW</span>
          </span>
        </div>

        {/* Org selector */}
        <div className="border-b border-sidebar-border px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Organization</div>
          <div className="mt-1 text-sm font-medium text-gold">{org}</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-4">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-foreground-muted">
                {section.label}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.segment}>
                    <Link
                      href={`/o/${org}/${item.segment}`}
                      className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                      <span className="w-4 text-center text-xs text-foreground-muted">{item.icon}</span>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center bg-gold text-xs font-bold text-black">OA</div>
            <div>
              <div className="text-sm font-medium text-sidebar-foreground">Org Admin</div>
              <div className="text-xs text-foreground-muted">admin@{org}.com</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-background px-8">
          <div className="text-sm text-foreground-muted">{org}</div>
          <div className="flex items-center gap-4">
            <Link href={`/o/${org}/notifications`} className="text-sm text-foreground-muted hover:text-gold">
              Notifications
            </Link>
            <button type="button" className="text-sm text-foreground-muted hover:text-foreground">
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  )
}
