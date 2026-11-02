import supabase from './supabase'
import type { Invoice, InvoiceItem } from '@/types'

// Invoices CRUD
export async function fetchInvoices(limit = 100) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as Invoice[]
}

export async function fetchInvoice(invoiceNo: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('invoice_no', invoiceNo)
    .single()

  if (error) throw error
  return data as Invoice
}

export async function fetchPublicInvoice(slug: string = 'rangoli', invoiceNo: string): Promise<import('@/types').PublicInvoice> {
  try {
    const { data, error } = await supabase.rpc('get_public_invoice', {
      p_slug: slug,
      p_invoice_no: invoiceNo,
    })

    if (!error && data) {
      return data as import('@/types').PublicInvoice
    }
  } catch (err) {
    console.warn('get_public_invoice RPC failed, falling back to direct queries:', err)
  }

  // Graceful fallback
  const inv = await fetchInvoice(invoiceNo)
  const items = await fetchInvoiceItems(inv.id)
  return {
    invoice_no: inv.invoice_no,
    party_name: inv.party_name,
    export_date: inv.export_date,
    total_amount: inv.total_amount,
    created_at: inv.created_at,
    business_name: 'Rangoli Textiles',
    business_slug: slug,
    items: items.map(item => ({
      id: item.id,
      design_no: item.design_no || '',
      rate: item.rate || 0,
      sets: item.sets,
      pcs_per_set: item.pcs_per_set,
      total_pcs: item.total_pcs,
      line_total: item.line_total,
    }))
  }
}


export async function createInvoice(invoice: Omit<Invoice, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('invoices')
    .insert([invoice])
    .select()

  if (error) throw error
  return data[0] as Invoice
}

export async function updateInvoice(id: number, updates: Partial<Invoice>) {
  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as Invoice
}

export async function deleteInvoice(id: number) {
  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Invoice Items CRUD
export async function fetchInvoiceItems(invoiceId: number) {
  const { data, error } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data as InvoiceItem[]
}

export async function createInvoiceItem(item: Omit<InvoiceItem, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('invoice_items')
    .insert([item])
    .select()

  if (error) throw error
  return data[0] as InvoiceItem
}

export async function createInvoiceItemBatch(items: Array<Omit<InvoiceItem, 'id' | 'created_at'>>) {
  const { data, error } = await supabase
    .from('invoice_items')
    .insert(items)
    .select()

  if (error) throw error
  return data as InvoiceItem[]
}

export async function updateInvoiceItem(id: number, updates: Partial<InvoiceItem>) {
  const { data, error } = await supabase
    .from('invoice_items')
    .update(updates)
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as InvoiceItem
}

export async function deleteInvoiceItem(id: number) {
  const { error } = await supabase
    .from('invoice_items')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function deleteInvoiceItemsByInvoiceId(invoiceId: number) {
  const { error } = await supabase
    .from('invoice_items')
    .delete()
    .eq('invoice_id', invoiceId)

  if (error) throw error
}
