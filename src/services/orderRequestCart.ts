import type { OrderRequestCartItem } from '@/types'

const CART_KEY_PREFIX = 'rangoli:order-request-cart:'
export const ORDER_REQUEST_CART_EVENT = 'rangoli:order-request-cart-updated'

function normalizeSlug(slug?: string): string {
  return (slug || 'rangoli').trim().toLowerCase() || 'rangoli'
}

function getStorageKey(slug?: string): string {
  return `${CART_KEY_PREFIX}${normalizeSlug(slug)}`
}

export function clampRequestSets(sets: number): number {
  const parsed = Number.isFinite(sets) ? Math.floor(sets) : 1
  return Math.max(1, Math.min(500, parsed))
}

function notifyCartUpdated(slug: string) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(
      new CustomEvent(ORDER_REQUEST_CART_EVENT, {
        detail: { slug: normalizeSlug(slug) },
      })
    )
  } catch {
    // Ignore event dispatch errors in restricted environments
  }
}

export function getOrderRequestCart(slug: string = 'rangoli'): OrderRequestCartItem[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(getStorageKey(slug))
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const cleaned: OrderRequestCartItem[] = []
    const seen = new Map<string, number>()

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const designNo = typeof item.design_no === 'string' ? item.design_no.trim() : ''
      const rawSets = Number(item.sets)
      if (!designNo || !Number.isFinite(rawSets) || rawSets < 1) continue

      const normKey = designNo.toUpperCase()
      const existingIdx = seen.get(normKey)
      if (existingIdx !== undefined) {
        cleaned[existingIdx].sets = clampRequestSets(cleaned[existingIdx].sets + rawSets)
      } else {
        seen.set(normKey, cleaned.length)
        cleaned.push({
          design_no: designNo,
          sets: clampRequestSets(rawSets),
        })
      }
    }

    return cleaned
  } catch {
    return []
  }
}

function saveOrderRequestCart(slug: string, items: OrderRequestCartItem[]): OrderRequestCartItem[] {
  const cleanSlug = normalizeSlug(slug)
  if (typeof window === 'undefined') return items

  try {
    if (items.length === 0) {
      window.localStorage.removeItem(getStorageKey(cleanSlug))
    } else {
      window.localStorage.setItem(getStorageKey(cleanSlug), JSON.stringify(items))
    }
  } catch {
    // Ignore localStorage quota / private browsing errors
  }

  notifyCartUpdated(cleanSlug)
  return items
}

export function addToOrderRequestCart(
  slug: string,
  designNo: string,
  setsToAdd: number = 1
): OrderRequestCartItem[] {
  const cleanDesign = (designNo || '').trim()
  if (!cleanDesign) return getOrderRequestCart(slug)

  const clampedAdd = clampRequestSets(setsToAdd)
  const current = getOrderRequestCart(slug)
  const normKey = cleanDesign.toUpperCase()

  const idx = current.findIndex((i) => i.design_no.trim().toUpperCase() === normKey)
  if (idx >= 0) {
    current[idx] = {
      design_no: current[idx].design_no,
      sets: clampRequestSets(current[idx].sets + clampedAdd),
    }
  } else {
    current.push({
      design_no: cleanDesign,
      sets: clampedAdd,
    })
  }

  return saveOrderRequestCart(slug, current)
}

export function updateOrderRequestCartItemSets(
  slug: string,
  designNo: string,
  sets: number
): OrderRequestCartItem[] {
  const cleanDesign = (designNo || '').trim()
  if (!cleanDesign) return getOrderRequestCart(slug)

  const current = getOrderRequestCart(slug)
  const normKey = cleanDesign.toUpperCase()
  const idx = current.findIndex((i) => i.design_no.trim().toUpperCase() === normKey)

  if (idx < 0) return current

  current[idx] = {
    ...current[idx],
    sets: clampRequestSets(sets),
  }

  return saveOrderRequestCart(slug, current)
}

export function removeFromOrderRequestCart(
  slug: string,
  designNo: string
): OrderRequestCartItem[] {
  const cleanDesign = (designNo || '').trim().toUpperCase()
  const current = getOrderRequestCart(slug)
  const next = current.filter((i) => i.design_no.trim().toUpperCase() !== cleanDesign)
  return saveOrderRequestCart(slug, next)
}

export function clearOrderRequestCart(slug: string = 'rangoli'): void {
  saveOrderRequestCart(slug, [])
}

export function getOrderRequestCartSummary(slug: string = 'rangoli'): {
  items: OrderRequestCartItem[]
  totalDesigns: number
  totalSets: number
} {
  const items = getOrderRequestCart(slug)
  const totalDesigns = items.length
  const totalSets = items.reduce((sum, item) => sum + item.sets, 0)
  return {
    items,
    totalDesigns,
    totalSets,
  }
}

