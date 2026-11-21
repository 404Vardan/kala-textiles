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
  ArrowLeft,
  ShoppingBag,
  CheckCircle2,
  ClipboardList,
  ArrowRight,
  Film,
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

  const [orderSets, setOrderSets] = useState(1)
  const [addedFeedback, setAddedFeedback] = useState('')
  const [cartSummary, setCartSummary] = useState(() => getOrderRequestCartSummary(normalizedSlug))

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
    setAddedFeedback(`Added ${clamped} ${clamped === 1 ? 'set' : 'sets'} to your order list.`)
    setOrderSets(1)
  }

  const handleAddToStaffDraftOrder = () => {
    if (!staffProduct) return
    const clamped = clampRequestSets(staffSetsToAdd)
    const updated = addProductToDraft(staffProduct, clamped)
    setStaffAddedMsg(
      `Added to draft order (${updated.sets} ${updated.sets === 1 ? 'set' : 'sets'} total).`
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

  const shopName = resolveBrandName(product?.business_name)
  const shopLogoUrl =
    (product as any)?.logo_url ||
    (business?.slug?.toLowerCase() === normalizedSlug && typeof business?.settings?.logo_url === 'string'
      ? business.settings.logo_url
      : null)

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center px-4">
        <LoadingState message="Loading product..." />
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center px-4">
        <div className="bg-white border border-[#E3E5EA] rounded-[6px] max-w-md w-full">
          <EmptyState
            title={`Design "${designNo}" could not be found.`}
            action={
              <Link to="/">
                <Button variant="outline" className="min-h-[44px]">
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Home</span>
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
      className={`min-h-screen bg-[#F4F5F7] text-[#1A1D24] flex flex-col justify-between ${
        cartSummary.totalDesigns > 0 ? 'pb-24' : ''
      }`}
    >
      {/* Shop Header */}
      <header className="bg-white border-b border-[#E3E5EA] sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              to="/"
              aria-label="Back to home"
              className="min-w-[44px] min-h-[44px] -ml-2 rounded-[6px] flex items-center justify-center text-[#1A1D24] hover:bg-[#F4F5F7] shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <KalaLogo
              size="sm"
              titleOverride={shopName}
              logoUrl={shopLogoUrl}
              showSubtitle={false}
            />
          </div>

          {cartSummary.totalDesigns > 0 && (
            <Link
              to={`/${normalizedSlug}/order-request`}
              className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold border border-[#E3E5EA] bg-white text-[#1E2A4A] px-3 rounded-[6px] hover:bg-[#F4F5F7] shrink-0 tabular-nums"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>
                {cartSummary.totalDesigns} · {cartSummary.totalSets} sets
              </span>
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-6 space-y-6 flex-1">
        {/* Image Carousel First + Product Specs & Order Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Carousel Column (First on Mobile and Desktop) */}
          <div className="lg:col-span-7 space-y-3">
            <div className="bg-white rounded-[6px] border border-[#E3E5EA] overflow-hidden">
              {media.length > 0 ? (
                <div className="relative aspect-[4/3] bg-[#F4F5F7] flex items-center justify-center">
                  {media[currentSlide].media_type === 'video' ? (
                    <video
                      key={currentSlide}
                      src={media[currentSlide].media_url}
                      className="w-full h-full object-contain bg-[#1A1D24]"
                      controls
                      autoPlay
                      muted
                    />
                  ) : (
                    <img
                      key={currentSlide}
                      src={media[currentSlide].media_url}
                      alt={`Design ${product.design_no}`}
                      className="w-full h-full object-contain"
                    />
                  )}

                  {media.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={prevSlide}
                        aria-label="Previous image"
                        className="absolute left-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] rounded-[6px] bg-white border border-[#E3E5EA] text-[#1A1D24] hover:bg-[#F4F5F7] flex items-center justify-center cursor-pointer"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={nextSlide}
                        aria-label="Next image"
                        className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] rounded-[6px] bg-white border border-[#E3E5EA] text-[#1A1D24] hover:bg-[#F4F5F7] flex items-center justify-center cursor-pointer"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                      <div className="absolute bottom-2.5 right-2.5 bg-white border border-[#E3E5EA] text-[#1A1D24] text-xs font-medium px-2.5 py-1 rounded-[6px] tabular-nums">
                        {currentSlide + 1} / {media.length}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="aspect-[4/3] bg-[#F4F5F7] flex items-center justify-center text-sm text-[#667085]">
                  No media available for Design {product.design_no}
                </div>
              )}
            </div>

            {media.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {media.map((m, i) => (
                  <button
                    key={m.id || i}
                    type="button"
                    onClick={() => setCurrentSlide(i)}
                    aria-label={`View media ${i + 1}`}
                    className={`relative shrink-0 w-16 h-16 min-w-[44px] min-h-[44px] rounded-[6px] overflow-hidden border cursor-pointer ${
                      i === currentSlide
                        ? 'border-[#1E2A4A] border-2'
                        : 'border-[#E3E5EA] opacity-75 hover:opacity-100'
                    }`}
                  >
                    {m.media_type === 'video' ? (
                      <>
                        <video src={m.media_url} className="w-full h-full object-cover" />
                        <span className="absolute bottom-1 right-1 bg-[#1A1D24] text-white p-0.5 rounded-[4px]">
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

          {/* Specs & Order Controls Column */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-[6px] border border-[#E3E5EA] p-5 space-y-5">
              {/* Large Design Number */}
              <div className="space-y-2 border-b border-[#E3E5EA] pb-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#667085]">Design Number</span>
                  {existingCartItem && (
                    <span className="text-xs font-semibold text-[#1E2A4A] border border-[#E3E5EA] px-2 py-0.5 rounded-[6px] tabular-nums">
                      In list: {existingCartItem.sets} {existingCartItem.sets === 1 ? 'set' : 'sets'}
                    </span>
                  )}
                </div>

                <h1 className="text-3xl sm:text-4xl font-bold text-[#1A1D24] tracking-tight tabular-nums">
                  {product.design_no}
                </h1>

                {(product.brand || product.collection_name || product.fabric) && (
                  <p className="text-xs text-[#667085]">
                    {[product.brand, product.collection_name, product.fabric]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>

              {/* Rate & Pcs Per Set */}
              <div className="grid grid-cols-2 gap-4 border-b border-[#E3E5EA] pb-4">
                <div>
                  <span className="text-xs font-medium text-[#667085] block">Wholesale Rate</span>
                  {product.rate ? (
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-semibold text-[#1A1D24] tabular-nums">
                        {formatCurrency(product.rate)}
                      </span>
                      <span className="text-xs text-[#667085]">/ pc</span>
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-[#1A1D24] mt-1 block">
                      Rate on inquiry
                    </span>
                  )}
                </div>

                <div className="border-l border-[#E3E5EA] pl-4">
                  <span className="text-xs font-medium text-[#667085] block">Pcs per Set</span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-semibold text-[#1A1D24] tabular-nums">
                      {pcsPerSet}
                    </span>
                    <span className="text-xs text-[#667085]">
                      {pcsPerSet === 1 ? 'pc / set' : 'pcs / set'}
                    </span>
                  </div>
                  {product.rate && pcsPerSet > 1 && (
                    <span className="text-xs text-[#667085] block tabular-nums mt-0.5">
                      {formatCurrency(product.rate * pcsPerSet)} / set
                    </span>
                  )}
                </div>
              </div>

              {product.description && (
                <p className="text-sm text-[#667085] leading-relaxed">{product.description}</p>
              )}

              {/* Add to Order List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <Label className="text-xs font-medium text-[#1A1D24]">Quantity (Sets)</Label>
                  <span className="text-[#667085] tabular-nums">
                    {orderSets} {orderSets === 1 ? 'set' : 'sets'} = {(orderSets * pcsPerSet).toLocaleString('en-IN')}{' '}
                    pcs
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
                    className="flex-1 min-h-[44px] h-11 font-semibold"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span>Add to order list</span>
                  </Button>
                </div>

                {addedFeedback && (
                  <div
                    role="status"
                    className="flex items-center justify-between gap-2 bg-white border border-[#1F7A4D] text-[#1F7A4D] px-3 py-2.5 rounded-[6px] text-xs font-medium"
                  >
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{addedFeedback}</span>
                    </div>
                    <Link
                      to={`/${normalizedSlug}/order-request`}
                      className="font-semibold underline shrink-0 min-h-[44px] inline-flex items-center"
                    >
                      Review Order
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Staff Live Stock & Draft Section (White Surface, 1px Border) */}
            {isAuthorizedStaffForSlug && (
              <div className="bg-white rounded-[6px] border border-[#E3E5EA] p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-[#E3E5EA] pb-3">
                  <div>
                    <span className="text-xs font-semibold text-[#1E2A4A]">Staff Inventory</span>
                    <h2 className="text-sm font-semibold text-[#1A1D24]">Live Stock &amp; Draft Order</h2>
                  </div>
                  {staffDraftDesigns > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(staffOrderPortalPath)}
                      className="min-h-[44px] text-xs tabular-nums"
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      <span>Draft: {staffDraftDesigns} · {staffDraftSets} sets</span>
                    </Button>
                  )}
                </div>

                {staffLoading ? (
                  <LoadingState message="Loading live stock..." className="py-4" />
                ) : staffError ? (
                  <p className="text-xs text-[#B42318] border border-[#B42318] rounded-[6px] p-3">
                    {staffError}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="border border-[#E3E5EA] rounded-[6px] p-3">
                        <span className="text-xs text-[#667085] block">Godown</span>
                        <p className="text-lg font-semibold text-[#1A1D24] tabular-nums mt-0.5">
                          {godownSets.toLocaleString('en-IN')} sets
                        </p>
                        <p className="text-xs text-[#667085] tabular-nums">
                          {godownPcs.toLocaleString('en-IN')} pcs
                        </p>
                      </div>
                      <div className="border border-[#E3E5EA] rounded-[6px] p-3">
                        <span className="text-xs text-[#667085] block">Shop Floor</span>
                        <p className="text-lg font-semibold text-[#1A1D24] tabular-nums mt-0.5">
                          {shopSets.toLocaleString('en-IN')} sets
                        </p>
                        <p className="text-xs text-[#667085] tabular-nums">
                          {shopPcs.toLocaleString('en-IN')} pcs
                        </p>
                      </div>
                    </div>

                    {staffProduct && (
                      <div className="space-y-3 pt-1">
                        <div className="flex items-center justify-between text-xs text-[#667085]">
                          <span>Add to staff draft order</span>
                          {existingStaffDraftItem && (
                            <span className="font-semibold text-[#1E2A4A] tabular-nums">
                              In draft: {existingStaffDraftItem.sets} sets
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2.5">
                          <QuantityStepper
                            value={staffSetsToAdd}
                            onChange={setStaffSetsToAdd}
                            min={1}
                            max={500}
                            size="lg"
                            ariaLabel="Sets to add to staff draft order"
                            className="w-full sm:w-auto justify-between"
                          />
                          <Button
                            type="button"
                            onClick={handleAddToStaffDraftOrder}
                            className="flex-1 min-h-[44px]"
                          >
                            <ClipboardList className="w-4 h-4" />
                            <span>Add to Current Order</span>
                          </Button>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => navigate(staffOrderPortalPath)}
                          className="w-full min-h-[44px]"
                        >
                          <span>Open Staff Order Form</span>
                          <ArrowRight className="w-4 h-4" />
                        </Button>

                        {staffAddedMsg && (
                          <p className="text-xs font-medium text-[#1F7A4D] border border-[#1F7A4D] rounded-[6px] px-3 py-2">
                            {staffAddedMsg}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Customer Inquiry Form */}
        <section className="bg-white rounded-[6px] border border-[#E3E5EA] p-5">
          <div className="max-w-2xl space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-[#1A1D24]">
                Inquire About Design {product.design_no}
              </h2>
              <p className="text-xs text-[#667085] mt-0.5">
                Send a message to {shopName} for bulk pricing or dispatch timelines.
              </p>
            </div>

            {submitted ? (
              <div className="border border-[#1F7A4D] rounded-[6px] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm font-medium text-[#1F7A4D]">
                  Inquiry sent to {shopName} for Design {product.design_no}.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSubmitted(false)}
                  className="min-h-[44px]"
                >
                  Send another
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmitInquiry} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="inquiry-name">Name / Firm Name *</Label>
                    <Input
                      id="inquiry-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your name"
                      required
                      className="min-h-[44px]"
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
                      className="min-h-[44px]"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inquiry-message">Message (Optional)</Label>
                  <Input
                    id="inquiry-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Quantity, station, or dispatch notes..."
                    className="min-h-[44px]"
                  />
                </div>
                <div>
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full sm:w-auto min-h-[44px]"
                    disabled={submitting || !name.trim() || !phone.trim()}
                  >
                    {submitting ? 'Sending...' : 'Send Inquiry'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>

      {/* Small Powered by Kala Footer */}
      <footer className="border-t border-[#E3E5EA] bg-white text-center py-3 px-4 text-xs text-[#667085]">
        Powered by Kala
      </footer>

      {/* Mobile-Safe Sticky Bottom Order Bar */}
      {cartSummary.totalDesigns > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E3E5EA] px-4 pt-3 pb-safe">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1A1D24] truncate tabular-nums">
                {cartSummary.totalDesigns}{' '}
                {cartSummary.totalDesigns === 1 ? 'design' : 'designs'} ·{' '}
                {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'set' : 'sets'}
              </p>
              <p className="text-xs text-[#667085] truncate">In your order list</p>
            </div>

            <Link
              to={`/${normalizedSlug}/order-request`}
              className="min-h-[44px] inline-flex items-center gap-1.5 font-semibold text-sm bg-[#1E2A4A] hover:bg-[#16203A] text-white px-4 rounded-[6px] shrink-0"
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
