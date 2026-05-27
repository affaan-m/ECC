import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Verify Email',
  description: 'Check your inbox to verify your email address.',
}

export default function VerifyEmailPage() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center bg-gold-muted">
        <svg className="h-8 w-8 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="square" strokeLinejoin="miter" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold">Check your email</h1>
      <p className="mt-3 text-sm text-foreground-muted">
        We&apos;ve sent a verification link to your email address. Click the link to activate your account.
      </p>

      <div className="mt-8 surface-elevated p-4">
        <p className="text-sm text-foreground-secondary">
          Didn&apos;t receive the email? Check your spam folder or click below to resend.
        </p>
      </div>

      <form className="mt-6">
        <button type="submit" className="btn-outline-gold w-full py-3 text-sm">
          RESEND VERIFICATION EMAIL
        </button>
      </form>

      <p className="mt-6 text-sm text-foreground-muted">
        Wrong email?{' '}
        <Link href="/signup" className="font-medium text-gold hover:text-gold-hover">
          Sign up again
        </Link>
      </p>
    </div>
  )
}
