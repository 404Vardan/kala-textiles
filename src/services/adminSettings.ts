import supabase from './supabase'
import type { AdminSettings } from '@/types'

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const { data, error } = await supabase
    .from('admin_settings')
    .select('*')
    .limit(1)
    .single()

  if (error) {
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
  const { data, error } = await supabase
    .from('admin_settings')
    .update({ whatsapp_number: number, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as AdminSettings
}

export async function updateUserPassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

