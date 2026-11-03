import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import { useAuth } from '@/contexts/AuthContext'
import { useStaffOrderDraft } from '@/contexts/StaffOrderDraftContext'
import { KalaLogo, resolveBrandName } from '@/components/common/KalaLogo'
import OrderTab from '@/components/admin/OrderTab'
import ShopScanTab from '@/components/admin/ShopScanTab'
import { LogOut, ShoppingCart, ScanLine, Smartphone, ClipboardList, ArrowRight } from 'lucide-react'

export default function StaffPage() {
  const { logout } = useStaffAuth()
  const { business } = useAuth()
  const { totalDesigns, totalSets } = useStaffOrderDraft()
  const [activeTab, setActiveTab] = useState('orders')
  const [autoOpenDraft, setAutoOpenDraft] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const businessName = resolveBrandName(business?.name)

  useEffect(() => {
    if (searchParams.get('openDraft') === '1') {
      setActiveTab('orders')
      setAutoOpenDraft(true)
    }
  }, [searchParams])

  const handleOpenDraftFromScanner = () => {
    setActiveTab('orders')
    setAutoOpenDraft(true)
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] text-stone-900">
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-stone-200/80 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <KalaLogo iconOnly size="md" />
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-extrabold text-stone-900 leading-tight truncate">
                {businessName}
              </h1>
              <span className="text-[11px] font-semibold text-orange-700 inline-flex items-center gap-1">
                <Smartphone className="w-3 h-3" /> Staff Floor Terminal
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="text-stone-600 hover:text-red-700 hover:border-red-200 hover:bg-red-50 text-xs font-semibold"
            >
              <LogOut className="w-4 h-4 mr-1" />
              Sign Out
            </Button>
          </div>
        </div>

        {/* Persistent Active Draft Order Bar */}
        {totalDesigns > 0 && (
          <div className="bg-stone-900 text-white border-t border-stone-800">
            <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <ClipboardList className="w-4 h-4 text-orange-400 shrink-0" />
                <span className="font-medium truncate">
                  Active Draft Order:{' '}
                  <strong className="text-white">
                    {totalDesigns} {totalDesigns === 1 ? 'design' : 'designs'} · {totalSets}{' '}
                    {totalSets === 1 ? 'set' : 'sets'}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={handleOpenDraftFromScanner}
                className="inline-flex items-center gap-1 font-bold text-orange-400 hover:text-orange-300 shrink-0 py-0.5"
              >
                <span>Return to Order</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-5">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-5">
          <TabsList className="w-full grid grid-cols-2 bg-white border border-stone-200/80 p-1 rounded-xl shadow-2xs h-auto">
            <TabsTrigger
              value="orders"
              className="flex items-center justify-center gap-2 py-2.5 text-xs sm:text-sm font-semibold rounded-lg data-[state=active]:bg-stone-900 data-[state=active]:text-white text-stone-600 transition-colors"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Orders & Drafting</span>
            </TabsTrigger>
            <TabsTrigger
              value="scanner"
              className="flex items-center justify-center gap-2 py-2.5 text-xs sm:text-sm font-semibold rounded-lg data-[state=active]:bg-stone-900 data-[state=active]:text-white text-stone-600 transition-colors"
            >
              <ScanLine className="w-4 h-4" />
              <span>Shop Floor Scanner</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="mt-0 focus:outline-none">
            {activeTab === 'orders' && (
              <OrderTab
                isStaff={true}
                autoOpenDraft={autoOpenDraft}
                onAutoOpenDraftHandled={() => setAutoOpenDraft(false)}
              />
            )}
          </TabsContent>

          <TabsContent value="scanner" className="mt-0 focus:outline-none">
            {activeTab === 'scanner' && (
              <ShopScanTab onOpenDraftOrder={handleOpenDraftFromScanner} />
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
