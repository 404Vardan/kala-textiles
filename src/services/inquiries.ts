import supabase from './supabase'
import type { Inquiry } from '@/types'

// Inquiries CRUD
export async function fetchInquiries(limit = 100) {
  const { data, error } = await supabase
    .from('inquiries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as Inquiry[]
}

export async function fetchInquiriesByStatus(status: string, limit = 100) {
  const { data, error } = await supabase
    .from('inquiries')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as Inquiry[]
}

export async function fetchInquiry(id: number) {
  const { data, error } = await supabase
    .from('inquiries')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Inquiry
}

export async function createInquiry(inquiry: Omit<Inquiry, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('inquiries')
    .insert([inquiry])
    .select()

  if (error) throw error
  return data[0] as Inquiry
}

export async function createPublicInquiry(params: {
  slug?: string
  customerName: string
  phone: string
  designNo?: string
  message?: string
}) {
  const { slug = 'rangoli', customerName, phone, designNo, message } = params
  try {
    const { data, error } = await supabase.rpc('create_public_inquiry', {
      p_slug: slug,
      p_customer_name: customerName,
      p_phone: phone,
      p_design_no: designNo || null,
      p_message: message || null,
    })

    if (!error && data) {
      return data
    }
  } catch (err) {
    console.warn('create_public_inquiry RPC failed, falling back to direct insert:', err)
  }

  // Graceful fallback
  return createInquiry({
    customer_name: customerName,
    phone,
    design_no: designNo,
    message,
    status: 'pending',
  })
}

export async function updateInquiry(id: number, updates: Partial<Inquiry>) {
  const { data, error } = await supabase
    .from('inquiries')
    .update(updates)
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as Inquiry
}

export async function deleteInquiry(id: number) {
  const { error } = await supabase
    .from('inquiries')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function searchInquiriesByDesignNo(designNo: string) {
  const { data, error } = await supabase
    .from('inquiries')
    .select('*')
    .eq('design_no', designNo)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Inquiry[]
}
