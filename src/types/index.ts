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
  created_at: string
  business?: Business
}

// Product types
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
  updated_at: string
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
