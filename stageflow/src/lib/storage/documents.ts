import { createClient } from '@/lib/supabase/server'
import { nanoid } from 'nanoid'

/** Allowed MIME types for document uploads */
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
] as const

export type AllowedDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number]

/** Maximum file size for document uploads: 10 MB */
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024

const DOCUMENTS_BUCKET = 'documents'

export interface DocumentUploadMetadata {
  organizationId: string
  /** What the document is attached to (e.g. "entry", "dancer", "event") */
  targetType: string
  /** ID of the target record */
  targetId: string
  /** Human-readable label */
  label?: string
}

export interface DocumentRecord {
  id: string
  storageKey: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  organizationId: string
  targetType: string
  targetId: string
  label: string | null
}

/**
 * Validate and upload a document to Supabase Storage,
 * then create a corresponding documents row.
 */
export async function uploadDocument(
  file: File,
  metadata: DocumentUploadMetadata,
): Promise<DocumentRecord> {
  // Validate MIME type
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as AllowedDocumentType)) {
    throw new Error(
      `Invalid file type "${file.type}". Allowed types: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`,
    )
  }

  // Validate file size
  if (file.size > MAX_DOCUMENT_SIZE) {
    throw new Error(
      `File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds the ${MAX_DOCUMENT_SIZE / (1024 * 1024)}MB limit`,
    )
  }

  const supabase = await createClient()
  const fileId = nanoid()
  const extension = file.name.split('.').pop() ?? 'pdf'
  const storageKey = `${metadata.organizationId}/${metadata.targetType}/${metadata.targetId}/${fileId}.${extension}`

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storageKey, file, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    throw new Error(`Document upload failed: ${uploadError.message}`)
  }

  // Create database record
  const { data: record, error: dbError } = await supabase
    .from('documents')
    .insert({
      storage_key: storageKey,
      original_filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      organization_id: metadata.organizationId,
      target_type: metadata.targetType,
      target_id: metadata.targetId,
      label: metadata.label ?? null,
    })
    .select()
    .single()

  if (dbError || !record) {
    // Attempt to clean up the uploaded file
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([storageKey])
    throw new Error(`Failed to create document record: ${dbError?.message}`)
  }

  return {
    id: record.id as string,
    storageKey: record.storage_key as string,
    originalFilename: record.original_filename as string,
    mimeType: record.mime_type as string,
    sizeBytes: record.size_bytes as number,
    organizationId: record.organization_id as string,
    targetType: record.target_type as string,
    targetId: record.target_id as string,
    label: record.label as string | null,
  }
}

/**
 * Generate a 15-minute signed URL for a document.
 */
export async function getDocumentSignedUrl(docId: string): Promise<string> {
  const supabase = await createClient()

  const { data: record, error: dbError } = await supabase
    .from('documents')
    .select('storage_key')
    .eq('id', docId)
    .single()

  if (dbError || !record) {
    throw new Error(`Document ${docId} not found`)
  }

  const { data: signedUrl, error: urlError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(record.storage_key as string, 15 * 60) // 15 minutes

  if (urlError || !signedUrl) {
    throw new Error(`Failed to generate signed URL: ${urlError?.message}`)
  }

  return signedUrl.signedUrl
}
