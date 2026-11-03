import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuantityStepper, EmptyState, StatusBadge } from '@/components/ui/primitives'
import {
  clampRequestSets,
  clearOrderRequestCart,
  getOrderRequestCartSummary,
  ORDER_REQUEST_CART_EVENT,
  removeFromOrderRequestCart,
  updateOrderRequestCartItemSets,
} from '@/services/orderRequestCart'
import { submitOrderRequest } from '@/services/orderRequests'
import { fetchPublicBusinessSettings, normalizeWhatsAppDigits } from '@/services/adminSettings'
import { fetchPublicProduct } from '@/services/products'
import { KalaLogo, resolveBrandName } from '@/components/common/KalaLogo'
import type { PublicBusinessSettings, PublicProduct } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import {
  ArrowLeft,
  ShoppingBag,
  Trash2,
  MessageCircle,
  Send,
  CheckCircle2,
  AlertCircle,
  QrCode,
} from 'lucide-react'

export default function OrderRequestPage() {
  const { slug = 'rangoli' } = useParams<{ slug?: string }>()
  const normalizedSlug = (slug || 'rangoli').trim().toLowerCase() || 'rangoli'

  const [cartSummary, setCartSummary] = useState(() => getOrderRequestCartSummary(normalizedSlug))
  const [productMap, setProductMap] = useState<Record<string, PublicProduct>>({})
  const [businessSettings, setBusinessSettings] = useState<PublicBusinessSettings | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(true)

  // Customer form inputs
  const [partyName, setPartyName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submittedRequestId, setSubmittedRequestId] = useState<number | null>(null)
  const [submittedSummary, setSubmittedSummary] = useState<{
    partyName: string
    phone: string
    totalDesigns: number
    totalSets: number
  } | null>(null)

  const syncCart = useCallback(() => {
    setCartSummary(getOrderRequestCartSummary(normalizedSlug))
  }, [normalizedSlug])

  useEffect(() => {
    syncCart()
    const handleUpdate = () => syncCart()
    window.addEventListener(ORDER_REQUEST_CART_EVENT, handleUpdate)
    window.addEventListener('storage', handleUpdate)
    return () => {
      window.removeEventListener(ORDER_REQUEST_CART_EVENT, handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [syncCart])

  // Load public business settings for WhatsApp number and business name
  useEffect(() => {
    let active = true
    setLoadingSettings(true)
    fetchPublicBusinessSettings(normalizedSlug)
      .then((data) => {
        if (active) setBusinessSettings(data)
      })
      .catch(() => {
        if (active) setBusinessSettings(null)
      })
      .finally(() => {
        if (active) setLoadingSettings(false)
      })
    return () => {
      active = false
    }
  }, [normalizedSlug])

  // Enrich cart items with public product metadata (thumbnail, brand, rate, pcs_per_set)
  useEffect(() => {
    let active = true
    const missingDesigns = cartSummary.items
      .map((i) => i.design_no)
      .filter((d) => !productMap[d.toUpperCase()])

    if (missingDesigns.length === 0) return

    Promise.all(
      missingDesigns.map(async (designNo) => {
        try {
          const prod = await fetchPublicProduct(normalizedSlug, designNo)
          return { key: designNo.toUpperCase(), prod }
        } catch {
          return { key: designNo.toUpperCase(), prod: null }
        }
      })
    ).then((results) => {
      if (!active) return
      setProductMap((prev) => {
        const next = { ...prev }
        for (const r of results) {
          if (r.prod) {
            next[r.key] = r.prod
          }
        }
        return next
      })
    })

    return () => {
      active = false
    }
  }, [cartSummary.items, normalizedSlug, productMap])

  const businessName = resolveBrandName(businessSettings?.business_name)
  const normalizedWhatsapp = normalizeWhatsAppDigits(businessSettings?.whatsapp_number)

  // Compute total pieces only when pcs_per_set is known for all loaded products
  const knownPieceSummary = useMemo(() => {
    if (cartSummary.items.length === 0) return { allKnown: false, totalPcs: 0 }
    let totalPcs = 0
    let allKnown = true

    for (const item of cartSummary.items) {
      const meta = productMap[item.design_no.toUpperCase()]
      if (meta?.pcs_per_set && meta.pcs_per_set > 0) {
        totalPcs += item.sets * meta.pcs_per_set
      } else {
        allKnown = false
      }
    }

    return { allKnown, totalPcs }
  }, [cartSummary.items, productMap])

  const validateCustomerFields = (): boolean => {
    setError('')
    const cleanName = partyName.trim()
    const cleanPhone = phone.trim()

    if (!cleanName) {
      setError('Please enter your name or shop/party name.')
      return false
    }
    if (cleanName.length > 120) {
      setError('Customer name cannot exceed 120 characters.')
      return false
    }
    if (!cleanPhone) {
      setError('Please enter your phone number.')
      return false
    }
    const digits = cleanPhone.replace(/[^0-9]/g, '')
    if (digits.length < 7 || digits.length > 15 || !/^[0-9+() .-]+$/.test(cleanPhone)) {
      setError('Please enter a valid phone number (7 to 15 digits).')
      return false
    }
    if (cartSummary.items.length === 0) {
      setError('Your order list is empty. Scan a product QR code to add designs.')
      return false
    }
    return true
  }

  const handleSendOnWhatsApp = () => {
    if (!validateCustomerFields()) return
    if (!normalizedWhatsapp) {
      setError(
        'WhatsApp number is not configured for this shop. Please use "Send to Shop" instead.'
      )
      return
    }

    const lines: string[] = [
      `Order Request - ${businessName}`,
      `Customer: ${partyName.trim()}`,
      `Phone: ${phone.trim()}`,
      '',
    ]

    cartSummary.items.forEach((item, idx) => {
      lines.push(`${idx + 1}. Design ${item.design_no} - ${item.sets} sets`)
    })

    lines.push('')
    lines.push(`Total: ${cartSummary.totalDesigns} designs, ${cartSummary.totalSets} sets`)

    if (note.trim()) {
      lines.push(`Note: ${note.trim()}`)
    }

    const messageText = lines.join('\n')
    const waUrl = `https://wa.me/${normalizedWhatsapp}?text=${encodeURIComponent(messageText)}`
    window.open(waUrl, '_blank', 'noopener,noreferrer')
  }

  const handleSendToShop = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateCustomerFields()) return

    setSubmitting(true)
    setError('')

    try {
      const requestId = await submitOrderRequest({
        slug: normalizedSlug,
        partyName: partyName.trim(),
        phone: phone.trim(),
        items: cartSummary.items,
        note: note.trim() || undefined,
      })

      setSubmittedSummary({
        partyName: partyName.trim(),
        phone: phone.trim(),
        totalDesigns: cartSummary.totalDesigns,
        totalSets: cartSummary.totalSets,
      })
      setSubmittedRequestId(requestId)

      // Clear local cart only after server confirms request creation
      clearOrderRequestCart(normalizedSlug)
      syncCart()
    } catch (err: any) {
      setError(err?.message || 'Failed to submit order request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] text-stone-900 flex flex-col justify-between">
      {/* Page Header */}
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
                {businessName}
              </h1>
              <p className="text-xs text-stone-500 truncate">Wholesale Order Request Review</p>
            </div>
          </div>

          <Link to="/">
            <Button variant="outline" size="sm" className="gap-1.5">
              <QrCode className="w-3.5 h-3.5 text-orange-700" />
              <span>Browse / Scan More</span>
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 flex-1">
        {submittedRequestId !== null && submittedSummary ? (
          /* Success State */
          <div className="max-w-xl mx-auto bg-white rounded-xl border border-stone-200 shadow-2xs p-6 sm:p-8 text-center space-y-5">
            <div className="w-14 h-14 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2">
                <StatusBadge status="requested" label="Order Request Received" />
                <span className="text-xs font-mono font-bold bg-stone-100 text-stone-800 border border-stone-200 px-2.5 py-0.5 rounded-md">
                  Ref #{submittedRequestId}
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-stone-900 pt-1">
                Request Sent to {businessName}
              </h2>

              <p className="text-sm text-stone-600 leading-relaxed max-w-md mx-auto">
                Thank you, <strong>{submittedSummary.partyName}</strong>. Your wholesale request for{' '}
                <strong>{submittedSummary.totalDesigns}</strong>{' '}
                {submittedSummary.totalDesigns === 1 ? 'design' : 'designs'} (
                <strong>{submittedSummary.totalSets}</strong>{' '}
                {submittedSummary.totalSets === 1 ? 'set' : 'sets'}) has been submitted for review.
              </p>
            </div>

            <div className="bg-stone-50 border border-stone-200/80 rounded-lg p-3.5 text-xs text-stone-600 text-left space-y-1">
              <p className="font-semibold text-stone-800">What happens next?</p>
              <p>
                This is an order request. Our shop team will review design availability, prepare
                your draft wholesale order, and contact you at{' '}
                <strong>{submittedSummary.phone}</strong> to confirm dispatch.
              </p>
            </div>

            <div className="pt-2">
              <Link to="/">
                <Button size="lg" className="gap-2">
                  <QrCode className="w-4 h-4" />
                  <span>Continue Browsing Designs</span>
                </Button>
              </Link>
            </div>
          </div>
        ) : cartSummary.items.length === 0 ? (
          /* Empty State */
          <div className="max-w-lg mx-auto bg-white rounded-xl border border-stone-200 shadow-2xs p-6 sm:p-8">
            <EmptyState
              icon={ShoppingBag}
              title="Your Order List is Empty"
              description="Scan a product QR label or open a design catalog link to add sets to your wholesale order request."
              action={
                <Link to="/">
                  <Button size="lg" className="gap-2">
                    <QrCode className="w-4 h-4" />
                    <span>Browse or Scan Designs</span>
                  </Button>
                </Link>
              }
            />
          </div>
        ) : (
          /* Two-Column Wholesale Order Checkout Layout */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
            {/* Left Column: Selected Design List */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-stone-200 shadow-2xs overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-orange-700" />
                  <h2 className="font-bold text-sm sm:text-base text-stone-900">
                    Selected Designs
                  </h2>
                </div>
                <span className="text-xs font-semibold text-stone-700 bg-white border border-stone-200 px-2.5 py-1 rounded-md tabular-nums">
                  {cartSummary.totalDesigns}{' '}
                  {cartSummary.totalDesigns === 1 ? 'Design' : 'Designs'} ·{' '}
                  {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'Set' : 'Sets'}
                </span>
              </div>

              <div className="divide-y divide-stone-100">
                {cartSummary.items.map((item) => {
                  const meta = productMap[item.design_no.toUpperCase()]
                  const thumb = meta?.media?.[0]?.media_url || meta?.image_url
                  const pcsPerSet =
                    meta?.pcs_per_set && meta.pcs_per_set > 0 ? meta.pcs_per_set : null

                  return (
                    <div
                      key={item.design_no}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {thumb ? (
                          <Link
                            to={`/${normalizedSlug}/p/${encodeURIComponent(item.design_no)}`}
                            className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 shrink-0"
                          >
                            <img
                              src={thumb}
                              alt={`Design ${item.design_no}`}
                              className="w-full h-full object-cover"
                            />
                          </Link>
                        ) : (
                          <Link
                            to={`/${normalizedSlug}/p/${encodeURIComponent(item.design_no)}`}
                            className="w-16 h-16 rounded-lg bg-orange-50 border border-orange-200 flex flex-col items-center justify-center text-orange-800 shrink-0 px-1"
                          >
                            <span className="text-[10px] uppercase font-semibold text-orange-600">
                              Design
                            </span>
                            <span className="font-bold text-xs truncate max-w-full">
                              {item.design_no}
                            </span>
                          </Link>
                        )}

                        <div className="space-y-1 min-w-0">
                          <Link
                            to={`/${normalizedSlug}/p/${encodeURIComponent(item.design_no)}`}
                            className="font-bold text-base sm:text-lg text-stone-900 hover:text-orange-700 transition-colors block truncate"
                          >
                            Design {item.design_no}
                          </Link>

                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-500">
                            {meta?.brand && (
                              <span className="font-medium text-stone-700">{meta.brand}</span>
                            )}
                            {meta?.fabric && <span>• {meta.fabric}</span>}
                            {pcsPerSet && (
                              <span className="tabular-nums">
                                • {pcsPerSet} pcs/set ({item.sets * pcsPerSet} pcs)
                              </span>
                            )}
                            {meta?.rate && (
                              <span className="font-semibold text-stone-700 tabular-nums">
                                • {formatCurrency(meta.rate)}/pc
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-stone-100">
                        <span className="text-xs font-medium text-stone-500 sm:hidden">
                          Quantity (Sets)
                        </span>
                        <div className="flex items-center gap-2">
                          <QuantityStepper
                            value={item.sets}
                            onChange={(nextSets) =>
                              updateOrderRequestCartItemSets(
                                normalizedSlug,
                                item.design_no,
                                clampRequestSets(nextSets)
                              )
                            }
                            min={1}
                            max={500}
                            size="sm"
                            disabled={submitting}
                            ariaLabel={`Set quantity for Design ${item.design_no}`}
                          />

                          <button
                            type="button"
                            onClick={() =>
                              removeFromOrderRequestCart(normalizedSlug, item.design_no)
                            }
                            disabled={submitting}
                            className="w-8 h-8 flex items-center justify-center text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                            aria-label={`Remove design ${item.design_no} from order list`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right Column: Order Summary + Customer Info + Submission Actions */}
            <div className="lg:col-span-5 space-y-5">
              {/* Order Summary Card */}
              <div className="bg-white rounded-xl border border-stone-200 shadow-2xs p-5 space-y-3">
                <h3 className="font-bold text-sm uppercase tracking-wider text-stone-600">
                  Order Request Summary
                </h3>

                <div className="divide-y divide-stone-100 text-sm">
                  <div className="py-2 flex items-center justify-between">
                    <span className="text-stone-600">Selected Designs</span>
                    <strong className="font-bold text-stone-900 tabular-nums">
                      {cartSummary.totalDesigns}
                    </strong>
                  </div>
                  <div className="py-2 flex items-center justify-between">
                    <span className="text-stone-600">Total Requested Sets</span>
                    <strong className="font-bold text-orange-700 text-base tabular-nums">
                      {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'Set' : 'Sets'}
                    </strong>
                  </div>
                  {knownPieceSummary.allKnown && knownPieceSummary.totalPcs > 0 && (
                    <div className="py-2 flex items-center justify-between">
                      <span className="text-stone-600">Total Pieces</span>
                      <strong className="font-semibold text-stone-800 tabular-nums">
                        {knownPieceSummary.totalPcs} Pcs
                      </strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer Information & Submission Form */}
              <form
                onSubmit={handleSendToShop}
                className="bg-white rounded-xl border border-stone-200 shadow-2xs p-5 sm:p-6 space-y-4"
              >
                <div className="border-b border-stone-100 pb-3">
                  <h3 className="font-bold text-base text-stone-900">Buyer Information</h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Enter your party details so the shop can review and confirm your request.
                  </p>
                </div>

                <div className="space-y-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="buyer-name">Customer / Firm Name *</Label>
                    <Input
                      id="buyer-name"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      placeholder="e.g. Shree Ganesh Textiles"
                      maxLength={120}
                      required
                      disabled={submitting}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="buyer-phone">Phone / WhatsApp Number *</Label>
                    <Input
                      id="buyer-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      maxLength={20}
                      required
                      disabled={submitting}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="buyer-note">Order Note (Optional)</Label>
                    <Input
                      id="buyer-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Station, transport preference, or special instructions..."
                      maxLength={1000}
                      disabled={submitting}
                    />
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg text-xs sm:text-sm font-medium"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="space-y-2.5 pt-2">
                  {/* Primary Action: Send to Shop */}
                  <Button
                    type="submit"
                    size="lg"
                    disabled={submitting || !partyName.trim() || !phone.trim()}
                    className="w-full h-11 bg-orange-700 hover:bg-orange-800 text-white font-bold rounded-lg gap-2"
                  >
                    <Send className="w-4 h-4" />
                    <span>{submitting ? 'Submitting Request...' : 'Send to Shop'}</span>
                  </Button>

                  {/* Secondary Action: Send on WhatsApp */}
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={handleSendOnWhatsApp}
                    disabled={submitting || loadingSettings || !normalizedWhatsapp}
                    className="w-full h-11 border-emerald-700 bg-emerald-50/60 text-emerald-900 hover:bg-emerald-100/80 font-bold rounded-lg gap-2"
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-700" />
                    <span>Send on WhatsApp</span>
                  </Button>
                </div>

                {!loadingSettings && !normalizedWhatsapp && (
                  <p className="text-xs text-stone-500 text-center">
                    WhatsApp contact is not configured for this business — use{' '}
                    <strong>Send to Shop</strong> to submit your request directly.
                  </p>
                )}
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white text-center py-4 px-4 text-xs text-stone-500 mt-8">
        © {new Date().getFullYear()} {businessName} • Textile Wholesale Management System
      </footer>
    </div>
  )
}
