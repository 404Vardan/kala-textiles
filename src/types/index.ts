// Business & Multi-Tenancy types
export type UserRole = 'owner' | 'staff'

export interface Business {
  id: number
  name: string
  slug: string
  settings?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface Membership {
  user_id: string
  business_id: number
  role: UserRole
  role_id?: number | null
  created_at: string
  business?: Business
}

export interface Branch {
  id: number
  business_id: number
  code: string
  name: string
  gstin?: string | null
  state_code?: string | null
  address?: string | null
  is_default: boolean
  is_active: boolean
  row_version?: number
}

export interface FinancialYear {
  id: number
  business_id: number
  label: string
  start_date: string
  end_date: string
  is_active: boolean
  is_locked: boolean
}

// Product types
export type TrackingMode = 'SET' | 'TAKA' | 'PIECE'
export type InventoryUom = 'SET' | 'PCS' | 'MTR' | 'KG'

export interface Product {
  id: number
  business_id?: number
  design_no: string
  brand?: string
  collection_name?: string
  fabric?: string
  rate?: number
  pcs_per_set?: number
  total_set?: number
  total_pcs?: number
  tracking_mode?: TrackingMode
  uom?: InventoryUom
  hsn_code?: string | null
  description?: string
  image_url?: string
  qr_code_url?: string
  is_active?: boolean
  created_at: string
  updated_at: string
}

export interface ProductMedia {
  id: number
  business_id?: number
  product_id: number
  media_url: string
  media_type: 'image' | 'video'
  sort_order: number
  created_at: string
}

// Public Product DTO returned by get_public_product RPC
export interface PublicProduct {
  design_no: string
  brand?: string
  collection_name?: string
  fabric?: string
  rate?: number
  pcs_per_set?: number
  description?: string
  image_url?: string
  business_name: string
  business_slug: string
  media: Array<{
    id: number
    media_url: string
    media_type: 'image' | 'video'
    sort_order: number
  }>
}

// Order types
export type OrderStatus = 'draft' | 'confirmed' | 'cancelled'

export interface Order {
  id: number
  business_id?: number
  order_no: string
  party_name: string
  station?: string | null
  agent?: string | null
  gst_number?: string | null
  order_date?: string | null
  export_date?: string | null
  brand?: string | null
  product_name?: string | null
  notes?: string | null
  status?: OrderStatus
  confirmed_at?: string | null
  confirmed_by?: string | null
  total_amount: number
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: number
  business_id?: number
  order_id: number
  product_id?: number
  design_no?: string
  rate?: number
  sets: number
  pcs_per_set: number
  total_pcs: number
  line_total: number
  created_at: string
}

// Public Order DTO returned by get_public_order RPC
export interface PublicOrder {
  order_no: string
  party_name: string
  station?: string | null
  agent?: string | null
  gst_number?: string | null
  order_date?: string | null
  export_date?: string | null
  brand?: string | null
  product_name?: string | null
  notes?: string | null
  status?: OrderStatus
  total_amount: number
  created_at: string
  confirmed_at?: string | null
  business_name: string
  business_slug: string
  items: Array<{
    id: number
    design_no: string
    rate: number
    sets: number
    pcs_per_set: number
    total_pcs: number
    line_total: number
    thumbnail?: string
    brand?: string
    fabric?: string
  }>
}

// Buyer Order Request types
export type OrderRequestStatus = 'requested' | 'converted' | 'rejected'

export interface OrderRequestCartItem {
  design_no: string
  sets: number
}

export interface OrderRequestItem {
  request_id: number
  product_id: number
  sets: number
  product?: {
    id: number
    design_no: string
    brand?: string | null
    collection_name?: string | null
    fabric?: string | null
    rate?: number | null
    pcs_per_set?: number | null
    image_url?: string | null
    is_active?: boolean | null
  } | null
}

export interface OrderRequest {
  id: number
  business_id: number
  party_name: string
  phone: string
  status: OrderRequestStatus
  note?: string | null
  created_at: string
  items: OrderRequestItem[]
}

export interface ConvertOrderRequestResult {
  success: boolean
  request_id: number
  order_id: number
  order_no: string
  status: OrderStatus
}

export interface RejectOrderRequestResult {
  success: boolean
  request_id: number
  status: OrderRequestStatus
}

export interface PublicBusinessSettings {
  business_name: string
  business_slug: string
  whatsapp_number: string | null
}

// Shared Staff Order Draft types
export interface StaffOrderItemDraft {
  product_id: number
  design_no: string
  rate: number
  sets: number
  pcs_per_set: number
  total_pcs: number
  line_total: number
  brand?: string
}

export interface StaffOrderHeaderDraft {
  partyName: string
  station: string
  agent: string
  gstNumber: string
  orderDate: string
  exportDate: string
  brand: string
  productName: string
  notes: string
}

export interface StaffOrderDraft extends StaffOrderHeaderDraft {
  items: StaffOrderItemDraft[]
  updatedAt: string
}

// Invoice types (legacy support)
export interface Invoice {
  id: number
  business_id?: number
  invoice_no: string
  party_name: string
  export_date?: string | null
  qr_code_url?: string | null
  total_amount: number
  created_at: string
  updated_at: string
}

export interface InvoiceItem {
  id: number
  business_id?: number
  invoice_id: number
  design_no?: string
  rate?: number
  sets: number
  pcs_per_set: number
  total_pcs: number
  line_total: number
  created_at: string
}

// Public Invoice DTO
export interface PublicInvoice {
  invoice_no: string
  party_name: string
  export_date?: string | null
  total_amount: number
  created_at: string
  business_name: string
  business_slug: string
  items: Array<{
    id: number
    design_no: string
    rate: number
    sets: number
    pcs_per_set: number
    total_pcs: number
    line_total: number
  }>
}

// Inventory types
export interface InventoryLocation {
  id: number
  business_id?: number
  name: string
  description?: string
  created_at: string
}

export interface InventoryStock {
  id: number
  business_id?: number
  product_id: number
  location_id: number
  sets: number
  total_pcs: number
  reserved_sets?: number
  avg_unit_cost?: number
  row_version?: number
  updated_at: string
}

// Stage 2: Variants, Lots, Serialized Takas, Unified Stock Ledger & 3-Way Reconciliation
export type TakaStatus =
  | 'in_stock'
  | 'reserved'
  | 'in_process'
  | 'split'
  | 'dispatched'
  | 'consumed'
  | 'damaged'

export type StockLedgerMovementType =
  | 'OPENING_BALANCE'
  | 'INTAKE'
  | 'PURCHASE_IN'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'DISPATCH'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'JOB_OUT'
  | 'JOB_IN'
  | 'SPLIT_OUT'
  | 'SPLIT_IN'
  | 'PRODUCTION_CONSUME'
  | 'PRODUCTION_OUT'
  | 'ADJUSTMENT'

export interface ProductVariant {
  id: number
  business_id: number
  product_id: number
  sku: string
  color_name?: string | null
  color_code?: string | null
  size_label?: string | null
  rate_override?: number | null
  is_active: boolean
  row_version: number
  created_at: string
  updated_at: string
}

export interface InventoryLot {
  id: number
  business_id: number
  branch_id: number
  product_id: number
  variant_id?: number | null
  lot_no: string
  supplier_party_id?: number | null
  mill_party_id?: number | null
  shade_no?: string | null
  gsm?: number | null
  width_inches?: number | null
  landed_cost_per_unit: number
  received_date: string
  notes?: string | null
  row_version: number
  created_at: string
  updated_at: string
}

export interface InventoryTaka {
  id: number
  business_id: number
  branch_id: number
  lot_id: number
  parent_taka_id?: number | null
  product_id: number
  variant_id?: number | null
  location_id: number
  taka_no: string
  barcode_value?: string | null
  initial_meters: number
  current_meters: number
  weight_kg?: number | null
  status: TakaStatus
  row_version: number
  created_at: string
  updated_at: string
}

export interface TakaSplit {
  id: number
  business_id: number
  parent_taka_id: number
  child_taka_id: number
  meters_allocated: number
  transaction_group_id: string
  created_by: string
  created_at: string
}

export interface StockLedgerEntry {
  id: number
  business_id: number
  branch_id: number
  fy_id: number
  transaction_group_id: string
  reversal_of_id?: number | null
  product_id: number
  variant_id?: number | null
  lot_id?: number | null
  taka_id?: number | null
  location_id: number
  movement_type: StockLedgerMovementType
  movement_date: string
  qty_delta: number
  pcs_delta: number
  uom: InventoryUom
  unit_cost: number
  value_delta: number
  ref_doc_type: string
  ref_doc_id?: number | null
  source_document_line_id?: number | null
  idempotency_key?: string | null
  created_by?: string | null
  posted_at: string
  notes?: string | null
}

export interface IntakeSetStockV2Result {
  success: boolean
  transaction_group_id: string
  product_id: number
  location_id: number
  pcs_per_set: number
  sets: number
  total_pcs: number
  avg_unit_cost: number
  reference_no: string
}

export interface ReceiveTakaLotItemInput {
  taka_no: string
  meters: number
  weight_kg?: number | null
}

export interface ReceiveTakaLotResult {
  success: boolean
  transaction_group_id: string
  lot_id: number
  lot_no: string
  taka_count: number
  total_meters: number
  taka_ids: number[]
}

export interface TransferTakaResult {
  success: boolean
  transaction_group_id: string
  taka_id: number
  from_location_id: number
  to_location_id: number
  meters: number
  unit_cost: number
}

export interface SplitTakaItemInput {
  taka_no: string
  meters: number
}

export interface SplitTakaResult {
  success: boolean
  transaction_group_id: string
  parent_taka_id: number
  child_taka_ids: number[]
}

export interface InventoryIntegrityReport {
  balanced: boolean
  set_mismatches: number
  taka_mismatches: number
  ledger_value: number
  projection_value: number
  value_diff: number
}

export type MovementType = 'INTAKE' | 'TRANSFER' | 'DISPATCH' | 'ADJUSTMENT'

export interface StockMovement {
  id: number
  business_id?: number
  product_id: number
  from_location_id?: number | null
  to_location_id?: number | null
  sets: number
  total_pcs: number
  notes?: string | null
  reference_no?: string | null
  staff_name?: string | null
  movement_type?: MovementType
  created_at: string
}

export interface IntakeStockResult {
  success: boolean
  product_id: number
  location_id: number
  pcs_per_set: number
  sets: number
  total_pcs: number
  reference_no: string
}

export interface TransferStockResult {
  success: boolean
  reference_no: string
  pcs_per_set: number
  transferred_sets: number
  transferred_pcs: number
}

export interface ConfirmOrderResult {
  success: boolean
  order_no: string
  status: OrderStatus
}

// Party & Agent Directory Types
export interface Party {
  id: number
  business_id?: number
  name: string
  station?: string | null
  gst_number?: string | null
  phone?: string | null
  address?: string | null
  created_at: string
  updated_at: string
}

export interface Agent {
  id: number
  business_id?: number
  name: string
  phone?: string | null
  station?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// Operational Dashboard summary
export interface DashboardStats {
  total_products: number
  active_products: number
  godown_sets: number
  godown_pcs: number
  shop_sets: number
  shop_pcs: number
  total_orders: number
  confirmed_orders: number
  draft_orders: number
}

// Inquiry types
export interface Inquiry {
  id: number
  business_id?: number
  customer_name: string
  phone: string
  design_no?: string
  message?: string
  status: 'pending' | 'quoted' | 'completed'
  admin_response?: string
  quoted_price?: number
  created_at: string
  updated_at: string
}

// Admin settings
export interface AdminSettings {
  id: number
  business_id?: number
  whatsapp_number?: string
  created_at: string
  updated_at: string
}


// Stage 3: Kala Finance / Accounting Core types
export type AccountGroup = 'asset' | 'liability' | 'equity' | 'income' | 'expense'
export type BalanceType = 'DR' | 'CR'
export type VoucherType =
  | 'SALES'
  | 'PURCHASE'
  | 'SALES_RETURN'
  | 'PURCHASE_RETURN'
  | 'RECEIPT'
  | 'PAYMENT'
  | 'JOURNAL'
  | 'CONTRA'
  | 'REVERSAL'
export type VoucherStatus = 'draft' | 'posted'

export interface Account {
  id: number
  business_id: number
  code: string
  name: string
  account_group: AccountGroup
  sub_group?: string | null
  party_id?: number | null
  opening_balance: number
  opening_balance_type: BalanceType
  is_system: boolean
  is_active: boolean
  row_version: number
  created_at: string
  updated_at: string
}

export interface CostCenter {
  id: number
  business_id: number
  code: string
  name: string
  is_active: boolean
  row_version: number
  created_at: string
  updated_at: string
}

export interface Voucher {
  id: number
  business_id: number
  branch_id: number
  fy_id: number
  voucher_no: string
  voucher_type: VoucherType
  voucher_date: string
  currency_code: string
  exchange_rate: number
  party_id?: number | null
  ref_doc_type?: string | null
  ref_doc_id?: number | null
  reversed_voucher_id?: number | null
  narration?: string | null
  total_amount: number
  base_total_amount: number
  status: VoucherStatus
  idempotency_key?: string | null
  created_by: string
  posted_at?: string | null
  created_at: string
}

export interface VoucherEntry {
  id: number
  business_id: number
  voucher_id: number
  account_id: number
  cost_center_id?: number | null
  party_id?: number | null
  debit: number
  credit: number
  base_debit: number
  base_credit: number
  line_narration?: string | null
}

export interface VoucherEntryInput {
  account_id: number
  debit: number
  credit: number
  cost_center_id?: number | null
  party_id?: number | null
  narration?: string | null
}

export interface BillAllocation {
  id: number
  business_id: number
  party_id: number
  invoice_voucher_id: number
  settlement_voucher_id: number
  allocated_amount: number
  currency_code: string
  allocation_date: string
  idempotency_key?: string | null
  created_by: string
  created_at: string
}

export interface PostVoucherResult {
  success: boolean
  voucher_id: number
  voucher_no: string
  voucher_type: VoucherType
  fy_id: number
  party_id?: number | null
  total_amount: number
  base_total_amount: number
  status: VoucherStatus
}

export interface ReverseVoucherResult {
  success: boolean
  reversal_voucher_id: number
  reversal_voucher_no: string
  reversed_voucher_id: number
  party_id?: number | null
  status: VoucherStatus
}

export interface AllocateBillPaymentResult {
  success: boolean
  allocation_id: number
  party_id: number
  invoice_voucher_id: number
  settlement_voucher_id: number
  allocated_amount: number
  currency_code: string
  invoice_remaining: number
  settlement_remaining: number
}

export interface OpeningBalanceReport {
  balanced: boolean
  total_debit: number
  total_credit: number
  diff: number
}

export interface TrialBalanceReport {
  balanced: boolean
  fy_id: number
  voucher_count: number
  total_debit: number
  total_credit: number
  diff: number
}

export interface CloseFinancialYearResult {
  success: boolean
  fy_id: number
  label: string
  is_locked: boolean
  net_profit: number
  closing_voucher_id: number | null
  closing_voucher_no: string | null
}
