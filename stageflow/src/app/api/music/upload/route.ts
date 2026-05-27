import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rate-limit'

const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'audio/aac',
  'audio/x-wav',
])

const MAX_FILE_SIZE = 30 * 1024 * 1024 // 30 MB

export async function POST(request: NextRequest) {
  let userId: string
  try {
    userId = await getCurrentUserId()
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const rateLimitResult = await rateLimit(userId, 'upload')
  if (!rateLimitResult.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const body = await request.json()
  const { routineId, fileName, mimeType, fileSize } = body as {
    routineId: string
    fileName: string
    mimeType: string
    fileSize: number
  }

  if (!routineId || !fileName || !mimeType || !fileSize) {
    return NextResponse.json({ error: 'Missing required fields: routineId, fileName, mimeType, fileSize' }, { status: 400 })
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: `Invalid MIME type. Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}` },
      { status: 400 },
    )
  }

  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const storagePath = `music/${routineId}/${Date.now()}-${fileName}`

  const { data: signedUrl, error: signError } = await supabase.storage
    .from('music-files')
    .createSignedUploadUrl(storagePath)

  if (signError) {
    console.error('[Music Upload] Failed to create signed URL:', signError.message)
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
  }

  const { error: dbError } = await supabase
    .from('music_files')
    .insert({
      routine_id: routineId,
      file_name: fileName,
      mime_type: mimeType,
      file_size: fileSize,
      storage_path: storagePath,
      uploaded_by: userId,
      status: 'pending',
    })

  if (dbError) {
    console.error('[Music Upload] Failed to write music_files row:', dbError.message)
    return NextResponse.json({ error: 'Failed to record upload' }, { status: 500 })
  }

  return NextResponse.json({
    uploadUrl: signedUrl.signedUrl,
    token: signedUrl.token,
    path: storagePath,
  })
}
