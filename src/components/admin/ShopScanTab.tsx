import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchProduct, fetchProductMedia, searchProducts } from '@/services/products'
import { fetchLocations, fetchStockByProduct } from '@/services/inventory'
import { clampRequestSets } from '@/services/orderRequestCart'
import { useQRScanner } from '@/hooks/useQRScanner'
import { parseProductQRUrl } from '@/utils/qrcode'
import { useAuth } from '@/contexts/AuthContext'
import { useStaffOrderDraft } from '@/contexts/StaffOrderDraftContext'
import type { Product, ProductMedia, InventoryStock, InventoryLocation } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import { QuantityStepper } from '@/components/ui/primitives'
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
  CheckCircle2,
  ClipboardList,
} from 'lucide-react'

interface ShopScanTabProps {
  onOpenDraftOrder?: () => void
}

export default function ShopScanTab({ onOpenDraftOrder }: ShopScanTabProps = {}) {
  const navigate = useNavigate()
  const { business, isOwner } = useAuth()
  const {
    addProductToDraft,
    draft: staffDraft,
    totalDesigns: draftDesigns,
    totalSets: draftSets,
  } = useStaffOrderDraft()

  const activeSlug = (business?.slug || 'rangoli').trim().toLowerCase() || 'rangoli'

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

  // Staff draft add controls
  const [setsToAdd, setSetsToAdd] = useState(1)
  const [addedFeedback, setAddedFeedback] = useState('')

  useEffect(() => {
    fetchLocations().then(setLocations).catch(console.error)
  }, [])

  const loadProductFullDetails = useCallback(async (designNo: string) => {
    try {
      setError('')
      setAddedFeedback('')
      setSetsToAdd(1)
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
  }, [])

  // Dual-mode fast QR scanner with tenant validation
  const handleQRScan = useCallback(
    (text: string) => {
      const parsed = parseProductQRUrl(text, activeSlug)
      if (!parsed) {
        setError('Invalid product QR code. Order or invoice QR codes cannot be scanned here.')
        return
      }

      if (!parsed.isLegacy && parsed.slug !== activeSlug) {
        setError(
          `QR code belongs to another business ("${parsed.slug}"). Active business is "${activeSlug}".`
        )
        return
      }

      if (parsed.designNo) {
        loadProductFullDetails(parsed.designNo)
      }
    },
    [activeSlug, loadProductFullDetails]
  )

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

  const handleAddToCurrentOrder = () => {
    if (!scannedProduct) return
    const clamped = clampRequestSets(setsToAdd)
    const updated = addProductToDraft(scannedProduct, clamped)
    setAddedFeedback(
      `Added ${clamped} ${clamped === 1 ? 'set' : 'sets'} to current order (${updated.sets} ${
        updated.sets === 1 ? 'set' : 'sets'
      } total for Design #${scannedProduct.design_no})`
    )
    setSetsToAdd(1)
  }

  const handleGoToDraftOrder = () => {
    if (onOpenDraftOrder) {
      onOpenDraftOrder()
      return
    }
    navigate(isOwner ? '/admin?tab=orders&openDraft=1' : '/staff?openDraft=1')
  }

  // Location stock lookups
  const godownId = locations.find((l) => l.name.toLowerCase().includes('godown'))?.id
  const shopId = locations.find((l) => l.name.toLowerCase().includes('shop'))?.id

  const godownStock = scannedStock.find((s) => s.location_id === godownId)
  const shopStock = scannedStock.find((s) => s.location_id === shopId)

  const existingDraftItem = scannedProduct
    ? staffDraft.items.find(
        (i) =>
          i.product_id === scannedProduct.id ||
          i.design_no.trim().toUpperCase() === scannedProduct.design_no.trim().toUpperCase()
      )
    : undefined

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-bold text-stone-900 tracking-tight">
            Shop Floor QR Scanner & Stock Lookup
          </h2>
          <p className="text-stone-500 text-xs sm:text-sm">
            Scan bale QR labels or search by design number to inspect Godown & Shop stock and add sets to your current order
          </p>
        </div>

        {draftDesigns > 0 && (
          <Button
            type="button"
            onClick={handleGoToDraftOrder}
            className="bg-orange-700 hover:bg-orange-800 text-white font-semibold gap-2 shrink-0"
          >
            <ClipboardList className="w-4 h-4" />
            <span>
              Draft Order: {draftDesigns} {draftDesigns === 1 ? 'Design' : 'Designs'} ({draftSets}{' '}
              {draftSets === 1 ? 'Set' : 'Sets'})
            </span>
          </Button>
        )}
      </div>

      {/* Camera Trigger / Active Scanner */}
      <div className="bg-white border border-stone-200/80 rounded-xl p-5 shadow-2xs space-y-4">
        {!isScanning ? (
          <div className="text-center py-4 space-y-3">
            <Button
              size="lg"
              onClick={() => setIsScanning(true)}
              className="w-full sm:w-auto bg-orange-700 hover:bg-orange-800 text-white h-12 px-8 text-base font-bold rounded-xl"
            >
              <Camera className="w-5 h-5 mr-2" />
              Start Camera QR Scanner
            </Button>
            <p className="text-xs text-stone-500">
              Fast camera recognition for Kala product QR tags
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center pb-2.5 border-b border-stone-100">
              <span className="text-xs font-bold text-stone-700 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                Camera Scanner Active
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsScanning(false)}
                className="h-8 text-stone-700"
              >
                <X className="w-4 h-4 mr-1" /> Close Camera
              </Button>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-stone-950 aspect-video max-w-sm mx-auto">
              <div id="shop-floor-scanner-view" className="w-full h-full" />
              <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-white/40 m-6 rounded-lg" />
            </div>

            {cameraError && (
              <div className="text-xs bg-red-50 text-red-700 p-3 rounded-lg border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  {cameraError}. Please allow camera permissions in your browser, or use manual design search below.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Fallback Manual Search */}
        <div className="border-t border-stone-200/80 pt-4">
          <form onSubmit={handleManualSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input
                aria-label="Manual design search"
                placeholder="Type design number or brand (e.g. 4955)..."
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                className="pl-9 bg-stone-50/70 text-sm"
              />
            </div>
            <Button type="submit" disabled={searching || !manualQuery.trim()} variant="outline">
              {searching ? 'Searching...' : 'Find Design'}
            </Button>
          </form>

          {manualResults.length > 0 && (
            <div className="mt-2 bg-white border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-52 overflow-y-auto shadow-xs">
              {manualResults.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    loadProductFullDetails(p.design_no)
                    setManualResults([])
                    setManualQuery('')
                  }}
                  className="w-full p-3 hover:bg-orange-50 text-left flex justify-between items-center text-xs transition-colors"
                >
                  <div>
                    <span className="font-bold text-stone-900">Design #{p.design_no}</span>
                    {p.brand && <span className="text-stone-500 ml-1.5">({p.brand})</span>}
                  </div>
                  <span className="text-orange-700 font-bold tabular-nums">
                    {p.rate ? formatCurrency(p.rate) : 'On Request'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Scanned Product Card */}
      {scannedProduct && (
        <div className="bg-white border border-stone-200/80 rounded-xl overflow-hidden shadow-2xs">
          {/* Media viewer */}
          {scannedMedia.length > 0 ? (
            <div className="relative bg-stone-950 aspect-video flex items-center justify-center">
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
                    type="button"
                    aria-label="Previous photo"
                    onClick={() =>
                      setCurrentMediaIdx(
                        (prev) => (prev - 1 + scannedMedia.length) % scannedMedia.length
                      )
                    }
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 bg-black/60 text-white p-2 rounded-full hover:bg-black"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next photo"
                    onClick={() => setCurrentMediaIdx((prev) => (prev + 1) % scannedMedia.length)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-black/60 text-white p-2 rounded-full hover:bg-black"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 bg-black/65 text-white text-[11px] px-2.5 py-0.5 rounded-md font-mono">
                    {currentMediaIdx + 1} / {scannedMedia.length}
                  </div>
                </>
              )}
            </div>
          ) : scannedProduct.image_url ? (
            <div className="aspect-video bg-stone-100 flex items-center justify-center overflow-hidden">
              <img src={scannedProduct.image_url} alt="" className="w-full h-full object-cover" />
            </div>
          ) : null}

          {/* Details body */}
          <div className="p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap justify-between items-start gap-4">
              <div>
                <span className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">
                  Design Number
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-stone-900 tracking-tight">
                  #{scannedProduct.design_no}
                </h3>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {scannedProduct.brand && (
                    <span className="bg-stone-100 text-stone-700 border border-stone-200/80 text-xs px-2.5 py-0.5 rounded-md font-medium">
                      {scannedProduct.brand}
                    </span>
                  )}
                  {scannedProduct.collection_name && (
                    <span className="bg-stone-100 text-stone-700 border border-stone-200/80 text-xs px-2.5 py-0.5 rounded-md font-medium">
                      {scannedProduct.collection_name}
                    </span>
                  )}
                  {scannedProduct.fabric && (
                    <span className="bg-orange-50 text-orange-800 border border-orange-200/80 text-xs px-2.5 py-0.5 rounded-md font-medium">
                      {scannedProduct.fabric}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right">
                <span className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold block">
                  Wholesale Rate
                </span>
                <p className="text-2xl font-extrabold text-orange-700 tabular-nums">
                  {scannedProduct.rate ? formatCurrency(scannedProduct.rate) : 'On Request'}
                  {scannedProduct.rate ? (
                    <span className="text-xs text-stone-500 font-normal">/pc</span>
                  ) : null}
                </p>
                <p className="text-xs text-stone-600 font-medium mt-0.5">
                  {scannedProduct.pcs_per_set || 1} pcs/set
                  {scannedProduct.rate && scannedProduct.pcs_per_set
                    ? ` • ${formatCurrency(scannedProduct.rate * scannedProduct.pcs_per_set)}/set`
                    : ''}
                </p>
              </div>
            </div>

            {/* Inventory Availability Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Shop Floor Stock */}
              <div className="p-4 rounded-xl border border-orange-200 bg-orange-50/40 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-orange-900">
                  <Store className="w-4 h-4 text-orange-700" />
                  <span>Shop Floor Stock</span>
                </div>
                <p className="text-2xl font-extrabold text-stone-900 tabular-nums">
                  {shopStock?.sets || 0}{' '}
                  <span className="text-xs font-normal text-stone-500">sets</span>
                </p>
                <p className="text-xs text-stone-600 font-medium font-mono tabular-nums">
                  {shopStock?.total_pcs || 0} pieces ready at counter
                </p>
              </div>

              {/* Godown Warehouse Stock */}
              <div className="p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-stone-800">
                  <Warehouse className="w-4 h-4 text-stone-600" />
                  <span>Godown Warehouse</span>
                </div>
                <p className="text-2xl font-extrabold text-stone-900 tabular-nums">
                  {godownStock?.sets || 0}{' '}
                  <span className="text-xs font-normal text-stone-500">sets</span>
                </p>
                <p className="text-xs text-stone-600 font-medium font-mono tabular-nums">
                  {godownStock?.total_pcs || 0} pieces in warehouse reserve
                </p>
              </div>
            </div>

            {scannedProduct.description && (
              <p className="text-xs text-stone-600 bg-stone-50 p-3 rounded-lg border border-stone-200/70">
                {scannedProduct.description}
              </p>
            )}

            {/* Shared Staff Order Draft Controls */}
            <div className="pt-4 border-t border-stone-200/80 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-stone-800">Sets to Add to Current Order</span>
                {existingDraftItem && (
                  <span className="font-bold text-orange-800 bg-orange-50 border border-orange-200 px-2.5 py-0.5 rounded-md">
                    In Current Order: {existingDraftItem.sets}{' '}
                    {existingDraftItem.sets === 1 ? 'set' : 'sets'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <QuantityStepper
                  value={setsToAdd}
                  onChange={(next) => setSetsToAdd(clampRequestSets(next))}
                  min={1}
                  max={500}
                />

                <Button
                  type="button"
                  onClick={handleAddToCurrentOrder}
                  className="flex-1 min-w-[180px] bg-stone-900 hover:bg-stone-800 text-white font-semibold h-11"
                >
                  <ShoppingCart className="w-4 h-4 mr-1.5" />
                  Add to Current Order
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    navigate(`/${activeSlug}/p/${encodeURIComponent(scannedProduct.design_no)}`)
                  }
                  className="h-11 text-stone-700"
                >
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                  Public Page
                </Button>
              </div>

              {addedFeedback && (
                <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3.5 py-2.5 rounded-xl text-xs font-medium">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>{addedFeedback}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleGoToDraftOrder}
                    className="font-bold underline text-emerald-900 shrink-0"
                  >
                    Open Draft Order →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
