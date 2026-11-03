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
import { QrCode, ShoppingCart, Shield, Search, X, Camera, Zap } from 'lucide-react'

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
    // Preload products for search when authenticated
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

  // Ultra-fast QR scanner via native BarcodeDetector API
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

  const handleScanQR = () => {
    setShowScanner(true)
  }

  const handleCloseScanner = () => {
    setShowScanner(false)
  }

  const handleCreateOrder = () => {
    navigate('/staff')
  }

  const handleAdminAccess = () => {
    navigate('/admin')
  }

  const handleSelectDesign = (designNo: string) => {
    const clean = designNo.trim()
    if (!clean) return
    setShowSearch(false)
    setSearchQuery('')
    navigate(`/${activeSlug}/p/${encodeURIComponent(clean)}`)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-orange-200/30 to-rose-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-tr from-amber-200/30 to-orange-200/30 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-8">
        {/* Logo / Brand */}
        <div className="text-center mb-10 animate-fade-in">
          <h1 className="text-5xl sm:text-6xl font-extrabold bg-gradient-to-r from-orange-600 via-rose-600 to-amber-600 bg-clip-text text-transparent tracking-tight">
            Rangoli Textiles
          </h1>
          <p className="mt-3 text-lg text-gray-500 font-medium">Premium Fabric Collection</p>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-lg mb-8">
          <button
            onClick={handleScanQR}
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl bg-white/80 backdrop-blur-sm border border-orange-100 shadow-lg hover:shadow-xl hover:border-orange-300 transition-all duration-300 hover:-translate-y-1"
          >
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <QrCode className="w-7 h-7 text-white" />
            </div>
            <span className="font-semibold text-gray-700">Scan QR</span>
          </button>

          <button
            onClick={handleCreateOrder}
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl bg-white/80 backdrop-blur-sm border border-orange-100 shadow-lg hover:shadow-xl hover:border-orange-300 transition-all duration-300 hover:-translate-y-1"
          >
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <ShoppingCart className="w-7 h-7 text-white" />
            </div>
            <span className="font-semibold text-gray-700">Create Order</span>
          </button>

          <button
            onClick={handleAdminAccess}
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl bg-white/80 backdrop-blur-sm border border-orange-100 shadow-lg hover:shadow-xl hover:border-orange-300 transition-all duration-300 hover:-translate-y-1"
          >
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-rose-500 to-red-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <span className="font-semibold text-gray-700">Admin Access</span>
          </button>
        </div>

        {/* Design Lookup */}
        <div className="w-full max-w-lg">
          <button
            onClick={() => setShowSearch(true)}
            className="w-full flex items-center gap-3 px-5 py-3.5 rounded-xl bg-white/80 backdrop-blur-sm border border-gray-200 shadow-md hover:shadow-lg hover:border-orange-300 transition-all text-gray-400 text-left"
          >
            <Search className="w-5 h-5" />
            <span>Search design number...</span>
          </button>
        </div>
      </div>

      {/* Search Dialog (cmdk-style) */}
      <Dialog open={showSearch} onOpenChange={setShowSearch}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (searchQuery.trim()) {
                handleSelectDesign(searchQuery.trim())
              }
            }}
            className="flex items-center gap-2 px-4 border-b"
          >
            <Search className="w-5 h-5 text-gray-400 shrink-0" />
            <Input
              placeholder="Type design number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-0 shadow-none focus-visible:ring-0 text-base py-4"
              autoFocus
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="shrink-0">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </form>
          <div className="max-h-72 overflow-y-auto">
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => handleSelectDesign(searchQuery.trim())}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-orange-50/60 hover:bg-orange-100/70 border-b transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <QrCode className="w-4 h-4 text-orange-600 shrink-0" />
                  <span className="font-semibold text-orange-800">
                    Open design "{searchQuery.trim()}"
                  </span>
                </div>
                <span className="text-xs font-medium text-orange-600">View →</span>
              </button>
            )}
            {filteredProducts.length === 0 ? (
              !searchQuery.trim() && (
                <div className="py-8 text-center text-gray-400 text-sm">
                  Type a design number above to view its catalog page
                </div>
              )
            ) : (
              filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleSelectDesign(product.design_no)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50 transition-colors text-left"
                >
                  <QrCode className="w-4 h-4 text-orange-500 shrink-0" />
                  <div>
                    <p className="font-medium text-gray-900">{product.design_no}</p>
                    <p className="text-xs text-gray-500">
                      {[product.brand, product.collection_name, product.fabric]
                        .filter(Boolean)
                        .join(' • ') || 'No details'}
                    </p>
                  </div>
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
              <Camera className="w-5 h-5" />
              Scan QR Code
            </DialogTitle>
          </DialogHeader>
          <div className="relative">
            <div id="qr-reader" className="w-full rounded-lg overflow-hidden" />
            <div className="flex items-center justify-center gap-2 mt-2">
              {scannerStatus === 'scanning' && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <Zap className="w-3 h-3" />
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  Ultra-fast scanning active
                </span>
              )}
              {scannerStatus === 'starting' && (
                <span className="text-sm text-gray-500">Starting camera...</span>
              )}
              {scannerStatus === 'idle' && (
                <span className="text-sm text-gray-500">Point camera at a product QR code</span>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={handleCloseScanner} className="w-full mt-2">
            Close Scanner
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
