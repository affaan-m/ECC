import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Team',
  description: 'Manage team members and permissions.',
}

interface TeamProps {
  params: Promise<{ org: string }>
}

const TEAM_MEMBERS = [
  { name: 'Sarah Mitchell', email: 'sarah@summershowcase.com', role: 'Owner', status: 'active' as const, lastActive: 'Now', avatar: 'SM' },
  { name: 'James Cooper', email: 'james@summershowcase.com', role: 'Admin', status: 'active' as const, lastActive: '2h ago', avatar: 'JC' },
  { name: 'Lisa Wang', email: 'lisa@summershowcase.com', role: 'Judge Coordinator', status: 'active' as const, lastActive: '1d ago', avatar: 'LW' },
  { name: 'David Kim', email: 'david@summershowcase.com', role: 'Finance', status: 'active' as const, lastActive: '3d ago', avatar: 'DK' },
  { name: 'Rachel Torres', email: 'rachel@summershowcase.com', role: 'Viewer', status: 'invited' as const, lastActive: 'Pending', avatar: 'RT' },
]

const ROLES = [
  { name: 'Owner', desc: 'Full access, billing, and team management', count: 1 },
  { name: 'Admin', desc: 'Full access except billing and ownership transfer', count: 1 },
  { name: 'Judge Coordinator', desc: 'Manage events, categories, running orders, and scores', count: 1 },
  { name: 'Finance', desc: 'Invoices, refunds, payments, and financial reports', count: 1 },
  { name: 'Viewer', desc: 'Read-only access to all data', count: 1 },
]

export default async function TeamPage({ params }: TeamProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={`${TEAM_MEMBERS.length} team members`}
        actions={
          <button type="button" className="btn-gold px-5 py-2.5 text-xs">INVITE MEMBER</button>
        }
      />

      {/* Members list */}
      <div className="surface-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-[#181818]">
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Member</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Role</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Status</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted">Last Active</th>
              <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-foreground-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {TEAM_MEMBERS.map((member) => (
              <tr key={member.email} className="hover:bg-white/[0.02]">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center bg-gold text-xs font-bold text-black">
                      {member.avatar}
                    </div>
                    <div>
                      <div className="font-medium">{member.name}</div>
                      <div className="text-xs text-foreground-muted">{member.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="bg-white/10 px-2 py-0.5 text-xs">{member.role}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs font-semibold px-2 py-0.5 ${
                    member.status === 'active' ? 'badge-success' : 'badge-gold'
                  }`}>
                    {member.status === 'active' ? 'Active' : 'Invited'}
                  </span>
                </td>
                <td className="px-6 py-4 text-foreground-muted">{member.lastActive}</td>
                <td className="px-6 py-4 text-right">
                  {member.role !== 'Owner' && (
                    <div className="flex justify-end gap-3">
                      <button type="button" className="text-xs text-gold hover:text-gold-hover">Edit</button>
                      <button type="button" className="text-xs text-foreground-muted hover:text-destructive">Remove</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Roles reference */}
      <div className="surface-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Available Roles</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((role) => (
            <div key={role.name} className="border border-border bg-[#181818] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{role.name}</span>
                <span className="text-xs text-foreground-muted">{role.count} member{role.count !== 1 ? 's' : ''}</span>
              </div>
              <p className="mt-1 text-xs text-foreground-muted">{role.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
