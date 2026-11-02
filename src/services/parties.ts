import supabase from './supabase'
import type { Party } from '@/types'

export async function fetchParties(): Promise<Party[]> {
  const { data, error } = await supabase
    .from('parties')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    console.warn('Could not fetch parties:', error.message)
    return []
  }
  return data as Party[]
}

export async function createParty(party: Omit<Party, 'id' | 'created_at' | 'updated_at'>): Promise<Party> {
  const { data, error } = await supabase
    .from('parties')
    .insert([{
      name: party.name.trim(),
      station: party.station?.trim() || null,
      gst_number: party.gst_number?.trim() || null,
      phone: party.phone?.trim() || null,
      address: party.address?.trim() || null,
    }])
    .select()

  if (error) throw error
  return data[0] as Party
}

export async function updateParty(id: number, updates: Partial<Party>): Promise<Party> {
  const { data, error } = await supabase
    .from('parties')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as Party
}

export async function deleteParty(id: number): Promise<void> {
  const { error } = await supabase
    .from('parties')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function findOrCreateParty(name: string, station?: string, gstNumber?: string): Promise<Party | null> {
  if (!name.trim()) return null
  const trimmed = name.trim()

  const { data: existing } = await supabase
    .from('parties')
    .select('*')
    .ilike('name', trimmed)
    .maybeSingle()

  if (existing) {
    // Optionally update station or GST if previously missing
    if ((!existing.station && station) || (!existing.gst_number && gstNumber)) {
      const { data: updated } = await supabase
        .from('parties')
        .update({
          station: existing.station || station || null,
          gst_number: existing.gst_number || gstNumber || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()
      return (updated as Party) || existing
    }
    return existing as Party
  }

  try {
    return await createParty({
      name: trimmed,
      station: station || null,
      gst_number: gstNumber || null,
    })
  } catch {
    return null
  }
}
