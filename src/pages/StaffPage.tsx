import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StaffPasswordModal } from '@/components/admin/StaffPasswordModal'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import OrderTab from '@/components/admin/OrderTab'
import ShopScanTab from '@/components/admin/ShopScanTab'
import { LogOut, ShoppingCart, ScanLine, Smartphone } from 'lucide-react'

export default function StaffPage() {
  const { isAuthenticated, login, logout } = useStaffAuth()
  const [showPassword, setShowPassword] = useState(!isAuthenticated)
  const [activeTab, setActiveTab] = useState('orders')
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
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center text-white font-black text-sm">
              R
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                Rangoli Textiles
              </h1>
              <span className="text-[11px] font-bold text-orange-600 inline-flex items-center gap-1">
                <Smartphone className="w-3 h-3" /> Staff Mobile Terminal
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="text-slate-600 hover:text-rose-600 text-xs font-semibold"
            >
              <LogOut className="w-4 h-4 mr-1" />
              Exit
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
          <TabsList className="w-full grid grid-cols-2 bg-white border border-slate-200 p-1 rounded-xl shadow-2xs">
            <TabsTrigger
              value="orders"
              className="flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg data-[state=active]:bg-slate-900 data-[state=active]:text-white text-slate-600"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Orders & Drafting</span>
            </TabsTrigger>
            <TabsTrigger
              value="scanner"
              className="flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg data-[state=active]:bg-slate-900 data-[state=active]:text-white text-slate-600"
            >
              <ScanLine className="w-4 h-4" />
              <span>Shop Floor Scanner</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="mt-0 focus:outline-none">
            {activeTab === 'orders' && <OrderTab isStaff={true} />}
          </TabsContent>

          <TabsContent value="scanner" className="mt-0 focus:outline-none">
            {activeTab === 'scanner' && <ShopScanTab />}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
