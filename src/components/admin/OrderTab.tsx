import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import {
  fetchOrders,
  deleteOrder,
  fetchOrderItems,
  createOrderWithItems,
  generateOrderNo,
  updateOrder,
  deleteOrderItemsByOrderId,
  createOrderItemBatch,
  duplicateOrder,
  updateOrderStatus,
} from '@/services/orders'
import { fetchProducts, fetchProduct } from '@/services/products'
import { fetchParties, findOrCreateParty } from '@/services/parties'
import { fetchAgents, findOrCreateAgent } from '@/services/agents'
import { fetchLocations, confirmOrderAndDeductStock } from '@/services/inventory'
import { useQRScanner } from '@/hooks/useQRScanner'
import { parseProductQRUrl } from '@/utils/qrcode'
import { useAuth } from '@/contexts/AuthContext'
import { useStaffOrderDraft } from '@/contexts/StaffOrderDraftContext'
import OrderRequestsSection from './OrderRequestsSection'
import type { Order, Product, Party, Agent, InventoryLocation, OrderStatus } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { downloadOrderPdf } from '@/utils/orderPdfGenerator'
import { StatusBadge, EmptyState, LoadingState } from '@/components/ui/primitives'
import {
  Plus,
  Trash2,
  Search,
  Download,
  Edit2,
  Copy,
  CheckCircle2,
  AlertCircle,
  Camera,
  Ban,
  ClipboardList,
} from 'lucide-react'

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
  hideRequestsSection?: boolean
  autoOpenDraft?: boolean
  onAutoOpenDraftHandled?: () => void
}

