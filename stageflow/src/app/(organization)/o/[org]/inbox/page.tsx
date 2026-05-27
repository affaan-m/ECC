import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'

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
      <PageHeader
        title="Inbox"
        description={`${SAMPLE_MESSAGES.filter((m) => m.unread).length} unread messages`}
        actions={
          <button type="button" className="btn-gold px-5 py-2.5 text-xs">COMPOSE</button>
        }
      />

      <div className="grid gap-0 lg:grid-cols-[380px_1fr] h-[calc(100vh-280px)] min-h-[500px]">
        {/* Conversation list */}
        <div className="surface-card divide-y divide-border overflow-y-auto border-r border-border">
          {SAMPLE_MESSAGES.map((msg) => (
            <button
              key={msg.id}
              type="button"
              className={`flex w-full items-start gap-4 px-6 py-4 text-left transition-colors hover:bg-surface-elevated ${msg.unread ? 'bg-gold-muted/30' : ''} ${msg.id === '1' ? 'border-l-2 border-l-gold' : ''}`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-surface-elevated text-xs font-bold text-gold">
                {msg.from.split(' ').map((n) => n[0]).join('')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${msg.unread ? 'font-bold' : 'font-medium'}`}>{msg.from}</span>
                  <span className="text-xs text-foreground-muted">{msg.time}</span>
                </div>
                <div className={`mt-0.5 text-sm truncate ${msg.unread ? 'font-semibold text-foreground' : 'text-foreground-secondary'}`}>
                  {msg.subject}
                </div>
                <p className="mt-0.5 truncate text-xs text-foreground-muted">{msg.preview}</p>
              </div>
              {msg.unread && <div className="mt-2 h-2 w-2 flex-shrink-0 bg-gold" />}
            </button>
          ))}
        </div>

        {/* Message panel */}
        <div className="surface-card flex flex-col">
          <div className="border-b border-border px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Music file format question</h3>
                <div className="text-xs text-foreground-muted">Emily Chen — Rhythm Studio</div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="text-xs text-foreground-muted hover:text-white">Archive</button>
                <button type="button" className="text-xs text-gold hover:text-gold-hover">Reply</button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-surface-elevated text-xs font-bold text-gold">EC</div>
              <div className="surface-card p-4 max-w-lg">
                <p className="text-sm">Hi, I have a question about the accepted music file formats for the Summer Showcase. Can we submit WAV files or does it need to be MP3 only?</p>
                <div className="mt-2 text-xs text-foreground-muted">10 min ago</div>
              </div>
            </div>
          </div>
          <div className="border-t border-border p-4">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Type your reply..."
                className="flex-1 h-10 bg-[#181818] border border-white/10 px-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-gold"
              />
              <button type="button" className="btn-gold px-5 py-2 text-xs">SEND</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
