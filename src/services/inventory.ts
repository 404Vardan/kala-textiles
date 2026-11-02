import supabase from './supabase'
import type { InventoryLocation, InventoryStock, StockMovement, DashboardStats } from '@/types'

// Locations
export async function fetchLocations(): Promise<InventoryLocation[]> {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('*')
    .order('id', { ascending: true })

  if (error) throw error
  return data as InventoryLocation[]
}

// Stock levels
export async function fetchAllStock(): Promise<InventoryStock[]> {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('*')
    .order('product_id', { ascending: true })

  if (error) throw error
  return data as InventoryStock[]
}

export async function fetchStockByLocation(locationId: number): Promise<InventoryStock[]> {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('location_id', locationId)

  if (error) throw error
  return data as InventoryStock[]
}

export async function fetchStockByProduct(productId: number): Promise<InventoryStock[]> {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('product_id', productId)

  if (error) throw error
  return data as InventoryStock[]
}

export async function upsertStock(productId: number, locationId: number, sets: number, totalPcs: number): Promise<InventoryStock> {
  const { data, error } = await supabase
    .from('inventory_stock')
    .upsert({
      product_id: productId,
      location_id: locationId,
      sets: Math.max(0, sets),
      total_pcs: Math.max(0, totalPcs),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id,location_id' })
    .select()

  if (error) throw error
  return data?.[0] as InventoryStock
}

// Transactional Stock Intake (e.g. Godown Inward)
export async function intakeStock(
  productId: number,
  locationId: number,
  sets: number,
  pcsPerSet: number,
  staffName?: string,
  notes?: string,
  refNo?: string
) {
  if (sets <= 0) {
    throw new Error('Intake sets must be greater than zero')
  }

  // 1. Attempt server-side atomic RPC
  try {
    const { data, error } = await supabase.rpc('intake_stock_tx', {
      p_product_id: productId,
      p_location_id: locationId,
      p_sets: sets,
      p_pcs_per_set: pcsPerSet || 1,
      p_staff_name: staffName || 'Staff',
      p_notes: notes || null,
      p_ref_no: refNo || null,
    })

    if (!error) return data
    if (error && !error.message?.includes('not found') && !error.message?.includes('does not exist')) {
      throw new Error(error.message)
    }
  } catch (err: any) {
    if (err.message && !err.message.includes('not found') && !err.message.includes('does not exist')) {
      throw err
    }
  }

  // 2. Client-side fallback if RPC is not yet migrated in Supabase
  const totalPcs = sets * (pcsPerSet || 1)
  const reference = refNo || `IN-${Date.now()}`

  const { data: existing } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('product_id', productId)
    .eq('location_id', locationId)
    .maybeSingle()

  const currentSets = existing?.sets || 0
  const currentPcs = existing?.total_pcs || 0

  await upsertStock(productId, locationId, currentSets + sets, currentPcs + totalPcs)

  await supabase.from('stock_movements').insert([{
    product_id: productId,
    from_location_id: null,
    to_location_id: locationId,
    sets,
    total_pcs: totalPcs,
    notes,
    reference_no: reference,
    staff_name: staffName || 'Staff',
    movement_type: 'INTAKE',
  }])

  return { success: true, reference_no: reference }
}

// Transactional Stock Transfer (e.g. Godown -> Shop)
export async function transferStock(
  productId: number,
  fromLocationId: number,
  toLocationId: number,
  transferSets: number,
  pcsPerSet: number,
  staffName?: string,
  notes?: string,
  refNo?: string
) {
  if (fromLocationId === toLocationId) {
    throw new Error('Source and destination cannot be the same location')
  }
  if (transferSets <= 0) {
    throw new Error('Transfer quantity must be greater than zero')
  }

  // 1. Attempt atomic RPC
  try {
    const { data, error } = await supabase.rpc('transfer_stock_tx', {
      p_product_id: productId,
      p_from_location_id: fromLocationId,
      p_to_location_id: toLocationId,
      p_sets: transferSets,
      p_pcs_per_set: pcsPerSet || 1,
      p_staff_name: staffName || 'Staff',
      p_notes: notes || null,
      p_ref_no: refNo || null,
    })

    if (!error) return data
    if (error && !error.message?.includes('not found') && !error.message?.includes('does not exist')) {
      throw new Error(error.message)
    }
  } catch (err: any) {
    if (err.message && !err.message.includes('not found') && !err.message.includes('does not exist')) {
      throw err
    }
  }

  // 2. Client-side fallback with validation
  const totalPcs = transferSets * (pcsPerSet || 1)
  const reference = refNo || `TR-${Date.now()}`

  // Check current source stock
  const { data: fromStock } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('product_id', productId)
    .eq('location_id', fromLocationId)
    .single()

  const currentFromSets = fromStock?.sets || 0
  const currentFromPcs = fromStock?.total_pcs || 0

  if (currentFromSets < transferSets) {
    throw new Error(`Insufficient stock at source location. Available: ${currentFromSets}, Requested: ${transferSets}`)
  }

  // Check current destination stock
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
      reference_no: reference,
      staff_name: staffName || 'Staff',
      movement_type: 'TRANSFER',
    }])

  if (moveError) throw moveError
  return { success: true, reference_no: reference }
}

