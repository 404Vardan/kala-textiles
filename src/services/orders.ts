import supabase from './supabase'
import type { Order, OrderItem, OrderStatus } from '@/types'

// Orders CRUD
export async function fetchOrders(options?: {
  limit?: number
  status?: OrderStatus | 'all'
  search?: string
}): Promise<Order[]> {
  const limit = options?.limit || 100
  let query = supabase.from('orders').select('*')

  if (options?.status && options.status !== 'all') {
    query = query.eq('status', options.status)
  }

  if (options?.search && options.search.trim()) {
    const s = options.search.trim()
    query = query.or(`order_no.ilike.%${s}%,party_name.ilike.%${s}%,station.ilike.%${s}%,agent.ilike.%${s}%,gst_number.ilike.%${s}%`)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as Order[]
}

export async function fetchOrder(id: number): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Order
}

export async function fetchOrderByNo(orderNo: string): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('order_no', orderNo)
    .single()

  if (error) throw error
  return data as Order
}

export async function fetchPublicOrder(slug: string = 'rangoli', orderNo: string): Promise<import('@/types').PublicOrder> {
  try {
    const { data, error } = await supabase.rpc('get_public_order', {
      p_slug: slug,
      p_order_no: orderNo,
    })

    if (!error && data) {
      return data as import('@/types').PublicOrder
    }
  } catch (err) {
    console.warn('get_public_order RPC failed, falling back to direct queries:', err)
  }

  // Graceful fallback
  const order = await fetchOrderByNo(orderNo)
  const items = await fetchOrderItems(order.id)
  return {
    order_no: order.order_no,
    party_name: order.party_name,
    station: order.station,
    agent: order.agent,
    gst_number: order.gst_number,
    order_date: order.order_date,
    export_date: order.export_date,
    brand: order.brand,
    product_name: order.product_name,
    notes: order.notes,
    status: order.status,
    total_amount: order.total_amount,
    created_at: order.created_at,
    confirmed_at: order.confirmed_at,
    business_name: 'Rangoli Textiles',
    business_slug: slug,
    items: items.map(item => ({
      id: item.id,
      design_no: item.design_no || '',
      rate: item.rate || 0,
      sets: item.sets,
      pcs_per_set: item.pcs_per_set,
      total_pcs: item.total_pcs,
      line_total: item.line_total,
    }))
  }
}

export async function generateOrderNo(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('generate_order_no')
    if (!error && data) return data as string
  } catch {}

  // Fallback client generation
  const year = new Date().getFullYear()
  const randomSeq = Math.floor(1000 + Math.random() * 9000)
  return `RNG-${year}-${randomSeq}`
}

export async function createOrder(order: Omit<Order, 'id' | 'created_at' | 'updated_at'>): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .insert([{
      ...order,
      status: order.status || 'draft',
    }])
    .select()

  if (error) throw error
  return data[0] as Order
}

export async function updateOrder(id: number, updates: Partial<Order>): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as Order
}

export async function updateOrderStatus(id: number, status: OrderStatus): Promise<Order> {
  return updateOrder(id, { status })
}

export async function deleteOrder(id: number): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Order Items CRUD
export async function fetchOrderItems(orderId: number): Promise<OrderItem[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('id', { ascending: true })

  if (error) throw error
  return data as OrderItem[]
}

export async function createOrderItem(item: Omit<OrderItem, 'id' | 'created_at'>): Promise<OrderItem> {
  const { data, error } = await supabase
    .from('order_items')
    .insert([item])
    .select()

  if (error) throw error
  return data[0] as OrderItem
}

export async function createOrderItemBatch(items: Array<Omit<OrderItem, 'id' | 'created_at'>>): Promise<OrderItem[]> {
  const { data, error } = await supabase
    .from('order_items')
    .insert(items)
    .select()

  if (error) throw error
  return data as OrderItem[]
}

export async function deleteOrderItem(id: number): Promise<void> {
  const { error } = await supabase
    .from('order_items')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function deleteOrderItemsByOrderId(orderId: number): Promise<void> {
  const { error } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', orderId)

  if (error) throw error
}

// Create order with items in one flow
export async function createOrderWithItems(
  orderData: Omit<Order, 'id' | 'created_at' | 'updated_at'>,
  items: Array<Omit<OrderItem, 'id' | 'created_at' | 'order_id'>>
): Promise<Order> {
  // Create order first
  const order = await createOrder(orderData)

  // Create items linked to order
  if (items.length > 0) {
    const itemsWithOrderId = items.map(item => ({
      ...item,
      order_id: order.id,
    }))
    await createOrderItemBatch(itemsWithOrderId)
  }

  return order
}

// Duplicate an existing order
export async function duplicateOrder(sourceOrderId: number): Promise<Order> {
  const sourceOrder = await fetchOrder(sourceOrderId)
  const sourceItems = await fetchOrderItems(sourceOrderId)

  const newOrderNo = await generateOrderNo()

  const duplicated = await createOrderWithItems(
    {
      order_no: newOrderNo,
      party_name: sourceOrder.party_name,
      station: sourceOrder.station,
      agent: sourceOrder.agent,
      gst_number: sourceOrder.gst_number,
      order_date: new Date().toISOString().split('T')[0],
      export_date: sourceOrder.export_date,
      brand: sourceOrder.brand,
      product_name: sourceOrder.product_name,
      notes: sourceOrder.notes ? `Duplicated from ${sourceOrder.order_no}: ${sourceOrder.notes}` : `Duplicated from ${sourceOrder.order_no}`,
      status: 'draft',
      total_amount: sourceOrder.total_amount,
    },
    sourceItems.map(item => ({
      product_id: item.product_id,
      design_no: item.design_no,
      rate: item.rate,
      sets: item.sets,
      pcs_per_set: item.pcs_per_set,
      total_pcs: item.total_pcs,
      line_total: item.line_total,
    }))
  )

  return duplicated
}
