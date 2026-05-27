import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Tags',
  description: 'Manage tags for organizing entries, studios, and dancers.',
}

interface TagsProps {
  params: Promise<{ org: string }>
}

const TAGS = [
  { name: 'featured', color: '#FFC000', count: 24, appliedTo: 'entries' },
  { name: 'returning', color: '#22C55E', count: 156, appliedTo: 'studios' },
  { name: 'scholarship', color: '#3B82F6', count: 8, appliedTo: 'entries' },
  { name: 'vip', color: '#A855F7', count: 12, appliedTo: 'studios' },
  { name: 'needs-review', color: '#EF4444', count: 5, appliedTo: 'entries' },
  { name: 'first-time', color: '#06B6D4', count: 34, appliedTo: 'studios' },
  { name: 'age-exception', color: '#F97316', count: 3, appliedTo: 'entries' },
  { name: 'staff-pick', color: '#EC4899', count: 15, appliedTo: 'entries' },
  { name: 'international', color: '#8B5CF6', count: 7, appliedTo: 'studios' },
  { name: 'competition-winner', color: '#FFC000', count: 42, appliedTo: 'entries' },
]

export default async function TagsPage({ params }: TagsProps) {
  const { org } = await params

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tags"
        description={`${TAGS.length} tags for organizing entries, studios, and dancers`}
        actions={
          <button type="button" className="btn-gold px-5 py-2.5 text-xs">CREATE TAG</button>
        }
      />

      {/* Tag stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="kpi-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Total Tags</div>
          <div className="mt-2 text-2xl font-bold text-gold">{TAGS.length}</div>
        </div>
        <div className="kpi-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Entry Tags</div>
          <div className="mt-2 text-2xl font-bold">{TAGS.filter((t) => t.appliedTo === 'entries').length}</div>
        </div>
        <div className="kpi-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Studio Tags</div>
          <div className="mt-2 text-2xl font-bold">{TAGS.filter((t) => t.appliedTo === 'studios').length}</div>
        </div>
      </div>

      {/* Tags grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TAGS.map((tag) => (
          <div key={tag.name} className="surface-card p-5 transition-colors hover:border-gold/30">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4" style={{ backgroundColor: tag.color }} />
                <div>
                  <span className="text-sm font-semibold">{tag.name}</span>
                  <div className="text-xs text-foreground-muted capitalize">Applied to {tag.appliedTo}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="text-xs text-gold hover:text-gold-hover">Edit</button>
                <button type="button" className="text-xs text-foreground-muted hover:text-destructive">Delete</button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-foreground-muted">Used {tag.count} times</span>
              <div className="h-1.5 w-24 bg-white/10">
                <div
                  className="h-full"
                  style={{
                    backgroundColor: tag.color,
                    width: `${Math.min((tag.count / 156) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
