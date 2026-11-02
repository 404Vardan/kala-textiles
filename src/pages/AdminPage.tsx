import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PasswordModal } from '@/components/admin/PasswordModal'
import { SettingsDialog } from '@/components/admin/SettingsDialog'
import { useAdminAuth } from '@/hooks/useAdminAuth'
import ProductTab from '@/components/admin/ProductTab'
import InvoiceTab from '@/components/admin/InvoiceTab'
import InquiryTab from '@/components/admin/InquiryTab'
import StockTab from '@/components/admin/StockTab'
import OrderTab from '@/components/admin/OrderTab'
import ShopScanTab from '@/components/admin/ShopScanTab'
import {
  LogOut,
  Settings,
  Package,
  Warehouse,
  ShoppingCart,
  ScanLine,
  FileText,
  MessageSquare,
} from 'lucide-react'

const TAB_CONFIG = [
  { value: 'products', label: 'Products', icon: Package },
  { value: 'stock', label: 'Stock', icon: Warehouse },
  { value: 'orders', label: 'Orders', icon: ShoppingCart },
  { value: 'shopscan', label: 'Shop Scan', icon: ScanLine },
  { value: 'invoices', label: 'Invoices', icon: FileText },
  { value: 'inquiries', label: 'Inquiries', icon: MessageSquare },
]

export default function AdminPage() {
  const { isAuthenticated, login, logout } = useAdminAuth()
  const [showPassword, setShowPassword] = useState(!isAuthenticated)
  const [showSettings, setShowSettings] = useState(false)
  const [activeTab, setActiveTab] = useState('products')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Handle tab from URL params
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && TAB_CONFIG.some(t => t.value === tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

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
    return <PasswordModal isOpen={true} onSuccess={handlePasswordSuccess} />
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
            <p className="text-xs text-gray-500 hidden sm:block">Admin Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(true)}
              className="text-gray-600"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Settings</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full flex overflow-x-auto gap-1 bg-white border rounded-lg p-1 shadow-sm mb-6">
            {TAB_CONFIG.map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap data-[state=active]:bg-orange-50 data-[state=active]:text-orange-700 flex-1"
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="products" className="mt-0">
            {activeTab === 'products' && <ProductTab />}
          </TabsContent>
          <TabsContent value="stock" className="mt-0">
            {activeTab === 'stock' && <StockTab />}
          </TabsContent>
          <TabsContent value="orders" className="mt-0">
            {activeTab === 'orders' && <OrderTab />}
          </TabsContent>
          <TabsContent value="shopscan" className="mt-0">
            {activeTab === 'shopscan' && <ShopScanTab />}
          </TabsContent>
          <TabsContent value="invoices" className="mt-0">
            {activeTab === 'invoices' && <InvoiceTab />}
          </TabsContent>
          <TabsContent value="inquiries" className="mt-0">
            {activeTab === 'inquiries' && <InquiryTab />}
          </TabsContent>
        </Tabs>
      </main>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  )
}
