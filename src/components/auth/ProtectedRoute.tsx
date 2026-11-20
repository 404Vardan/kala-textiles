import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types'
import { ShieldAlert, ArrowLeft, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: UserRole
}

export default function ProtectedRoute({ children, requiredRole = 'staff' }: ProtectedRouteProps) {
  const {
    user,
    role,
    loading,
    isOwner,
    isStaff,
    membershipError,
    signOut,
  } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F4F5F7]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#E3E5EA] border-t-[#1E2A4A] rounded-full animate-spin" />
          <p className="text-sm font-medium text-[#667085]">Verifying session credentials...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to={`/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  if ((requiredRole === 'owner' && !isOwner) || (requiredRole === 'staff' && !isStaff)) {
    const title = !role
      ? 'Business Membership Required'
      : 'Administrative Access Required'

    const description = !role
      ? membershipError ||
        'Your account does not have an active staff or owner membership for this business.'
      : `Your account is registered with the ${role} role for the active business. Owner access is required for this section.`

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F4F5F7] px-4 text-center">
        <div className="bg-white border border-[#E3E5EA] rounded-[6px] p-6 max-w-md w-full space-y-4">
          <div className="flex justify-center text-[#B42318]">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-[#1A1D24]">{title}</h1>
            <p className="text-xs text-[#667085] leading-relaxed">{description}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {isStaff && requiredRole === 'owner' && (
              <Button onClick={() => (window.location.href = '/staff')}>
                Go to Staff Terminal
              </Button>
            )}
            <Button
              variant="outline"
              onClick={async () => {
                await signOut()
                window.location.href = '/login'
              }}
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </Button>
            <Button variant="outline" onClick={() => (window.location.href = '/')}>
              <ArrowLeft className="w-4 h-4" />
              <span>Return Home</span>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
