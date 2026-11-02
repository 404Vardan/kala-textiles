import { useAuth } from '@/contexts/AuthContext'

export function useStaffAuth() {
  const { user, isStaff, loading, signOut } = useAuth()

  return {
    isAuthenticated: !!user && isStaff,
    user,
    loading,
    logout: signOut,
  }
}
