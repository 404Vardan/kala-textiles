import supabase from './supabase'
import type { Agent } from '@/types'

export async function fetchAgents(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    console.warn('Could not fetch agents:', error.message)
    return []
  }
  return data as Agent[]
}

export async function createAgent(agent: Omit<Agent, 'id' | 'created_at' | 'updated_at'>): Promise<Agent> {
  const { data, error } = await supabase
    .from('agents')
    .insert([{
      name: agent.name.trim(),
      phone: agent.phone?.trim() || null,
      station: agent.station?.trim() || null,
      is_active: agent.is_active ?? true,
    }])
    .select()

  if (error) throw error
  return data[0] as Agent
}

export async function updateAgent(id: number, updates: Partial<Agent>): Promise<Agent> {
  const { data, error } = await supabase
    .from('agents')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as Agent
}

export async function deleteAgent(id: number): Promise<void> {
  const { error } = await supabase
    .from('agents')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function findOrCreateAgent(name: string, station?: string): Promise<Agent | null> {
  if (!name.trim()) return null
  const trimmed = name.trim()

  const { data: existing } = await supabase
    .from('agents')
    .select('*')
    .ilike('name', trimmed)
    .maybeSingle()

  if (existing) {
    if (!existing.station && station) {
      const { data: updated } = await supabase
        .from('agents')
        .update({
          station,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()
      return (updated as Agent) || existing
    }
    return existing as Agent
  }

  try {
    return await createAgent({
      name: trimmed,
      station: station || null,
      is_active: true,
    })
  } catch {
    return null
  }
}
