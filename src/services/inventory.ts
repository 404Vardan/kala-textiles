import supabase from './supabase'
import type {
  InventoryLocation,
  InventoryStock,
  StockMovement,
  DashboardStats,
  IntakeStockResult,
  TransferStockResult,
  ConfirmOrderResult,
} from '@/types'

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

export async function upsertStock(
  productId: number,
  locationId: number,
  sets: number,
  totalPcs: number,
  businessId?: number
): Promise<InventoryStock> {
  if (sets < 0 || totalPcs < 0) {
    throw new Error('Stock quantities cannot be negative')
  }

  const payload: Record<string, unknown> = {
    product_id: productId,
    location_id: locationId,
    sets,
    total_pcs: totalPcs,
    updated_at: new Date().toISOString(),
  }

  if (businessId !== undefined) {
    payload.business_id = businessId
  }

  const { data, error } = await supabase
    .from('inventory_stock')
    .upsert(payload, { onConflict: 'business_id,product_id,location_id' })
    .select()

  if (error) throw error
  if (!data?.[0]) {
    throw new Error('Failed to upsert inventory stock')
  }
  return data[0] as InventoryStock
}

// Transactional Stock Intake (Godown Inward) — strictly via secured database RPC
export async function intakeStock(
  productId: number,
  locationId: number,
  sets: number,
  _pcsPerSet?: number,
  staffName?: string,
  notes?: string,
  refNo?: string
): Promise<IntakeStockResult> {
  if (sets <= 0) {
    throw new Error('Intake sets must be greater than zero')
  }

  const { data, error } = await supabase.rpc('intake_stock_tx', {
    p_product_id: productId,
    p_location_id: locationId,
    p_sets: sets,
    p_staff_name: staffName || 'Staff',
    p_notes: notes || null,
    p_ref_no: refNo || null,
  })

  if (error) {
    throw new Error(error.message || 'Stock intake RPC failed')
  }
  if (!data) {
    throw new Error('Stock intake RPC returned no data')
  }

  return data as IntakeStockResult
}

// Transactional Stock Transfer (e.g. Godown -> Shop) — strictly via secured database RPC
export async function transferStock(
  productId: number,
  fromLocationId: number,
  toLocationId: number,
  transferSets: number,
  _pcsPerSet?: number,
  staffName?: string,
  notes?: string,
  refNo?: string
): Promise<TransferStockResult> {
  if (fromLocationId === toLocationId) {
    throw new Error('Source and destination cannot be the same location')
  }
  if (transferSets <= 0) {
    throw new Error('Transfer quantity must be greater than zero')
  }

  const { data, error } = await supabase.rpc('transfer_stock_tx', {
    p_product_id: productId,
    p_from_location_id: fromLocationId,
    p_to_location_id: toLocationId,
    p_sets: transferSets,
    p_staff_name: staffName || 'Staff',
    p_notes: notes || null,
    p_ref_no: refNo || null,
  })

  if (error) {
    throw new Error(error.message || 'Stock transfer RPC failed')
  }
  if (!data) {
    throw new Error('Stock transfer RPC returned no data')
  }

  return data as TransferStockResult
}

// Transactional Order Confirmation & Stock Deduction — strictly via secured database RPC
export async function confirmOrderAndDeductStock(
  orderId: number,
  locationId: number,
  staffName?: string
): Promise<ConfirmOrderResult> {
  const { data, error } = await supabase.rpc('confirm_order_and_deduct_stock_tx', {
    p_order_id: orderId,
    p_location_id: locationId,
    p_staff_name: staffName || 'Staff',
  })

  if (error) {
    throw new Error(error.message || 'Order confirmation RPC failed')
  }
  if (!data) {
    throw new Error('Order confirmation RPC returned no data')
  }

  return data as ConfirmOrderResult
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

// Operational Dashboard summary — strictly via secured database RPC
export async function fetchDashboardSummary(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('get_dashboard_summary')

  if (error) {
    throw new Error(error.message || 'Failed to load dashboard summary')
  }
  if (!data) {
    throw new Error('Dashboard summary RPC returned no data')
  }

  return data as DashboardStats
}
