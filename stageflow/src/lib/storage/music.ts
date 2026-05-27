import { createClient } from '@/lib/supabase/server'
import { nanoid } from 'nanoid'

/** Allowed MIME types for music uploads */
export const ALLOWED_MUSIC_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/aac',
] as const

export type AllowedMusicType = (typeof ALLOWED_MUSIC_TYPES)[number]

/** Maximum file size for music uploads: 30 MB */
export const MAX_MUSIC_SIZE = 30 * 1024 * 1024

const MUSIC_BUCKET = 'music'

export interface MusicUploadMetadata {
  routineId: string
  organizationId: string
  title: string
  artistName?: string
  durationSeconds?: number
}

export interface MusicFileRecord {
  id: string
  storageKey: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  routineId: string
  organizationId: string
  title: string
  artistName: string | null
  durationSeconds: number | null
}

/**
 * Validate and upload a music file to Supabase Storage,
 * then create a corresponding music_files row.
 */
export async function uploadMusic(
  file: File,
  metadata: MusicUploadMetadata,
): Promise<MusicFileRecord> {
  // Validate MIME type
  if (!ALLOWED_MUSIC_TYPES.includes(file.type as AllowedMusicType)) {
    throw new Error(
      `Invalid file type "${file.type}". Allowed types: ${ALLOWED_MUSIC_TYPES.join(', ')}`,
    )
  }

  // Validate file size
  if (file.size > MAX_MUSIC_SIZE) {
    throw new Error(
      `File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds the ${MAX_MUSIC_SIZE / (1024 * 1024)}MB limit`,
    )
  }

  const supabase = await createClient()
  const fileId = nanoid()
  const extension = file.name.split('.').pop() ?? 'mp3'
  const storageKey = `${metadata.organizationId}/${metadata.routineId}/${fileId}.${extension}`

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from(MUSIC_BUCKET)
    .upload(storageKey, file, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    throw new Error(`Music upload failed: ${uploadError.message}`)
  }

  // Create database record
  const { data: record, error: dbError } = await supabase
    .from('music_files')
    .insert({
      storage_key: storageKey,
      original_filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      routine_id: metadata.routineId,
      organization_id: metadata.organizationId,
      title: metadata.title,
      artist_name: metadata.artistName ?? null,
      duration_seconds: metadata.durationSeconds ?? null,
    })
    .select()
    .single()

  if (dbError || !record) {
    // Attempt to clean up the uploaded file
    await supabase.storage.from(MUSIC_BUCKET).remove([storageKey])
    throw new Error(`Failed to create music record: ${dbError?.message}`)
  }

  return {
    id: record.id as string,
    storageKey: record.storage_key as string,
    originalFilename: record.original_filename as string,
    mimeType: record.mime_type as string,
    sizeBytes: record.size_bytes as number,
    routineId: record.routine_id as string,
    organizationId: record.organization_id as string,
    title: record.title as string,
    artistName: record.artist_name as string | null,
    durationSeconds: record.duration_seconds as number | null,
  }
}

/**
 * Generate a 1-hour signed URL for a music file.
 */
export async function getMusicSignedUrl(musicFileId: string): Promise<string> {
  const supabase = await createClient()

  const { data: record, error: dbError } = await supabase
    .from('music_files')
    .select('storage_key')
    .eq('id', musicFileId)
    .single()

  if (dbError || !record) {
    throw new Error(`Music file ${musicFileId} not found`)
  }

  const { data: signedUrl, error: urlError } = await supabase.storage
    .from(MUSIC_BUCKET)
    .createSignedUrl(record.storage_key as string, 60 * 60) // 1 hour

  if (urlError || !signedUrl) {
    throw new Error(`Failed to generate signed URL: ${urlError?.message}`)
  }

  return signedUrl.signedUrl
}
