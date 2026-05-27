import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Tags',
  description: 'Manage tags for organizing entries, studios, and dancers.',
}

interface Tag {
  id: string
  name: string
  color: string
  usageCount: number
  appliedTo: 'entries' | 'studios' | 'dancers' | 'all'
}

const SAMPLE_TAGS: Tag[] = [
  { id: '1', name: 'VIP', color: '#FFC000', usageCount: 12, appliedTo: 'studios' },
  { id: '2', name: 'First-time', color: '#22c55e', usageCount: 24, appliedTo: 'studios' },
  { id: '3', name: 'Priority Review', color: '#ef4444', usageCount: 8, appliedTo: 'entries' },
  { id: '4', name: 'Scholarship', color: '#8b5cf6', usageCount: 5, appliedTo: 'dancers' },
  { id: '5', name: 'Returning', color: '#3b82f6', usageCount: 38, appliedTo: 'studios' },
  { id: '6', name: 'Late Entry', color: '#f97316', usageCount: 15, appliedTo: 'entries' },
]

export default function TagsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tags</h1>
          <p className="mt-1 text-sm text-foreground-muted">Organize entries, studios, and dancers with custom tags</p>
        </div>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">CREATE TAG</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SAMPLE_TAGS.map((tag) => (
          <div key={tag.id} className="surface-card flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4" style={{ backgroundColor: tag.color }} />
              <div>
                <div className="text-sm font-medium">{tag.name}</div>
                <div className="text-xs text-foreground-muted">
                  {tag.usageCount} {tag.appliedTo} tagged
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" className="text-xs text-gold hover:text-gold-hover">Edit</button>
              <button type="button" className="text-xs text-destructive hover:text-destructive-hover">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
