'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Trophy, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountType, setAccountType] = useState<'organization' | 'studio'>('organization')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            org_name: orgName,
            account_type: accountType,
          },
        },
      })

      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }

      router.push('/verify-email')
    } catch {
      setError('An unexpected error occurred. Please try again.')
      setLoading(false)
    }
  }

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-2 text-sm text-foreground-muted">Get started with StageFlow in minutes</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <form className="space-y-4" onSubmit={onSubmit}>
        {/* Account type selector */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground-secondary">I am a...</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="relative flex cursor-pointer items-center justify-center border border-border bg-surface p-4 text-sm font-medium transition-colors hover:border-gold/50 has-[:checked]:border-gold has-[:checked]:bg-gold-muted">
              <input
                type="radio"
                name="accountType"
                value="organization"
                checked={accountType === 'organization'}
                onChange={() => setAccountType('organization')}
                className="sr-only"
              />
              <div className="text-center">
                <div className="flex justify-center text-lg">
                  <Trophy className="h-5 w-5" />
                </div>
                <div className="mt-1">Competition Organizer</div>
              </div>
            </label>
            <label className="relative flex cursor-pointer items-center justify-center border border-border bg-surface p-4 text-sm font-medium transition-colors hover:border-gold/50 has-[:checked]:border-gold has-[:checked]:bg-gold-muted">
              <input
                type="radio"
                name="accountType"
                value="studio"
                checked={accountType === 'studio'}
                onChange={() => setAccountType('studio')}
                className="sr-only"
              />
              <div className="text-center">
                <div className="flex justify-center text-lg">
                  <Users className="h-5 w-5" />
                </div>
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
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
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
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
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
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
            minLength={8}
            placeholder="Min 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-dark w-full"
          />
          <p className="mt-1 text-xs text-foreground-muted">Must be at least 8 characters with one number.</p>
        </div>

        <button type="submit" disabled={loading} className="btn-gold w-full py-3 text-sm disabled:opacity-50">
          {loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
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
