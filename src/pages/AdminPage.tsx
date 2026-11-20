import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SettingsDialog } from '@/components/admin/SettingsDialog'
import { useAdminAuth } from '@/hooks/useAdminAuth'
import { useAuth } from '@/contexts/AuthContext'
import { fetchOrderRequests } from '@/services/orderRequests'
import { KalaLogo, resolveBrandName } from '@/components/common/KalaLogo'
import DashboardTab from '@/components/admin/DashboardTab'
import ProductTab from '@/components/admin/ProductTab'
import StockTab from '@/components/admin/StockTab'
import OrderTab from '@/components/admin/OrderTab'
import OrderRequestsSection from '@/components/admin/OrderRequestsSection'
import ShopScanTab from '@/components/admin/ShopScanTab'
import PartyTab from '@/components/admin/PartyTab'
import AgentTab from '@/components/admin/AgentTab'
import InvoiceTab from '@/components/admin/InvoiceTab'
import InquiryTab from '@/components/admin/InquiryTab'
import {
  LogOut,
  Settings,
  LayoutDashboard,
  Package,
  Warehouse,
  ShoppingCart,
  Inbox,
  ScanLine,
  Users,
  UserCheck,
  Menu,
  X,
  ChevronUp,
} from 'lucide-react'

const SIDEBAR_ITEMS = [
  { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { value: 'products', label: 'Products', icon: Package },
  { value: 'stock', label: 'Stock', icon: Warehouse },
  { value: 'orders', label: 'Orders', icon: ShoppingCart },
  { value: 'requests', label: 'Requests', icon: Inbox },
  { value: 'parties', label: 'Parties', icon: Users },
  { value: 'agents', label: 'Agents', icon: UserCheck },
  { value: 'shopscan', label: 'Scan', icon: ScanLine },
] as const

const VALID_TABS = new Set([
  'dashboard',
  'products',
  'stock',
  'orders',
  'requests',
  'parties',
  'agents',
  'shopscan',
  'invoices',
  'inquiries',
])

export default function AdminPage() {
  const { logout } = useAdminAuth()
  const { user, business, memberships, activeFY, switchBusiness } = useAuth()
  const [showSettings, setShowSettings] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const shopName = resolveBrandName(business?.name)
  const shopLogoUrl =
    typeof business?.settings?.logo_url === 'string' ? business.settings.logo_url : null

  const activeNavItem =
    SIDEBAR_ITEMS.find((t) => t.value === activeTab) || {
      value: activeTab,
      label: activeTab.charAt(0).toUpperCase() + activeTab.slice(1),
    }

  // Handle tab from URL params
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && VALID_TABS.has(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  // Load pending buyer order request count for Requests badge
  useEffect(() => {
    let active = true
    fetchOrderRequests('requested')
      .then((reqs) => {
        if (active) setPendingRequestCount(reqs.length)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [activeTab])

  const handleTabChange = (val: string) => {
    setActiveTab(val)
    setSearchParams({ tab: val })
    setMobileMenuOpen(false)
  }

  const handleOpenDraftFromScanner = () => {
    setActiveTab('orders')
    setSearchParams({ tab: 'orders', openDraft: '1' })
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-white">
      {/* Shop Name & Brand */}
      <div className="h-14 px-4 border-b border-[#E3E5EA] flex items-center justify-between gap-2 shrink-0">
        <KalaLogo
          size="sm"
          titleOverride={shopName}
          logoUrl={shopLogoUrl}
          showSubtitle={false}
        />
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation"
          className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-[6px] text-[#667085] hover:bg-[#F4F5F7] hover:text-[#1A1D24]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav aria-label="Admin navigation" className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {SIDEBAR_ITEMS.map((item) => {
          const isActive = activeTab === item.value
          const Icon = item.icon
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => handleTabChange(item.value)}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-[6px] text-sm font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#1E2A4A] text-white'
                  : 'text-[#1A1D24] hover:bg-[#F4F5F7]'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {item.value === 'requests' && pendingRequestCount > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-xs font-semibold rounded-[6px] tabular-nums ${
                    isActive
                      ? 'bg-white text-[#1E2A4A]'
                      : 'border border-[#E3E5EA] bg-[#F4F5F7] text-[#1E2A4A]'
                  }`}
                >
                  {pendingRequestCount}
                </span>
              )}
            </button>
          )
        })}

        <div className="pt-2 mt-2 border-t border-[#E3E5EA]">
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false)
              setShowSettings(true)
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[6px] text-sm font-medium text-[#1A1D24] hover:bg-[#F4F5F7] transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4 shrink-0 text-[#667085]" />
            <span>Settings</span>
          </button>
        </div>
      </nav>

      {/* User Menu */}
      <div className="p-3 border-t border-[#E3E5EA] relative shrink-0">
        {userMenuOpen && (
          <div className="mb-2 rounded-[6px] border border-[#E3E5EA] bg-white p-1 space-y-0.5">
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(false)
                setShowSettings(true)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[6px] text-xs font-medium text-[#1A1D24] hover:bg-[#F4F5F7] cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-[#667085]" />
              <span>Business &amp; Team Settings</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[6px] text-xs font-medium text-[#B42318] hover:bg-[#F4F5F7] cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setUserMenuOpen((prev) => !prev)}
          aria-expanded={userMenuOpen}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[6px] border border-[#E3E5EA] bg-white hover:bg-[#F4F5F7] text-left transition-colors cursor-pointer"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#1A1D24] truncate">
              {user?.email || 'Owner Account'}
            </p>
            <p className="text-[11px] text-[#667085]">Owner</p>
          </div>
          <ChevronUp
            className={`w-4 h-4 text-[#667085] shrink-0 transition-transform ${
              userMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#1A1D24]">
      {/* Fixed Left Sidebar (Desktop) */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 border-r border-[#E3E5EA] bg-white z-30">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-[#1A1D24]/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[82vw] h-full border-r border-[#E3E5EA] bg-white z-10">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="lg:pl-60 min-h-screen flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-[#E3E5EA] px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center rounded-[6px] text-[#1A1D24] hover:bg-[#F4F5F7]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base font-semibold text-[#1A1D24] tracking-tight truncate">
              {activeNavItem.label}
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activeFY && (
              <span className="hidden sm:inline-flex items-center px-2 py-1 text-xs font-medium text-[#1A1D24] bg-[#F4F5F7] border border-[#E3E5EA] rounded-[6px] tabular-nums">
                {activeFY.label}
              </span>
            )}
            {memberships.length > 1 && business ? (
              <select
                aria-label="Switch active company"
                value={business.id}
                onChange={(e) => {
                  const nextId = Number(e.target.value)
                  if (nextId && nextId !== business.id) {
                    void switchBusiness(nextId)
                  }
                }}
                className="h-8 bg-white border border-[#E3E5EA] rounded-[6px] px-2.5 text-xs font-medium text-[#1A1D24]"
              >
                {memberships.map((m) => (
                  <option key={m.business_id} value={m.business_id}>
                    {resolveBrandName(m.business?.name)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-[#667085] hidden sm:inline truncate">
                {shopName}
              </span>
            )}
          </div>
        </header>

        {/* Canvas Workspace */}
        <main className="flex-1 p-4 sm:p-6">
          <div key={business?.id ?? 'none'} className="max-w-[1200px] mx-auto">
            {activeTab === 'dashboard' && <DashboardTab onNavigateTab={handleTabChange} />}
            {activeTab === 'products' && <ProductTab />}
            {activeTab === 'stock' && <StockTab />}
            {activeTab === 'orders' && <OrderTab hideRequestsSection />}
            {activeTab === 'requests' && (
              <OrderRequestsSection
                onOrderConverted={() => {
                  handleTabChange('orders')
                }}
                onPendingCountChange={setPendingRequestCount}
              />
            )}
            {activeTab === 'shopscan' && (
              <ShopScanTab onOpenDraftOrder={handleOpenDraftFromScanner} />
            )}
            {activeTab === 'parties' && <PartyTab />}
            {activeTab === 'agents' && <AgentTab />}
            {activeTab === 'invoices' && <InvoiceTab />}
            {activeTab === 'inquiries' && <InquiryTab />}
          </div>
        </main>
      </div>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  )
}
