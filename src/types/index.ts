// Product types
export interface Product {
  id: number
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
  product_id: number
  media_url: string
  media_type: 'image' | 'video'
  sort_order: number
  created_at: string
}

// Order types
export type OrderStatus = 'draft' | 'confirmed' | 'cancelled'

export interface Order {
  id: number
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

// Invoice types (legacy support)
export interface Invoice {
  id: number
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
  invoice_id: number
  design_no?: string
  rate?: number
  sets: number
  pcs_per_set: number
  total_pcs: number
  line_total: number
  created_at: string
}

// Inventory types
export interface InventoryLocation {
  id: number
  name: string
  description?: string
  created_at: string
}

export interface InventoryStock {
  id: number
  product_id: number
  location_id: number
  sets: number
  total_pcs: number
  updated_at: string
}

export type MovementType = 'INTAKE' | 'TRANSFER' | 'DISPATCH' | 'ADJUSTMENT'

export interface StockMovement {
  id: number
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
  password_hash: string
  staff_password?: string
  whatsapp_number?: string
  created_at: string
  updated_at: string
}
