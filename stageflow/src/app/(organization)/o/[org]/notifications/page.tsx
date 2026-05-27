import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Notifications',
  description: 'View and manage your notification center.',
}

interface Notification {
  id: string
  title: string
  description: string
  time: string
  read: boolean
  type: 'entry' | 'payment' | 'system' | 'message' | 'event'
}

const SAMPLE_NOTIFICATIONS: Notification[] = [
  { id: '1', title: 'New entry submitted', description: '"Gravity" by Rhythm Studio — Senior Contemporary Solo', time: '2h ago', read: false, type: 'entry' },
  { id: '2', title: 'Payment received', description: 'Elite Academy paid INV-1042 ($385.00)', time: '4h ago', read: false, type: 'payment' },
  { id: '3', title: 'New message', description: 'Tom Harris (Elite Academy) sent you a message', time: '5h ago', read: false, type: 'message' },
  { id: '4', title: 'Refund requested', description: 'Dance Fusion requesting refund for Entry #892 ($45.00)', time: '6h ago', read: true, type: 'payment' },
  { id: '5', title: 'Entry deadline approaching', description: 'Summer Showcase 2026 — entries close in 5 days', time: '1d ago', read: true, type: 'event' },
  { id: '6', title: 'New studio registered', description: 'New Horizons Dance joined your organization', time: '2d ago', read: true, type: 'system' },
]

const TYPE_COLORS: Record<Notification['type'], string> = {
  entry: 'bg-blue-500',
  payment: 'bg-green-500',
  system: 'bg-gold',
  message: 'bg-purple-500',
  event: 'bg-amber-500',
}

export default function NotificationsPage() {
  const unreadCount = SAMPLE_NOTIFICATIONS.filter((n) => !n.read).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="mt-1 text-sm text-foreground-muted">{unreadCount} unread notifications</p>
        </div>
        <button type="button" className="btn-outline-gold px-4 py-2 text-xs">MARK ALL READ</button>
      </div>

      <div className="surface-card divide-y divide-border">
        {SAMPLE_NOTIFICATIONS.map((notification) => (
          <div
            key={notification.id}
            className={`flex items-start gap-4 px-6 py-4 ${!notification.read ? 'bg-gold-muted/20' : ''}`}
          >
            <div className={`mt-1 h-2 w-2 flex-shrink-0 ${TYPE_COLORS[notification.type]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className={`text-sm ${!notification.read ? 'font-bold' : 'font-medium'}`}>
                  {notification.title}
                </span>
                <span className="text-xs text-foreground-muted">{notification.time}</span>
              </div>
              <p className="mt-0.5 text-sm text-foreground-muted">{notification.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Notification preferences */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Notification Preferences</h2>
        <div className="space-y-4">
          {[
            { label: 'New entries', desc: 'When a studio submits a new entry', email: true, inApp: true },
            { label: 'Payments', desc: 'When a payment is received or fails', email: true, inApp: true },
            { label: 'Messages', desc: 'When a studio sends you a message', email: false, inApp: true },
            { label: 'System alerts', desc: 'Deadline reminders and system notifications', email: true, inApp: true },
          ].map((pref) => (
            <div key={pref.label} className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground-secondary">{pref.label}</div>
                <div className="text-xs text-foreground-muted">{pref.desc}</div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-foreground-muted">
                  <div className={`h-5 w-9 ${pref.email ? 'bg-gold' : 'bg-surface-elevated'}`} />
                  Email
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground-muted">
                  <div className={`h-5 w-9 ${pref.inApp ? 'bg-gold' : 'bg-surface-elevated'}`} />
                  In-app
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
