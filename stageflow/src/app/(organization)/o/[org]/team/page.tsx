import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Team',
  description: 'Manage team members and their roles.',
}

interface TeamMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  status: 'active' | 'invited'
  lastActive: string
}

const SAMPLE_TEAM: TeamMember[] = [
  { id: '1', name: 'Sarah Mitchell', email: 'sarah@starlight-dance.com', role: 'owner', status: 'active', lastActive: 'Just now' },
  { id: '2', name: 'David Park', email: 'david@starlight-dance.com', role: 'admin', status: 'active', lastActive: '2h ago' },
  { id: '3', name: 'Rachel Green', email: 'rachel@starlight-dance.com', role: 'member', status: 'active', lastActive: '1d ago' },
  { id: '4', name: 'Mike Torres', email: 'mike@starlight-dance.com', role: 'viewer', status: 'invited', lastActive: 'Never' },
]

const ROLE_STYLES: Record<TeamMember['role'], string> = {
  owner: 'bg-gold/15 text-gold',
  admin: 'bg-blue-500/15 text-blue-400',
  member: 'bg-green-500/15 text-green-500',
  viewer: 'bg-foreground-muted/15 text-foreground-muted',
}

export default function TeamPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="mt-1 text-sm text-foreground-muted">Manage who has access to your organization</p>
        </div>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">INVITE MEMBER</button>
      </div>

      <div className="surface-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Member</th>
              <th className="px-6 py-3 text-left">Role</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-left">Last Active</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_TEAM.map((member) => (
              <tr key={member.id} className="table-row">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center bg-surface-elevated text-xs font-bold text-gold">
                      {member.name.split(' ').map((n) => n[0]).join('')}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{member.name}</div>
                      <div className="text-xs text-foreground-muted">{member.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs font-semibold px-2 py-0.5 capitalize ${ROLE_STYLES[member.role]}`}>
                    {member.role}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={member.status === 'active' ? 'badge-success' : 'badge-gold'}>
                    {member.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-foreground-muted">{member.lastActive}</td>
                <td className="px-6 py-4 text-right">
                  {member.role !== 'owner' && (
                    <div className="flex justify-end gap-3">
                      <button type="button" className="text-xs text-gold hover:text-gold-hover">Edit</button>
                      <button type="button" className="text-xs text-destructive hover:text-destructive-hover">Remove</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Role descriptions */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Role Permissions</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { role: 'Owner', desc: 'Full access. Manage billing, team, and all settings. Cannot be removed.' },
            { role: 'Admin', desc: 'Full access except billing and ownership transfer.' },
            { role: 'Member', desc: 'Manage events, entries, and studios. Cannot access billing or team settings.' },
            { role: 'Viewer', desc: 'Read-only access to dashboards and reports.' },
          ].map((r) => (
            <div key={r.role} className="bg-surface-elevated p-4">
              <div className="text-sm font-semibold text-gold">{r.role}</div>
              <p className="mt-1 text-xs text-foreground-muted">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
