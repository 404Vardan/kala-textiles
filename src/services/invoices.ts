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
