import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type { PublicBusinessSettings, PublicProduct } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import {
  ArrowLeft,
  ShoppingBag,
  Plus,
  Minus,
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

  const businessName = businessSettings?.business_name || 'Rangoli Textiles'
  const normalizedWhatsapp = normalizeWhatsAppDigits(businessSettings?.whatsapp_number)

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
      setError('WhatsApp number is not configured for this shop. Please use "Send to Shop" instead.')
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
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-500 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-bold text-lg bg-gradient-to-r from-orange-600 to-rose-600 bg-clip-text text-transparent">
                {businessName}
              </h1>
              <p className="text-xs text-gray-500">Review Buyer Order Request</p>
            </div>
          </div>

          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-full transition-colors"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Scan Another Design</span>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {submittedRequestId !== null && submittedSummary ? (
          <div className="bg-white rounded-2xl shadow-sm border p-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-1">
              <span className="inline-block text-xs font-bold uppercase tracking-wider bg-green-50 text-green-700 border border-green-200 px-3 py-1 rounded-full">
                Request Reference #{submittedRequestId}
              </span>
              <h2 className="text-2xl font-bold text-gray-900 pt-2">
                Order Request Sent to {businessName}!
              </h2>
              <p className="text-sm text-gray-600 max-w-md mx-auto">
                Thank you, <strong>{submittedSummary.partyName}</strong>. We have received your
                request for <strong>{submittedSummary.totalDesigns}</strong>{' '}
                {submittedSummary.totalDesigns === 1 ? 'design' : 'designs'} (
                <strong>{submittedSummary.totalSets}</strong>{' '}
                {submittedSummary.totalSets === 1 ? 'set' : 'sets'}) and will contact you on{' '}
                <strong>{submittedSummary.phone}</strong>.
              </p>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/">
                <Button className="bg-orange-600 hover:bg-orange-700 text-white gap-2">
                  <QrCode className="w-4 h-4" />
                  Scan More Designs
                </Button>
              </Link>
            </div>
          </div>
        ) : cartSummary.items.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-orange-50 text-orange-400 flex items-center justify-center mx-auto">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">Your Order List is Empty</h2>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Scan a product QR label or open a design link to add sets to your order request list.
            </p>
            <div className="pt-2">
              <Link to="/">
                <Button className="bg-orange-600 hover:bg-orange-700 text-white gap-2">
                  <QrCode className="w-4 h-4" />
                  Scan Product QR
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Selected Designs List */}
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <div className="px-5 py-4 border-b bg-gray-50/70 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-orange-600" />
                  <h2 className="font-bold text-gray-900">Selected Designs</h2>
                </div>
                <div className="text-xs font-semibold text-orange-700 bg-orange-100 px-3 py-1 rounded-full">
                  {cartSummary.totalDesigns}{' '}
                  {cartSummary.totalDesigns === 1 ? 'Design' : 'Designs'} ·{' '}
                  {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'Set' : 'Sets'}
                </div>
              </div>

              <div className="divide-y">
                {cartSummary.items.map((item) => {
                  const meta = productMap[item.design_no.toUpperCase()]
                  const thumb = meta?.media?.[0]?.media_url || meta?.image_url
                  const pcsPerSet = meta?.pcs_per_set && meta.pcs_per_set > 0 ? meta.pcs_per_set : null

                  return (
                    <div
                      key={item.design_no}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3.5">
                        {thumb ? (
                          <Link
                            to={`/${normalizedSlug}/p/${encodeURIComponent(item.design_no)}`}
                            className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 border shrink-0"
                          >
                            <img
                              src={thumb}
                              alt={item.design_no}
                              className="w-full h-full object-cover"
                            />
                          </Link>
                        ) : (
                          <Link
                            to={`/${normalizedSlug}/p/${encodeURIComponent(item.design_no)}`}
                            className="w-16 h-16 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 font-bold text-xs shrink-0"
                          >
                            {item.design_no}
                          </Link>
                        )}

                        <div className="space-y-0.5">
                          <Link
                            to={`/${normalizedSlug}/p/${encodeURIComponent(item.design_no)}`}
                            className="font-bold text-lg text-gray-900 hover:text-orange-600 transition-colors"
                          >
                            Design {item.design_no}
                          </Link>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            {meta?.brand && <span>{meta.brand}</span>}
                            {pcsPerSet && (
                              <span>
                                • {pcsPerSet} pcs/set ({item.sets * pcsPerSet} pcs)
                              </span>
                            )}
                            {meta?.rate && <span>• {formatCurrency(meta.rate)}/pc</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        {/* Set quantity stepper */}
                        <div className="inline-flex items-center border rounded-xl bg-gray-50 p-1">
                          <button
                            type="button"
                            onClick={() =>
                              updateOrderRequestCartItemSets(
                                normalizedSlug,
                                item.design_no,
                                clampRequestSets(item.sets - 1)
                              )
                            }
                            disabled={item.sets <= 1 || submitting}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-700 hover:bg-white disabled:opacity-40"
                            aria-label="Decrease sets"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={item.sets}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10)
                              if (!Number.isNaN(val)) {
                                updateOrderRequestCartItemSets(
                                  normalizedSlug,
                                  item.design_no,
                                  clampRequestSets(val)
                                )
                              }
                            }}
                            disabled={submitting}
                            className="w-12 text-center font-bold text-sm bg-transparent focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateOrderRequestCartItemSets(
                                normalizedSlug,
                                item.design_no,
                                clampRequestSets(item.sets + 1)
                              )
                            }
                            disabled={item.sets >= 500 || submitting}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-700 hover:bg-white disabled:opacity-40"
                            aria-label="Increase sets"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeFromOrderRequestCart(normalizedSlug, item.design_no)}
                          disabled={submitting}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          aria-label={`Remove design ${item.design_no}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="px-5 py-3.5 bg-orange-50/60 border-t flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">Total Order Summary</span>
                <span className="font-bold text-orange-800">
                  {cartSummary.totalDesigns}{' '}
                  {cartSummary.totalDesigns === 1 ? 'Design' : 'Designs'} ·{' '}
                  {cartSummary.totalSets} {cartSummary.totalSets === 1 ? 'Set' : 'Sets'}
                </span>
              </div>
            </div>

            {/* Customer Details & Submission Actions */}
            <form
              onSubmit={handleSendToShop}
              className="bg-white rounded-2xl shadow-sm border p-5 sm:p-6 space-y-5"
            >
              <div>
                <h3 className="font-bold text-lg text-gray-900">Your Contact Details</h3>
                <p className="text-xs text-gray-500">
                  Required so the shop can confirm availability and prepare your order.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="buyer-name">Your Name / Firm Name *</Label>
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
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="buyer-note">Note (Optional)</Label>
                <Input
                  id="buyer-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Transport preference, station, or special instructions..."
                  maxLength={1000}
                  disabled={submitting}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 p-3.5 rounded-xl text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {/* Action 1: Send on WhatsApp */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendOnWhatsApp}
                  disabled={submitting || loadingSettings || !normalizedWhatsapp}
                  className="h-12 border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-semibold rounded-xl gap-2"
                >
                  <MessageCircle className="w-5 h-5" />
                  <span>Send on WhatsApp</span>
                </Button>

                {/* Action 2: Send to Shop */}
                <Button
                  type="submit"
                  disabled={submitting || !partyName.trim() || !phone.trim()}
                  className="h-12 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>{submitting ? 'Sending to Shop...' : 'Send to Shop'}</span>
                </Button>
              </div>

              {!loadingSettings && !normalizedWhatsapp && (
                <p className="text-xs text-gray-500 text-center">
                  Direct WhatsApp sharing is not configured for this shop yet — please click{' '}
                  <strong>Send to Shop</strong> to submit your order request directly.
                </p>
              )}
            </form>
          </>
        )}
      </main>
    </div>
  )
}

