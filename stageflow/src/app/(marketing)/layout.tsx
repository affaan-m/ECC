import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: {
    default: 'StageFlow',
    template: '%s | StageFlow',
  },
}

function MarketingNav() {
  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 gold-gradient" />
          <span className="text-lg font-bold tracking-tight text-foreground">
            STAGE<span className="text-gold">FLOW</span>
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <Link href="/pricing" className="text-sm text-foreground-muted transition-colors hover:text-foreground">
            Pricing
          </Link>
          <Link href="#features" className="text-sm text-foreground-muted transition-colors hover:text-foreground">
            Features
          </Link>
          <Link href="#testimonials" className="text-sm text-foreground-muted transition-colors hover:text-foreground">
            Testimonials
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-foreground-secondary transition-colors hover:text-gold"
          >
            Sign in
          </Link>
          <Link href="/signup" className="btn-gold px-5 py-2 text-sm">
            GET STARTED
          </Link>
        </div>
      </div>
    </nav>
  )
}

function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <span className="text-lg font-bold tracking-tight">
              STAGE<span className="text-gold">FLOW</span>
            </span>
            <p className="mt-3 text-sm text-foreground-muted">
              The competition management platform built for dance.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Product</h4>
            <ul className="mt-4 space-y-2">
              <li><Link href="/pricing" className="text-sm text-foreground-secondary hover:text-gold">Pricing</Link></li>
              <li><Link href="#features" className="text-sm text-foreground-secondary hover:text-gold">Features</Link></li>
              <li><Link href="#" className="text-sm text-foreground-secondary hover:text-gold">Changelog</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Company</h4>
            <ul className="mt-4 space-y-2">
              <li><Link href="#" className="text-sm text-foreground-secondary hover:text-gold">About</Link></li>
              <li><Link href="#" className="text-sm text-foreground-secondary hover:text-gold">Blog</Link></li>
              <li><Link href="#" className="text-sm text-foreground-secondary hover:text-gold">Contact</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Legal</h4>
            <ul className="mt-4 space-y-2">
              <li><Link href="#" className="text-sm text-foreground-secondary hover:text-gold">Privacy</Link></li>
              <li><Link href="#" className="text-sm text-foreground-secondary hover:text-gold">Terms</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t border-border pt-8 text-center text-sm text-foreground-muted">
          &copy; {new Date().getFullYear()} StageFlow. All rights reserved.
        </div>
      </div>
    </footer>
  )
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      <main className="flex-1 pt-16">{children}</main>
      <MarketingFooter />
    </div>
  )
}
