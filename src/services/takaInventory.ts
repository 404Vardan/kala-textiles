import supabase from './supabase'
import type {
  ProductVariant,
  InventoryLot,
  InventoryTaka,
  TakaSplit,
  TakaStatus,
  StockLedgerEntry,
  IntakeSetStockV2Result,
  ReceiveTakaLotItemInput,
  ReceiveTakaLotResult,
  TransferTakaResult,
  SplitTakaItemInput,
  SplitTakaResult,
  InventoryIntegrityReport,
} from '@/types'

// --------------------------------------------------------------------
// Product Variants
// --------------------------------------------------------------------

export async function fetchProductVariants(productId?: number): Promise<ProductVariant[]> {
  let query = supabase
    .from('product_variants')
    .select('*')
    .order('sku', { ascending: true })

  if (productId !== undefined) {
    query = query.eq('product_id', productId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ProductVariant[]
}

export async function createProductVariant(input: {
  productId: number
  sku: string
  colorName?: string | null
  colorCode?: string | null
  sizeLabel?: string | null
  rateOverride?: number | null
}): Promise<ProductVariant> {
  const { data, error } = await supabase
    .from('product_variants')
    .insert({
      product_id: input.productId,
      sku: input.sku.trim(),
      color_name: input.colorName?.trim() || null,
      color_code: input.colorCode?.trim() || null,
      size_label: input.sizeLabel?.trim() || null,
      rate_override: input.rateOverride ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return data as ProductVariant
}

// --------------------------------------------------------------------
// Inventory Lots, Serialized Takas & Lineage Queries
// --------------------------------------------------------------------

export async function fetchInventoryLots(productId?: number): Promise<InventoryLot[]> {
  let query = supabase
    .from('inventory_lots')
    .select('*')
    .order('received_date', { ascending: false })
    .order('id', { ascending: false })

  if (productId !== undefined) {
    query = query.eq('product_id', productId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as InventoryLot[]
}

export async function fetchInventoryTakas(filters?: {
  lotId?: number
  productId?: number
  locationId?: number
  status?: TakaStatus
}): Promise<InventoryTaka[]> {
  let query = supabase
    .from('inventory_takas')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters?.lotId !== undefined) {
    query = query.eq('lot_id', filters.lotId)
  }
  if (filters?.productId !== undefined) {
    query = query.eq('product_id', filters.productId)
  }
  if (filters?.locationId !== undefined) {
    query = query.eq('location_id', filters.locationId)
  }
  if (filters?.status !== undefined) {
    query = query.eq('status', filters.status)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as InventoryTaka[]
}

export async function fetchTakaSplits(parentTakaId: number): Promise<TakaSplit[]> {
  const { data, error } = await supabase
    .from('taka_splits')
    .select('*')
    .eq('parent_taka_id', parentTakaId)
    .order('id', { ascending: true })

  if (error) throw error
  return (data ?? []) as TakaSplit[]
}

// --------------------------------------------------------------------
// Unified Append-Only Stock Ledger Query
// --------------------------------------------------------------------

export async function fetchStockLedger(filters?: {
  productId?: number
  locationId?: number
  takaId?: number
  limit?: number
}): Promise<StockLedgerEntry[]> {
  let query = supabase
    .from('stock_ledger')
    .select('*')
    .order('posted_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(filters?.limit ?? 100)

  if (filters?.productId !== undefined) {
    query = query.eq('product_id', filters.productId)
  }
  if (filters?.locationId !== undefined) {
    query = query.eq('location_id', filters.locationId)
  }
  if (filters?.takaId !== undefined) {
    query = query.eq('taka_id', filters.takaId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as StockLedgerEntry[]
}

// --------------------------------------------------------------------
// Stage 2 Transactional RPCs
// --------------------------------------------------------------------

export async function intakeSetStockV2(params: {
  businessId: number
  branchId: number
  productId: number
  locationId: number
  sets: number
  unitCost: number
  movementDate?: string
  staffName?: string
  notes?: string
  refNo?: string
  idempotencyKey?: string
}): Promise<IntakeSetStockV2Result> {
  if (params.sets <= 0) {
    throw new Error('Intake sets must be greater than zero')
  }
  if (params.unitCost < 0) {
    throw new Error('Unit cost cannot be negative')
  }

  const { data, error } = await supabase.rpc('intake_set_stock_v2', {
    p_business_id: params.businessId,
    p_branch_id: params.branchId,
    p_product_id: params.productId,
    p_location_id: params.locationId,
    p_sets: params.sets,
    p_unit_cost: params.unitCost,
    p_movement_date: params.movementDate ?? new Date().toISOString().slice(0, 10),
    p_staff_name: params.staffName ?? null,
    p_notes: params.notes ?? null,
    p_ref_no: params.refNo ?? null,
    p_idempotency_key: params.idempotencyKey ?? null,
  })

  if (error) throw new Error(error.message || 'Set stock intake RPC failed')
  if (!data) throw new Error('Set stock intake RPC returned no data')
  return data as IntakeSetStockV2Result
}

export async function receiveTakaLot(params: {
  businessId: number
  branchId: number
  productId: number
  locationId: number
  lotNo: string
  landedCostPerUnit: number
  takas: ReceiveTakaLotItemInput[]
  movementDate?: string
  variantId?: number | null
  supplierPartyId?: number | null
  shadeNo?: string | null
  notes?: string | null
  idempotencyKey?: string | null
}): Promise<ReceiveTakaLotResult> {
  if (!params.lotNo.trim()) {
    throw new Error('Lot number is required')
  }
  if (params.landedCostPerUnit < 0) {
    throw new Error('Landed cost per unit cannot be negative')
  }
  if (!params.takas.length) {
    throw new Error('At least one taka roll is required')
  }

  const { data, error } = await supabase.rpc('receive_taka_lot_tx', {
    p_business_id: params.businessId,
    p_branch_id: params.branchId,
    p_product_id: params.productId,
    p_location_id: params.locationId,
    p_lot_no: params.lotNo.trim(),
    p_landed_cost_per_unit: params.landedCostPerUnit,
    p_takas: params.takas,
    p_movement_date: params.movementDate ?? new Date().toISOString().slice(0, 10),
    p_variant_id: params.variantId ?? null,
    p_supplier_party_id: params.supplierPartyId ?? null,
    p_shade_no: params.shadeNo ?? null,
    p_notes: params.notes ?? null,
    p_idempotency_key: params.idempotencyKey ?? null,
  })

  if (error) throw new Error(error.message || 'Receive taka lot RPC failed')
  if (!data) throw new Error('Receive taka lot RPC returned no data')
  return data as ReceiveTakaLotResult
}

export async function transferTaka(params: {
  businessId: number
  takaId: number
  toLocationId: number
  movementDate?: string
  notes?: string | null
  idempotencyKey?: string | null
}): Promise<TransferTakaResult> {
  const { data, error } = await supabase.rpc('transfer_taka_tx', {
    p_business_id: params.businessId,
    p_taka_id: params.takaId,
    p_to_location_id: params.toLocationId,
    p_movement_date: params.movementDate ?? new Date().toISOString().slice(0, 10),
    p_notes: params.notes ?? null,
    p_idempotency_key: params.idempotencyKey ?? null,
  })

  if (error) throw new Error(error.message || 'Transfer taka RPC failed')
  if (!data) throw new Error('Transfer taka RPC returned no data')
  return data as TransferTakaResult
}

export async function splitTaka(params: {
  businessId: number
  parentTakaId: number
  splits: SplitTakaItemInput[]
  movementDate?: string
  notes?: string | null
  idempotencyKey?: string | null
}): Promise<SplitTakaResult> {
  if (params.splits.length < 2) {
    throw new Error('Splitting a taka requires at least 2 child rolls')
  }

  const { data, error } = await supabase.rpc('split_taka_tx', {
    p_business_id: params.businessId,
    p_parent_taka_id: params.parentTakaId,
    p_splits: params.splits,
    p_movement_date: params.movementDate ?? new Date().toISOString().slice(0, 10),
    p_notes: params.notes ?? null,
    p_idempotency_key: params.idempotencyKey ?? null,
  })

  if (error) throw new Error(error.message || 'Split taka RPC failed')
  if (!data) throw new Error('Split taka RPC returned no data')
  return data as SplitTakaResult
}

export async function verifyInventoryIntegrity(
  businessId: number
): Promise<InventoryIntegrityReport> {
  const { data, error } = await supabase.rpc('verify_inventory_integrity', {
    p_business_id: businessId,
  })

  if (error) throw new Error(error.message || 'Inventory reconciliation RPC failed')
  if (!data) throw new Error('Inventory reconciliation RPC returned no data')
  return data as InventoryIntegrityReport
}

