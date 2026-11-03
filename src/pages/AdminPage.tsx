import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsDialog } from '@/components/admin/SettingsDialog'
import { useAdminAuth } from '@/hooks/useAdminAuth'
import { useAuth } from '@/contexts/AuthContext'
import { fetchOrderRequests } from '@/services/orderRequests'
import { KalaLogo, resolveBrandName } from '@/components/common/KalaLogo'
import DashboardTab from '@/components/admin/DashboardTab'
import ProductTab from '@/components/admin/ProductTab'
import StockTab from '@/components/admin/StockTab'
import OrderTab from '@/components/admin/OrderTab'
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
  ScanLine,
  Users,
  UserCheck,
  FileText,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react'

const TAB_CONFIG = [
  { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { value: 'products', label: 'Products', icon: Package },
  { value: 'stock', label: 'Stock & Godown', icon: Warehouse },
  { value: 'orders', label: 'Orders', icon: ShoppingCart },
  { value: 'shopscan', label: 'Shop Terminal', icon: ScanLine },
  { value: 'parties', label: 'Parties', icon: Users },
  { value: 'agents', label: 'Agents', icon: UserCheck },
  { value: 'invoices', label: 'Invoices', icon: FileText },
  { value: 'inquiries', label: 'Inquiries', icon: MessageSquare },
]

export default function AdminPage() {
  const { logout } = useAdminAuth()
  const { business } = useAuth()
  const [showSettings, setShowSettings] = useState(false)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTabInfo = TAB_CONFIG.find((t) => t.value === activeTab) || TAB_CONFIG[0]

  // Handle tab from URL params
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && TAB_CONFIG.some((t) => t.value === tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  // Load pending buyer order request count for Orders tab badge
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
  }

  const handleOpenDraftFromScanner = () => {
    setActiveTab('orders')
    setSearchParams({ tab: 'orders', openDraft: '1' })
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] text-stone-900">
      {/* Operational Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <KalaLogo iconOnly size="md" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold text-stone-900 tracking-tight truncate">
                  {resolveBrandName(business?.name)}
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-stone-700 bg-stone-100 px-2.5 py-0.5 rounded-md border border-stone-200">
                  <ShieldCheck className="w-3.5 h-3.5 text-orange-700" />
                  <span>Owner Workspace</span>
                </span>
              </div>
              <p className="text-xs text-stone-500 truncate">
                {activeTabInfo.label} • Textile Wholesale Management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(true)}
              className="gap-1.5"
            >
              <Settings className="w-3.5 h-3.5 text-stone-600" />
              <span>Settings</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-stone-600 hover:text-red-700 hover:bg-red-50 gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
          {/* Navigation Bar */}
          <nav
            aria-label="Admin sections"
            className="bg-white p-1.5 rounded-xl border border-stone-200 shadow-2xs overflow-x-auto"
          >
            <TabsList className="w-full flex justify-start gap-1 bg-transparent p-0 h-auto">
              {TAB_CONFIG.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold whitespace-nowrap rounded-lg data-[state=active]:bg-stone-900 data-[state=active]:text-white data-[state=active]:shadow-2xs text-stone-600 hover:text-stone-900 hover:bg-stone-100/70 transition-colors cursor-pointer"
                >
                  <tab.icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                  {tab.value === 'orders' && pendingRequestCount > 0 && (
                    <span
                      title={`${pendingRequestCount} pending buyer order requests`}
                      className="ml-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-xs font-bold bg-orange-700 text-white rounded-full tabular-nums"
                    >
                      {pendingRequestCount}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>

          <TabsContent value="dashboard" className="mt-0 focus:outline-none">
            {activeTab === 'dashboard' && <DashboardTab onNavigateTab={handleTabChange} />}
          </TabsContent>

          <TabsContent value="products" className="mt-0 focus:outline-none">
            {activeTab === 'products' && <ProductTab />}
          </TabsContent>

          <TabsContent value="stock" className="mt-0 focus:outline-none">
            {activeTab === 'stock' && <StockTab />}
          </TabsContent>

          <TabsContent value="orders" className="mt-0 focus:outline-none">
            {activeTab === 'orders' && <OrderTab />}
          </TabsContent>

          <TabsContent value="shopscan" className="mt-0 focus:outline-none">
            {activeTab === 'shopscan' && (
              <ShopScanTab onOpenDraftOrder={handleOpenDraftFromScanner} />
            )}
          </TabsContent>

          <TabsContent value="parties" className="mt-0 focus:outline-none">
            {activeTab === 'parties' && <PartyTab />}
          </TabsContent>

          <TabsContent value="agents" className="mt-0 focus:outline-none">
            {activeTab === 'agents' && <AgentTab />}
          </TabsContent>

          <TabsContent value="invoices" className="mt-0 focus:outline-none">
            {activeTab === 'invoices' && <InvoiceTab />}
          </TabsContent>

          <TabsContent value="inquiries" className="mt-0 focus:outline-none">
            {activeTab === 'inquiries' && <InquiryTab />}
          </TabsContent>
        </Tabs>
      </main>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  )
}
