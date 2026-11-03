import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetchProducts } from '@/services/products'
import type { Product } from '@/types'
import { useQRScanner } from '@/hooks/useQRScanner'
import { parseProductQRUrl } from '@/utils/qrcode'
import { useAuth } from '@/contexts/AuthContext'
import { KalaLogo } from '@/components/common/KalaLogo'
import {
  QrCode,
  ShoppingCart,
  Shield,
  Search,
  X,
  Camera,
  ArrowRight,
  Package,
} from 'lucide-react'

export default function LandingPage() {
  const navigate = useNavigate()
  const { user, business } = useAuth()
  const [showScanner, setShowScanner] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([])

  const activeSlug = business?.slug || 'rangoli'

  useEffect(() => {
    if (!user) return
    fetchProducts(500).then(setProducts).catch(() => {})
  }, [user])

  useEffect(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      setFilteredProducts(products.filter((p) => p.design_no.toLowerCase().includes(q)))
    } else {
      setFilteredProducts(products.slice(0, 20))
    }
  }, [searchQuery, products])

  const handleQRScan = useCallback(
    (text: string) => {
      const parsed = parseProductQRUrl(text, activeSlug)
      if (parsed) {
        setShowScanner(false)
        navigate(`/${parsed.slug}/p/${encodeURIComponent(parsed.designNo)}`)
      }
    },
    [navigate, activeSlug]
  )

  const { status: scannerStatus } = useQRScanner({
    elementId: 'qr-reader',
    onScan: handleQRScan,
    active: showScanner,
    cooldownMs: 500,
  })

  const handleScanQR = () => setShowScanner(true)
  const handleCloseScanner = () => setShowScanner(false)
  const handleCreateOrder = () => navigate('/staff')
  const handleAdminAccess = () => navigate('/admin')

  const handleSelectDesign = (designNo: string) => {
    const clean = designNo.trim()
    if (!clean) return
    setShowSearch(false)
    setSearchQuery('')
    navigate(`/${activeSlug}/p/${encodeURIComponent(clean)}`)
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] text-stone-900 flex flex-col justify-between">
      {/* Top Bar */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <KalaLogo
            size="md"
            subtitle="Textile Wholesale Management System"
          />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleScanQR}
              className="gap-1.5"
            >
              <QrCode className="w-4 h-4 text-orange-700" />
              <span>Scan QR</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
        <div className="w-full max-w-2xl space-y-8">
          {/* Brand Heading */}
          <div className="text-center space-y-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-orange-800 bg-orange-50 border border-orange-200 px-3 py-1 rounded-full">
              <Package className="w-3.5 h-3.5" /> Textile Wholesale Management System
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-stone-900 tracking-tight">
              Kala
            </h1>
            <p className="text-sm sm:text-base text-stone-600 max-w-md mx-auto">
              Scan product QR labels, browse wholesale design specifications, or access staff and
              management operations.
            </p>
          </div>

          {/* Primary Search Trigger */}
          <div className="bg-white p-2 rounded-xl border border-stone-300 shadow-2xs">
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg hover:bg-stone-50 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3 text-stone-500">
                <Search className="w-4 h-4 text-stone-400 shrink-0" />
                <span className="text-sm">Lookup design number (e.g. 4955)...</span>
              </div>
              <span className="text-xs font-semibold text-orange-700 bg-orange-50 px-2.5 py-1 rounded-md border border-orange-200/70">
                Search
              </span>
            </button>
          </div>

          {/* Core Operational Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={handleScanQR}
              className="group flex flex-col justify-between p-5 rounded-xl bg-white border border-stone-200 shadow-2xs hover:border-orange-700/60 hover:shadow-sm transition-all text-left cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg bg-orange-50 border border-orange-200/80 text-orange-700 flex items-center justify-center mb-4">
                <QrCode className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 text-base">Scan QR</span>
                  <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-orange-700 transition-colors" />
                </div>
                <p className="text-xs text-stone-500 mt-1">
                  Scan a product label to view design details and request sets
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={handleCreateOrder}
              className="group flex flex-col justify-between p-5 rounded-xl bg-white border border-stone-200 shadow-2xs hover:border-stone-400 hover:shadow-sm transition-all text-left cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg bg-stone-100 border border-stone-200 text-stone-800 flex items-center justify-center mb-4">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 text-base">Create Order</span>
                  <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-stone-900 transition-colors" />
                </div>
                <p className="text-xs text-stone-500 mt-1">
                  Staff terminal for floor scanning, stock check, and order drafting
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={handleAdminAccess}
              className="group flex flex-col justify-between p-5 rounded-xl bg-white border border-stone-200 shadow-2xs hover:border-stone-400 hover:shadow-sm transition-all text-left cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg bg-stone-100 border border-stone-200 text-stone-800 flex items-center justify-center mb-4">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 text-base">Admin Access</span>
                  <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-stone-900 transition-colors" />
                </div>
                <p className="text-xs text-stone-500 mt-1">
                  Manage catalog, Godown stock, buyer requests, and parties
                </p>
              </div>
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white py-4 px-4 text-center text-xs text-stone-500">
        © {new Date().getFullYear()} Kala • Textile Wholesale Management System
      </footer>

      {/* Search Dialog */}
      <Dialog open={showSearch} onOpenChange={setShowSearch}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Search Design Number</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (searchQuery.trim()) {
                handleSelectDesign(searchQuery.trim())
              }
            }}
            className="flex items-center gap-2 px-4 py-1 border-b border-stone-200 bg-stone-50"
          >
            <Search className="w-4 h-4 text-stone-400 shrink-0" />
            <Input
              placeholder="Enter design number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm h-11 px-1"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search query"
                onClick={() => setSearchQuery('')}
                className="p-1 text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </form>
          <div className="max-h-72 overflow-y-auto divide-y divide-stone-100">
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => handleSelectDesign(searchQuery.trim())}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-orange-50/70 hover:bg-orange-100/70 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <QrCode className="w-4 h-4 text-orange-700 shrink-0" />
                  <span className="font-semibold text-sm text-orange-900">
                    Open Design "{searchQuery.trim().toUpperCase()}"
                  </span>
                </div>
                <span className="text-xs font-semibold text-orange-800">View →</span>
              </button>
            )}
            {filteredProducts.length === 0 ? (
              !searchQuery.trim() && (
                <div className="py-8 px-4 text-center text-stone-500 text-xs sm:text-sm">
                  Type a design number above and press Enter to open its catalog page.
                </div>
              )
            ) : (
              filteredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleSelectDesign(product.design_no)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <QrCode className="w-4 h-4 text-orange-700 shrink-0" />
                    <div>
                      <p className="font-bold text-sm text-stone-900">{product.design_no}</p>
                      <p className="text-xs text-stone-500">
                        {[product.brand, product.collection_name, product.fabric]
                          .filter(Boolean)
                          .join(' • ') || 'Catalog Design'}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-stone-400" />
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* QR Scanner Dialog */}
      <Dialog
        open={showScanner}
        onOpenChange={(open) => {
          if (!open) handleCloseScanner()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-orange-700" />
              Scan Product QR Code
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-stone-950 aspect-video">
              <div id="qr-reader" className="w-full h-full" />
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-stone-600">
              {scannerStatus === 'scanning' && (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <span className="w-2 h-2 bg-emerald-600 rounded-full" />
                  Camera active — point at a product QR label
                </span>
              )}
              {scannerStatus === 'starting' && <span>Starting camera...</span>}
              {scannerStatus === 'idle' && <span>Point camera at a product QR code</span>}
            </div>
          </div>
          <Button variant="outline" onClick={handleCloseScanner} className="w-full">
            Close Scanner
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
