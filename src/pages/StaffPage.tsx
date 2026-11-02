import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { StaffPasswordModal } from '@/components/admin/StaffPasswordModal'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import OrderTab from '@/components/admin/OrderTab'
import { LogOut, ShoppingCart } from 'lucide-react'

export default function StaffPage() {
  const { isAuthenticated, login, logout } = useStaffAuth()
  const [showPassword, setShowPassword] = useState(!isAuthenticated)
  const navigate = useNavigate()

  const handlePasswordSuccess = () => {
    login()
    setShowPassword(false)
  }

  const handleLogout = () => {
    logout()
    setShowPassword(true)
    navigate('/')
  }

  if (showPassword) {
    return <StaffPasswordModal isOpen={true} onSuccess={handlePasswordSuccess} onClose={() => navigate('/')} />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-orange-600 to-rose-600 bg-clip-text text-transparent">
              Rangoli Textiles
            </h1>
            <p className="text-xs text-gray-500 hidden sm:block">Staff Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white border rounded-lg p-1 shadow-sm mb-6 flex items-center gap-2 px-4 py-3">
          <ShoppingCart className="w-5 h-5 text-orange-600" />
          <h2 className="font-semibold text-gray-700">Orders</h2>
        </div>
        
        {/* Render OrderTab with isStaff flag to disable editing/deleting */}
        <OrderTab isStaff={true} />
      </main>
    </div>
  )
}