export default function OrderTab({
  isStaff = false,
  hideRequestsSection = false,
  autoOpenDraft = false,
  onAutoOpenDraftHandled,
}: OrderTabProps) {
  const { business } = useAuth()
  const activeSlug = (business?.slug || 'rangoli').trim().toLowerCase() || 'rangoli'
  const [searchParams, setSearchParams] = useSearchParams()

  const {
    draft: sharedDraft,
    totalDesigns: sharedDraftDesigns,
    totalSets: sharedDraftSets,
    updateHeader: updateSharedHeader,
    setItems: setSharedItems,
    addProductToDraft: addProductToSharedDraft,
    clearDraft: clearSharedDraft,
  } = useStaffOrderDraft()

  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [confirmModalOrder, setConfirmModalOrder] = useState<Order | null>(null)
  const [deductLocationId, setDeductLocationId] = useState<string>('')
  const [confirmStaffName, setConfirmStaffName] = useState(isStaff ? 'Staff' : 'Admin')
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [products, setProducts] = useState<Product[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])

  const [partyName, setPartyName] = useState('')
  const [station, setStation] = useState('')
  const [agent, setAgent] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0])
  const [exportDate, setExportDate] = useState('')
  const [brand, setBrand] = useState('')
  const [productName, setProductName] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<OrderItemDraft[]>([])
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')

  const [partySuggestions, setPartySuggestions] = useState<Party[]>([])
  const [agentSuggestions, setAgentSuggestions] = useState<Agent[]>([])
  const [showPartySuggestions, setShowPartySuggestions] = useState(false)
  const [showAgentSuggestions, setShowAgentSuggestions] = useState(false)

  const [itemSearch, setItemSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [showScanner, setShowScanner] = useState(false)

  useEffect(() => {
    loadOrders()
    loadAuxiliaryData()
  }, [])

  useEffect(() => {
    if (editingOrder) return
    setPartyName(sharedDraft.partyName)
    setStation(sharedDraft.station)
    setAgent(sharedDraft.agent)
    setGstNumber(sharedDraft.gstNumber)
    setOrderDate(sharedDraft.orderDate || new Date().toISOString().split('T')[0])
    setExportDate(sharedDraft.exportDate)
    setBrand(sharedDraft.brand)
    setProductName(sharedDraft.productName)
    setNotes(sharedDraft.notes)
    setItems(
      sharedDraft.items.map((item) => {
        const prod = products.find(
          (p) =>
            p.id === item.product_id ||
            p.design_no.toLowerCase() === item.design_no.toLowerCase()
        )
        return {
          design_no: item.design_no,
          rate: item.rate,
          sets: item.sets,
          pcs_per_set: item.pcs_per_set,
          total_pcs: item.total_pcs,
          line_total: item.line_total,
          product_id: item.product_id,
          thumbnail: prod?.image_url || undefined,
        }
      })
    )
  }, [sharedDraft, editingOrder, products])

  useEffect(() => {
    const openDraftParam = searchParams.get('openDraft')
    if (openDraftParam === '1' || autoOpenDraft) {
      setEditingOrder(null)
      setFormError('')
      setShowForm(true)
      if (openDraftParam === '1') {
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete('openDraft')
        setSearchParams(nextParams, { replace: true })
      }
      onAutoOpenDraftHandled?.()
    }
  }, [searchParams, autoOpenDraft, setSearchParams, onAutoOpenDraftHandled])

  const loadOrders = async () => {
    try {
      setLoading(true)
      const data = await fetchOrders({ limit: 200 })
      setOrders(data)
    } catch (error) {
      console.error('Error loading orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadAuxiliaryData = async () => {
    try {
      const [prods, pts, ags, locs] = await Promise.all([
        fetchProducts({ limit: 500 }),
        fetchParties(),
        fetchAgents(),
        fetchLocations(),
      ])
      setProducts(prods)
      setParties(pts)
      setAgents(ags)
      setLocations(locs)

      const shopLoc = locs.find((l) => l.name.toLowerCase() === 'shop')
      if (shopLoc) setDeductLocationId(String(shopLoc.id))
      else if (locs.length > 0) setDeductLocationId(String(locs[0].id))
    } catch (err) {
      console.error('Error loading auxiliary data:', err)
    }
  }

  const syncNewOrderItemsToShared = useCallback(
    (nextItems: OrderItemDraft[]) => {
      setItems(nextItems)
      if (!editingOrder) {
        setSharedItems(
          nextItems
            .filter((i) => Number(i.product_id) > 0 || i.design_no.trim() !== '')
            .map((i) => ({
              product_id: Number(i.product_id) || 0,
              design_no: i.design_no,
              rate: i.rate,
              sets: Math.max(1, Math.min(500, Math.floor(Number(i.sets) || 1))),
              pcs_per_set: Math.max(1, Math.floor(Number(i.pcs_per_set) || 1)),
              total_pcs: i.total_pcs,
              line_total: i.line_total,
            }))
        )
      }
    },
    [editingOrder, setSharedItems]
  )

  const handlePartyChange = (value: string) => {
    setPartyName(value)
    if (!editingOrder) updateSharedHeader({ partyName: value })
    if (value.trim().length > 0) {
      const q = value.toLowerCase()
      const matches = parties.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6)
      setPartySuggestions(matches)
      setShowPartySuggestions(matches.length > 0)
    } else {
      setShowPartySuggestions(false)
    }
  }

  const selectParty = (party: Party) => {
    setPartyName(party.name)
    const nextStation = party.station || station
    const nextGst = party.gst_number || gstNumber
    if (party.station) setStation(party.station)
    if (party.gst_number) setGstNumber(party.gst_number)
    if (!editingOrder) {
      updateSharedHeader({
        partyName: party.name,
        station: nextStation,
        gstNumber: nextGst,
      })
    }
    setShowPartySuggestions(false)
  }

  const handleAgentChange = (value: string) => {
    setAgent(value)
    if (!editingOrder) updateSharedHeader({ agent: value })
    if (value.trim().length > 0) {
      const q = value.toLowerCase()
      const matches = agents.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 6)
      setAgentSuggestions(matches)
      setShowAgentSuggestions(matches.length > 0)
    } else {
      setShowAgentSuggestions(false)
    }
  }

  const selectAgent = (agentRecord: Agent) => {
    setAgent(agentRecord.name)
    if (!editingOrder) updateSharedHeader({ agent: agentRecord.name })
    setShowAgentSuggestions(false)
  }

  const handleSearchItem = (query: string) => {
    setItemSearch(query)
    if (query.trim()) {
      const q = query.toLowerCase()
      setSearchResults(
        products
          .filter(
            (p) =>
              p.design_no.toLowerCase().includes(q) ||
              (p.brand && p.brand.toLowerCase().includes(q))
          )
          .slice(0, 8)
      )
    } else {
      setSearchResults([])
    }
  }

  const addItemFromProduct = useCallback(
    (product: Product) => {
      if (!editingOrder) {
        addProductToSharedDraft(product, 1)
      } else {
        setItems((prev) => {
          const existingIndex = prev.findIndex(
            (i) => i.design_no.toLowerCase() === product.design_no.toLowerCase()
          )
          if (existingIndex !== -1) {
            const updated = [...prev]
            const item = { ...updated[existingIndex] }
            item.sets = Math.min(500, item.sets + 1)
            item.total_pcs = item.sets * item.pcs_per_set
            item.line_total = item.rate * item.total_pcs
            updated[existingIndex] = item
            return updated
          }

          const pcsPerSet = product.pcs_per_set || 1
          const rate = product.rate || 0
          return [
            ...prev,
            {
              design_no: product.design_no,
              rate: rate,
              sets: 1,
              pcs_per_set: pcsPerSet,
              total_pcs: pcsPerSet,
              line_total: rate * pcsPerSet,
              product_id: product.id,
              thumbnail: product.image_url || undefined,
            },
          ]
        })
      }
      setItemSearch('')
      setSearchResults([])
    },
    [editingOrder, addProductToSharedDraft]
  )

  const handleQRScan = useCallback(
    async (text: string) => {
      const parsed = parseProductQRUrl(text, activeSlug)
      if (!parsed) {
        setFormError('Invalid product QR code. Order or invoice QR codes cannot be scanned here.')
        return
      }

      if (!parsed.isLegacy && parsed.slug !== activeSlug) {
        setFormError(
          `Scanned QR belongs to business "${parsed.slug}", not "${activeSlug}".`
        )
        return
      }

      const scannedCode = parsed.designNo
      if (!scannedCode) return

      setFormError('')
      const localMatch = products.find(
        (p) => p.design_no.toLowerCase() === scannedCode.toLowerCase()
      )
      if (localMatch) {
        addItemFromProduct(localMatch)
        return
      }

      try {
        const fetched = await fetchProduct(scannedCode)
        if (fetched) {
          addItemFromProduct(fetched)
        }
      } catch {
        setFormError(`Scanned design "${scannedCode}" was not found in active catalog.`)
      }
    },
    [activeSlug, products, addItemFromProduct]
  )

  useQRScanner({
    elementId: 'order-qr-reader',
    onScan: handleQRScan,
    active: showScanner,
    cooldownMs: 700,
  })

  const updateItem = (index: number, field: string, value: number) => {
    const updated = [...items]
    const item = { ...updated[index] }

    if (field === 'sets') {
      item.sets = Math.max(1, Math.min(500, Math.floor(value || 1)))
      item.total_pcs = item.sets * item.pcs_per_set
      item.line_total = item.rate * item.total_pcs
    } else if (field === 'rate') {
      item.rate = Math.max(0, value)
      item.line_total = item.rate * item.total_pcs
    } else if (field === 'pcs_per_set') {
      item.pcs_per_set = Math.max(1, Math.floor(value || 1))
      item.total_pcs = item.sets * item.pcs_per_set
      item.line_total = item.rate * item.total_pcs
    }

    updated[index] = item
    syncNewOrderItemsToShared(updated)
  }

  const removeItem = (index: number) => {
    const updated = items.filter((_, i) => i !== index)
    syncNewOrderItemsToShared(updated)
  }

  const totalSets = items.reduce((sum, i) => sum + (i.sets || 0), 0)
  const totalPieces = items.reduce((sum, i) => sum + (i.total_pcs || 0), 0)
  const totalAmount = items.reduce((sum, i) => sum + i.line_total, 0)

  const discardSharedDraftAndReset = () => {
    clearSharedDraft()
    setPartyName('')
    setStation('')
    setAgent('')
    setGstNumber('')
    setOrderDate(new Date().toISOString().split('T')[0])
    setExportDate('')
    setBrand('')
    setProductName('')
    setNotes('')
    setItems([])
    setEditingOrder(null)
    setShowScanner(false)
    setFormError('')
  }

  const openCreateForm = () => {
    setEditingOrder(null)
    setShowScanner(false)
    setFormError('')
    setShowForm(true)
  }

  const openEditForm = async (ord: Order) => {
    setEditingOrder(ord)
    setPartyName(ord.party_name)
    setStation(ord.station || '')
    setAgent(ord.agent || '')
    setGstNumber(ord.gst_number || '')
    setOrderDate(ord.order_date || new Date().toISOString().split('T')[0])
    setExportDate(ord.export_date || '')
    setBrand(ord.brand || '')
    setProductName(ord.product_name || '')
    setNotes(ord.notes || '')
    setFormError('')

    try {
      const orderItems = await fetchOrderItems(ord.id)
      const drafts: OrderItemDraft[] = orderItems.map((item) => {
        const prod = products.find((p) => p.design_no === item.design_no)
        return {
          design_no: item.design_no || '',
          rate: item.rate || 0,
          sets: item.sets || 1,
          pcs_per_set: item.pcs_per_set || 1,
          total_pcs: item.total_pcs || 0,
          line_total: item.line_total || 0,
          product_id: item.product_id || undefined,
          thumbnail: prod?.image_url || undefined,
        }
      })
      setItems(drafts)
    } catch {
      setItems([])
    }

    setShowForm(true)
  }

  const handleDuplicate = async (ord: Order) => {
    try {
      const duplicated = await duplicateOrder(ord.id)
      setOrders([duplicated, ...orders])
      setFeedbackBanner({
        type: 'success',
        text: `Order duplicated as draft: ${duplicated.order_no}`,
      })
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: `Error duplicating order: ${err?.message || 'Error'}`,
      })
    }
  }

  const handleSaveOrder = async () => {
    if (!partyName.trim()) {
      setFormError('Party Name is mandatory')
      return
    }
    if (items.length === 0) {
      setFormError('Please add at least one design item to the order')
      return
    }

    setFormLoading(true)
    setFormError('')

    try {
      await findOrCreateParty(partyName, station, gstNumber).catch(() => {})
      if (agent.trim()) await findOrCreateAgent(agent, station).catch(() => {})

      if (editingOrder) {
        await updateOrder(editingOrder.id, {
          party_name: partyName.trim(),
          station: station.trim() || null,
          agent: agent.trim() || null,
          gst_number: gstNumber.trim() || null,
          order_date: orderDate || null,
          export_date: exportDate || null,
          brand: brand.trim() || null,
          product_name: productName.trim() || null,
          notes: notes.trim() || null,
          total_amount: totalAmount,
        })

        await deleteOrderItemsByOrderId(editingOrder.id)
        if (items.length > 0) {
          await createOrderItemBatch(
            items.map((i) => ({
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
        setFeedbackBanner({
          type: 'success',
          text: `Order ${editingOrder.order_no} updated.`,
        })
      } else {
        const orderNo = await generateOrderNo()
        await createOrderWithItems(
          {
            order_no: orderNo,
            party_name: partyName.trim(),
            station: station.trim() || null,
            agent: agent.trim() || null,
            gst_number: gstNumber.trim() || null,
            order_date: orderDate || null,
            export_date: exportDate || null,
            brand: brand.trim() || null,
            product_name: productName.trim() || null,
            notes: notes.trim() || null,
            status: 'draft',
            total_amount: totalAmount,
          },
          items.map((i) => ({
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
        clearSharedDraft()
        setFeedbackBanner({
          type: 'success',
          text: `Draft order ${orderNo} created for ${partyName.trim()}.`,
        })
      }

      setShowForm(false)
      setEditingOrder(null)
      setShowScanner(false)
      await loadOrders()
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save order')
    } finally {
      setFormLoading(false)
    }
  }

  const handleExecuteConfirmation = async () => {
    if (!confirmModalOrder) return
    setConfirmLoading(true)

    try {
      await confirmOrderAndDeductStock(
        confirmModalOrder.id,
        parseInt(deductLocationId, 10),
        confirmStaffName.trim() || 'Staff'
      )
      setOrders(
        orders.map((o) => (o.id === confirmModalOrder.id ? { ...o, status: 'confirmed' } : o))
      )
      const confirmedNo = confirmModalOrder.order_no
      setConfirmModalOrder(null)
      setFeedbackBanner({
        type: 'success',
        text: `Order ${confirmedNo} confirmed and stock deducted.`,
      })
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: `Confirmation failed: ${err?.message || 'Error'}`,
      })
    } finally {
      setConfirmLoading(false)
    }
  }

  const handleCancelOrder = async (orderId: number) => {
    try {
      await updateOrderStatus(orderId, 'cancelled')
      setOrders(orders.map((o) => (o.id === orderId ? { ...o, status: 'cancelled' } : o)))
      setFeedbackBanner({
        type: 'success',
        text: 'Order marked as cancelled.',
      })
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: `Failed to cancel order: ${err?.message || 'Error'}`,
      })
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    try {
      await deleteOrder(deleteConfirm)
      setOrders(orders.filter((o) => o.id !== deleteConfirm))
      setDeleteConfirm(null)
      setFeedbackBanner({
        type: 'success',
        text: 'Order deleted.',
      })
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: `Error deleting order: ${err?.message || 'Error'}`,
      })
    }
  }

  const handleDownloadPdf = async (ord: Order) => {
    try {
      const ordItems = await fetchOrderItems(ord.id)
      const withProducts = await Promise.all(
        ordItems.map(async (item) => {
          const prod = products.find((p) => p.design_no === item.design_no)
          return { ...item, product: prod }
        })
      )
      await downloadOrderPdf({ order: ord, items: withProducts, businessName: business?.name })
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: `PDF download failed: ${err?.message || 'Error'}`,
      })
    }
  }

  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      o.order_no.toLowerCase().includes(q) ||
      o.party_name.toLowerCase().includes(q) ||
      (o.station && o.station.toLowerCase().includes(q)) ||
      (o.agent && o.agent.toLowerCase().includes(q)) ||
      (o.gst_number && o.gst_number.toLowerCase().includes(q))
    )
  })

  const touchClass = isStaff ? 'min-h-[44px]' : ''

  return (
    <div className="space-y-4">
      {/* Optional inline Requests section when not shown on dedicated Requests tab */}
      {!isStaff && !hideRequestsSection && (
        <OrderRequestsSection
          onOrderConverted={async () => {
            await loadOrders()
            await loadAuxiliaryData()
          }}
        />
      )}

      {feedbackBanner && (
        <div
          className={`flex items-center justify-between gap-2 px-4 py-3 rounded-[6px] border bg-white text-xs font-medium ${
            feedbackBanner.type === 'success'
              ? 'border-[#1F7A4D] text-[#1F7A4D]'
              : 'border-[#B42318] text-[#B42318]'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedbackBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="font-semibold underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search, Filter & Primary Action Toolbar */}
      <div className="bg-white p-4 rounded-[6px] border border-[#E3E5EA] space-y-3">
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <Input
              aria-label="Search orders"
              placeholder="Search order no, party, station, agent..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pl-9 ${touchClass}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {sharedDraftDesigns > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={openCreateForm}
                className={`flex-1 sm:flex-initial ${touchClass}`}
              >
                <ClipboardList className="w-4 h-4" />
                <span className="tabular-nums">
                  Resume Draft ({sharedDraftDesigns} · {sharedDraftSets} sets)
                </span>
              </Button>
            )}
            <Button
              onClick={openCreateForm}
              className={`flex-1 sm:flex-initial ${touchClass}`}
            >
              <Plus className="w-4 h-4" />
              <span>New Order</span>
            </Button>
          </div>
        </div>

        {/* Status Filter Bar */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-[#E3E5EA] text-xs">
          {(
            [
              { key: 'all', label: `All (${orders.length})` },
              {
                key: 'draft',
                label: `Draft (${orders.filter((o) => !o.status || o.status === 'draft').length})`,
              },
              {
                key: 'confirmed',
                label: `Confirmed (${orders.filter((o) => o.status === 'confirmed').length})`,
              },
              {
                key: 'cancelled',
                label: `Cancelled (${orders.filter((o) => o.status === 'cancelled').length})`,
              },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-[6px] font-medium border transition-colors cursor-pointer tabular-nums ${
                isStaff ? 'min-h-[44px]' : ''
              } ${
                statusFilter === f.key
                  ? 'bg-[#1E2A4A] text-white border-[#1E2A4A]'
                  : 'bg-white text-[#1A1D24] border-[#E3E5EA] hover:bg-[#F4F5F7]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders List Table */}
      <div className="bg-white border border-[#E3E5EA] rounded-[6px] overflow-hidden">
        {loading ? (
          <LoadingState message="Loading wholesale orders..." />
        ) : filteredOrders.length === 0 ? (
          <EmptyState
            title="No wholesale orders found."
            action={
              <Button onClick={openCreateForm} size="sm" className={touchClass}>
                <Plus className="w-3.5 h-3.5" />
                <span>New Order</span>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F4F5F7] border-b border-[#E3E5EA] text-[#667085] text-xs font-medium">
                <tr>
                  <th className="px-4 py-2.5 text-left">Order No</th>
                  <th className="px-4 py-2.5 text-left">Party</th>
                  <th className="px-4 py-2.5 text-left">Station / Agent</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E5EA]">
                {filteredOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-[#F4F5F7]/60">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <a
                        href={`/${activeSlug}/order/${encodeURIComponent(ord.order_no)}`}
                        className="font-mono text-xs font-semibold text-[#1E2A4A] hover:underline"
                      >
                        {ord.order_no}
                      </a>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#1A1D24]">{ord.party_name}</div>
                      {ord.gst_number && (
                        <div className="font-mono text-xs text-[#667085]">{ord.gst_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs text-[#1A1D24]">{ord.station || '—'}</div>
                      {ord.agent && <div className="text-xs text-[#667085]">{ord.agent}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#667085] whitespace-nowrap tabular-nums">
                      {formatDate(ord.order_date || ord.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#1A1D24] tabular-nums whitespace-nowrap">
                      {formatCurrency(ord.total_amount)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusBadge status={ord.status || 'draft'} />
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {ord.status !== 'confirmed' && ord.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            onClick={() => setConfirmModalOrder(ord)}
                            className={`h-8 px-2.5 text-xs bg-[#1F7A4D] hover:bg-[#17603C] text-white ${
                              isStaff ? 'min-h-[44px] px-3' : ''
                            }`}
                          >
                            Confirm
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Download Order PDF"
                          onClick={() => handleDownloadPdf(ord)}
                          className={`p-0 text-[#1E2A4A] ${isStaff ? 'min-h-[44px] min-w-[44px]' : 'h-8 w-8'}`}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Duplicate Order"
                          onClick={() => handleDuplicate(ord)}
                          className={`p-0 text-[#667085] hover:text-[#1A1D24] ${
                            isStaff ? 'min-h-[44px] min-w-[44px]' : 'h-8 w-8'
                          }`}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        {!isStaff && ord.status !== 'confirmed' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit Order"
                            onClick={() => openEditForm(ord)}
                            className="h-8 w-8 p-0 text-[#667085] hover:text-[#1A1D24]"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                        {!isStaff && ord.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Cancel Order"
                            onClick={() => handleCancelOrder(ord.id)}
                            className="h-8 w-8 p-0 text-[#667085] hover:text-[#B42318]"
                          >
                            <Ban className="w-4 h-4" />
                          </Button>
                        )}
                        {!isStaff && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Delete Order"
                            onClick={() => setDeleteConfirm(ord.id)}
                            className="h-8 w-8 p-0 text-[#B42318]"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Order / Edit Order Modal with Pinned Totals Bar */}
      <Dialog
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open)
          if (!open) {
            setShowScanner(false)
            setEditingOrder(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-[820px] max-h-[92vh] p-0 flex flex-col gap-0 overflow-hidden">
          <DialogHeader className="px-5 py-4 border-b border-[#E3E5EA] bg-white shrink-0">
            <DialogTitle>
              {editingOrder ? `Edit Order — ${editingOrder.order_no}` : 'New Order'}
            </DialogTitle>
          </DialogHeader>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-[#F4F5F7]">
            {formError && (
              <p className="text-xs font-medium text-[#B42318] bg-white p-3 rounded-[6px] border border-[#B42318]">
                {formError}
              </p>
            )}

            {/* Party & Agent Pickers */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 bg-white p-4 rounded-[6px] border border-[#E3E5EA]">
              <div className="space-y-1.5 relative">
                <Label htmlFor="order-party-name">Party Name *</Label>
                <Input
                  id="order-party-name"
                  value={partyName}
                  onChange={(e) => handlePartyChange(e.target.value)}
                  onFocus={() => {
                    if (parties.length > 0 && partyName.trim().length > 0) {
                      setShowPartySuggestions(partySuggestions.length > 0)
                    }
                  }}
                  placeholder="Select or type party"
                  required
                />
                {showPartySuggestions && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white border border-[#E3E5EA] rounded-[6px] mt-1 overflow-hidden divide-y divide-[#E3E5EA]">
                    {partySuggestions.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => selectParty(p)}
                        className="w-full px-3 py-2 hover:bg-[#F4F5F7] text-left text-xs flex justify-between items-center cursor-pointer"
                      >
                        <span className="font-semibold text-[#1A1D24]">{p.name}</span>
                        <span className="text-[#667085]">{p.station}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="order-station">Station / City</Label>
                <Input
                  id="order-station"
                  value={station}
                  onChange={(e) => {
                    setStation(e.target.value)
                    if (!editingOrder) updateSharedHeader({ station: e.target.value })
                  }}
                  placeholder="e.g. Surat"
                />
              </div>

              <div className="space-y-1.5 relative">
                <Label htmlFor="order-agent">Agent</Label>
                <Input
                  id="order-agent"
                  value={agent}
                  onChange={(e) => handleAgentChange(e.target.value)}
                  placeholder="Select or type agent"
                />
                {showAgentSuggestions && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white border border-[#E3E5EA] rounded-[6px] mt-1 overflow-hidden divide-y divide-[#E3E5EA]">
                    {agentSuggestions.map((a) => (
                      <button
                        type="button"
                        key={a.id}
                        onClick={() => selectAgent(a)}
                        className="w-full px-3 py-2 hover:bg-[#F4F5F7] text-left text-xs cursor-pointer"
                      >
                        <span className="font-semibold text-[#1A1D24]">{a.name}</span>
                        {a.station && <span className="text-[#667085] ml-1">({a.station})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="order-gst">GSTIN</Label>
                <Input
                  id="order-gst"
                  value={gstNumber}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase()
                    setGstNumber(val)
                    if (!editingOrder) updateSharedHeader({ gstNumber: val })
                  }}
                  placeholder="24AAAAA0000A1Z5"
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="order-date">Order Date</Label>
                <Input
                  id="order-date"
                  type="date"
                  value={orderDate}
                  onChange={(e) => {
                    setOrderDate(e.target.value)
                    if (!editingOrder) updateSharedHeader({ orderDate: e.target.value })
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="order-export-date">Dispatch Date</Label>
                <Input
                  id="order-export-date"
                  type="date"
                  value={exportDate}
                  onChange={(e) => {
                    setExportDate(e.target.value)
                    if (!editingOrder) updateSharedHeader({ exportDate: e.target.value })
                  }}
                />
              </div>
            </div>

            {/* Scan-Add Row */}
            <div className="bg-white p-4 rounded-[6px] border border-[#E3E5EA] space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
                  <Input
                    aria-label="Search design number to add"
                    placeholder="Type design number or brand to add..."
                    value={itemSearch}
                    onChange={(e) => handleSearchItem(e.target.value)}
                    className={`pl-9 ${touchClass}`}
                  />

                  {searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-50 bg-white border border-[#E3E5EA] rounded-[6px] mt-1 overflow-hidden divide-y divide-[#E3E5EA]">
                      {searchResults.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => addItemFromProduct(p)}
                          className="w-full px-3 py-2 hover:bg-[#F4F5F7] text-left flex items-center justify-between text-xs cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            {p.image_url && (
                              <img
                                src={p.image_url}
                                alt=""
                                className="w-8 h-8 rounded-[4px] object-cover border border-[#E3E5EA]"
                              />
                            )}
                            <div>
                              <p className="font-semibold text-[#1A1D24]">{p.design_no}</p>
                              <p className="text-[#667085]">
                                {p.brand || 'Kala'} · {p.fabric || 'Standard'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right tabular-nums">
                            <p className="font-semibold text-[#1A1D24]">
                              {formatCurrency(p.rate || 0)}/pc
                            </p>
                            <p className="text-[#667085]">{p.pcs_per_set || 1} pcs/set</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  type="button"
                  variant={showScanner ? 'default' : 'outline'}
                  onClick={() => setShowScanner(!showScanner)}
                  className={`shrink-0 ${touchClass}`}
                >
                  <Camera className="w-4 h-4" />
                  <span>{showScanner ? 'Close Scanner' : 'Scan QR'}</span>
                </Button>
              </div>

              {showScanner && (
                <div className="bg-[#F4F5F7] p-3 rounded-[6px] border border-[#E3E5EA] space-y-2">
                  <div
                    id="order-qr-reader"
                    className="w-full max-w-xs mx-auto rounded-[6px] overflow-hidden aspect-video bg-[#1A1D24]"
                  />
                  <p className="text-xs text-center text-[#667085]">
                    Point camera at product QR. Repeated scans increment sets automatically.
                  </p>
                </div>
              )}
            </div>

            {/* Order Items Table */}
            <div className="bg-white border border-[#E3E5EA] rounded-[6px] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F4F5F7] border-b border-[#E3E5EA] text-[#667085] font-medium">
                    <tr>
                      <th className="py-2.5 px-3 text-left">Design No</th>
                      <th className="py-2.5 px-3 text-right w-24">Rate (₹)</th>
                      <th className="py-2.5 px-3 text-right w-20">Sets</th>
                      <th className="py-2.5 px-3 text-right w-20">Pcs/Set</th>
                      <th className="py-2.5 px-3 text-right w-20">Total Pcs</th>
                      <th className="py-2.5 px-3 text-right w-28">Amount</th>
                      <th className="py-2.5 px-2 text-center w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E5EA]">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 px-4 text-center text-sm text-[#667085]">
                          No designs added yet. Search a design number or scan a QR tag above.
                        </td>
                      </tr>
                    ) : (
                      items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-[#F4F5F7]/60">
                          <td className="py-2 px-3 font-semibold text-[#1A1D24]">
                            <div className="flex items-center gap-2">
                              {item.thumbnail && (
                                <img
                                  src={item.thumbnail}
                                  alt=""
                                  className="w-7 h-7 rounded-[4px] object-cover border border-[#E3E5EA]"
                                />
                              )}
                              <span>{item.design_no}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Input
                              aria-label={`Rate for design ${item.design_no}`}
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.rate}
                              onChange={(e) =>
                                updateItem(idx, 'rate', parseFloat(e.target.value) || 0)
                              }
                              className="h-8 text-right text-xs px-2 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Input
                              aria-label={`Sets for design ${item.design_no}`}
                              type="number"
                              min="1"
                              max="500"
                              value={item.sets}
                              onChange={(e) => updateItem(idx, 'sets', parseInt(e.target.value) || 1)}
                              className="h-8 text-right text-xs px-2 font-semibold tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Input
                              aria-label={`Pieces per set for design ${item.design_no}`}
                              type="number"
                              min="1"
                              value={item.pcs_per_set}
                              onChange={(e) =>
                                updateItem(idx, 'pcs_per_set', parseInt(e.target.value) || 1)
                              }
                              className="h-8 text-right text-xs px-2 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-medium text-[#1A1D24] tabular-nums">
                            {item.total_pcs.toLocaleString('en-IN')}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-[#1A1D24] tabular-nums whitespace-nowrap">
                            {formatCurrency(item.line_total)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              title="Remove item"
                              onClick={() => removeItem(idx)}
                              className="text-[#B42318] p-1.5 rounded-[6px] hover:bg-[#F4F5F7] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Pinned Totals Bar */}
          <div className="sticky bottom-0 px-5 py-3.5 bg-white border-t border-[#E3E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div className="flex flex-wrap items-center gap-4 text-xs text-[#667085] tabular-nums">
              <span>
                Designs: <strong className="text-[#1A1D24]">{items.length}</strong>
              </span>
              <span>
                Sets: <strong className="text-[#1A1D24]">{totalSets.toLocaleString('en-IN')}</strong>
              </span>
              <span>
                Pieces: <strong className="text-[#1A1D24]">{totalPieces.toLocaleString('en-IN')}</strong>
              </span>
              <span className="text-sm font-semibold text-[#1A1D24]">
                Total: {formatCurrency(totalAmount)}
              </span>
            </div>

            <div className="flex items-center gap-2 justify-end">
              {!editingOrder && (items.length > 0 || partyName.trim()) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={discardSharedDraftAndReset}
                  className="text-[#B42318] text-xs"
                >
                  Discard
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Close
              </Button>
              <Button
                type="button"
                onClick={handleSaveOrder}
                disabled={formLoading || items.length === 0}
              >
                {formLoading ? 'Saving...' : editingOrder ? 'Update Order' : 'Save Draft Order'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation & Stock Deduction Modal */}
      <Dialog open={confirmModalOrder !== null} onOpenChange={() => setConfirmModalOrder(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Confirm Order &amp; Deduct Stock</DialogTitle>
          </DialogHeader>

          {confirmModalOrder && (
            <div className="space-y-4 pt-1 text-sm">
              <p className="text-[#667085] leading-relaxed">
                Confirming <strong className="text-[#1A1D24]">{confirmModalOrder.order_no}</strong> for{' '}
                <strong className="text-[#1A1D24]">{confirmModalOrder.party_name}</strong> locks pricing and
                deducts inventory sets from the selected location.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-location">Deduct Inventory From *</Label>
                <select
                  id="confirm-location"
                  value={deductLocationId}
                  onChange={(e) => setDeductLocationId(e.target.value)}
                  className="w-full h-9 bg-white border border-[#E3E5EA] rounded-[6px] px-3 text-sm text-[#1A1D24]"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-staff">Authorizing Staff</Label>
                <Input
                  id="confirm-staff"
                  value={confirmStaffName}
                  onChange={(e) => setConfirmStaffName(e.target.value)}
                  placeholder="Staff member name"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E3E5EA]">
                <Button variant="outline" onClick={() => setConfirmModalOrder(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleExecuteConfirmation}
                  disabled={confirmLoading}
                  className="bg-[#1F7A4D] hover:bg-[#17603C] text-white"
                >
                  {confirmLoading ? 'Confirming...' : 'Confirm & Deduct'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this order? All associated line items will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-[#B42318] hover:bg-[#911C13] text-white"
            >
              Delete Order
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
