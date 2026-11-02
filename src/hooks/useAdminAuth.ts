import { useEffect, useState } from 'react'
import supabase from '@/services/supabase'

const ADMIN_KEY = 'rangoli_admin_access'
const EXPIRY_KEY = 'rangoli_admin_expiry'
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

export function isAdminAuthenticated(): boolean {
  try {
    const access = localStorage.getItem(ADMIN_KEY)
    const expiry = localStorage.getItem(EXPIRY_KEY)
    if (!access || !expiry) return false
    if (Date.now() > parseInt(expiry, 10)) {
      clearAdminAccess()
      return false
    }
    return access === 'true'
  } catch {
    return false
  }
}

export function setAdminAccess() {
  try {
    localStorage.setItem(ADMIN_KEY, 'true')
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + TWELVE_HOURS_MS))
  } catch {}
}

export function clearAdminAccess() {
  try {
    localStorage.removeItem(ADMIN_KEY)
    localStorage.removeItem(EXPIRY_KEY)
  } catch {}
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  try {
    // Try secure RPC first
    const { data, error } = await supabase.rpc('verify_admin_password', {
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
      .select('password_hash')
      .limit(1)
      .single()

    if (settings && settings.password_hash) {
      return password === settings.password_hash
    }
  } catch {}

  // Final fallback to default initial password
  return password === 'admin123'
}

export function useAdminAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => isAdminAuthenticated())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setIsAuthenticated(isAdminAuthenticated())
    setLoading(false)
  }, [])

  const login = () => {
    setAdminAccess()
    setIsAuthenticated(true)
  }

  const logout = () => {
    clearAdminAccess()
    setIsAuthenticated(false)
  }

  return {
    isAuthenticated,
    loading,
    login,
    logout,
  }
}
