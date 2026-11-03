import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchPublicOrder } from '@/services/orders'
import type { Order, OrderItem, Product } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { downloadOrderPdf, printOrderPdf } from '@/utils/orderPdfGenerator'
import { KalaLogo, resolveBrandName } from '@/components/common/KalaLogo'
import {
  ArrowLeft,
  ShoppingCart,
  Printer,
  Share2,
  Download,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface OrderItemWithProduct extends OrderItem {
  product?: Product
}

export default function OrderPage() {
  const { orderNo, slug = 'rangoli' } = useParams<{ orderNo: string; slug?: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItemWithProduct[]>([])
  const [businessName, setBusinessName] = useState<string>('Kala')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pdfGenerating, setPdfGenerating] = useState(false)

  const displayBrand = resolveBrandName(businessName)

  useEffect(() => {
    if (!orderNo) return
    loadOrder()
  }, [orderNo, slug])

  const loadOrder = async () => {
    try {
      setLoading(true)
      const pubOrder = await fetchPublicOrder(slug, orderNo!)
      setBusinessName(resolveBrandName(pubOrder.business_name))

      const adaptedOrder: Order = {
        id: 0,
        order_no: pubOrder.order_no,
        party_name: pubOrder.party_name,
        station: pubOrder.station,
        agent: pubOrder.agent,
        gst_number: pubOrder.gst_number,
        order_date: pubOrder.order_date,
        export_date: pubOrder.export_date,
        brand: pubOrder.brand,
        product_name: pubOrder.product_name,
        notes: pubOrder.notes,
        status: pubOrder.status || 'draft',
        confirmed_at: pubOrder.confirmed_at,
        total_amount: pubOrder.total_amount,
        created_at: pubOrder.created_at,
        updated_at: pubOrder.created_at,
      }
      setOrder(adaptedOrder)

      const adaptedItems: OrderItemWithProduct[] = pubOrder.items.map((item) => ({
        id: item.id,
        order_id: 0,
        design_no: item.design_no,
        rate: item.rate,
        sets: item.sets,
        pcs_per_set: item.pcs_per_set,
        total_pcs: item.total_pcs,
        line_total: item.line_total,
        created_at: pubOrder.created_at,
        product: {
          id: 0,
          design_no: item.design_no,
          image_url: item.thumbnail,
          brand: item.brand,
          fabric: item.fabric,
          rate: item.rate,
          pcs_per_set: item.pcs_per_set,
          created_at: pubOrder.created_at,
          updated_at: pubOrder.created_at,
        },
      }))
      setItems(adaptedItems)
    } catch {
      setError('Order not found')
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = async () => {
    if (!order) return
    setPdfGenerating(true)
    try {
      await printOrderPdf({ order, items, businessName: displayBrand })
    } catch {
      window.print()
    } finally {
      setPdfGenerating(false)
    }
  }

  const handleShareWhatsApp = () => {
    if (!order) return
    const url = window.location.href
    const text = `*KALA — WHOLESALE ORDER CONFIRMATION*\nOrder: ${order.order_no}\nParty: ${order.party_name}\nStation: ${order.station || 'N/A'}\nTotal: ${formatCurrency(order.total_amount)}\n\nView order form: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const handleDownloadPDF = async () => {
    if (!order) return
    setPdfGenerating(true)
    try {
      await downloadOrderPdf({ order, items, businessName: displayBrand })
    } catch (err: any) {
      console.error('Error generating PDF:', err)
      alert('Could not download PDF directly. Opening print view.')
      window.print()
    } finally {
      setPdfGenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f8f7f4]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-700 rounded-full animate-spin" />
          <p className="text-sm font-medium text-stone-600">Retrieving order details...</p>
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-[#f8f7f4] px-4">
        <ShoppingCart className="w-16 h-16 text-stone-300" />
        <h1 className="text-2xl font-bold text-stone-800">Order Not Found</h1>
        <p className="text-stone-500 text-sm">We could not find an order matching "{orderNo}".</p>
        <Link
          to="/"
          className="text-orange-700 font-semibold hover:underline flex items-center gap-1.5 mt-2"
        >
          <ArrowLeft className="w-4 h-4" /> Return to Kala Home
        </Link>
      </div>
    )
  }

  const totalSets = items.reduce((s, i) => s + (i.sets || 0), 0)
  const totalPieces = items.reduce((s, i) => s + (i.total_pcs || 0), 0)

  return (
    <div className="min-h-screen bg-[#f8f7f4] print:bg-white text-stone-900">
      {/* Actions bar — hidden on print */}
      <div className="print:hidden bg-white border-b border-stone-200 sticky top-0 z-30 shadow-2xs py-3 px-4">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/"
            className="text-stone-600 hover:text-stone-900 flex items-center gap-1.5 text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4" /> Kala Home
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleShareWhatsApp}>
              <Share2 className="w-4 h-4 mr-1 text-emerald-700" /> WhatsApp
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
              disabled={pdfGenerating}
            >
              <Download className="w-4 h-4 mr-1 text-orange-700" />
              {pdfGenerating ? 'Generating...' : 'Download PDF'}
            </Button>
            <Button
              className="bg-stone-900 hover:bg-stone-800 text-white"
              size="sm"
              onClick={handlePrint}
              disabled={pdfGenerating}
            >
              <Printer className="w-4 h-4 mr-1" /> Print Order Form
            </Button>
          </div>
        </div>
      </div>

      {/* Order Content — Print-Ready A4 Container */}
      <div className="max-w-4xl mx-auto my-6 print:my-0 bg-white shadow-sm print:shadow-none rounded-xl print:rounded-none overflow-hidden border print:border-none border-stone-200">
        {/* Top Terracotta & Charcoal Bar */}
        <div className="h-2 flex">
          <div className="w-36 bg-orange-700" />
          <div className="flex-1 bg-stone-900" />
        </div>

        <div className="p-6 sm:p-10 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-6 border-b border-stone-200 gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <KalaLogo
                  size="lg"
                  titleOverride={displayBrand.toUpperCase()}
                  subtitle="KALA — Textile Wholesale Management System"
                />
                {order.status === 'confirmed' ? (
                  <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-md border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" /> CONFIRMED
                  </span>
                ) : order.status === 'cancelled' ? (
                  <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 text-xs font-bold px-2.5 py-1 rounded-md border border-red-200">
                    <AlertCircle className="w-3.5 h-3.5" /> CANCELLED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-md border border-amber-200">
                    <Clock className="w-3.5 h-3.5" /> DRAFT ORDER
                  </span>
                )}
              </div>
            </div>

            <div className="text-left sm:text-right bg-stone-50 border border-stone-200 px-4 py-2.5 rounded-lg">
              <span className="text-[11px] text-stone-500 uppercase tracking-wider font-bold block">
                Wholesale Order No
              </span>
              <p className="text-xl font-mono font-extrabold text-orange-700">{order.order_no}</p>
            </div>
          </div>

          {/* Metadata Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-[#f8f7f4] p-4 rounded-xl border border-stone-200 text-sm">
            <div className="space-y-1">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                Customer / Party Details
              </span>
              <p className="font-extrabold text-stone-900 text-base">{order.party_name}</p>
              {order.station && (
                <p className="text-stone-600">
                  Station: <strong className="text-stone-900">{order.station}</strong>
                </p>
              )}
              {order.gst_number && (
                <p className="text-stone-600 font-mono text-xs">GSTIN: {order.gst_number}</p>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                Agency & Line
              </span>
              <p className="text-stone-600">
                Agent: <strong className="text-stone-900">{order.agent || 'Direct'}</strong>
              </p>
              <p className="text-stone-600">
                Brand: <strong className="text-stone-900">{order.brand || displayBrand}</strong>
              </p>
              {order.product_name && <p className="text-stone-600">Line: {order.product_name}</p>}
            </div>

            <div className="space-y-1 sm:text-right">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                Order Timeline
              </span>
              <p className="text-stone-600">
                Order Date:{' '}
                <strong className="text-stone-900">
                  {formatDate(order.order_date || order.created_at)}
                </strong>
              </p>
              {order.export_date && (
                <p className="text-stone-600">
                  Dispatch:{' '}
                  <strong className="text-stone-900">{formatDate(order.export_date)}</strong>
                </p>
              )}
              {order.confirmed_at && (
                <p className="text-xs font-semibold text-emerald-700">
                  Confirmed: {formatDate(order.confirmed_at)}
                </p>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto border border-stone-200 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-stone-900 text-white font-bold text-xs tracking-wider uppercase">
                <tr>
                  <th className="py-3 px-3 text-left w-12">S.No</th>
                  <th className="py-3 px-3 text-left w-16">Photo</th>
                  <th className="py-3 px-3 text-left">Design No & Description</th>
                  <th className="py-3 px-3 text-right">Pcs/Set</th>
                  <th className="py-3 px-3 text-right">Sets</th>
                  <th className="py-3 px-3 text-right">Total Pcs</th>
                  <th className="py-3 px-3 text-right">Rate (₹)</th>
                  <th className="py-3 px-4 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/80">
                {items.map((item, index) => (
                  <tr key={item.id} className={index % 2 === 1 ? 'bg-stone-50/70' : 'bg-white'}>
                    <td className="py-3 px-3 text-stone-500 font-mono text-xs tabular-nums">
                      {index + 1}
                    </td>
                    <td className="py-3 px-3">
                      {item.product?.image_url ? (
                        <img
                          src={item.product.image_url}
                          alt={item.design_no}
                          className="w-11 h-11 object-cover rounded-lg border border-stone-200"
                        />
                      ) : (
                        <div className="w-11 h-11 bg-stone-100 rounded-lg border border-stone-200 flex items-center justify-center text-[10px] text-stone-400 font-semibold">
                          DESIGN
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-bold text-stone-900">Design #{item.design_no}</p>
                      <p className="text-xs text-stone-500">
                        {[item.product?.brand || order.brand, item.product?.fabric]
                          .filter(Boolean)
                          .join(' • ') || 'Wholesale Catalog Item'}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-right text-stone-700 tabular-nums">
                      {item.pcs_per_set}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-stone-900 tabular-nums">
                      {item.sets}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-stone-900 tabular-nums">
                      {item.total_pcs}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-stone-700 tabular-nums">
                      {formatCurrency(item.rate || 0)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900 tabular-nums">
                      {formatCurrency(item.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes & Grand Total Summary */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6 pt-2">
            <div className="flex-1 w-full">
              {order.notes ? (
                <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-950">
                  <strong className="block mb-1 uppercase tracking-wider text-[10px] text-amber-800">
                    Order Notes / Instructions:
                  </strong>
                  {order.notes}
                </div>
              ) : (
                <div className="text-xs text-stone-500 space-y-1 pt-1">
                  <p className="font-bold text-stone-700 uppercase tracking-wider text-[11px]">
                    Order Notes
                  </p>
                  <p>Order Reference: {order.order_no}</p>
                  <p>No additional dispatch notes recorded for this order.</p>
                </div>
              )}
            </div>

            <div className="w-full sm:w-80 bg-[#f8f7f4] border border-stone-200 rounded-xl p-4 space-y-2.5 text-sm shrink-0">
              <div className="flex justify-between text-stone-600">
                <span>Total Designs:</span>
                <strong className="text-stone-900 font-mono tabular-nums">{items.length}</strong>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>Total Sets:</span>
                <strong className="text-stone-900 font-mono tabular-nums">{totalSets}</strong>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>Total Pieces:</span>
                <strong className="text-stone-900 font-mono tabular-nums">{totalPieces}</strong>
              </div>
              <div className="border-t border-stone-200 pt-2.5 flex justify-between items-baseline">
                <span className="font-extrabold text-stone-900 text-base">Grand Total:</span>
                <span className="text-xl font-black text-orange-700 tabular-nums">
                  {formatCurrency(order.total_amount)}
                </span>
              </div>
            </div>
          </div>

          {/* Document Footer */}
          <div className="border-t border-stone-200 pt-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
            <p className="font-semibold text-stone-700">
              KALA — Textile Wholesale Management System
            </p>
            <p>Thank you for your business with {displayBrand}.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
