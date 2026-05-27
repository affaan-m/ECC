import type { Metadata } from 'next'
import { Play } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Running Orders',
  description: 'Build and manage running orders for competition days.',
}

interface RunningOrdersProps {
  params: Promise<{ org: string }>
}

const SESSIONS = [
  { id: '1', name: 'Saturday Morning — Junior', time: '8:00 AM - 12:00 PM', entries: 28, status: 'draft' as const },
  { id: '2', name: 'Saturday Afternoon — Teen', time: '1:00 PM - 5:00 PM', entries: 34, status: 'draft' as const },
  { id: '3', name: 'Sunday Morning — Senior', time: '8:00 AM - 12:00 PM', entries: 42, status: 'draft' as const },
  { id: '4', name: 'Sunday Afternoon — Finals', time: '2:00 PM - 6:00 PM', entries: 20, status: 'draft' as const },
]

export default async function RunningOrdersPage({ params }: RunningOrdersProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Running Orders"
        description={`Plan the performance schedule for ${org} events`}
        actions={
          <div className="flex items-center gap-3">
            <span className="bg-blue-500/15 text-blue-400 text-xs font-semibold px-2 py-0.5">Phase 2</span>
            <button type="button" className="btn-gold px-5 py-2.5 text-xs">CREATE SESSION</button>
          </div>
        }
      />

      {/* Feature flag banner */}
      <div className="border border-blue-500/30 bg-blue-500/5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center bg-blue-500/15 text-blue-400 text-sm"><Play className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-blue-400">Running Order Builder — Phase 2 Preview</h3>
            <p className="text-xs text-foreground-muted">
              This feature is currently in beta. Drag-and-drop ordering, automatic time calculations,
              and conflict detection are coming soon.
            </p>
          </div>
        </div>
      </div>

      {/* Event selector */}
      <div className="flex items-center gap-4">
        <select className="h-10 bg-[#202020] border border-white/10 px-4 text-sm text-white focus:outline-none focus:border-gold">
          <option>Summer Showcase 2026</option>
          <option>Fall Championship 2026</option>
        </select>
        <span className="text-sm text-foreground-muted">4 sessions — 124 entries total</span>
      </div>

      {/* Sessions */}
      <div className="space-y-4">
        {SESSIONS.map((session) => (
          <div key={session.id} className="surface-card p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center bg-gold-muted text-gold text-sm font-bold">
                  {session.id}
                </div>
                <div>
                  <h3 className="text-sm font-semibold">{session.name}</h3>
                  <div className="text-xs text-foreground-muted">{session.time}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-lg font-bold text-gold">{session.entries}</div>
                  <div className="text-xs text-foreground-muted">entries</div>
                </div>
                <span className="bg-foreground-muted/15 text-foreground-muted text-xs font-semibold px-2 py-0.5">
                  {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                </span>
                <button type="button" className="text-xs text-gold hover:text-gold-hover">Edit order</button>
              </div>
            </div>

            {/* Sample running order preview */}
            <div className="mt-4 border-t border-border pt-4">
              <div className="space-y-1">
                {[1, 2, 3].map((num) => (
                  <div key={num} className="flex items-center gap-3 py-1.5 px-3 hover:bg-white/[0.02]">
                    <span className="w-6 text-center text-xs font-mono text-foreground-muted">{num}</span>
                    <div className="h-1 w-4 bg-white/10 cursor-grab" title="Drag to reorder" />
                    <span className="text-xs text-foreground-muted">8:{String(num * 3).padStart(2, '0')} AM</span>
                    <span className="text-sm flex-1">Entry placeholder #{num}</span>
                    <span className="text-xs text-foreground-muted">2:30</span>
                  </div>
                ))}
                <div className="px-3 py-1.5 text-xs text-foreground-muted">
                  + {session.entries - 3} more entries...
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Upcoming features */}
      <div className="surface-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Coming Soon</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            { title: 'Drag-and-Drop', desc: 'Reorder entries by dragging them into position' },
            { title: 'Auto-Schedule', desc: 'Automatically arrange entries based on rules and conflicts' },
            { title: 'Print & Export', desc: 'Generate PDF running orders for judges and stage managers' },
          ].map((feature) => (
            <div key={feature.title} className="border border-border bg-[#181818] p-4">
              <div className="text-sm font-medium">{feature.title}</div>
              <p className="mt-1 text-xs text-foreground-muted">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
