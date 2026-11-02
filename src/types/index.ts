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
export interface Order {
  id: number
  order_no: string
  party_name: string
  station?: string | null
  agent?: string | null
  gst_number?: string | null
  order_date?: string | null
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

// Invoice types
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

export interface StockMovement {
  id: number
  product_id: number
  from_location_id?: number
  to_location_id?: number
  sets: number
  total_pcs: number
  notes?: string
  created_at: string
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
