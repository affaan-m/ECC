import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Running Orders',
  description: 'Phase 2 feature — schedule and order performances for events.',
}

export default function RunningOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Running Orders</h1>
          <span className="bg-purple-500/15 px-2 py-0.5 text-xs font-semibold text-purple-400">PHASE 2</span>
        </div>
        <p className="mt-1 text-sm text-foreground-muted">
          Schedule and order performances across stages and time slots
        </p>
      </div>

      {/* Feature flag banner */}
      <div className="border border-purple-500/30 bg-purple-500/5 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center bg-purple-500/15 text-lg text-purple-400">
            ▶
          </div>
          <div>
            <h2 className="font-semibold text-purple-400">Coming Soon — Phase 2</h2>
            <p className="mt-2 text-sm text-foreground-muted">
              Running Orders is a Phase 2 feature currently in development. When released, you will be able to:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-foreground-secondary">
              <li className="flex items-center gap-2">
                <span className="text-purple-400">→</span>
                Auto-generate running orders from approved entries with conflict detection
              </li>
              <li className="flex items-center gap-2">
                <span className="text-purple-400">→</span>
                Drag-and-drop reordering across multiple stages
              </li>
              <li className="flex items-center gap-2">
                <span className="text-purple-400">→</span>
                Time slot estimation based on routine type and duration
              </li>
              <li className="flex items-center gap-2">
                <span className="text-purple-400">→</span>
                Publish schedules to the studio portal in real-time
              </li>
              <li className="flex items-center gap-2">
                <span className="text-purple-400">→</span>
                Export to PDF and print-ready formats
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Wireframe preview */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Preview</h2>
        <div className="grid grid-cols-3 gap-4">
          {['Stage A', 'Stage B', 'Warm-up'].map((stage) => (
            <div key={stage} className="border border-border p-4">
              <div className="mb-3 text-sm font-semibold text-gold">{stage}</div>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 bg-surface-elevated p-2">
                    <div className="font-mono text-xs text-foreground-muted">{`${9 + Math.floor(i / 2)}:${i % 2 === 0 ? '00' : '15'}`}</div>
                    <div className="h-3 flex-1 bg-border" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center">
        <button type="button" className="btn-outline-gold px-6 py-3 text-xs">
          NOTIFY ME WHEN AVAILABLE
        </button>
      </div>
    </div>
  )
}
