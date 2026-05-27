import Link from 'next/link'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Logo */}
      <Link href="/" className="mb-8 flex items-center gap-2">
        <div className="h-8 w-8 gold-gradient" />
        <span className="text-lg font-bold tracking-tight text-foreground">
          STAGE<span className="text-gold">FLOW</span>
        </span>
      </Link>

      {/* Auth card */}
      <div className="w-full max-w-md surface-card p-8">
        {children}
      </div>

      {/* Footer */}
      <p className="mt-8 text-xs text-foreground-muted">
        &copy; {new Date().getFullYear()} StageFlow. All rights reserved.
      </p>
    </div>
  )
}
