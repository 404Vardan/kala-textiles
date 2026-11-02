import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchProduct, fetchProductMedia, searchProducts } from '@/services/products'
import { fetchLocations, fetchStockByProduct } from '@/services/inventory'
import { useQRScanner } from '@/hooks/useQRScanner'
import type { Product, ProductMedia, InventoryStock, InventoryLocation } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import {
  Camera,
  X,
  Search,
  Warehouse,
  Store,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  AlertCircle,
} from 'lucide-react'

export default function ShopScanTab() {
  const navigate = useNavigate()
  const [isScanning, setIsScanning] = useState(false)
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null)
  const [scannedMedia, setScannedMedia] = useState<ProductMedia[]>([])
  const [scannedStock, setScannedStock] = useState<InventoryStock[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [currentMediaIdx, setCurrentMediaIdx] = useState(0)
  const [error, setError] = useState('')
  const [manualQuery, setManualQuery] = useState('')
  const [manualResults, setManualResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    fetchLocations().then(setLocations).catch(console.error)
  }, [])

  const loadProductFullDetails = async (designNo: string) => {
    try {
      setError('')
      const prod = await fetchProduct(designNo)
      setScannedProduct(prod)

      const [media, stockList] = await Promise.all([
        fetchProductMedia(prod.id).catch(() => []),
        fetchStockByProduct(prod.id).catch(() => []),
      ])

      setScannedMedia(media)
      setScannedStock(stockList)
      setCurrentMediaIdx(0)
    } catch {
      setError(`Design "${designNo}" not found in catalog`)
      setScannedProduct(null)
      setScannedMedia([])
      setScannedStock([])
    }
  }

  // Dual-mode fast QR scanner
  const handleQRScan = useCallback((text: string) => {
    const match = text.match(/\/p\/([^/?#]+)/)
    const code = match ? match[1] : text.trim()
    if (code) {
      loadProductFullDetails(code)
    }
  }, [])

  const { error: cameraError } = useQRScanner({
    elementId: 'shop-floor-scanner-view',
    onScan: handleQRScan,
    active: isScanning,
    cooldownMs: 800,
  })

  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualQuery.trim()) return
    setSearching(true)
    try {
      const results = await searchProducts(manualQuery.trim())
      setManualResults(results)
      if (results.length === 1) {
        loadProductFullDetails(results[0].design_no)
        setManualResults([])
      }
    } catch (err: any) {
      setError(err?.message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  // Location stock lookups
  const godownId = locations.find(l => l.name.toLowerCase() === 'godown')?.id
  const shopId = locations.find(l => l.name.toLowerCase() === 'shop')?.id

  const godownStock = scannedStock.find(s => s.location_id === godownId)
  const shopStock = scannedStock.find(s => s.location_id === shopId)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Staff Terminal & Scanner</h2>
        <p className="text-slate-500 text-sm">
          Scan QR tags or search design numbers to view real-time warehouse & shop availability
        </p>
      </div>

      {/* Camera Trigger / Active Scanner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-4">
        {!isScanning ? (
          <div className="text-center py-4 space-y-3">
            <Button
              onClick={() => setIsScanning(true)}
              className="bg-orange-600 hover:bg-orange-700 text-white h-14 px-8 text-base font-bold shadow-md hover:shadow-lg transition-all rounded-xl"
            >
              <Camera className="w-5 h-5 mr-2" />
              Start Camera Scanner
            </Button>
            <p className="text-xs text-slate-400">Continuous scanning with GPU-accelerated Barcode API</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Camera Active
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsScanning(false)}
                className="h-8 text-slate-500 hover:text-slate-800"
              >
                <X className="w-4 h-4 mr-1" /> Close Camera
              </Button>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-w-sm mx-auto shadow-inner">
              <div id="shop-floor-scanner-view" className="w-full h-full" />
              <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-white/40 m-6 rounded-lg" />
            </div>

            {cameraError && (
              <div className="text-xs bg-rose-50 text-rose-700 p-2.5 rounded-lg border border-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {cameraError}. Please ensure camera permissions are allowed, or use manual search below.
              </div>
            )}
          </div>
        )}

        {/* Fallback Manual Search */}
        <div className="border-t border-slate-100 pt-4">
          <form onSubmit={handleManualSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Manual search: e.g. 4955, Silk..."
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                className="pl-9 bg-slate-50 border-slate-200 text-sm"
              />
            </div>
            <Button type="submit" disabled={searching || !manualQuery.trim()} variant="outline">
              {searching ? 'Finding...' : 'Search'}
            </Button>
          </form>

          {manualResults.length > 0 && (
            <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg divide-y max-h-48 overflow-y-auto">
              {manualResults.map(p => (
                <div
                  key={p.id}
                  onClick={() => {
                    loadProductFullDetails(p.design_no)
                    setManualResults([])
                    setManualQuery('')
                  }}
                  className="p-2.5 hover:bg-orange-50 cursor-pointer flex justify-between items-center text-xs"
                >
                  <span className="font-bold text-slate-900">{p.design_no} ({p.brand || 'No brand'})</span>
                  <span className="text-orange-600 font-bold">{formatCurrency(p.rate || 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {/* Scanned Product Card */}
      {scannedProduct && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm animate-in fade-in duration-200">
          {/* Media viewer */}
          {scannedMedia.length > 0 ? (
            <div className="relative bg-slate-900 aspect-video flex items-center justify-center">
              {scannedMedia[currentMediaIdx].media_type === 'video' ? (
                <video
                  key={scannedMedia[currentMediaIdx].media_url}
                  src={scannedMedia[currentMediaIdx].media_url}
                  className="w-full h-full object-contain"
                  controls
                  autoPlay
                  muted
                />
              ) : (
                <img
                  key={scannedMedia[currentMediaIdx].media_url}
                  src={scannedMedia[currentMediaIdx].media_url}
                  alt={scannedProduct.design_no}
                  className="w-full h-full object-contain"
                />
              )}

              {scannedMedia.length > 1 && (
                <>
                  <button
                    onClick={() => setCurrentMediaIdx((prev) => (prev - 1 + scannedMedia.length) % scannedMedia.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 text-white p-2 rounded-full hover:bg-black"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setCurrentMediaIdx((prev) => (prev + 1) % scannedMedia.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 text-white p-2 rounded-full hover:bg-black"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full font-mono">
                    {currentMediaIdx + 1} / {scannedMedia.length}
                  </div>
                </>
              )}
            </div>
          ) : scannedProduct.image_url ? (
            <div className="aspect-video bg-slate-100 flex items-center justify-center overflow-hidden">
              <img src={scannedProduct.image_url} alt="" className="w-full h-full object-cover" />
            </div>
          ) : null}

          {/* Details body */}
          <div className="p-6 space-y-5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Design Number</span>
                <h3 className="text-3xl font-black text-slate-900">{scannedProduct.design_no}</h3>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {scannedProduct.brand && (
                    <span className="bg-slate-100 text-slate-700 text-xs px-2.5 py-0.5 rounded-md font-medium">
                      {scannedProduct.brand}
                    </span>
                  )}
                  {scannedProduct.collection_name && (
                    <span className="bg-slate-100 text-slate-700 text-xs px-2.5 py-0.5 rounded-md font-medium">
                      {scannedProduct.collection_name}
                    </span>
                  )}
                  {scannedProduct.fabric && (
                    <span className="bg-orange-50 text-orange-700 text-xs px-2.5 py-0.5 rounded-md font-medium">
                      {scannedProduct.fabric}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right">
                <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Wholesale Rate</span>
                <p className="text-2xl font-black text-orange-600">
                  {scannedProduct.rate ? formatCurrency(scannedProduct.rate) : '-'}
                  <span className="text-xs text-slate-400 font-normal">/pc</span>
                </p>
                {scannedProduct.pcs_per_set && (
                  <p className="text-xs text-slate-500 font-medium">
                    {scannedProduct.pcs_per_set} pcs/set
                    {scannedProduct.rate && ` • ${formatCurrency(scannedProduct.rate * scannedProduct.pcs_per_set)}/set`}
                  </p>
                )}
              </div>
            </div>

            {/* Inventory Availability Cards */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              {/* Shop Floor Stock */}
              <div className="p-3.5 rounded-xl border border-orange-200 bg-orange-50/50 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-orange-800">
                  <Store className="w-4 h-4" />
                  <span>Shop Floor Stock</span>
                </div>
                <p className="text-xl font-black text-slate-900">
                  {shopStock?.sets || 0} <span className="text-xs font-normal text-slate-500">sets</span>
                </p>
                <p className="text-xs text-slate-600 font-medium font-mono">
                  {shopStock?.total_pcs || 0} pieces ready
                </p>
              </div>

              {/* Godown Warehouse Stock */}
              <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/50 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
                  <Warehouse className="w-4 h-4" />
                  <span>Godown Warehouse</span>
                </div>
                <p className="text-xl font-black text-slate-900">
                  {godownStock?.sets || 0} <span className="text-xs font-normal text-slate-500">sets</span>
                </p>
                <p className="text-xs text-slate-600 font-medium font-mono">
                  {godownStock?.total_pcs || 0} pieces stored
                </p>
              </div>
            </div>

            {scannedProduct.description && (
              <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                {scannedProduct.description}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => navigate('/staff')}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold"
              >
                <ShoppingCart className="w-4 h-4 mr-1.5" />
                Add Design to Order
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(`/p/${scannedProduct.design_no}`)}
                className="text-slate-700"
              >
                <ExternalLink className="w-4 h-4 mr-1.5" />
                Customer Page
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
