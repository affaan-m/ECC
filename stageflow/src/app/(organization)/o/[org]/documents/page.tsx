import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Documents',
  description: 'Document verification inbox for proof of age and other required documents.',
}

interface DocumentSubmission {
  id: string
  studio: string
  dancer: string
  documentType: string
  submittedAt: string
  status: 'pending_review' | 'approved' | 'rejected'
  notes: string | null
}

const SAMPLE_DOCS: DocumentSubmission[] = [
  { id: '1', studio: 'Rhythm Studio', dancer: 'Jane Doe', documentType: 'Proof of Age (Birth Certificate)', submittedAt: '3h ago', status: 'pending_review', notes: null },
  { id: '2', studio: 'Elite Academy', dancer: 'Alex Rivera', documentType: 'Proof of Age (Passport)', submittedAt: '8h ago', status: 'pending_review', notes: null },
  { id: '3', studio: 'Urban Edge', dancer: 'Sam Kim', documentType: 'Medical Clearance', submittedAt: '1d ago', status: 'approved', notes: null },
  { id: '4', studio: 'Classical Motion', dancer: 'Mia Petrov', documentType: 'Proof of Age (Birth Certificate)', submittedAt: '2d ago', status: 'rejected', notes: 'Image too blurry — please resubmit.' },
]

const STATUS_BADGE: Record<DocumentSubmission['status'], string> = {
  pending_review: 'badge-gold',
  approved: 'badge-success',
  rejected: 'badge-destructive',
}

const STATUS_LABELS: Record<DocumentSubmission['status'], string> = {
  pending_review: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Documents</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Review submitted documents for verification. {SAMPLE_DOCS.filter((d) => d.status === 'pending_review').length} pending.
        </p>
      </div>

      <div className="flex gap-3">
        <input type="search" placeholder="Search dancer or studio..." className="input-dark w-64" />
        <select className="input-dark">
          <option value="">All Statuses</option>
          <option value="pending_review">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="space-y-4">
        {SAMPLE_DOCS.map((doc) => (
          <div key={doc.id} className="surface-card flex items-center justify-between p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center bg-surface-elevated text-lg">
                📄
              </div>
              <div>
                <div className="text-sm font-medium">{doc.dancer}</div>
                <div className="text-xs text-foreground-muted">{doc.studio} — {doc.documentType}</div>
                <div className="mt-1 text-xs text-foreground-muted">Submitted {doc.submittedAt}</div>
                {doc.notes && (
                  <div className="mt-1 text-xs text-destructive">Note: {doc.notes}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className={STATUS_BADGE[doc.status]}>{STATUS_LABELS[doc.status]}</span>
              {doc.status === 'pending_review' && (
                <div className="flex gap-2">
                  <button type="button" className="btn-outline-gold px-3 py-1.5 text-xs">VIEW</button>
                  <button type="button" className="text-xs text-green-500 hover:text-green-400">Approve</button>
                  <button type="button" className="text-xs text-destructive hover:text-destructive-hover">Reject</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
