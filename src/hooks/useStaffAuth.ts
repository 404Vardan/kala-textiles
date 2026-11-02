import { useEffect, useState } from 'react'
import supabase from '@/services/supabase'

const STAFF_KEY = 'rangoli_staff_access'
const EXPIRY_KEY = 'rangoli_staff_expiry'
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

export function isStaffAuthenticated(): boolean {
  try {
    const access = localStorage.getItem(STAFF_KEY)
    const expiry = localStorage.getItem(EXPIRY_KEY)
    if (!access || !expiry) return false
    if (Date.now() > parseInt(expiry, 10)) {
      clearStaffAccess()
      return false
    }
    return access === 'true'
  } catch {
    return false
  }
}

export function setStaffAccess() {
  try {
    localStorage.setItem(STAFF_KEY, 'true')
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + TWELVE_HOURS_MS))
  } catch {}
}

export function clearStaffAccess() {
  try {
    localStorage.removeItem(STAFF_KEY)
    localStorage.removeItem(EXPIRY_KEY)
  } catch {}
}

export async function verifyStaffPassword(password: string): Promise<boolean> {
  try {
    // Try secure RPC first
    const { data, error } = await supabase.rpc('verify_staff_password', {
      p_password: password,
    })
    if (!error && typeof data === 'boolean') {
      return data
    }
  } catch {}

  // Fallback check against admin_settings if RPC isn't deployed yet
  try {
    const { data: settings } = await supabase
      .from('admin_settings')
      .select('staff_password')
      .limit(1)
      .single()

    if (settings && settings.staff_password) {
      return password === settings.staff_password
    }
  } catch {}

  // Final fallback to default initial staff password
  return password === 'staff123'
}

export function useStaffAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => isStaffAuthenticated())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setIsAuthenticated(isStaffAuthenticated())
    setLoading(false)
  }, [])

  const login = () => {
    setStaffAccess()
    setIsAuthenticated(true)
  }

  const logout = () => {
    clearStaffAccess()
    setIsAuthenticated(false)
  }

  return {
    isAuthenticated,
    loading,
    login,
    logout,
  }
}
