import supabase from './supabase'
import type { Product, ProductMedia } from '@/types'

// Products CRUD
export async function fetchProducts(options?: number | {
  limit?: number
  search?: string
  brand?: string
  collection?: string
  activeOnly?: boolean
}): Promise<Product[]> {
  const opts = typeof options === 'number' ? { limit: options } : options
  const limit = opts?.limit || 100
  let query = supabase.from('products').select('*')

  if (opts?.activeOnly) {
    query = query.neq('is_active', false)
  }

  if (opts?.brand && opts.brand !== 'all') {
    query = query.eq('brand', opts.brand)
  }

  if (opts?.collection && opts.collection !== 'all') {
    query = query.eq('collection_name', opts.collection)
  }

  if (opts?.search && opts.search.trim()) {
    const s = opts.search.trim()
    query = query.or(`design_no.ilike.%${s}%,brand.ilike.%${s}%,collection_name.ilike.%${s}%,fabric.ilike.%${s}%`)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as Product[]
}

export async function fetchProduct(designNo: string): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('design_no', designNo)
    .single()

  if (error) throw error
  return data as Product
}

export async function fetchProductById(id: number): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Product
}

export async function fetchPublicProduct(slug: string = 'rangoli', designNo: string): Promise<import('@/types').PublicProduct> {
  const { data, error } = await supabase.rpc('get_public_product', {
    p_slug: slug,
    p_design_no: designNo,
  })

  if (error) throw error
  if (!data) {
    throw new Error('Product not found')
  }

  return data as import('@/types').PublicProduct
}

export async function checkDesignNoAvailable(designNo: string, excludeId?: number): Promise<boolean> {
  let query = supabase
    .from('products')
    .select('id')
    .ilike('design_no', designNo.trim())

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) return true
  return !data
}

export async function searchProducts(query: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .or(`design_no.ilike.%${query}%,brand.ilike.%${query}%,collection_name.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return data as Product[]
}

export async function createProduct(product: Omit<Product, 'id' | 'created_at' | 'updated_at'>): Promise<Product> {
  const isAvailable = await checkDesignNoAvailable(product.design_no)
  if (!isAvailable) {
    throw new Error(`Design number "${product.design_no}" already exists. Please choose a unique design number.`)
  }

  const { data, error } = await supabase
    .from('products')
    .insert([{
      ...product,
      is_active: product.is_active ?? true,
    }])
    .select()

  if (error) throw error
  return data[0] as Product
}

export async function updateProduct(id: number, updates: Partial<Product>): Promise<Product> {
  if (updates.design_no) {
    const isAvailable = await checkDesignNoAvailable(updates.design_no, id)
    if (!isAvailable) {
      throw new Error(`Design number "${updates.design_no}" is already used by another product.`)
    }
  }

  const { data, error } = await supabase
    .from('products')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as Product
}

export async function toggleProductActive(id: number, currentStatus: boolean): Promise<Product> {
  return updateProduct(id, { is_active: !currentStatus })
}

export async function deleteProduct(id: number): Promise<void> {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Product Media CRUD
export async function fetchProductMedia(productId: number): Promise<ProductMedia[]> {
  const { data, error } = await supabase
    .from('product_media')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data as ProductMedia[]
}

export async function createProductMedia(
  productId: number,
  mediaUrl: string,
  mediaType: 'image' | 'video',
  sortOrder: number = 0
): Promise<ProductMedia> {
  const { data, error } = await supabase
    .from('product_media')
    .insert([{
      product_id: productId,
      media_url: mediaUrl,
      media_type: mediaType,
      sort_order: sortOrder
    }])
    .select()

  if (error) throw error
  return data[0] as ProductMedia
}

export async function setPrimaryImage(productId: number, mediaUrl: string): Promise<void> {
  await updateProduct(productId, { image_url: mediaUrl })
}

export async function updateMediaOrder(mediaId: number, sortOrder: number): Promise<ProductMedia> {
  const { data, error } = await supabase
    .from('product_media')
    .update({ sort_order: sortOrder })
    .eq('id', mediaId)
    .select()

  if (error) throw error
  return data[0] as ProductMedia
}

export async function deleteProductMedia(mediaId: number): Promise<void> {
  const { error } = await supabase
    .from('product_media')
    .delete()
    .eq('id', mediaId)

  if (error) throw error
}

export async function updateMediaOrderBatch(updates: Array<{ id: number; sort_order: number }>): Promise<void> {
  const { error } = await supabase
    .from('product_media')
    .upsert(updates)

  if (error) throw error
}