// Transactional Order Confirmation & Stock Deduction
export async function confirmOrderAndDeductStock(
  orderId: number,
  locationId: number,
  staffName?: string
) {
  // 1. Try atomic database RPC
  try {
    const { data, error } = await supabase.rpc('confirm_order_and_deduct_stock_tx', {
      p_order_id: orderId,
      p_location_id: locationId,
      p_staff_name: staffName || 'Staff',
    })
    if (!error) return data
    if (error && !error.message?.includes('not found') && !error.message?.includes('does not exist')) {
      throw new Error(error.message)
    }
  } catch (err: any) {
    if (err.message && !err.message.includes('not found') && !err.message.includes('does not exist')) {
      throw err
    }
  }


  // 2. Client fallback
  // Fetch order items
  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)

  if (itemsErr) throw itemsErr

  // Check availability
  for (const item of items || []) {
    if (item.product_id) {
      const { data: stock } = await supabase
        .from('inventory_stock')
        .select('*')
        .eq('product_id', item.product_id)
        .eq('location_id', locationId)
        .maybeSingle()

      const avail = stock?.sets || 0
      if (avail < item.sets) {
        throw new Error(`Insufficient stock for design ${item.design_no || item.product_id}. Available: ${avail}, Required: ${item.sets}`)
      }
    }
  }

  // Deduct
  for (const item of items || []) {
    if (item.product_id) {
      const { data: stock } = await supabase
        .from('inventory_stock')
        .select('*')
        .eq('product_id', item.product_id)
        .eq('location_id', locationId)
        .single()

      if (stock) {
        await upsertStock(
          item.product_id,
          locationId,
          stock.sets - item.sets,
          stock.total_pcs - item.total_pcs
        )

        await supabase.from('stock_movements').insert([{
          product_id: item.product_id,
          from_location_id: locationId,
          to_location_id: null,
          sets: item.sets,
          total_pcs: item.total_pcs,
          notes: 'Deducted on order confirmation',
          reference_no: `ORD-${orderId}`,
          staff_name: staffName || 'Staff',
          movement_type: 'DISPATCH',
        }])
      }
    }
  }

  // Mark confirmed
  await supabase
    .from('orders')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: staffName || 'Staff',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)

  return { success: true }
}

// Stock movements log
export async function fetchStockMovements(limit = 100): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as StockMovement[]
}

// Operational Dashboard summary
export async function fetchDashboardSummary(): Promise<DashboardStats> {
  try {
    const { data, error } = await supabase.rpc('get_dashboard_summary')
    if (!error && data) {
      return data as DashboardStats
    }
  } catch {}

  // Fallback client aggregation
  const [{ count: totalProducts }, { data: allStock }, { data: allOrders }] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }),
    supabase.from('inventory_stock').select('location_id, sets, total_pcs'),
    supabase.from('orders').select('id, status'),
  ])

  // Get locations
  const locations = await fetchLocations().catch(() => [])
  const godownId = locations.find(l => l.name.toLowerCase() === 'godown')?.id
  const shopId = locations.find(l => l.name.toLowerCase() === 'shop')?.id

  const godownStock = (allStock || []).filter(s => s.location_id === godownId)
  const shopStock = (allStock || []).filter(s => s.location_id === shopId)

  const godownSets = godownStock.reduce((sum, s) => sum + (s.sets || 0), 0)
  const godownPcs = godownStock.reduce((sum, s) => sum + (s.total_pcs || 0), 0)
  const shopSets = shopStock.reduce((sum, s) => sum + (s.sets || 0), 0)
  const shopPcs = shopStock.reduce((sum, s) => sum + (s.total_pcs || 0), 0)

  const confirmed = (allOrders || []).filter(o => o.status === 'confirmed').length
  const draft = (allOrders || []).filter(o => !o.status || o.status === 'draft').length

  return {
    total_products: totalProducts || 0,
    active_products: totalProducts || 0,
    godown_sets: godownSets,
    godown_pcs: godownPcs,
    shop_sets: shopSets,
    shop_pcs: shopPcs,
    total_orders: (allOrders || []).length,
    confirmed_orders: confirmed,
    draft_orders: draft,
  }
}
