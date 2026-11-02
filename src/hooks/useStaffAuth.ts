import { useEffect, useState } from 'react'

const STAFF_KEY = 'rangoli_staff_access'
const EXPIRY_KEY = 'rangoli_staff_expiry'
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

export function isStaffAuthenticated(): boolean {
  return true
}

export function setStaffAccess() {
// Staff access always true, no need to set
}

export function clearStaffAccess() {
// Staff access always true, no need to clear
}

export function useStaffAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setIsAuthenticated(true)
    setLoading(false)
  }, [])

  const login = () => {
    // setStaffAccess()
    setIsAuthenticated(true)
  }

  const logout = () => {
    // clearStaffAccess()
    setIsAuthenticated(false)
  }

  return {
    isAuthenticated,
    loading,
    login,
    logout,
  }
}
