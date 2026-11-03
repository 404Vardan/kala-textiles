import supabase from './supabase'
import type { AdminSettings } from '@/types'

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const { data, error } = await supabase
    .from('admin_settings')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message || 'Failed to fetch business settings')
  }

  if (!data) {
    return {
      id: 0,
      whatsapp_number: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  return data as AdminSettings
}

export async function updateWhatsappNumber(id: number, number: string): Promise<AdminSettings> {
  const trimmed = number.trim()
  const now = new Date().toISOString()

  if (id > 0) {
    const { data, error } = await supabase
      .from('admin_settings')
      .update({ whatsapp_number: trimmed, updated_at: now })
      .eq('id', id)
      .select()

    if (error) throw error
    if (data?.[0]) {
      return data[0] as AdminSettings
    }
  }

  // If no existing row was found for this business, insert a tenant-scoped settings row
  // (business_id defaults to public.current_business_id() in PostgreSQL)
  const { data: inserted, error: insertError } = await supabase
    .from('admin_settings')
    .insert([{ whatsapp_number: trimmed, updated_at: now }])
    .select()

  if (insertError) throw insertError
  if (!inserted?.[0]) {
    throw new Error('Failed to save business WhatsApp contact')
  }

  return inserted[0] as AdminSettings
}

export async function updateUserPassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}
