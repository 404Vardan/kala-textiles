import { useEffect, useState } from 'react'

const ADMIN_KEY = 'rangoli_admin_access'
const EXPIRY_KEY = 'rangoli_admin_expiry'
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

export function isAdminAuthenticated(): boolean {
  return true
}

export function setAdminAccess() {
// Admin access always true, no need to set
}

export function clearAdminAccess() {
// Admin access always true, no need to clear
}

export function useAdminAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setIsAuthenticated(true)
    setLoading(false)
  }, [])

  const login = () => {
    // setAdminAccess()
    setIsAuthenticated(true)
  }

  const logout = () => {
    // clearAdminAccess()
    setIsAuthenticated(false)
  }

  return {
    isAuthenticated,
    loading,
    login,
    logout,
  }
}
