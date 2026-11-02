import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchPublicOrder } from '@/services/orders'
import type { Order, OrderItem, Product } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { downloadOrderPdf, printOrderPdf } from '@/utils/orderPdfGenerator'
import { ArrowLeft, ShoppingCart, Printer, Share2, Download, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface OrderItemWithProduct extends OrderItem {
  product?: Product
}

export default function OrderPage() {
  const { orderNo, slug = 'rangoli' } = useParams<{ orderNo: string; slug?: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItemWithProduct[]>([])
  const [businessName, setBusinessName] = useState<string>('Rangoli Textiles')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pdfGenerating, setPdfGenerating] = useState(false)

  useEffect(() => {
    if (!orderNo) return
    loadOrder()
  }, [orderNo, slug])

  const loadOrder = async () => {
    try {
      setLoading(true)
      const pubOrder = await fetchPublicOrder(slug, orderNo!)
      setBusinessName(pubOrder.business_name || 'Rangoli Textiles')

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

      const adaptedItems: OrderItemWithProduct[] = pubOrder.items.map(item => ({
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
        }
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
      await printOrderPdf({ order, items })
    } catch {
      window.print()
    } finally {
      setPdfGenerating(false)
    }
  }

  const handleShareWhatsApp = () => {
    if (!order) return
    const url = window.location.href
    const text = `*RANGOLI TEXTILES - ORDER CONFIRMATION*\nOrder: ${order.order_no}\nParty: ${order.party_name}\nStation: ${order.station || 'N/A'}\nTotal: ${formatCurrency(order.total_amount)}\n\nView details: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const handleDownloadPDF = async () => {
    if (!order) return
    setPdfGenerating(true)
    try {
      await downloadOrderPdf({ order, items })
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
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-500">Retrieving order details...</p>
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-slate-50 px-4">
        <ShoppingCart className="w-16 h-16 text-slate-300" />
        <h1 className="text-2xl font-bold text-slate-700">Order Not Found</h1>
        <p className="text-slate-500 text-sm">We could not find an order matching "{orderNo}".</p>
        <Link to="/" className="text-orange-600 font-medium hover:underline flex items-center gap-1.5 mt-2">
          <ArrowLeft className="w-4 h-4" /> Return to Main Menu
        </Link>
      </div>
    )
  }

  const totalSets = items.reduce((s, i) => s + (i.sets || 0), 0)
  const totalPieces = items.reduce((s, i) => s + (i.total_pcs || 0), 0)

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white text-slate-800">
      {/* Actions bar — hidden on print */}
      <div className="print:hidden bg-white border-b sticky top-0 z-30 shadow-xs py-3 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <Link to="/" className="text-slate-600 hover:text-slate-900 flex items-center gap-1.5 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleShareWhatsApp}>
              <Share2 className="w-4 h-4 mr-1 text-emerald-600" /> WhatsApp
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
              disabled={pdfGenerating}
            >
              <Download className="w-4 h-4 mr-1 text-orange-600" />
              {pdfGenerating ? 'Generating...' : 'Download PDF'}
            </Button>
            <Button
              className="bg-slate-900 hover:bg-slate-800 text-white"
              size="sm"
              onClick={handlePrint}
              disabled={pdfGenerating}
            >
              <Printer className="w-4 h-4 mr-1" /> Print Order Form
            </Button>
          </div>
        </div>
      </div>

      {/* Order Content — Clean A4 Container */}
      <div className="max-w-4xl mx-auto my-6 print:my-0 bg-white shadow-md print:shadow-none rounded-xl print:rounded-none overflow-hidden border print:border-none border-slate-200">
        <div className="p-8 sm:p-10 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-6 border-b border-slate-200 gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{businessName.toUpperCase()}</h1>
                {order.status === 'confirmed' ? (
                  <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed
                  </span>
                ) : order.status === 'cancelled' ? (
                  <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-rose-200">
                    <AlertCircle className="w-3.5 h-3.5" /> Cancelled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-amber-200">
                    <Clock className="w-3.5 h-3.5" /> Draft
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-1">
                Wholesale Textile Order Form
              </p>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold block">Order Reference</span>
              <p className="text-xl font-mono font-bold text-orange-600">{order.order_no}</p>
            </div>
          </div>

          {/* Metadata Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50/80 p-4 rounded-lg border border-slate-200 text-sm">
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Party Details</span>
              <p className="font-bold text-slate-900 text-base">{order.party_name}</p>
              {order.station && <p className="text-slate-600">Station: <strong className="text-slate-800">{order.station}</strong></p>}
              {order.gst_number && <p className="text-slate-600 font-mono text-xs">GSTIN: {order.gst_number}</p>}
            </div>

            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Agency & Brand</span>
              <p className="text-slate-600">Agent: <strong className="text-slate-800">{order.agent || 'Direct'}</strong></p>
              {order.brand && <p className="text-slate-600">Brand: <strong className="text-slate-800">{order.brand}</strong></p>}
              {order.product_name && <p className="text-slate-600">Product: {order.product_name}</p>}
            </div>

            <div className="space-y-1 sm:text-right">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Order Timeline</span>
              <p className="text-slate-600">Date: <strong className="text-slate-800">{formatDate(order.order_date || order.created_at)}</strong></p>
              {order.export_date && (
                <p className="text-slate-600">Export: <strong className="text-slate-800">{formatDate(order.export_date)}</strong></p>
              )}
              {order.confirmed_at && (
                <p className="text-xs text-emerald-600">Confirmed: {formatDate(order.confirmed_at)}</p>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-white font-semibold text-xs tracking-wider uppercase">
                <tr>
                  <th className="py-3 px-3 text-left w-12">#</th>
                  <th className="py-3 px-3 text-left w-16">Photo</th>
                  <th className="py-3 px-3 text-left">Design No</th>
                  <th className="py-3 px-3 text-right">Rate (₹)</th>
                  <th className="py-3 px-3 text-right">Total Set</th>
                  <th className="py-3 px-3 text-right">Pcs/Set</th>
                  <th className="py-3 px-3 text-right">Total Pcs</th>
                  <th className="py-3 px-4 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, index) => (
                  <tr key={item.id} className={index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}>
                    <td className="py-3 px-3 text-slate-400 font-mono text-xs">{index + 1}</td>
                    <td className="py-3 px-3">
                      {item.product?.image_url ? (
                        <img
                          src={item.product.image_url}
                          alt={item.design_no}
                          className="w-10 h-10 object-cover rounded-md border border-slate-200"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 rounded-md flex items-center justify-center text-[10px] text-slate-400 font-medium">
                          N/A
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900">{item.design_no}</p>
                      {item.product?.fabric && (
                        <p className="text-xs text-slate-500">{item.product.fabric}</p>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-slate-700">
                      {formatCurrency(item.rate || 0)}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900">{item.sets}</td>
                    <td className="py-3 px-3 text-right text-slate-600">{item.pcs_per_set}</td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900">{item.total_pcs}</td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">
                      {formatCurrency(item.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Grand Total Summary */}
          <div className="flex justify-end pt-2">
            <div className="w-full sm:w-72 bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Total Sets:</span>
                <strong className="text-slate-900 font-mono">{totalSets}</strong>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Total Pieces:</span>
                <strong className="text-slate-900 font-mono">{totalPieces}</strong>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between items-baseline">
                <span className="font-bold text-slate-900 text-base">Grand Total:</span>
                <span className="text-xl font-black text-orange-600">
                  {formatCurrency(order.total_amount)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
              <strong className="block mb-0.5 uppercase tracking-wider text-[10px]">Order Notes:</strong>
              {order.notes}
            </div>
          )}

          {/* Terms / Footer */}
          <div className="border-t border-slate-200 pt-6 text-center text-xs text-slate-400 space-y-1">
            <p className="font-medium text-slate-500">Thank you for your business with Rangoli Textiles.</p>
            <p>Subject to Surat jurisdiction • Goods once sold will not be taken back without prior authorization.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
