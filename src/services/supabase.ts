import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const SESSION_BIZ_KEY = 'kala:active-business-id'
const LAST_BIZ_KEY = 'kala:last-business-id'

let activeBusinessIdMemory: number | null = null

export function getActiveBusinessId(): number | null {
  if (activeBusinessIdMemory !== null) return activeBusinessIdMemory
  if (typeof window === 'undefined') return null

  try {
    const raw =
      window.sessionStorage.getItem(SESSION_BIZ_KEY) ||
      window.localStorage.getItem(LAST_BIZ_KEY)
    if (raw && /^[0-9]+$/.test(raw)) {
      activeBusinessIdMemory = Number(raw)
      return activeBusinessIdMemory
    }
  } catch {
    // Storage unavailable
  }
  return null
}

export function setActiveBusinessId(businessId: number | null): void {
  activeBusinessIdMemory = businessId
  if (typeof window === 'undefined') return

  try {
    if (businessId === null) {
      window.sessionStorage.removeItem(SESSION_BIZ_KEY)
      window.localStorage.removeItem(LAST_BIZ_KEY)
    } else {
      const serialized = String(businessId)
      window.sessionStorage.setItem(SESSION_BIZ_KEY, serialized)
      window.localStorage.setItem(LAST_BIZ_KEY, serialized)
    }
  } catch {
    // Storage unavailable
  }
}

function shouldAttachBusinessHeader(input: RequestInfo | URL): boolean {
  try {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const parsed = new URL(rawUrl, supabaseUrl)
    return (
      parsed.pathname.startsWith('/rest/v1/') ||
      parsed.pathname.startsWith('/functions/v1/')
    )
  } catch {
    return false
  }
}

/**
 * Custom fetch wrapper injecting the tab-scoped `x-business-id` header
 * strictly on `/rest/v1/` and `/functions/v1/` requests so Auth (`/auth/v1/`)
 * and Storage (`/storage/v1/`) CORS/preflight flows remain unaffected.
 */
const tenantScopedFetch: typeof fetch = (input, init) => {
  const bizId = getActiveBusinessId()
  if (bizId === null || !shouldAttachBusinessHeader(input)) {
    return fetch(input, init)
  }

  const headers = new Headers(init?.headers)
  if (!headers.has('x-business-id')) {
    headers.set('x-business-id', String(bizId))
  }
  return fetch(input, { ...init, headers })
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: tenantScopedFetch,
  },
})

export default supabase
