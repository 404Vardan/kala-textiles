import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import { useAuth } from '@/contexts/AuthContext'
import { useStaffOrderDraft } from '@/contexts/StaffOrderDraftContext'
import { KalaLogo, resolveBrandName } from '@/components/common/KalaLogo'
import OrderTab from '@/components/admin/OrderTab'
import ShopScanTab from '@/components/admin/ShopScanTab'
import { LogOut, ShoppingCart, ScanLine, ClipboardList, ArrowRight } from 'lucide-react'

export default function StaffPage() {
  const { logout } = useStaffAuth()
  const { user, business } = useAuth()
  const { totalDesigns, totalSets } = useStaffOrderDraft()
  const [activeTab, setActiveTab] = useState<'orders' | 'scanner'>('orders')
  const [autoOpenDraft, setAutoOpenDraft] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const businessName = resolveBrandName(business?.name)
  const shopLogoUrl =
    typeof business?.settings?.logo_url === 'string' ? business.settings.logo_url : null

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
    <div className="min-h-screen bg-[#F4F5F7] text-[#1A1D24] pb-20 lg:pb-0">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 border-r border-[#E3E5EA] bg-white flex-col z-30">
        <div className="h-14 px-4 border-b border-[#E3E5EA] flex items-center">
          <KalaLogo size="sm" titleOverride={businessName} logoUrl={shopLogoUrl} />
        </div>

        <nav aria-label="Staff navigation" className="flex-1 p-3 space-y-1">
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            aria-current={activeTab === 'orders' ? 'page' : undefined}
            className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 rounded-[6px] text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'orders'
                ? 'bg-[#1E2A4A] text-white'
                : 'text-[#1A1D24] hover:bg-[#F4F5F7]'
            }`}
          >
            <ShoppingCart className="w-4 h-4 shrink-0" />
            <span>Orders</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('scanner')}
            aria-current={activeTab === 'scanner' ? 'page' : undefined}
            className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 rounded-[6px] text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'scanner'
                ? 'bg-[#1E2A4A] text-white'
                : 'text-[#1A1D24] hover:bg-[#F4F5F7]'
            }`}
          >
            <ScanLine className="w-4 h-4 shrink-0" />
            <span>Scan</span>
          </button>
        </nav>

        <div className="p-3 border-t border-[#E3E5EA] space-y-2">
          <div className="px-2">
            <p className="text-xs font-semibold text-[#1A1D24] truncate">
              {user?.email || 'Staff Account'}
            </p>
            <p className="text-[11px] text-[#667085]">Staff Terminal</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[44px] flex items-center gap-2 px-3 rounded-[6px] border border-[#E3E5EA] bg-white hover:bg-[#F4F5F7] text-sm font-medium text-[#B42318] cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:pl-60 min-h-screen flex flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-20 bg-white border-b border-[#E3E5EA]">
          <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 lg:hidden">
              <KalaLogo size="sm" titleOverride={businessName} logoUrl={shopLogoUrl} />
            </div>
            <h1 className="hidden lg:block text-base font-semibold text-[#1A1D24] tracking-tight">
              {activeTab === 'orders' ? 'Orders' : 'Scan'}
            </h1>
            <span className="text-xs font-medium text-[#667085] shrink-0">Staff Terminal</span>
          </div>

          {/* Active Draft Banner */}
          {totalDesigns > 0 && (
            <div className="bg-[#1E2A4A] text-white border-t border-[#1E2A4A]">
              <div className="px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <ClipboardList className="w-4 h-4 shrink-0" />
                  <span className="truncate tabular-nums">
                    Active Draft: <strong>{totalDesigns} {totalDesigns === 1 ? 'design' : 'designs'} · {totalSets} {totalSets === 1 ? 'set' : 'sets'}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleOpenDraftFromScanner}
                  className="min-h-[44px] inline-flex items-center gap-1 font-semibold text-white underline shrink-0 px-1 cursor-pointer"
                >
                  <span>Open Draft</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </header>

        <main className="flex-1 p-4 sm:p-6">
          <div className="max-w-[1100px] mx-auto">
            {activeTab === 'orders' && (
              <OrderTab
                isStaff={true}
                autoOpenDraft={autoOpenDraft}
                onAutoOpenDraftHandled={() => setAutoOpenDraft(false)}
              />
            )}
            {activeTab === 'scanner' && (
              <ShopScanTab onOpenDraftOrder={handleOpenDraftFromScanner} />
            )}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar (44px+ touch targets) */}
      <nav
        aria-label="Staff mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#E3E5EA] pb-safe"
      >
        <div className="grid grid-cols-3 h-14">
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            aria-current={activeTab === 'orders' ? 'page' : undefined}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-xs font-medium cursor-pointer ${
              activeTab === 'orders'
                ? 'text-[#1E2A4A] font-semibold border-t-2 border-[#1E2A4A] -mt-px'
                : 'text-[#667085]'
            }`}
          >
            <ShoppingCart className="w-5 h-5" />
            <span>Orders</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('scanner')}
            aria-current={activeTab === 'scanner' ? 'page' : undefined}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-xs font-medium cursor-pointer ${
              activeTab === 'scanner'
                ? 'text-[#1E2A4A] font-semibold border-t-2 border-[#1E2A4A] -mt-px'
                : 'text-[#667085]'
            }`}
          >
            <ScanLine className="w-5 h-5" />
            <span>Scan</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-xs font-medium text-[#B42318] cursor-pointer"
          >
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
