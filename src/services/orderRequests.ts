import supabase from './supabase'
import type {
  ConvertOrderRequestResult,
  OrderRequest,
  OrderRequestCartItem,
  OrderRequestStatus,
  RejectOrderRequestResult,
} from '@/types'

export interface SubmitOrderRequestInput {
  slug: string
  partyName: string
  phone: string
  items: OrderRequestCartItem[]
  note?: string
}

/**
 * Submits a customer order request through the secured public RPC `submit_order_request`.
 * Returns the newly created request ID.
 */
export async function submitOrderRequest(input: SubmitOrderRequestInput): Promise<number> {
  const cleanSlug = (input.slug || 'rangoli').trim().toLowerCase() || 'rangoli'
  const cleanPartyName = (input.partyName || '').trim()
  const cleanPhone = (input.phone || '').trim()
  const cleanNote = (input.note || '').trim()

  const payloadItems = (input.items || []).map((item) => ({
    design_no: item.design_no.trim(),
    sets: Math.max(1, Math.min(500, Math.floor(Number(item.sets) || 1))),
  }))

  const rpcArgs: Record<string, any> = {
    p_slug: cleanSlug,
    p_party_name: cleanPartyName,
    p_phone: cleanPhone,
    p_items: payloadItems,
  }

  if (cleanNote) {
    rpcArgs.p_note = cleanNote
  }

  const { data, error } = await supabase.rpc('submit_order_request', rpcArgs)

  if (error) {
    throw new Error(error.message || 'Failed to submit order request to the shop')
  }

  const requestId = Number(data)
  if (!Number.isFinite(requestId) || requestId <= 0) {
    throw new Error('Shop did not return a valid order request reference')
  }

  return requestId
}

/**
 * Fetches order requests for the authenticated user's active business.
 */
export async function fetchOrderRequests(
  statusFilter?: OrderRequestStatus
): Promise<OrderRequest[]> {
  let query = supabase
    .from('order_requests')
    .select(
      `
      id,
      business_id,
      party_name,
      phone,
      status,
      note,
      created_at,
      items:order_request_items (
        request_id,
        product_id,
        sets,
        product:products (
          id,
          design_no,
          brand,
          collection_name,
          fabric,
          rate,
          pcs_per_set,
          image_url,
          is_active
        )
      )
    `
    )
    .order('created_at', { ascending: false })

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message || 'Failed to load buyer order requests')
  }

  return ((data || []) as any[]).map((row) => ({
    id: row.id,
    business_id: row.business_id,
    party_name: row.party_name,
    phone: row.phone,
    status: row.status,
    note: row.note,
    created_at: row.created_at,
    items: Array.isArray(row.items)
      ? row.items.map((item: any) => ({
          request_id: item.request_id,
          product_id: item.product_id,
          sets: item.sets,
          product: Array.isArray(item.product) ? item.product[0] || null : item.product || null,
        }))
      : [],
  }))
}

/**
 * Atomically converts a pending buyer order request into a draft order via `convert_order_request`.
 */
export async function convertOrderRequest(requestId: number): Promise<ConvertOrderRequestResult> {
  const { data, error } = await supabase.rpc('convert_order_request', {
    p_request_id: requestId,
  })

  if (error) {
    throw new Error(error.message || 'Failed to convert order request into a draft order')
  }

  if (!data) {
    throw new Error('Order request conversion returned an empty response')
  }

  return data as ConvertOrderRequestResult
}

/**
 * Marks a pending buyer order request as rejected via `reject_order_request`.
 */
export async function rejectOrderRequest(requestId: number): Promise<RejectOrderRequestResult> {
  const { data, error } = await supabase.rpc('reject_order_request', {
    p_request_id: requestId,
  })

  if (error) {
    throw new Error(error.message || 'Failed to reject order request')
  }

  if (!data) {
    throw new Error('Reject order request returned an empty response')
  }

  return data as RejectOrderRequestResult
}

