import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to your StageFlow account.',
}

export default function LoginPage() {
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-2 text-sm text-foreground-muted">Sign in to your account to continue</p>
      </div>

      <form className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@studio.com"
            className="input-dark w-full"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-foreground-secondary">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-gold hover:text-gold-hover">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            className="input-dark w-full"
          />
        </div>

        <button type="submit" className="btn-gold w-full py-3 text-sm">
          SIGN IN
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-foreground-muted">OR</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Magic link */}
      <form className="space-y-4">
        <div>
          <label htmlFor="magic-email" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
            Magic link
          </label>
          <input
            id="magic-email"
            name="email"
            type="email"
            placeholder="you@studio.com"
            className="input-dark w-full"
          />
        </div>
        <button type="submit" className="btn-outline-gold w-full py-3 text-sm">
          SEND MAGIC LINK
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-foreground-muted">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-medium text-gold hover:text-gold-hover">
          Sign up
        </Link>
      </p>
    </>
  )
}
