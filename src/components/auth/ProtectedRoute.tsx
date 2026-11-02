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
    hasMultipleMemberships,
    membershipError,
    signOut,
  } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-500">Verifying session credentials...</p>
        </div>
      </div>
    )
  }

  // Not logged in
  if (!user) {
    return <Navigate to={`/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  // Role and single-tenant membership verification
  if ((requiredRole === 'owner' && !isOwner) || (requiredRole === 'staff' && !isStaff)) {
    const title = hasMultipleMemberships
      ? 'Multiple Business Memberships Detected'
      : !role
      ? 'Business Membership Required'
      : 'Administrative Access Required'

    const description = hasMultipleMemberships
      ? membershipError ||
        'Your account is linked to multiple businesses. Database tenancy requires a single unambiguous business membership.'
      : !role
      ? membershipError ||
        'Your account does not have an active staff or owner membership for this business.'
      : `Your account is registered with the ${role} role. Access to the executive management dashboard is restricted to Business Owners.`

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-black text-slate-900">{title}</h1>
        <p className="text-slate-500 text-sm max-w-md mt-2 mb-6">{description}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {isStaff && requiredRole === 'owner' && (
            <Button onClick={() => (window.location.href = '/staff')} className="bg-slate-900 text-white">
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
            <LogOut className="w-4 h-4 mr-1.5" /> Sign Out
          </Button>
          <Button variant="outline" onClick={() => (window.location.href = '/')}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Return Home
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
