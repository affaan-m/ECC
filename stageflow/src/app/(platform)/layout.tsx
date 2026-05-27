import Link from 'next/link'

const PLATFORM_NAV = [
  { label: 'Dashboard', href: '/admin', icon: '◆' },
  { label: 'Organizations', href: '/admin/organizations', icon: '◇' },
  { label: 'Users', href: '/admin/users', icon: '○' },
  { label: 'Plans', href: '/admin/plans', icon: '□' },
  { label: 'Audit Logs', href: '/admin/audit-logs', icon: '▣' },
  { label: 'System Health', href: '/admin/system-health', icon: '▲' },
] as const

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <div className="h-6 w-6 gold-gradient" />
          <span className="text-sm font-bold tracking-tight text-foreground">
            STAGE<span className="text-gold">FLOW</span>
          </span>
          <span className="ml-2 badge-gold text-[10px]">ADMIN</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {PLATFORM_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <span className="text-xs text-foreground-muted">{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center bg-gold text-xs font-bold text-black">
              SA
            </div>
            <div>
              <div className="text-sm font-medium text-sidebar-foreground">Super Admin</div>
              <div className="text-xs text-foreground-muted">admin@stageflow.app</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-background px-8">
          <div className="text-sm text-foreground-muted">Platform Administration</div>
          <div className="flex items-center gap-4">
            <button type="button" className="text-sm text-foreground-muted hover:text-foreground">
              Notifications
            </button>
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
