import supabase from './supabase'
import type { AdminSettings } from '@/types'

export async function fetchAdminSettings() {
  const { data, error } = await supabase
    .from('admin_settings')
    .select('*')
    .limit(1)
    .single()

  if (error) throw error
  return data as AdminSettings
}

export async function updatePassword(id: number, newPassword: string) {
  const { data, error } = await supabase
    .from('admin_settings')
    .update({ password_hash: newPassword, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as AdminSettings
}

export async function updateStaffPassword(id: number, newStaffPassword: string) {
  const { data, error } = await supabase
    .from('admin_settings')
    .update({ staff_password: newStaffPassword, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as AdminSettings
}

export async function updateWhatsappNumber(id: number, number: string) {
  const { data, error } = await supabase
    .from('admin_settings')
    .update({ whatsapp_number: number, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as AdminSettings
}
