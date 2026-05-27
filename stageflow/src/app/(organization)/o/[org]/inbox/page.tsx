import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Inbox',
  description: 'Messages between your organization and studios.',
}

interface Message {
  id: string
  from: string
  fromRole: string
  subject: string
  preview: string
  time: string
  unread: boolean
}

const SAMPLE_MESSAGES: Message[] = [
  { id: '1', from: 'Emily Chen', fromRole: 'Rhythm Studio', subject: 'Music file format question', preview: 'Hi, I have a question about the accepted music file formats for...', time: '10 min ago', unread: true },
  { id: '2', from: 'Tom Harris', fromRole: 'Elite Academy', subject: 'Late entry request', preview: 'We have one more solo we would like to add to the Summer Showcase if possible...', time: '2h ago', unread: true },
  { id: '3', from: 'Nina Petrov', fromRole: 'Classical Motion', subject: 'Re: Invoice clarification', preview: 'Thank you for the explanation. I will process the payment today...', time: '5h ago', unread: false },
  { id: '4', from: 'Marcus Johnson', fromRole: 'Urban Edge', subject: 'Category age cutoff', preview: 'Can you confirm the age cutoff date for the Junior division?...', time: '1d ago', unread: false },
  { id: '5', from: 'Sophie Taylor', fromRole: 'Graceful Arts', subject: 'Studio registration complete', preview: 'Just wanted to confirm everything went through on our end...', time: '2d ago', unread: false },
]

export default function InboxPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {SAMPLE_MESSAGES.filter((m) => m.unread).length} unread messages
          </p>
        </div>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">COMPOSE</button>
      </div>

      <div className="surface-card divide-y divide-border">
        {SAMPLE_MESSAGES.map((msg) => (
          <button
            key={msg.id}
            type="button"
            className={`flex w-full items-start gap-4 px-6 py-4 text-left transition-colors hover:bg-surface-elevated ${msg.unread ? 'bg-gold-muted/30' : ''}`}
          >
            <div className="flex h-10 w-10 items-center justify-center bg-surface-elevated text-xs font-bold text-gold">
              {msg.from.split(' ').map((n) => n[0]).join('')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${msg.unread ? 'font-bold' : 'font-medium'}`}>{msg.from}</span>
                  <span className="text-xs text-foreground-muted">{msg.fromRole}</span>
                </div>
                <span className="text-xs text-foreground-muted">{msg.time}</span>
              </div>
              <div className={`mt-0.5 text-sm ${msg.unread ? 'font-semibold text-foreground' : 'text-foreground-secondary'}`}>
                {msg.subject}
              </div>
              <p className="mt-0.5 truncate text-xs text-foreground-muted">{msg.preview}</p>
            </div>
            {msg.unread && <div className="mt-2 h-2 w-2 flex-shrink-0 bg-gold" />}
          </button>
        ))}
      </div>
    </div>
  )
}
