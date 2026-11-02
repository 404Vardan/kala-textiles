import supabase from './supabase'

let bucketReady = false

async function ensureBucket() {
  if (bucketReady) return
  try {
    // Try to get the bucket first
    const { error: getError } = await supabase.storage.getBucket('product-media')
    if (getError) {
      // Bucket doesn't exist, create it
      await supabase.storage.createBucket('product-media', { public: true })
    }
    bucketReady = true
  } catch {
    // Ignore — bucket might already exist
    bucketReady = true
  }
}

export async function uploadProductMedia(productId: number, file: File): Promise<string> {
  await ensureBucket()

  const fileExt = file.name.split('.').pop()
  const filename = `${productId}/${Date.now()}.${fileExt}`

  const { data, error: uploadError } = await supabase.storage
    .from('product-media')
    .upload(filename, file)

  if (uploadError) throw uploadError

  const { data: publicUrlData } = supabase.storage
    .from('product-media')
    .getPublicUrl(data.path)

  return publicUrlData.publicUrl
}

export async function deleteMediaFile(path: string) {
  const { error } = await supabase.storage
    .from('product-media')
    .remove([path])

  if (error) throw error
}

// Extract file path from public URL
export function getPathFromUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    const parts = urlObj.pathname.split('/')
    const bucketIndex = parts.indexOf('product-media')
    if (bucketIndex !== -1) {
      return parts.slice(bucketIndex + 1).join('/')
    }
    return url
  } catch {
    return url
  }
}
