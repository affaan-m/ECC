import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'
import {
  ClipboardList,
  Receipt,
  RotateCcw,
  Building2,
  FileCheck,
  Calendar,
  MessageSquare,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Notifications',
  description: 'View all organization notifications and activity.',
}

interface NotificationsProps {
  params: Promise<{ org: string }>
}

const NOTIFICATIONS = [
  { id: '1', type: 'entry' as const, title: 'New entry submitted', desc: '"Gravity" by Rhythm Studio for Summer Showcase 2026', time: '2h ago', read: false },
  { id: '2', type: 'payment' as const, title: 'Invoice paid', desc: 'Elite Academy paid Invoice #1042 ($385.00)', time: '4h ago', read: false },
  { id: '3', type: 'refund' as const, title: 'Refund requested', desc: 'Dance Fusion — Entry #892 "Starlight" ($45.00)', time: '6h ago', read: false },
  { id: '4', type: 'studio' as const, title: 'New studio registered', desc: 'Prestige Dance Co. joined your organization', time: '1d ago', read: true },
  { id: '5', type: 'document' as const, title: 'Document uploaded', desc: 'Jane Doe (Rhythm Studio) — Proof of Age', time: '1d ago', read: true },
  { id: '6', type: 'event' as const, title: 'Event updated', desc: 'Summer Showcase 2026 — 3 new categories added', time: '1d ago', read: true },
  { id: '7', type: 'entry' as const, title: 'Entry withdrawn', desc: '"Midnight Train" by Rhythm Studio — entry #830', time: '2d ago', read: true },
  { id: '8', type: 'message' as const, title: 'New message', desc: 'Emily Chen (Rhythm Studio) — Music file format question', time: '2d ago', read: true },
  { id: '9', type: 'payment' as const, title: 'Invoice overdue', desc: 'Urban Edge — Invoice #1040 ($125.00) past due', time: '3d ago', read: true },
  { id: '10', type: 'studio' as const, title: 'Studio invite accepted', desc: 'Dance Fusion accepted your invitation', time: '1w ago', read: true },
]

const TYPE_ICONS: Record<string, LucideIcon> = {
  entry: ClipboardList,
  payment: Receipt,
  refund: RotateCcw,
  studio: Building2,
  document: FileCheck,
  event: Calendar,
  message: MessageSquare,
}

export default async function NotificationsPage({ params }: NotificationsProps) {
  const { org } = await params
  const unreadCount = NOTIFICATIONS.filter((n) => !n.read).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread notifications for ${org}`}
        actions={
          <button type="button" className="text-xs text-gold hover:text-gold-hover">Mark all as read</button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        {['All', 'Unread', 'Entries', 'Payments', 'Studios', 'Messages'].map((filter) => (
          <button
            key={filter}
            type="button"
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === 'All'
                ? 'bg-gold text-black'
                : 'bg-[#202020] text-white/60 hover:text-white'
            }`}
          >
            {filter}
            {filter === 'Unread' && unreadCount > 0 && (
              <span className="ml-1.5 bg-gold/20 text-gold px-1.5 py-0.5 text-[10px]">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      <div className="surface-card divide-y divide-border">
        {NOTIFICATIONS.map((notification) => {
          const Icon = TYPE_ICONS[notification.type]
          return (
            <div
              key={notification.id}
              className={`flex items-start gap-4 px-6 py-4 transition-colors hover:bg-white/[0.02] ${
                !notification.read ? 'bg-gold-muted/20' : ''
              }`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#181818] text-foreground-muted">
                {Icon && <Icon className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${!notification.read ? 'font-semibold' : 'font-medium'}`}>
                    {notification.title}
                  </span>
                  <span className="text-xs text-foreground-muted">{notification.time}</span>
                </div>
                <p className="mt-0.5 text-xs text-foreground-muted">{notification.desc}</p>
              </div>
              {!notification.read && <div className="mt-2 h-2 w-2 shrink-0 bg-gold" />}
            </div>
          )
        })}
      </div>

      {/* Load more */}
      <div className="flex justify-center">
        <button type="button" className="text-xs text-foreground-muted hover:text-gold">Load older notifications</button>
      </div>
    </div>
  )
}
