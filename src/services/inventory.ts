import supabase from './supabase'
import type { InventoryLocation, InventoryStock, StockMovement } from '@/types'

// Locations
export async function fetchLocations() {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('*')
    .order('id', { ascending: true })

  if (error) throw error
  return data as InventoryLocation[]
}

// Stock levels
export async function fetchAllStock() {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('*')
    .order('product_id', { ascending: true })

  if (error) throw error
  return data as InventoryStock[]
}

export async function fetchStockByLocation(locationId: number) {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('location_id', locationId)

  if (error) throw error
  return data as InventoryStock[]
}

export async function fetchStockByProduct(productId: number) {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('product_id', productId)

  if (error) throw error
  return data as InventoryStock[]
}

export async function upsertStock(productId: number, locationId: number, sets: number, totalPcs: number) {
  const { data, error } = await supabase
    .from('inventory_stock')
    .upsert({
      product_id: productId,
      location_id: locationId,
      sets,
      total_pcs: totalPcs,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id,location_id' })
    .select()

  if (error) throw error
  return data?.[0] as InventoryStock
}

// Transfer stock between locations
export async function transferStock(
  productId: number,
  fromLocationId: number,
  toLocationId: number,
  transferSets: number,
  pcsPerSet: number,
  notes?: string,
) {
  const totalPcs = transferSets * pcsPerSet

  // Get current source stock
  const { data: fromStock } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('product_id', productId)
    .eq('location_id', fromLocationId)
    .single()

  const currentFromSets = fromStock?.sets || 0
  const currentFromPcs = fromStock?.total_pcs || 0

  if (currentFromSets < transferSets) {
    throw new Error('Insufficient stock at source location')
  }

  // Get current destination stock
  const { data: toStock } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('product_id', productId)
    .eq('location_id', toLocationId)
    .maybeSingle()

  const currentToSets = toStock?.sets || 0
  const currentToPcs = toStock?.total_pcs || 0

  // Update source (subtract)
  await upsertStock(productId, fromLocationId, currentFromSets - transferSets, currentFromPcs - totalPcs)

  // Update destination (add)
  await upsertStock(productId, toLocationId, currentToSets + transferSets, currentToPcs + totalPcs)

  // Log movement
  const { error: moveError } = await supabase
    .from('stock_movements')
    .insert([{
      product_id: productId,
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      sets: transferSets,
      total_pcs: totalPcs,
      notes,
    }])

  if (moveError) throw moveError
}

// Stock movements log
export async function fetchStockMovements(limit = 50) {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as StockMovement[]
}

export async function fetchStockMovementsByProduct(productId: number) {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as StockMovement[]
}
