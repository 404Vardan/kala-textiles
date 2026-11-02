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
  from_location_id?: number
  to_location_id?: number
  sets: number
  total_pcs: number
  notes?: string
  reference_no?: string
  staff_name?: string
  movement_type?: MovementType
  created_at: string
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
