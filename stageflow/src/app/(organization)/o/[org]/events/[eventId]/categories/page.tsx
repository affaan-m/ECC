import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Categories',
  description: 'Manage competition categories for this event.',
}

interface CategoriesPageProps {
  params: Promise<{ org: string; eventId: string }>
}

interface Category {
  id: string
  name: string
  ageGroup: string
  genre: string
  performerType: 'Solo' | 'Duo/Trio' | 'Small Group' | 'Large Group' | 'Line/Production'
  entryFee: string
  entries: number
  maxEntries: number | null
}

const SAMPLE_CATEGORIES: Category[] = [
  { id: '1', name: 'Mini Lyrical Solo', ageGroup: 'Mini (7 & Under)', genre: 'Lyrical', performerType: 'Solo', entryFee: '$25', entries: 22, maxEntries: null },
  { id: '2', name: 'Junior Hip-Hop Duo', ageGroup: 'Junior (8-10)', genre: 'Hip-Hop', performerType: 'Duo/Trio', entryFee: '$20/dancer', entries: 28, maxEntries: null },
  { id: '3', name: 'Teen Jazz Group', ageGroup: 'Teen (11-14)', genre: 'Jazz', performerType: 'Small Group', entryFee: '$15/dancer', entries: 32, maxEntries: 40 },
  { id: '4', name: 'Senior Contemporary Solo', ageGroup: 'Senior (15-19)', genre: 'Contemporary', performerType: 'Solo', entryFee: '$25', entries: 48, maxEntries: 50 },
  { id: '5', name: 'Senior Ballet Solo', ageGroup: 'Senior (15-19)', genre: 'Ballet', performerType: 'Solo', entryFee: '$25', entries: 24, maxEntries: null },
  { id: '6', name: 'Teen Contemporary Group', ageGroup: 'Teen (11-14)', genre: 'Contemporary', performerType: 'Small Group', entryFee: '$15/dancer', entries: 18, maxEntries: null },
]

export default async function CategoriesPage({ params }: CategoriesPageProps) {
  const { org, eventId } = await params

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-foreground-muted">
        <Link href={`/o/${org}/events`} className="hover:text-gold">Events</Link>
        <span>/</span>
        <Link href={`/o/${org}/events/${eventId}`} className="hover:text-gold">Summer Showcase 2026</Link>
        <span>/</span>
        <span className="text-foreground">Categories</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="mt-1 text-sm text-foreground-muted">{SAMPLE_CATEGORIES.length} categories configured</p>
        </div>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">ADD CATEGORY</button>
      </div>

      <div className="surface-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-6 py-3 text-left">Category</th>
              <th className="px-6 py-3 text-left">Age Group</th>
              <th className="px-6 py-3 text-left">Genre</th>
              <th className="px-6 py-3 text-left">Type</th>
              <th className="px-6 py-3 text-right">Fee</th>
              <th className="px-6 py-3 text-right">Entries</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CATEGORIES.map((cat) => (
              <tr key={cat.id} className="table-row">
                <td className="px-6 py-4 text-sm font-medium">{cat.name}</td>
                <td className="px-6 py-4 text-sm text-foreground-secondary">{cat.ageGroup}</td>
                <td className="px-6 py-4"><span className="badge-gold">{cat.genre}</span></td>
                <td className="px-6 py-4 text-sm text-foreground-secondary">{cat.performerType}</td>
                <td className="px-6 py-4 text-right text-sm text-foreground-secondary">{cat.entryFee}</td>
                <td className="px-6 py-4 text-right">
                  <span className="font-mono text-sm text-gold">{cat.entries}</span>
                  {cat.maxEntries && (
                    <span className="text-xs text-foreground-muted"> / {cat.maxEntries}</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <button type="button" className="text-xs text-gold hover:text-gold-hover">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
