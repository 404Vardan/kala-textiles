import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type { InventoryLocation, InventoryStock, Product, PublicProduct } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import {
  ChevronLeft,
  ChevronRight,
  Send,
  ArrowLeft,
  Package,
  ShoppingBag,
  Plus,
  Minus,
  CheckCircle2,
  Warehouse,
  Store,
  ClipboardList,
  ArrowRight,
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Package className="w-16 h-16 text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-600">Product Not Found</h1>
        <p className="text-gray-400">Design "{designNo}" could not be found</p>
        <Link to="/" className="text-orange-600 hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>
      </div>
    )
  }

  return (
    <div
      className={`min-h-screen bg-gradient-to-b from-orange-50 to-white ${
        cartSummary.totalDesigns > 0 ? 'pb-28' : ''
      }`}
    >
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-500 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-bold text-lg bg-gradient-to-r from-orange-600 to-rose-600 bg-clip-text text-transparent">
              {product.business_name || 'Rangoli Textiles'}
            </h1>
          </div>

          {cartSummary.totalDesigns > 0 && (
            <Link
              to={`/${normalizedSlug}/order-request`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-orange-100 text-orange-800 px-3 py-1.5 rounded-full hover:bg-orange-200 transition-colors"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>
                {cartSummary.totalDesigns} {cartSummary.totalDesigns === 1 ? 'Design' : 'Designs'} (
                {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'Set' : 'Sets'})
              </span>
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Media Carousel */}
        {media.length > 0 && (
          <div className="relative rounded-2xl overflow-hidden shadow-lg bg-gray-100">
            <div className="aspect-[4/3] relative">
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
                  alt={product.design_no}
                  className="w-full h-full object-contain"
                />
              )}
            </div>

            {media.length > 1 && (
              <>
                <button
                  onClick={prevSlide}
                  className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={nextSlide}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {media.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentSlide(i)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        i === currentSlide ? 'bg-white' : 'bg-white/50'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Thumbnail strip */}
        {media.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {media.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setCurrentSlide(i)}
                className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                  i === currentSlide ? 'border-orange-500' : 'border-transparent'
                }`}
              >
                {m.media_type === 'video' ? (
                  <video src={m.media_url} className="w-full h-full object-cover" />
                ) : (
                  <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Product Details & Buyer Order Controls */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 space-y-5">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">{product.design_no}</h2>
            <div className="flex flex-wrap gap-2 mt-2">
              {product.brand && (
                <span className="bg-orange-50 text-orange-700 px-3 py-1 rounded-full text-sm font-medium">
                  {product.brand}
                </span>
              )}
              {product.collection_name && (
                <span className="bg-rose-50 text-rose-700 px-3 py-1 rounded-full text-sm font-medium">
                  {product.collection_name}
                </span>
              )}
              {product.fabric && (
                <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full text-sm font-medium">
                  {product.fabric}
                </span>
              )}
            </div>
          </div>

          {product.rate && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-orange-600">
                {formatCurrency(product.rate)}
              </span>
              <span className="text-gray-400">/piece</span>
            </div>
          )}

          {product.pcs_per_set && product.pcs_per_set > 1 && (
            <p className="text-sm text-gray-500">
              {product.pcs_per_set} pieces per set
              {product.rate && ` • ${formatCurrency(product.rate * product.pcs_per_set)}/set`}
            </p>
          )}

          {product.description && (
            <p className="text-gray-600 leading-relaxed">{product.description}</p>
          )}

          {/* Buyer Order List Controls */}
          <div className="pt-4 border-t border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">Order Quantity (Sets)</span>
              {existingCartItem && (
                <span className="text-xs font-medium bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full">
                  In Order List: {existingCartItem.sets}{' '}
                  {existingCartItem.sets === 1 ? 'set' : 'sets'}
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* Stepper */}
              <div className="inline-flex items-center justify-between sm:justify-start border rounded-xl bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => setOrderSets((prev) => clampRequestSets(prev - 1))}
                  disabled={orderSets <= 1}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-700 hover:bg-white hover:shadow-sm disabled:opacity-40 transition-all"
                  aria-label="Decrease sets"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={orderSets}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (!Number.isNaN(val)) {
                      setOrderSets(clampRequestSets(val))
                    }
                  }}
                  className="w-16 text-center font-bold text-lg bg-transparent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setOrderSets((prev) => clampRequestSets(prev + 1))}
                  disabled={orderSets >= 500}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-700 hover:bg-white hover:shadow-sm disabled:opacity-40 transition-all"
                  aria-label="Increase sets"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <Button
                type="button"
                onClick={handleAddToCustomerOrderList}
                className="flex-1 h-12 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl gap-2 text-base"
              >
                <ShoppingBag className="w-5 h-5" />
                Add to Order List
              </Button>
            </div>

            {addedFeedback && (
              <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 text-green-800 px-3.5 py-2.5 rounded-xl text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <span>{addedFeedback}</span>
                </div>
                <Link
                  to={`/${normalizedSlug}/order-request`}
                  className="text-xs font-bold text-green-900 underline shrink-0"
                >
                  Review Order
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Authenticated Staff Operations Section (shown ONLY to logged-in staff/owner of this business) */}
        {isAuthorizedStaffForSlug && (
          <div className="bg-slate-900 text-white rounded-2xl shadow-md border border-slate-800 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
                  Staff Mode
                </span>
                <h3 className="font-semibold text-base">Live Inventory & Staff Order</h3>
              </div>

              {staffDraftDesigns > 0 && (
                <button
                  type="button"
                  onClick={() => navigate(staffOrderPortalPath)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span>
                    Active Draft: {staffDraftDesigns}{' '}
                    {staffDraftDesigns === 1 ? 'Design' : 'Designs'} ({staffDraftSets}{' '}
                    {staffDraftSets === 1 ? 'Set' : 'Sets'})
                  </span>
                </button>
              )}
            </div>

            {staffLoading ? (
              <p className="text-sm text-slate-400 py-2">Loading live inventory...</p>
            ) : staffError ? (
              <p className="text-sm text-red-400 bg-red-950/50 border border-red-800/50 rounded-lg p-3">
                {staffError}
              </p>
            ) : (
              <>
                {/* Godown & Shop Floor Stock Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-3.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                      <Warehouse className="w-3.5 h-3.5 text-blue-400" />
                      <span>Godown Stock</span>
                    </div>
                    <p className="text-xl font-bold text-white">
                      {godownSets} <span className="text-sm font-normal text-slate-300">Sets</span>
                    </p>
                    <p className="text-xs text-slate-400">{godownPcs} Pcs</p>
                  </div>

                  <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-3.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                      <Store className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Shop Floor Stock</span>
                    </div>
                    <p className="text-xl font-bold text-white">
                      {shopSets} <span className="text-sm font-normal text-slate-300">Sets</span>
                    </p>
                    <p className="text-xs text-slate-400">{shopPcs} Pcs</p>
                  </div>
                </div>

                {/* Add to Current Staff Order */}
                {staffProduct && (
                  <div className="pt-2 space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span>Add to Staff Draft Order (Sets)</span>
                      {existingStaffDraftItem && (
                        <span className="text-orange-400 font-semibold">
                          In Current Draft: {existingStaffDraftItem.sets}{' '}
                          {existingStaffDraftItem.sets === 1 ? 'set' : 'sets'}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <div className="inline-flex items-center justify-between sm:justify-start border border-slate-700 rounded-xl bg-slate-800 p-1">
                        <button
                          type="button"
                          onClick={() => setStaffSetsToAdd((prev) => clampRequestSets(prev - 1))}
                          disabled={staffSetsToAdd <= 1}
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-white hover:bg-slate-700 disabled:opacity-40"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={staffSetsToAdd}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            if (!Number.isNaN(val)) {
                              setStaffSetsToAdd(clampRequestSets(val))
                            }
                          }}
                          className="w-14 text-center font-bold text-base bg-transparent text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setStaffSetsToAdd((prev) => clampRequestSets(prev + 1))}
                          disabled={staffSetsToAdd >= 500}
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-white hover:bg-slate-700 disabled:opacity-40"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>

                      <Button
                        type="button"
                        onClick={handleAddToStaffDraftOrder}
                        className="flex-1 h-11 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded-xl gap-2"
                      >
                        <ClipboardList className="w-4 h-4" />
                        Add to Current Order
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => navigate(staffOrderPortalPath)}
                        className="h-11 border-slate-700 bg-slate-800 hover:bg-slate-700 text-white rounded-xl gap-1.5"
                      >
                        <span>Open Order Form</span>
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </div>

                    {staffAddedMsg && (
                      <div className="flex items-center justify-between gap-2 bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 px-3 py-2 rounded-lg text-xs">
                        <span>{staffAddedMsg}</span>
                        <button
                          type="button"
                          onClick={() => navigate(staffOrderPortalPath)}
                          className="font-bold underline text-emerald-200"
                        >
                          Go to Draft Order
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Inquiry Form */}
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4">Interested? Send an Inquiry</h3>

          {submitted ? (
            <div className="text-center py-6 space-y-2">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Send className="w-6 h-6 text-green-600" />
              </div>
              <p className="font-medium text-green-700">Inquiry Sent!</p>
              <p className="text-sm text-gray-500">We'll get back to you soon.</p>
              <Button variant="outline" size="sm" onClick={() => setSubmitted(false)}>
                Send Another
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmitInquiry} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Your Name *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Phone Number *</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91..."
                    required
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Message (optional)</Label>
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Any specific requirements..."
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700"
                disabled={submitting || !name.trim() || !phone.trim()}
              >
                {submitting ? 'Sending...' : 'Send Inquiry'}
              </Button>
            </form>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-sm text-gray-400">
        © {product.business_name || 'Rangoli Textiles'}
      </footer>

      {/* Floating Bottom Order Bar (Customer Order List) */}
      {cartSummary.totalDesigns > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 p-3 sm:p-4 bg-gradient-to-t from-white via-white/95 to-transparent pointer-events-none">
          <div className="max-w-xl mx-auto pointer-events-auto">
            <Link
              to={`/${normalizedSlug}/order-request`}
              className="w-full flex items-center justify-between gap-3 bg-orange-600 hover:bg-orange-700 text-white px-5 py-3.5 rounded-2xl shadow-xl transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold leading-tight">
                    {cartSummary.totalDesigns}{' '}
                    {cartSummary.totalDesigns === 1 ? 'design' : 'designs'} ·{' '}
                    {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'set' : 'sets'}
                  </p>
                  <p className="text-xs text-orange-100">Ready in your Order List</p>
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 font-bold text-sm sm:text-base bg-white text-orange-700 px-4 py-2 rounded-xl shadow-sm">
                <span>Review Order</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
