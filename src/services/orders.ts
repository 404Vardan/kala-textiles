import supabase from './supabase'
import type { Order, OrderItem } from '@/types'

// Orders CRUD
export async function fetchOrders(limit = 100) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as Order[]
}

export async function fetchOrder(id: number) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Order
}

export async function fetchOrderByNo(orderNo: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('order_no', orderNo)
    .single()

  if (error) throw error
  return data as Order
}

export async function generateOrderNo(): Promise<string> {
  const { data, error } = await supabase.rpc('generate_order_no')
  if (error) throw error
  return data as string
}

export async function createOrder(order: Omit<Order, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('orders')
    .insert([order])
    .select()

  if (error) throw error
  return data[0] as Order
}

export async function updateOrder(id: number, updates: Partial<Order>) {
  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select()

  if (error) throw error
  return data[0] as Order
}

export async function deleteOrder(id: number) {
  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Order Items CRUD
export async function fetchOrderItems(orderId: number) {
  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data as OrderItem[]
}

export async function createOrderItem(item: Omit<OrderItem, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('order_items')
    .insert([item])
    .select()

  if (error) throw error
  return data[0] as OrderItem
}

export async function createOrderItemBatch(items: Array<Omit<OrderItem, 'id' | 'created_at'>>) {
  const { data, error } = await supabase
    .from('order_items')
    .insert(items)
    .select()

  if (error) throw error
  return data as OrderItem[]
}

export async function deleteOrderItem(id: number) {
  const { error } = await supabase
    .from('order_items')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function deleteOrderItemsByOrderId(orderId: number) {
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
) {
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
