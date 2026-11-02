import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { fetchOrders, deleteOrder, fetchOrderItems, createOrderWithItems, generateOrderNo, updateOrder, deleteOrderItemsByOrderId, createOrderItemBatch } from '@/services/orders'
import { fetchProducts } from '@/services/products'
import { useQRScanner } from '@/hooks/useQRScanner'
import type { Order, OrderItem, Product } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { Plus, Trash2, Eye, QrCode, Search, Share2, Download, X, Edit2, Zap } from 'lucide-react'

interface OrderItemDraft {
  design_no: string
  rate: number
  sets: number
  pcs_per_set: number
  total_pcs: number
  line_total: number
  product_id?: number
  thumbnail?: string
}

interface OrderTabProps {
  isStaff?: boolean
}

export default function OrderTab({ isStaff = false }: OrderTabProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [viewOrder, setViewOrder] = useState<{ order: Order; items: OrderItem[] } | null>(null)

  // Form fields
  const [partyName, setPartyName] = useState('')
  const [station, setStation] = useState('')
  const [agent, setAgent] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0])
  const [items, setItems] = useState<OrderItemDraft[]>([])
  const [formLoading, setFormLoading] = useState(false)

  // Item entry
  const [itemSearch, setItemSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [showScanner, setShowScanner] = useState(false)

  useEffect(() => {
    loadOrders()
    fetchProducts(500).then(setProducts).catch(console.error)
  }, [])

  const loadOrders = async () => {
    try {
      setLoading(true)
      const data = await fetchOrders()
      setOrders(data)
    } catch (error) {
      console.error('Error loading orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearchItem = (query: string) => {
    setItemSearch(query)
    if (query.trim()) {
      const q = query.toLowerCase()
      setSearchResults(products.filter(p => p.design_no.toLowerCase().includes(q)).slice(0, 10))
    } else {
      setSearchResults([])
    }
  }

  const addItemFromProduct = useCallback((product: Product) => {
    setItems(prev => {
      const existingIndex = prev.findIndex(i => i.design_no === product.design_no)
      if (existingIndex !== -1) {
        const updated = [...prev]
        const item = { ...updated[existingIndex] }
        item.sets += 1
        item.total_pcs = item.sets * item.pcs_per_set
        item.line_total = item.rate * item.total_pcs
        updated[existingIndex] = item
        return updated
      }

      const pcsPerSet = product.pcs_per_set || 1
      return [...prev, {
        design_no: product.design_no,
        rate: product.rate || 0,
        sets: 1,
        pcs_per_set: pcsPerSet,
        total_pcs: pcsPerSet,
        line_total: (product.rate || 0) * pcsPerSet,
        product_id: product.id,
        thumbnail: product.image_url || undefined,
      }]
    })
    setItemSearch('')
    setSearchResults([])
  }, [])

  // Ultra-fast QR scanner
  const handleQRScan = useCallback((text: string) => {
    const match = text.match(/\/p\/([^/?#]+)/)
    if (match) {
      const product = products.find(p => p.design_no === match[1])
      if (product) addItemFromProduct(product)
    }
  }, [products, addItemFromProduct])

  const { status: scannerStatus } = useQRScanner({
    elementId: 'order-qr-reader',
    onScan: handleQRScan,
    active: showScanner,
    cooldownMs: 600,
  })

  const updateItem = (index: number, field: string, value: number) => {
    const updated = [...items]
    const item = { ...updated[index] }

    if (field === 'sets') {
      item.sets = value
      item.total_pcs = value * item.pcs_per_set
      item.line_total = item.rate * item.total_pcs
    } else if (field === 'rate') {
      item.rate = value
      item.line_total = value * item.total_pcs
    }

    updated[index] = item
    setItems(updated)
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const totalAmount = items.reduce((sum, i) => sum + i.line_total, 0)

  // Reset form
  const resetForm = () => {
    setPartyName('')
    setStation('')
    setAgent('')
    setGstNumber('')
    setOrderDate(new Date().toISOString().split('T')[0])
    setItems([])
    setEditingOrder(null)
    setShowScanner(false)
  }

  const openCreateForm = () => {
    resetForm()
    setShowForm(true)
  }

  const openEditForm = async (order: Order) => {
    setEditingOrder(order)
    setPartyName(order.party_name)
    setStation(order.station || '')
    setAgent(order.agent || '')
    setGstNumber(order.gst_number || '')
    setOrderDate(order.order_date || new Date().toISOString().split('T')[0])

    // Load existing items
    try {
      const orderItems = await fetchOrderItems(order.id)
      const drafts: OrderItemDraft[] = orderItems.map(item => {
        const product = products.find(p => p.design_no === item.design_no)
        return {
          design_no: item.design_no || '',
          rate: item.rate || 0,
          sets: item.sets || 1,
          pcs_per_set: item.pcs_per_set || 1,
          total_pcs: item.total_pcs || 0,
          line_total: item.line_total || 0,
          product_id: item.product_id || undefined,
          thumbnail: product?.image_url || undefined,
        }
      })
      setItems(drafts)
    } catch {
      setItems([])
    }

    setShowForm(true)
  }

  const handleSaveOrder = async () => {
    setFormLoading(true)
    try {
      if (editingOrder) {
        // Update existing order
        await updateOrder(editingOrder.id, {
          party_name: partyName,
          station: station || null,
          agent: agent || null,
          gst_number: gstNumber || null,
          order_date: orderDate || null,
          total_amount: totalAmount,
        })

        // Delete old items and re-insert
        await deleteOrderItemsByOrderId(editingOrder.id)
        if (items.length > 0) {
          await createOrderItemBatch(
            items.map(i => ({
              order_id: editingOrder.id,
              product_id: i.product_id,
              design_no: i.design_no,
              rate: i.rate,
              sets: i.sets,
              pcs_per_set: i.pcs_per_set,
              total_pcs: i.total_pcs,
              line_total: i.line_total,
            }))
          )
        }
      } else {
        // Create new order
        const orderNo = await generateOrderNo()
        await createOrderWithItems(
          {
            order_no: orderNo,
            party_name: partyName,
            station: station || null,
            agent: agent || null,
            gst_number: gstNumber || null,
            order_date: orderDate || null,
            total_amount: totalAmount,
          },
          items.map(i => ({
            product_id: i.product_id,
            design_no: i.design_no,
            rate: i.rate,
            sets: i.sets,
            pcs_per_set: i.pcs_per_set,
            total_pcs: i.total_pcs,
            line_total: i.line_total,
            order_id: 0,
          }))
        )
      }

      setShowForm(false)
      resetForm()
      await loadOrders()
    } catch (error: any) {
      console.error('Error saving order:', error)
      alert(`Error: ${error?.message || 'Failed to save order'}`)
    } finally {
      setFormLoading(false)
    }
  }

  const handleViewOrder = async (order: Order) => {
    try {
      const orderItems = await fetchOrderItems(order.id)
      setViewOrder({ order, items: orderItems })
    } catch (error) {
      console.error('Error loading order items:', error)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteOrder(id)
      setOrders(orders.filter(o => o.id !== id))
      setDeleteConfirm(null)
    } catch (error: any) {
      console.error('Error deleting order:', error)
      alert(`Error: ${error?.message || 'Failed to delete order'}`)
    }
  }

  const handleShareWhatsApp = (order: Order) => {
    const domain = import.meta.env.VITE_PUBLISHED_DOMAIN || window.location.origin
    const url = `${domain}/order/${order.order_no}`
    const text = `Order ${order.order_no}\nParty: ${order.party_name}\nTotal: ${formatCurrency(order.total_amount)}\n\nView: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const handleDownloadPDF = async (order: Order) => {
    try {
      const { jsPDF } = await import('jspdf')

      let orderItems = viewOrder?.items || []
      if (!viewOrder || viewOrder.order.id !== order.id) {
        try { orderItems = await fetchOrderItems(order.id) } catch { orderItems = [] }
      }

      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = 210
      let y = 20

      // Header
      pdf.setFontSize(24)
      pdf.setFont('helvetica', 'bold')
      pdf.text('ORDER', 15, y)
      pdf.setFontSize(12)
      pdf.setTextColor(234, 88, 12) // orange
      pdf.text(order.order_no, 15, y + 8)

      pdf.setFontSize(16)
      pdf.text('Rangoli Textiles', pageWidth - 15, y, { align: 'right' })
      pdf.setTextColor(0, 0, 0)

      y += 18
      pdf.setDrawColor(200, 200, 200)
      pdf.line(15, y, pageWidth - 15, y)
      y += 10

      // Party details
      pdf.setFontSize(9)
      pdf.setTextColor(130, 130, 130)
      pdf.text('PARTY NAME', 15, y)
      pdf.text('ORDER DATE', pageWidth / 2 + 10, y)
      y += 5
      pdf.setFontSize(13)
      pdf.setTextColor(0, 0, 0)
      pdf.setFont('helvetica', 'bold')
      pdf.text(order.party_name, 15, y)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(11)
      pdf.text(order.order_date ? formatDate(order.order_date) : '-', pageWidth / 2 + 10, y)
      y += 8

      if (order.station) {
        pdf.setFontSize(9)
        pdf.setTextColor(130, 130, 130)
        pdf.text('STATION', 15, y)
        y += 5
        pdf.setFontSize(11)
        pdf.setTextColor(0, 0, 0)
        pdf.text(order.station, 15, y)
        y += 7
      }

      if (order.agent) {
        pdf.setFontSize(9)
        pdf.setTextColor(130, 130, 130)
        pdf.text('AGENT', pageWidth / 2 + 10, y - (order.station ? 12 : 0))
        pdf.setFontSize(11)
        pdf.setTextColor(0, 0, 0)
        pdf.text(order.agent, pageWidth / 2 + 10, y - (order.station ? 7 : 0))
      }

      if (order.gst_number) {
        pdf.setFontSize(9)
        pdf.setTextColor(130, 130, 130)
        pdf.text('GST NO', 15, y)
        y += 5
        pdf.setFontSize(11)
        pdf.setTextColor(0, 0, 0)
        pdf.text(order.gst_number, 15, y)
        y += 7
      }

      y += 5
      pdf.line(15, y, pageWidth - 15, y)
      y += 8

      // Table header
      const cols = [15, 25, 80, 110, 135, 160]
      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(80, 80, 80)
      pdf.text('#', cols[0], y)
      pdf.text('Design No', cols[1], y)
      pdf.text('Rate/pc', cols[2], y)
      pdf.text('Sets', cols[3], y)
      pdf.text('Total Pcs', cols[4], y)
      pdf.text('Amount', pageWidth - 15, y, { align: 'right' })
      y += 3
      pdf.line(15, y, pageWidth - 15, y)
      y += 5

      // Table rows
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(0, 0, 0)
      pdf.setFontSize(10)

      orderItems.forEach((item, i) => {
        if (y > 270) {
          pdf.addPage()
          y = 20
        }
        pdf.text(String(i + 1), cols[0], y)
        pdf.text(item.design_no || '-', cols[1], y)
        pdf.text(formatCurrency(item.rate || 0), cols[2], y)
        pdf.text(String(item.sets), cols[3], y)
        pdf.text(String(item.total_pcs), cols[4], y)
        pdf.text(formatCurrency(item.line_total), pageWidth - 15, y, { align: 'right' })
        y += 7
      })

      // Total
      y += 3
      pdf.setDrawColor(100, 100, 100)
      pdf.line(15, y, pageWidth - 15, y)
      y += 8
      pdf.setFontSize(13)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Grand Total', cols[4], y)
      pdf.setTextColor(234, 88, 12)
      pdf.text(formatCurrency(order.total_amount), pageWidth - 15, y, { align: 'right' })

      // Footer
      y += 20
      pdf.setFontSize(9)
      pdf.setTextColor(170, 170, 170)
      pdf.setFont('helvetica', 'normal')
      pdf.text('Thank you for your order! — Rangoli Textiles', pageWidth / 2, y, { align: 'center' })

      pdf.save(`Order_${order.order_no}.pdf`)
    } catch (err) {
      console.error('Error generating PDF:', err)
      alert('Failed to generate PDF. Please try again.')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10">Loading orders...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <Button onClick={openCreateForm} className="bg-orange-600 hover:bg-orange-700">
          <Plus className="w-4 h-4 mr-2" />
          Create Order
        </Button>
      </div>

      {/* Orders List */}
      <div className="border rounded-lg overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Order No</th>
              <th className="px-4 py-3 text-left font-medium">Party</th>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Total</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No orders yet
                </td>
              </tr>
            ) : (
              orders.map(order => (
                <tr key={order.id} className="hover:bg-orange-50/50">
                  <td className="px-4 py-3 font-medium text-orange-700">{order.order_no}</td>
                  <td className="px-4 py-3">{order.party_name}</td>
                  <td className="px-4 py-3 text-sm">{order.order_date ? formatDate(order.order_date) : '-'}</td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(order.total_amount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleViewOrder(order)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {!isStaff && (
                        <Button variant="ghost" size="sm" onClick={() => openEditForm(order)}>
                          <Edit2 className="w-4 h-4 text-blue-500" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => handleShareWhatsApp(order)}>
                        <Share2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDownloadPDF(order)}>
                        <Download className="w-4 h-4" />
                      </Button>
                      {!isStaff && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(order.id)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Order Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setShowScanner(false); resetForm() } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingOrder ? `Edit Order ${editingOrder.order_no}` : 'Create New Order'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Party Details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Party Name *</Label>
                <Input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Party name" />
              </div>
              <div className="space-y-1">
                <Label>Station</Label>
                <Input value={station} onChange={(e) => setStation(e.target.value)} placeholder="Station" />
              </div>
              <div className="space-y-1">
                <Label>Agent</Label>
                <Input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Agent" />
              </div>
              <div className="space-y-1">
                <Label>GST No</Label>
                <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="GST Number" />
              </div>
              <div className="space-y-1">
                <Label>Date</Label>
                <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </div>
            </div>

            <hr />

            {/* Item Entry */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Items</h3>
                <Button
                  variant={showScanner ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowScanner(!showScanner)}
                  className={showScanner ? 'bg-green-600 hover:bg-green-700' : ''}
                >
                  {showScanner ? (
                    <><Zap className="w-4 h-4 mr-1" /> Scanning...</>
                  ) : (
                    <><QrCode className="w-4 h-4 mr-1" /> Scan QR</>
                  )}
                </Button>
              </div>

              {showScanner && (
                <div className="border-2 border-green-200 rounded-lg p-2 bg-green-50/50">
                  <div id="order-qr-reader" className="w-full max-w-xs mx-auto" />
                  <div className="flex items-center justify-center gap-2 mt-2">
                    {scannerStatus === 'scanning' && (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        Ultra-fast scanning active • Scan adds items automatically
                      </span>
                    )}
                    {scannerStatus === 'starting' && (
                      <span className="text-xs text-gray-500">Starting camera...</span>
                    )}
                  </div>
                </div>
              )}

              {/* Manual Search */}
              <div className="relative">
                <div className="flex items-center gap-2 border rounded-lg px-3">
                  <Search className="w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search design number to add..."
                    value={itemSearch}
                    onChange={(e) => handleSearchItem(e.target.value)}
                    className="border-0 shadow-none focus-visible:ring-0"
                  />
                </div>
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {searchResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addItemFromProduct(p)}
                        className="w-full text-left px-3 py-2 hover:bg-orange-50 text-sm flex items-center gap-2"
                      >
                        {p.image_url && <img src={p.image_url} alt="" className="w-6 h-6 rounded object-cover" />}
                        <span className="font-medium">{p.design_no}</span>
                        <span className="text-gray-400">₹{p.rate || 0}/pc</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Items Table */}
              {items.length > 0 && (
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left">D.No</th>
                        <th className="px-3 py-2 text-center">Rate/pc</th>
                        <th className="px-3 py-2 text-center">Sets</th>
                        <th className="px-3 py-2 text-center">Total Pcs</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {item.thumbnail && (
                                <img src={item.thumbnail} alt="" className="w-8 h-8 rounded object-cover" />
                              )}
                              <span className="font-medium">{item.design_no}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Input
                              type="number"
                              value={item.rate}
                              onChange={(e) => updateItem(idx, 'rate', parseFloat(e.target.value) || 0)}
                              className="w-20 text-center mx-auto"
                              min="0"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Input
                              type="number"
                              value={item.sets}
                              onChange={(e) => updateItem(idx, 'sets', parseInt(e.target.value) || 0)}
                              className="w-16 text-center mx-auto"
                              min="1"
                            />
                          </td>
                          <td className="px-3 py-2 text-center text-gray-500">{item.total_pcs}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.line_total)}</td>
                          <td className="px-3 py-2">
                            <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600">
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                        <td className="px-3 py-2 text-right text-orange-700">{formatCurrency(totalAmount)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <Button
              onClick={handleSaveOrder}
              className="w-full bg-orange-600 hover:bg-orange-700"
              disabled={formLoading || !partyName.trim() || items.length === 0}
            >
              {formLoading ? 'Saving...' : editingOrder
                ? `Update Order (${formatCurrency(totalAmount)})`
                : `Create Order (${formatCurrency(totalAmount)})`
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Order Dialog */}
      <Dialog open={viewOrder !== null} onOpenChange={() => setViewOrder(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Order {viewOrder.order.order_no}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <p><span className="text-gray-500">Party:</span> {viewOrder.order.party_name}</p>
                  <p><span className="text-gray-500">Station:</span> {viewOrder.order.station || '-'}</p>
                  <p><span className="text-gray-500">Agent:</span> {viewOrder.order.agent || '-'}</p>
                  <p><span className="text-gray-500">GST:</span> {viewOrder.order.gst_number || '-'}</p>
                  <p><span className="text-gray-500">Date:</span> {viewOrder.order.order_date ? formatDate(viewOrder.order.order_date) : '-'}</p>
                </div>

                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left">D.No</th>
                        <th className="px-3 py-2 text-center">Rate/pc</th>
                        <th className="px-3 py-2 text-center">Sets</th>
                        <th className="px-3 py-2 text-center">Total Pcs</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {viewOrder.items.map(item => (
                        <tr key={item.id}>
                          <td className="px-3 py-2 font-medium">{item.design_no}</td>
                          <td className="px-3 py-2 text-center">{formatCurrency(item.rate || 0)}</td>
                          <td className="px-3 py-2 text-center">{item.sets}</td>
                          <td className="px-3 py-2 text-center">{item.total_pcs}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(item.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                        <td className="px-3 py-2 text-right text-orange-700">{formatCurrency(viewOrder.order.total_amount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="flex gap-2">
                  {!isStaff && (
                    <Button variant="outline" onClick={() => { setViewOrder(null); openEditForm(viewOrder.order) }}>
                      <Edit2 className="w-4 h-4 mr-1" /> Edit
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => handleShareWhatsApp(viewOrder.order)}>
                    <Share2 className="w-4 h-4 mr-1" /> WhatsApp
                  </Button>
                  <Button variant="outline" onClick={() => handleDownloadPDF(viewOrder.order)}>
                    <Download className="w-4 h-4 mr-1" /> PDF
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteConfirm !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? This will permanently delete this order and all its items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-4">
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteConfirm) handleDelete(deleteConfirm) }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
