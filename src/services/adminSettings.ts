import supabase from './supabase'
import type { AdminSettings, PublicBusinessSettings } from '@/types'

function sanitizeConfiguredWhatsapp(raw?: string | null): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  if (trimmed.toUpperCase().includes('XXXX')) return ''
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (digits.length < 7 || digits.length > 15) return ''
  return trimmed
}

/**
 * Normalizes a configured WhatsApp phone number into international digits suitable for https://wa.me/<digits>.
 * Returns null if the number is missing, a placeholder, or invalid.
 */
export function normalizeWhatsAppDigits(raw?: string | null): string | null {
  const clean = sanitizeConfiguredWhatsapp(raw)
  if (!clean) return null

  const digits = clean.replace(/[^0-9]/g, '')
  if (digits.length === 10) {
    // Standard 10-digit Indian mobile number -> prepend 91 country code for wa.me
    return `91${digits}`
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`
  }
  if (digits.length >= 7 && digits.length <= 15) {
    return digits
  }
  return null
}

/**
 * Public-safe RPC to fetch only public business settings (business_name, business_slug, whatsapp_number)
 * for customer-facing QR and order request screens.
 */
export async function fetchPublicBusinessSettings(slug: string = 'rangoli'): Promise<PublicBusinessSettings | null> {
  const cleanSlug = (slug || 'rangoli').trim().toLowerCase() || 'rangoli'

  const { data, error } = await supabase.rpc('get_public_business_settings', {
    p_slug: cleanSlug,
  })

  if (error) {
    throw new Error(error.message || 'Failed to load business contact settings')
  }

  if (!data) return null

  const payload = data as PublicBusinessSettings
  const validWhatsapp = sanitizeConfiguredWhatsapp(payload.whatsapp_number)

  return {
    business_name: payload.business_name || 'Kala',
    business_slug: payload.business_slug || cleanSlug,
    whatsapp_number: validWhatsapp || null,
  }
}

/**
 * Authenticated owner helper to read current business settings including WhatsApp contact.
 * Reads from businesses.settings.whatsapp_number first, with fallback to admin_settings.
 */
export async function fetchAdminSettings(): Promise<AdminSettings> {
  const now = new Date().toISOString()

  const { data: bizData, error: bizError } = await supabase
    .from('businesses')
    .select('id, settings, created_at, updated_at')
    .limit(1)
    .maybeSingle()

  if (!bizError && bizData) {
    const fromBizSettings = sanitizeConfiguredWhatsapp(
      (bizData.settings as Record<string, any> | undefined)?.whatsapp_number
    )
    if (fromBizSettings) {
      return {
        id: bizData.id,
        business_id: bizData.id,
        whatsapp_number: fromBizSettings,
        created_at: bizData.created_at || now,
        updated_at: bizData.updated_at || now,
      }
    }
  }

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
      created_at: now,
      updated_at: now,
    }
  }

  return {
    ...(data as AdminSettings),
    whatsapp_number: sanitizeConfiguredWhatsapp(data.whatsapp_number),
  }
}

/**
 * Updates the active business WhatsApp number in businesses.settings via owner-only RPC
 * (preserving other settings keys such as order_prefix and invoice_prefix).
 */
export async function updateBusinessWhatsappNumber(number: string): Promise<string | null> {
  const trimmed = number.trim()

  const { data, error } = await supabase.rpc('update_business_whatsapp_number', {
    p_whatsapp_number: trimmed,
  })

  if (error) {
    throw new Error(error.message || 'Failed to update WhatsApp number')
  }

  const result = data as { success?: boolean; whatsapp_number?: string | null } | null
  return result?.whatsapp_number ?? (trimmed || null)
}

export async function updateWhatsappNumber(_id: number, number: string): Promise<AdminSettings> {
  const updated = await updateBusinessWhatsappNumber(number)
  const now = new Date().toISOString()
  return {
    id: _id || 1,
    whatsapp_number: updated || '',
    created_at: now,
    updated_at: now,
  }
}

export async function updateUserPassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}
