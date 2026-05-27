import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Organizations',
  description: 'Manage all organizations on the StageFlow platform.',
}

interface Organization {
  id: string
  name: string
  slug: string
  plan: 'starter' | 'professional' | 'enterprise'
  status: 'active' | 'trial' | 'past_due' | 'churned'
  studios: number
  entries: number
  mrr: string
  createdAt: string
}

const SAMPLE_ORGS: Organization[] = [
  { id: '1', name: 'Starlight Dance Championships', slug: 'starlight', plan: 'professional', status: 'active', studios: 42, entries: 1283, mrr: '$149', createdAt: '2024-03-15' },
  { id: '2', name: 'Elevate Competition Series', slug: 'elevate', plan: 'enterprise', status: 'active', studios: 128, entries: 4521, mrr: '$499', createdAt: '2023-11-01' },
  { id: '3', name: 'Rhythm Nation Comp', slug: 'rhythm-nation', plan: 'starter', status: 'trial', studios: 8, entries: 0, mrr: '$0', createdAt: '2026-05-20' },
  { id: '4', name: 'Premier Dance Events', slug: 'premier', plan: 'professional', status: 'past_due', studios: 35, entries: 892, mrr: '$149', createdAt: '2024-07-22' },
  { id: '5', name: 'Cascade Dance Cup', slug: 'cascade', plan: 'starter', status: 'active', studios: 15, entries: 312, mrr: '$49', createdAt: '2025-01-10' },
]

function StatusBadge({ status }: { status: Organization['status'] }) {
  const styles = {
    active: 'badge-success',
    trial: 'badge-gold',
    past_due: 'badge-destructive',
    churned: 'bg-foreground-muted/15 text-foreground-muted text-xs font-semibold px-2 py-0.5',
  }
  const labels = { active: 'Active', trial: 'Trial', past_due: 'Past Due', churned: 'Churned' }
  return <span className={styles[status]}>{labels[status]}</span>
}

export default function OrganizationsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Organizations</h1>
          <p className="mt-1 text-sm text-foreground-muted">247 total organizations</p>
        </div>
        <div className="flex gap-3">
          <input
            type="search"
            placeholder="Search organizations..."
            className="input-dark w-64"
          />
          <select className="input-dark">
            <option value="">All Plans</option>
            <option value="starter">Starter</option>
            <option value="professional">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <select className="input-dark">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="past_due">Past Due</option>
            <option value="churned">Churned</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="surface-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Organization</th>
              <th className="px-6 py-3 text-left">Plan</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Studios</th>
              <th className="px-6 py-3 text-right">Entries</th>
              <th className="px-6 py-3 text-right">MRR</th>
              <th className="px-6 py-3 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_ORGS.map((org) => (
              <tr key={org.id} className="table-row">
                <td className="px-6 py-4">
                  <Link href={`/admin/organizations/${org.id}`} className="font-medium text-foreground hover:text-gold">
                    {org.name}
                  </Link>
                  <div className="text-xs text-foreground-muted">{org.slug}.stageflow.app</div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm capitalize text-foreground-secondary">{org.plan}</span>
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={org.status} />
                </td>
                <td className="px-6 py-4 text-right text-sm text-foreground-secondary">{org.studios}</td>
                <td className="px-6 py-4 text-right text-sm text-foreground-secondary">{org.entries.toLocaleString()}</td>
                <td className="px-6 py-4 text-right text-sm font-medium text-gold">{org.mrr}</td>
                <td className="px-6 py-4 text-right text-sm text-foreground-muted">{org.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground-muted">Showing 1-5 of 247</p>
        <div className="flex gap-2">
          <button type="button" className="btn-outline-gold px-4 py-2 text-xs" disabled>
            Previous
          </button>
          <button type="button" className="btn-outline-gold px-4 py-2 text-xs">
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
