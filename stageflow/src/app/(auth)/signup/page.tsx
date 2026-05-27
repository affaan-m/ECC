import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Create Account',
  description: 'Create your StageFlow account as an organizer or studio.',
}

export default function SignupPage() {
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-2 text-sm text-foreground-muted">Get started with StageFlow in minutes</p>
      </div>

      <form className="space-y-4">
        {/* Account type selector */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground-secondary">I am a...</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="relative flex cursor-pointer items-center justify-center border border-border bg-surface p-4 text-sm font-medium transition-colors hover:border-gold/50 has-[:checked]:border-gold has-[:checked]:bg-gold-muted">
              <input type="radio" name="accountType" value="organization" defaultChecked className="sr-only" />
              <div className="text-center">
                <div className="text-lg">🏆</div>
                <div className="mt-1">Competition Organizer</div>
              </div>
            </label>
            <label className="relative flex cursor-pointer items-center justify-center border border-border bg-surface p-4 text-sm font-medium transition-colors hover:border-gold/50 has-[:checked]:border-gold has-[:checked]:bg-gold-muted">
              <input type="radio" name="accountType" value="studio" className="sr-only" />
              <div className="text-center">
                <div className="text-lg">💃</div>
                <div className="mt-1">Dance Studio</div>
              </div>
            </label>
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
              First name
            </label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              required
              placeholder="Jane"
              className="input-dark w-full"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
              Last name
            </label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              required
              placeholder="Smith"
              className="input-dark w-full"
            />
          </div>
        </div>

        <div>
          <label htmlFor="orgName" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
            Organization / Studio name
          </label>
          <input
            id="orgName"
            name="orgName"
            type="text"
            required
            placeholder="Starlight Dance Championships"
            className="input-dark w-full"
          />
        </div>

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
            placeholder="you@organization.com"
            className="input-dark w-full"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Min 8 characters"
            className="input-dark w-full"
          />
          <p className="mt-1 text-xs text-foreground-muted">Must be at least 8 characters with one number.</p>
        </div>

        <button type="submit" className="btn-gold w-full py-3 text-sm">
          CREATE ACCOUNT
        </button>

        <p className="text-center text-xs text-foreground-muted">
          By signing up, you agree to our{' '}
          <Link href="#" className="text-gold hover:text-gold-hover">Terms of Service</Link>
          {' '}and{' '}
          <Link href="#" className="text-gold hover:text-gold-hover">Privacy Policy</Link>.
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-foreground-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-gold hover:text-gold-hover">
          Sign in
        </Link>
      </p>
    </>
  )
}
