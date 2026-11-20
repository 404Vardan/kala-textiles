import supabase from './supabase'

const PRODUCT_MEDIA_BUCKET = 'product-media'

function generateFileUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function resolveFileExtension(file: File): string {
  const nameParts = file.name.split('.')
  if (nameParts.length > 1) {
    const ext = nameParts.pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
    if (ext && ext.length <= 10) {
      return ext
    }
  }

  const mimeSubtype = file.type.split('/')[1]?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
  if (mimeSubtype === 'jpeg') return 'jpg'
  if (mimeSubtype && mimeSubtype.length <= 10) return mimeSubtype

  return 'bin'
}

/**
 * Uploads product media to tenant-scoped storage path:
 * `{business_id}/{product_id}/{uuid}.{ext}`
 */
export async function uploadProductMedia(
  businessId: number,
  productId: number,
  file: File
): Promise<string> {
  if (!Number.isInteger(businessId) || businessId <= 0) {
    throw new Error('Valid business_id is required to upload product media.')
  }
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error('Valid product_id is required to upload product media.')
  }

  const ext = resolveFileExtension(file)
  const uuid = generateFileUuid()
  const objectPath = `${businessId}/${productId}/${uuid}.${ext}`

  const { data, error: uploadError } = await supabase.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .upload(objectPath, file, {
      upsert: false,
      contentType: file.type || undefined,
    })

  if (uploadError) throw uploadError

  const { data: publicUrlData } = supabase.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .getPublicUrl(data.path)

  return publicUrlData.publicUrl
}

export async function deleteMediaFile(pathOrUrl: string): Promise<void> {
  const objectPath = getPathFromUrl(pathOrUrl)
  if (!objectPath) return

  const { error } = await supabase.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .remove([objectPath])

  if (error) throw error
}

/**
 * Extracts the storage object path (e.g. `{business_id}/{product_id}/{uuid}.{ext}`)
 * from a Supabase Storage URL or returns an already-relative object path.
 */
export function getPathFromUrl(url: string): string {
  const raw = (url || '').trim()
  if (!raw) return ''

  try {
    const urlObj = new URL(raw)
    const segments = urlObj.pathname.split('/').filter(Boolean)
    const bucketIndex = segments.indexOf(PRODUCT_MEDIA_BUCKET)
    if (bucketIndex !== -1 && bucketIndex + 1 < segments.length) {
      return segments
        .slice(bucketIndex + 1)
        .map((seg) => decodeURIComponent(seg))
        .join('/')
    }
    return ''
  } catch {
    // Already a relative storage path (strip query/hash and leading slashes)
    const clean = raw.split(/[?#]/)[0].replace(/^\/+/, '')
    const prefix = `${PRODUCT_MEDIA_BUCKET}/`
    return clean.startsWith(prefix) ? clean.slice(prefix.length) : clean
  }
}
