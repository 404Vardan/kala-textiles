import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsDialog } from '@/components/admin/SettingsDialog'
import { useAdminAuth } from '@/hooks/useAdminAuth'
import { fetchOrderRequests } from '@/services/orderRequests'
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
  const [showSettings, setShowSettings] = useState(false)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

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
    <div className="min-h-screen bg-slate-50/70 text-slate-800">
      {/* Sticky Top Navigation */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-slate-950 via-slate-900 to-orange-950 flex items-center justify-center text-white font-black text-base shadow-sm">
              R
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                  Rangoli Textiles
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                  <ShieldCheck className="w-3 h-3 text-orange-600" /> System Manager
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">Wholesale Business Operations</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(true)}
              className="text-slate-600 hover:text-slate-900 text-xs font-semibold"
            >
              <Settings className="w-4 h-4 mr-1" />
              Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="text-slate-600 hover:text-rose-600 text-xs font-semibold border-slate-200"
            >
              <LogOut className="w-4 h-4 mr-1" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
          {/* Scrollable responsive tabs list */}
          <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-2xs overflow-x-auto">
            <TabsList className="w-full flex justify-start gap-1 bg-transparent p-0">
              {TAB_CONFIG.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold whitespace-nowrap rounded-lg data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-xs text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {tab.value === 'orders' && pendingRequestCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-extrabold bg-orange-600 text-white rounded-full">
                      {pendingRequestCount}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

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
