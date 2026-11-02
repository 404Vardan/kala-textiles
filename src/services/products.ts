import supabase from './supabase'
import type { Product, ProductMedia } from '@/types'

// Products CRUD
export async function fetchProducts(limit = 100) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .limit(limit)

  if (error) throw error
  return data as Product[]
}

export async function fetchProduct(designNo: string) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('design_no', designNo)
    .single()

  if (error) throw error
  return data as Product
}

export async function searchProducts(query: string) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .or(`design_no.ilike.%${query}%,brand.ilike.%${query}%,collection_name.ilike.%${query}%`)

  if (error) throw error
  return data as Product[]
}

export async function createProduct(product: Omit<Product, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('products')
    .insert([product])
    .select()

  if (error) throw error
  return data[0] as Product
}

export async function updateProduct(id: number, updates: Partial<Product>) {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as Product
}

export async function deleteProduct(id: number) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Product Media CRUD
export async function fetchProductMedia(productId: number) {
  const { data, error } = await supabase
    .from('product_media')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data as ProductMedia[]
}

export async function createProductMedia(productId: number, mediaUrl: string, mediaType: 'image' | 'video', sortOrder: number = 0) {
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

export async function updateMediaOrder(mediaId: number, sortOrder: number) {
  const { data, error } = await supabase
    .from('product_media')
    .update({ sort_order: sortOrder })
    .eq('id', mediaId)
    .select()

  if (error) throw error
  return data[0] as ProductMedia
}

export async function deleteProductMedia(mediaId: number) {
  const { error } = await supabase
    .from('product_media')
    .delete()
    .eq('id', mediaId)

  if (error) throw error
}

// Batch update media order
export async function updateMediaOrderBatch(updates: Array<{ id: number; sort_order: number }>) {
  const { error } = await supabase
    .from('product_media')
    .upsert(updates)

  if (error) throw error
}
