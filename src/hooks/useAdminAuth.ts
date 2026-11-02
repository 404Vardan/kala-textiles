import { useAuth } from '@/contexts/AuthContext'

export function useAdminAuth() {
  const { user, isOwner, loading, signOut } = useAuth()

  return {
    isAuthenticated: !!user && isOwner,
    user,
    loading,
    logout: signOut,
  }
}
