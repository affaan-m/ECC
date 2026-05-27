import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Users',
  description: 'Global user search and management.',
}

interface User {
  id: string
  name: string
  email: string
  role: 'platform_admin' | 'org_admin' | 'org_member' | 'studio_owner' | 'studio_member'
  organization: string
  lastLogin: string
  status: 'active' | 'suspended' | 'invited'
}

const SAMPLE_USERS: User[] = [
  { id: '1', name: 'Sarah Mitchell', email: 'sarah@starlight-dance.com', role: 'org_admin', organization: 'Starlight Dance Championships', lastLogin: '2 hours ago', status: 'active' },
  { id: '2', name: 'James Rivera', email: 'james@elevate-comp.com', role: 'org_admin', organization: 'Elevate Competition Series', lastLogin: '1 day ago', status: 'active' },
  { id: '3', name: 'Emily Chen', email: 'emily@rhythm-studio.com', role: 'studio_owner', organization: 'Rhythm Studio (Starlight)', lastLogin: '3 hours ago', status: 'active' },
  { id: '4', name: 'David Park', email: 'david@premier-events.com', role: 'org_member', organization: 'Premier Dance Events', lastLogin: '1 week ago', status: 'active' },
  { id: '5', name: 'Lisa Wong', email: 'lisa@cascade.com', role: 'org_admin', organization: 'Cascade Dance Cup', lastLogin: 'Never', status: 'invited' },
]

const ROLE_LABELS: Record<User['role'], string> = {
  platform_admin: 'Platform Admin',
  org_admin: 'Org Admin',
  org_member: 'Org Member',
  studio_owner: 'Studio Owner',
  studio_member: 'Studio Member',
}

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="mt-1 text-sm text-foreground-muted">Global user directory across all organizations</p>
        </div>
        <div className="flex gap-3">
          <input type="search" placeholder="Search by name or email..." className="input-dark w-72" />
          <select className="input-dark">
            <option value="">All Roles</option>
            <option value="org_admin">Org Admin</option>
            <option value="org_member">Org Member</option>
            <option value="studio_owner">Studio Owner</option>
            <option value="studio_member">Studio Member</option>
          </select>
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">User</th>
              <th className="px-6 py-3 text-left">Role</th>
              <th className="px-6 py-3 text-left">Organization</th>
              <th className="px-6 py-3 text-left">Last Login</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_USERS.map((user) => (
              <tr key={user.id} className="table-row">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center bg-surface-elevated text-xs font-bold text-gold">
                      {user.name.split(' ').map((n) => n[0]).join('')}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{user.name}</div>
                      <div className="text-xs text-foreground-muted">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="badge-gold">{ROLE_LABELS[user.role]}</span>
                </td>
                <td className="px-6 py-4 text-sm text-foreground-secondary">{user.organization}</td>
                <td className="px-6 py-4 text-sm text-foreground-muted">{user.lastLogin}</td>
                <td className="px-6 py-4">
                  <span className={user.status === 'active' ? 'badge-success' : user.status === 'invited' ? 'badge-gold' : 'badge-destructive'}>
                    {user.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button type="button" className="text-xs text-gold hover:text-gold-hover">
                    Impersonate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground-muted">Showing 1-5 of 1,247</p>
        <div className="flex gap-2">
          <button type="button" className="btn-outline-gold px-4 py-2 text-xs" disabled>Previous</button>
          <button type="button" className="btn-outline-gold px-4 py-2 text-xs">Next</button>
        </div>
      </div>
    </div>
  )
}
