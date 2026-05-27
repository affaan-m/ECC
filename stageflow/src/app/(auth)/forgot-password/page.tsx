import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Reset Password',
  description: 'Request a password reset link for your StageFlow account.',
}

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Enter the email address associated with your account and we&apos;ll send you a reset link.
        </p>
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

        <button type="submit" className="btn-gold w-full py-3 text-sm">
          SEND RESET LINK
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-foreground-muted">
        Remember your password?{' '}
        <Link href="/login" className="font-medium text-gold hover:text-gold-hover">
          Sign in
        </Link>
      </p>
    </>
  )
}
