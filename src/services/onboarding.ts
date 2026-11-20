import supabase from './supabase'
import type { Business } from '@/types'

export const RESERVED_SLUGS = new Set([
  'admin',
  'login',
  'signup',
  'api',
  'p',
  'order',
  'invoice',
  'staff',
  'reset-password',
  'order-request',
  'auth',
  'settings',
  'www',
  'app',
])

export interface SlugAvailabilityResult {
  available: boolean
  slug: string
  reason: string | null
}

export function slugifyBusinessName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export async function checkSlugAvailable(slug: string): Promise<SlugAvailabilityResult> {
  const clean = slug.trim().toLowerCase()
  if (clean.length < 2 || clean.length > 48) {
    return {
      available: false,
      slug: clean,
      reason: 'Slug must be between 2 and 48 characters.',
    }
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) {
    return {
      available: false,
      slug: clean,
      reason: 'Slug may only contain lowercase letters, numbers, and single hyphens.',
    }
  }

  if (RESERVED_SLUGS.has(clean)) {
    return {
      available: false,
      slug: clean,
      reason: 'This URL slug is reserved.',
    }
  }

  const { data, error } = await supabase.rpc('check_slug_available', {
    p_slug: clean,
  })

  if (error) {
    throw new Error(error.message || 'Unable to check slug availability.')
  }

  return data as SlugAvailabilityResult
}

export interface CreateBusinessInput {
  name: string
  slug: string
  gstin?: string
  address?: string
}

export async function createBusiness(input: CreateBusinessInput): Promise<Business> {
  const settings: Record<string, string> = {}
  if (input.gstin?.trim()) settings.gstin = input.gstin.trim().toUpperCase()
  if (input.address?.trim()) settings.address = input.address.trim()

  const { data, error } = await supabase.rpc('create_business', {
    name: input.name.trim(),
    slug: input.slug.trim().toLowerCase(),
    settings,
  })

  if (error) {
    throw new Error(error.message || 'Failed to create business.')
  }

  return data as Business
}
