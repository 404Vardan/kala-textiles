import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuantityStepper, LoadingState, EmptyState } from '@/components/ui/primitives'
import { fetchPublicProduct, fetchProduct } from '@/services/products'
import { fetchLocations, fetchStockByProduct } from '@/services/inventory'
import { createPublicInquiry } from '@/services/inquiries'
import {
  addToOrderRequestCart,
  clampRequestSets,
  getOrderRequestCartSummary,
  ORDER_REQUEST_CART_EVENT,
} from '@/services/orderRequestCart'
import { useAuth } from '@/contexts/AuthContext'
import { useStaffOrderDraft } from '@/contexts/StaffOrderDraftContext'
import { KalaLogo, resolveBrandName } from '@/components/common/KalaLogo'
import type { InventoryLocation, InventoryStock, Product, PublicProduct } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import {
  ChevronLeft,
  ChevronRight,
  Send,
  ArrowLeft,
  Package,
  ShoppingBag,
  CheckCircle2,
  Warehouse,
  Store,
  ClipboardList,
  ArrowRight,
  Film,
  Layers,
} from 'lucide-react'

export default function ProductPage() {
  const { designNo, slug = 'rangoli' } = useParams<{ designNo: string; slug?: string }>()
  const navigate = useNavigate()
  const normalizedSlug = (slug || 'rangoli').trim().toLowerCase() || 'rangoli'

  const { user, business, isStaff, isOwner } = useAuth()
  const {
    addProductToDraft,
    draft: staffDraft,
    totalDesigns: staffDraftDesigns,
    totalSets: staffDraftSets,
  } = useStaffOrderDraft()

  const [product, setProduct] = useState<PublicProduct | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentSlide, setCurrentSlide] = useState(0)

  // Customer Order List controls
  const [orderSets, setOrderSets] = useState(1)
  const [addedFeedback, setAddedFeedback] = useState('')
  const [cartSummary, setCartSummary] = useState(() => getOrderRequestCartSummary(normalizedSlug))

  // Staff Operations state (authenticated staff of same business only)
  const isAuthorizedStaffForSlug = Boolean(
    user &&
      isStaff &&
      business?.slug &&
      business.slug.trim().toLowerCase() === normalizedSlug
  )
  const [staffProduct, setStaffProduct] = useState<Product | null>(null)
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [stockRows, setStockRows] = useState<InventoryStock[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [staffError, setStaffError] = useState('')
  const [staffSetsToAdd, setStaffSetsToAdd] = useState(1)
  const [staffAddedMsg, setStaffAddedMsg] = useState('')

  // Inquiry form
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const syncCartSummary = useCallback(() => {
    setCartSummary(getOrderRequestCartSummary(normalizedSlug))
  }, [normalizedSlug])

  useEffect(() => {
    syncCartSummary()
    const handleCartEvent = () => syncCartSummary()
    window.addEventListener(ORDER_REQUEST_CART_EVENT, handleCartEvent)
    window.addEventListener('storage', handleCartEvent)
    return () => {
      window.removeEventListener(ORDER_REQUEST_CART_EVENT, handleCartEvent)
      window.removeEventListener('storage', handleCartEvent)
    }
  }, [syncCartSummary])

  useEffect(() => {
    if (!designNo) return
    setOrderSets(1)
    setAddedFeedback('')
    setStaffAddedMsg('')
    loadProduct()
  }, [designNo, normalizedSlug])

  const loadProduct = async () => {
    try {
      setLoading(true)
      setError('')
      const prod = await fetchPublicProduct(normalizedSlug, designNo!)
      setProduct(prod)
      setCurrentSlide(0)
    } catch {
      setError('Product not found')
    } finally {
      setLoading(false)
    }
  }

  // Load private inventory & product record when authenticated staff for this business views the page
  useEffect(() => {
    if (!isAuthorizedStaffForSlug || !product?.design_no) {
      setStaffProduct(null)
      setLocations([])
      setStockRows([])
      setStaffError('')
      return
    }

    let cancelled = false
    setStaffLoading(true)
    setStaffError('')

    ;(async () => {
      try {
        const [privProd, locs] = await Promise.all([
          fetchProduct(product.design_no),
          fetchLocations(),
        ])
        if (cancelled) return

        if (!privProd) {
          setStaffError('Private product record could not be loaded.')
          return
        }

        const stocks = await fetchStockByProduct(privProd.id)
        if (cancelled) return

        setStaffProduct(privProd)
        setLocations(locs)
        setStockRows(stocks)
      } catch (err: any) {
        if (!cancelled) {
          setStaffError(err?.message || 'Unable to load live stock details.')
        }
      } finally {
        if (!cancelled) {
          setStaffLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAuthorizedStaffForSlug, product?.design_no])

  const handleAddToCustomerOrderList = () => {
    if (!product) return
    const clamped = clampRequestSets(orderSets)
    addToOrderRequestCart(normalizedSlug, product.design_no, clamped)
    syncCartSummary()
    setAddedFeedback(`Added ${clamped} ${clamped === 1 ? 'set' : 'sets'} to your Order List`)
    setOrderSets(1)
  }

  const handleAddToStaffDraftOrder = () => {
    if (!staffProduct) return
    const clamped = clampRequestSets(staffSetsToAdd)
    const updated = addProductToDraft(staffProduct, clamped)
    setStaffAddedMsg(
      `Added to Draft Order (${updated.sets} ${updated.sets === 1 ? 'set' : 'sets'} total for ${staffProduct.design_no})`
    )
    setStaffSetsToAdd(1)
  }

  const handleSubmitInquiry = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      await createPublicInquiry({
        slug: normalizedSlug,
        customerName: name,
        phone,
        designNo,
        message: message || undefined,
      })
      setSubmitted(true)
      setName('')
      setPhone('')
      setMessage('')
    } catch {
      console.error('Error submitting inquiry')
    } finally {
      setSubmitting(false)
    }
  }

  const media =
    product?.media && product.media.length > 0
      ? product.media
      : product?.image_url
      ? [{ id: 0, media_url: product.image_url, media_type: 'image' as const, sort_order: 0 }]
      : []

  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % media.length)
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + media.length) % media.length)

  const existingCartItem = product
    ? cartSummary.items.find(
        (i) => i.design_no.trim().toUpperCase() === product.design_no.trim().toUpperCase()
      )
    : undefined

  const existingStaffDraftItem = staffProduct
    ? staffDraft.items.find(
        (i) =>
          i.product_id === staffProduct.id ||
          i.design_no.trim().toUpperCase() === staffProduct.design_no.trim().toUpperCase()
      )
    : undefined

  // Compute Godown & Shop Floor stock for Staff view
  const godownLoc = locations.find((l) => l.name.toLowerCase().includes('godown'))
  const shopLoc = locations.find((l) => l.name.toLowerCase().includes('shop'))
  const godownStock = godownLoc ? stockRows.find((s) => s.location_id === godownLoc.id) : undefined
  const shopStock = shopLoc ? stockRows.find((s) => s.location_id === shopLoc.id) : undefined

  const pcsPerSet = product?.pcs_per_set && product.pcs_per_set > 0 ? product.pcs_per_set : 1
  const godownSets = godownStock?.sets ?? 0
  const godownPcs = godownStock?.total_pcs ?? godownSets * pcsPerSet
  const shopSets = shopStock?.sets ?? 0
  const shopPcs = shopStock?.total_pcs ?? shopSets * pcsPerSet

  const staffOrderPortalPath = isOwner ? '/admin?tab=orders&openDraft=1' : '/staff?openDraft=1'

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center">
        <LoadingState message="Loading product details..." />
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-4">
        <div className="bg-white border border-stone-200 rounded-xl p-8 max-w-md w-full shadow-2xs">
          <EmptyState
            icon={Package}
            title="Product Not Found"
            description={`Design "${designNo}" could not be found in this catalog.`}
            action={
              <Link to="/">
                <Button variant="outline" className="gap-1.5">
                  <ArrowLeft className="w-4 h-4" /> Back to Home
                </Button>
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`min-h-screen bg-[#f8f7f4] text-stone-900 flex flex-col justify-between ${
        cartSummary.totalDesigns > 0 ? 'pb-32' : ''
      }`}
    >
      {/* Commercial Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/"
              aria-label="Back to home"
              className="w-9 h-9 rounded-lg border border-stone-200 flex items-center justify-center text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <KalaLogo iconOnly size="sm" />
            <div className="min-w-0">
              <h1 className="font-extrabold text-base sm:text-lg text-stone-900 truncate leading-tight">
                {resolveBrandName(product.business_name)}
              </h1>
              <p className="text-xs text-stone-500 truncate">
                Wholesale Product Catalog • Design {product.design_no}
              </p>
            </div>
          </div>

          {cartSummary.totalDesigns > 0 && (
            <Link
              to={`/${normalizedSlug}/order-request`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-orange-50 text-orange-800 border border-orange-200 px-3 py-1.5 rounded-lg hover:bg-orange-100 transition-colors shrink-0"
            >
              <ShoppingBag className="w-3.5 h-3.5 text-orange-700" />
              <span>
                {cartSummary.totalDesigns}{' '}
                {cartSummary.totalDesigns === 1 ? 'Design' : 'Designs'} ·{' '}
                {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'Set' : 'Sets'}
              </span>
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-8 flex-1">
        {/* Top Product Grid: Media Gallery (Left) + Wholesale Specs & Order Controls (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Media Gallery Column */}
          <div className="lg:col-span-7 space-y-3">
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
              {media.length > 0 ? (
                <div className="relative aspect-[4/3] bg-stone-900 flex items-center justify-center">
                  {media[currentSlide].media_type === 'video' ? (
                    <video
                      key={currentSlide}
                      src={media[currentSlide].media_url}
                      className="w-full h-full object-contain bg-black"
                      controls
                      autoPlay
                      muted
                    />
                  ) : (
                    <img
                      key={currentSlide}
                      src={media[currentSlide].media_url}
                      alt={`Design ${product.design_no}`}
                      className="w-full h-full object-contain bg-stone-100"
                    />
                  )}

                  {media.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={prevSlide}
                        aria-label="Previous image"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-stone-900/75 hover:bg-stone-900 text-white flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={nextSlide}
                        aria-label="Next image"
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-stone-900/75 hover:bg-stone-900 text-white flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                      <div className="absolute bottom-3 right-3 bg-stone-900/80 text-white text-xs font-medium px-2.5 py-1 rounded-md tabular-nums">
                        {currentSlide + 1} / {media.length}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="aspect-[4/3] bg-stone-100 flex flex-col items-center justify-center gap-2 text-stone-400">
                  <Package className="w-12 h-12 stroke-[1.5]" />
                  <span className="text-xs font-medium text-stone-500">
                    Design {product.design_no}
                  </span>
                </div>
              )}
            </div>

            {/* Thumbnail Strip */}
            {media.length > 1 && (
              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {media.map((m, i) => (
                  <button
                    key={m.id || i}
                    type="button"
                    onClick={() => setCurrentSlide(i)}
                    aria-label={`View media ${i + 1}`}
                    className={`relative shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                      i === currentSlide
                        ? 'border-orange-700 ring-2 ring-orange-700/20'
                        : 'border-stone-200 opacity-75 hover:opacity-100'
                    }`}
                  >
                    {m.media_type === 'video' ? (
                      <>
                        <video src={m.media_url} className="w-full h-full object-cover" />
                        <span className="absolute bottom-1 right-1 bg-stone-900/80 text-white p-0.5 rounded">
                          <Film className="w-3 h-3" />
                        </span>
                      </>
                    ) : (
                      <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Details & Ordering Column */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white rounded-xl border border-stone-200 shadow-2xs p-5 sm:p-6 space-y-5">
              {/* Design Identifier & Metadata */}
              <div className="space-y-2.5 border-b border-stone-100 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                    Design Number
                  </span>
                  {existingCartItem && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-orange-50 text-orange-800 border border-orange-200 px-2.5 py-0.5 rounded-md">
                      In Order List: {existingCartItem.sets}{' '}
                      {existingCartItem.sets === 1 ? 'set' : 'sets'}
                    </span>
                  )}
                </div>

                <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
                  {product.design_no}
                </h2>

                {(product.brand || product.collection_name || product.fabric) && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {product.brand && (
                      <span className="bg-stone-100 text-stone-800 border border-stone-200 px-2.5 py-1 rounded-md text-xs font-semibold">
                        Brand: {product.brand}
                      </span>
                    )}
                    {product.collection_name && (
                      <span className="bg-stone-100 text-stone-800 border border-stone-200 px-2.5 py-1 rounded-md text-xs font-semibold">
                        {product.collection_name}
                      </span>
                    )}
                    {product.fabric && (
                      <span className="bg-orange-50 text-orange-800 border border-orange-200/80 px-2.5 py-1 rounded-md text-xs font-semibold">
                        Fabric: {product.fabric}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Wholesale Rate & Set Specification */}
              <div className="grid grid-cols-2 gap-3 bg-stone-50 rounded-lg p-3.5 border border-stone-200/80">
                <div>
                  <span className="text-xs font-medium text-stone-500 block">Wholesale Rate</span>
                  {product.rate ? (
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-xl sm:text-2xl font-bold text-orange-700 tabular-nums">
                        {formatCurrency(product.rate)}
                      </span>
                      <span className="text-xs text-stone-500 font-medium">/ pc</span>
                    </div>
                  ) : (
                    <span className="text-sm font-semibold text-stone-700 mt-1 block">
                      Rate on Inquiry
                    </span>
                  )}
                </div>

                <div className="border-l border-stone-200 pl-3">
                  <span className="text-xs font-medium text-stone-500 block">Set Packing</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <Layers className="w-3.5 h-3.5 text-stone-500 self-center mr-0.5" />
                    <span className="text-base sm:text-lg font-bold text-stone-900 tabular-nums">
                      {pcsPerSet} {pcsPerSet === 1 ? 'Pc' : 'Pcs'}
                    </span>
                    <span className="text-xs text-stone-500">/ set</span>
                  </div>
                  {product.rate && pcsPerSet > 1 && (
                    <span className="text-xs text-stone-500 block tabular-nums">
                      {formatCurrency(product.rate * pcsPerSet)} / set
                    </span>
                  )}
                </div>
              </div>

              {product.description && (
                <div className="text-sm text-stone-600 leading-relaxed bg-stone-50/60 p-3 rounded-lg border border-stone-200/60">
                  {product.description}
                </div>
              )}

              {/* Buyer Order List Controls */}
              <div className="pt-2 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-stone-700">
                    Select Quantity (Sets)
                  </Label>
                  <span className="text-xs text-stone-500 font-medium tabular-nums">
                    {orderSets} {orderSets === 1 ? 'set' : 'sets'} = {orderSets * pcsPerSet}{' '}
                    {orderSets * pcsPerSet === 1 ? 'piece' : 'pieces'}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <QuantityStepper
                    value={orderSets}
                    onChange={setOrderSets}
                    min={1}
                    max={500}
                    size="lg"
                    ariaLabel="Number of sets to add to order list"
                    className="w-full sm:w-auto justify-between"
                  />

                  <Button
                    type="button"
                    size="lg"
                    onClick={handleAddToCustomerOrderList}
                    className="flex-1 h-12 bg-orange-700 hover:bg-orange-800 text-white font-bold rounded-lg gap-2 text-sm sm:text-base shadow-xs"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span>Add to Order List</span>
                  </Button>
                </div>

                {addedFeedback && (
                  <div
                    role="status"
                    className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 text-emerald-900 px-3.5 py-2.5 rounded-lg text-xs sm:text-sm"
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>{addedFeedback}</span>
                    </div>
                    <Link
                      to={`/${normalizedSlug}/order-request`}
                      className="text-xs font-bold text-emerald-900 underline shrink-0"
                    >
                      Review Order →
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Authenticated Staff Operations Card */}
            {isAuthorizedStaffForSlug && (
              <div className="bg-stone-900 text-white rounded-xl shadow-sm border border-stone-800 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="bg-orange-600/20 text-orange-400 border border-orange-500/30 text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md">
                      Staff Mode
                    </span>
                    <h3 className="font-bold text-sm sm:text-base">
                      Live Inventory & Staff Order
                    </h3>
                  </div>

                  {staffDraftDesigns > 0 && (
                    <button
                      type="button"
                      onClick={() => navigate(staffOrderPortalPath)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-orange-700 hover:bg-orange-600 text-white px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      <span>
                        Draft: {staffDraftDesigns} · {staffDraftSets}{' '}
                        {staffDraftSets === 1 ? 'set' : 'sets'}
                      </span>
                    </button>
                  )}
                </div>

                {staffLoading ? (
                  <p className="text-xs text-stone-400 py-2">Loading live inventory...</p>
                ) : staffError ? (
                  <p className="text-xs text-red-300 bg-red-950/60 border border-red-800/60 rounded-lg p-3">
                    {staffError}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-stone-800/90 border border-stone-700 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 text-xs text-stone-300 mb-1">
                          <Warehouse className="w-3.5 h-3.5 text-sky-400" />
                          <span>Godown Stock</span>
                        </div>
                        <p className="text-lg font-bold text-white tabular-nums">
                          {godownSets}{' '}
                          <span className="text-xs font-normal text-stone-300">sets</span>
                        </p>
                        <p className="text-xs text-stone-400 tabular-nums">{godownPcs} pcs</p>
                      </div>

                      <div className="bg-stone-800/90 border border-stone-700 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 text-xs text-stone-300 mb-1">
                          <Store className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Shop Floor</span>
                        </div>
                        <p className="text-lg font-bold text-white tabular-nums">
                          {shopSets}{' '}
                          <span className="text-xs font-normal text-stone-300">sets</span>
                        </p>
                        <p className="text-xs text-stone-400 tabular-nums">{shopPcs} pcs</p>
                      </div>
                    </div>

                    {staffProduct && (
                      <div className="pt-1 space-y-3">
                        <div className="flex items-center justify-between text-xs text-stone-300">
                          <span>Add to Staff Draft Order</span>
                          {existingStaffDraftItem && (
                            <span className="text-orange-400 font-semibold">
                              In Draft: {existingStaffDraftItem.sets}{' '}
                              {existingStaffDraftItem.sets === 1 ? 'set' : 'sets'}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                          <QuantityStepper
                            value={staffSetsToAdd}
                            onChange={setStaffSetsToAdd}
                            min={1}
                            max={500}
                            variant="dark"
                            ariaLabel="Sets to add to staff draft order"
                            className="w-full sm:w-auto justify-between"
                          />

                          <Button
                            type="button"
                            onClick={handleAddToStaffDraftOrder}
                            className="flex-1 h-10 bg-orange-700 hover:bg-orange-600 text-white font-semibold rounded-lg gap-1.5"
                          >
                            <ClipboardList className="w-4 h-4" />
                            <span>Add to Current Order</span>
                          </Button>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => navigate(staffOrderPortalPath)}
                          className="w-full h-9 border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-100 rounded-lg gap-1.5 text-xs"
                        >
                          <span>Open Staff Order Form</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>

                        {staffAddedMsg && (
                          <div className="flex items-center justify-between gap-2 bg-emerald-950/70 border border-emerald-700/60 text-emerald-200 px-3 py-2 rounded-lg text-xs">
                            <span>{staffAddedMsg}</span>
                            <button
                              type="button"
                              onClick={() => navigate(staffOrderPortalPath)}
                              className="font-bold underline text-white shrink-0 cursor-pointer"
                            >
                              Open Draft
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Customer Inquiry Card */}
        <section className="bg-white rounded-xl border border-stone-200 shadow-2xs p-5 sm:p-6">
          <div className="max-w-2xl space-y-4">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-stone-900">
                Have a Question About Design {product.design_no}?
              </h3>
              <p className="text-xs sm:text-sm text-stone-500">
                Send a direct inquiry for bulk pricing, custom dispatch, or fabric availability.
              </p>
            </div>

            {submitted ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                    <Send className="w-5 h-5 text-emerald-700" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-emerald-900">Inquiry Sent to Shop</p>
                    <p className="text-xs text-emerald-800">
                      Our sales team will contact you shortly regarding Design {product.design_no}.
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSubmitted(false)}>
                  Send Another Inquiry
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmitInquiry} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="inquiry-name">Your Name / Firm Name *</Label>
                    <Input
                      id="inquiry-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your name"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inquiry-phone">Phone Number *</Label>
                    <Input
                      id="inquiry-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inquiry-message">Message (Optional)</Label>
                  <Input
                    id="inquiry-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Specific quantity, station, or dispatch inquiry..."
                  />
                </div>
                <div>
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full sm:w-auto border-stone-300 text-stone-800 hover:bg-stone-100"
                    disabled={submitting || !name.trim() || !phone.trim()}
                  >
                    <Send className="w-4 h-4 mr-1.5 text-orange-700" />
                    {submitting ? 'Sending Inquiry...' : 'Send Inquiry'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white text-center py-4 px-4 text-xs text-stone-500">
        © {new Date().getFullYear()} {resolveBrandName(product.business_name)} • Textile Wholesale Management System
      </footer>

      {/* Mobile-Safe Floating Bottom Order Bar */}
      {cartSummary.totalDesigns > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-xs border-t border-stone-200 shadow-lg px-4 pt-3 pb-safe">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm sm:text-base font-bold text-stone-900 truncate tabular-nums">
                  {cartSummary.totalDesigns}{' '}
                  {cartSummary.totalDesigns === 1 ? 'design' : 'designs'} ·{' '}
                  {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'set' : 'sets'}
                </p>
                <p className="text-xs text-stone-500 truncate">
                  Saved in your wholesale order list
                </p>
              </div>
            </div>

            <Link
              to={`/${normalizedSlug}/order-request`}
              className="inline-flex items-center gap-1.5 font-bold text-xs sm:text-sm bg-orange-700 hover:bg-orange-800 text-white px-4 py-2.5 rounded-lg shadow-xs transition-colors shrink-0"
            >
              <span>Review Order</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
