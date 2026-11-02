import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchOrderByNo, fetchOrderItems } from '@/services/orders'
import { fetchProduct } from '@/services/products'
import type { Order, OrderItem, Product } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { ArrowLeft, ShoppingCart, Printer, Share2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface OrderItemWithProduct extends OrderItem {
  product?: Product
}

export default function OrderPage() {
  const { orderNo } = useParams<{ orderNo: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItemWithProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orderNo) return
    loadOrder()
  }, [orderNo])

  const loadOrder = async () => {
    try {
      setLoading(true)
      const ord = await fetchOrderByNo(orderNo!)
      setOrder(ord)
      const orderItems = await fetchOrderItems(ord.id)

      // Fetch product thumbnails for each item
      const itemsWithProducts = await Promise.all(
        orderItems.map(async (item) => {
          if (item.design_no) {
            try {
              const product = await fetchProduct(item.design_no)
              return { ...item, product }
            } catch {
              return item
            }
          }
          return item
        })
      )
      setItems(itemsWithProducts)
    } catch {
      setError('Order not found')
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = () => window.print()

  const handleShareWhatsApp = () => {
    if (!order) return
    const url = window.location.href
    const text = `Order ${order.order_no}\nParty: ${order.party_name}\nTotal: ${formatCurrency(order.total_amount)}\n\nView: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const handleDownloadPDF = async () => {
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { jsPDF } = await import('jspdf')

      const element = document.getElementById('order-printable')
      if (!element) return

      const canvas = await html2canvas(element, { scale: 2 })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const imgWidth = 210
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight)
      pdf.save(`Order_${order?.order_no || 'unknown'}.pdf`)
    } catch (err) {
      console.error('Error generating PDF:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <ShoppingCart className="w-16 h-16 text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-600">Order Not Found</h1>
        <Link to="/" className="text-orange-600 hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Actions bar — hidden on print */}
      <div className="print:hidden bg-white border-b py-3 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleShareWhatsApp}>
              <Share2 className="w-4 h-4 mr-1" /> Share
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPDF}>
              <Download className="w-4 h-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
          </div>
        </div>
      </div>

      {/* Order Content — A4-optimized */}
      <div id="order-printable" className="max-w-4xl mx-auto my-6 print:my-0 bg-white shadow-lg print:shadow-none rounded-lg print:rounded-none">
        <div className="p-8 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start border-b pb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">ORDER</h1>
              <p className="text-lg font-medium text-orange-600 mt-1">{order.order_no}</p>
            </div>
            <div className="text-right">
              <h2 className="text-xl font-bold bg-gradient-to-r from-orange-600 to-rose-600 bg-clip-text text-transparent">
                Rangoli Textiles
              </h2>
            </div>
          </div>

          {/* Party Details */}
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div className="space-y-2">
              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Party Name</p>
                <p className="font-semibold text-lg">{order.party_name}</p>
              </div>
              {order.station && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide">Station</p>
                  <p className="font-medium">{order.station}</p>
                </div>
              )}
            </div>
            <div className="text-right space-y-2">
              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Order Date</p>
                <p className="font-medium">{order.order_date ? formatDate(order.order_date) : formatDate(order.created_at)}</p>
              </div>
              {order.agent && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide">Agent</p>
                  <p className="font-medium">{order.agent}</p>
                </div>
              )}
              {order.gst_number && (
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide">GST No</p>
                  <p className="font-medium">{order.gst_number}</p>
                </div>
              )}
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="py-3 text-left font-semibold">#</th>
                <th className="py-3 text-left font-semibold">Design No</th>
                <th className="py-3 text-center font-semibold">Rate/pc</th>
                <th className="py-3 text-center font-semibold">Sets</th>
                <th className="py-3 text-center font-semibold">Total Pcs</th>
                <th className="py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-3">{index + 1}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      {item.product?.image_url && (
                        <img src={item.product.image_url} alt="" className="w-8 h-8 rounded object-cover print:hidden" />
                      )}
                      <span className="font-medium">{item.design_no || '-'}</span>
                    </div>
                  </td>
                  <td className="py-3 text-center">{formatCurrency(item.rate || 0)}</td>
                  <td className="py-3 text-center">{item.sets}</td>
                  <td className="py-3 text-center">{item.total_pcs}</td>
                  <td className="py-3 text-right">{formatCurrency(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300">
                <td colSpan={5} className="py-4 text-right font-bold text-lg">Grand Total</td>
                <td className="py-4 text-right font-bold text-lg text-orange-600">
                  {formatCurrency(order.total_amount)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Footer */}
          <div className="border-t pt-6 text-center text-xs text-gray-400">
            <p>Thank you for your order!</p>
            <p className="mt-1">Rangoli Textiles</p>
          </div>
        </div>
      </div>
    </div>
  )
}
