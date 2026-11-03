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
  ShoppingCart,
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
  autoOpenDraft?: boolean
  onAutoOpenDraftHandled?: () => void
}

export default function OrderTab({
  isStaff = false,
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

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Directories & Products Cache
  const [products, setProducts] = useState<Product[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])

  // Form fields (when editingOrder is null, synchronized with sharedDraft)
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

  // Autocomplete suggestions
  const [partySuggestions, setPartySuggestions] = useState<Party[]>([])
  const [agentSuggestions, setAgentSuggestions] = useState<Agent[]>([])
  const [showPartySuggestions, setShowPartySuggestions] = useState(false)
  const [showAgentSuggestions, setShowAgentSuggestions] = useState(false)

  // Item entry
  const [itemSearch, setItemSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [showScanner, setShowScanner] = useState(false)

  useEffect(() => {
    loadOrders()
    loadAuxiliaryData()
  }, [])

  // Keep New Order modal state synchronized with shared staff draft when not editing an existing DB order
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

  // Auto-open draft order form when navigated with ?openDraft=1 or autoOpenDraft prop
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

      // Default stock deduction to Shop location
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

  // Handle party name typing & autocomplete
  const handlePartyChange = (value: string) => {
    setPartyName(value)
    if (!editingOrder) updateSharedHeader({ partyName: value })
    if (value.trim().length > 1) {
      const q = value.toLowerCase()
      const matches = parties.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5)
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

  // Handle agent typing & autocomplete
  const handleAgentChange = (value: string) => {
    setAgent(value)
    if (!editingOrder) updateSharedHeader({ agent: value })
    if (value.trim().length > 1) {
      const q = value.toLowerCase()
      const matches = agents.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 5)
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

  // Item search
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

  // QR Scanner hook with shared parser & tenant validation
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
      // Auto-register party and agent in master directories
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
        // Clear shared staff draft once saved to the database
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

  // Confirm order & trigger stock deduction
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
        text: `Order ${confirmedNo} confirmed and stock inventory deducted.`,
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

  // Filtered orders list
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

  return (
    <div className="space-y-6">
      {/* Owner-only Buyer QR Order Requests Section */}
      {!isStaff && (
        <OrderRequestsSection
          onOrderConverted={async () => {
            await loadOrders()
            await loadAuxiliaryData()
          }}
        />
      )}

      {feedbackBanner && (
        <div
          className={`flex items-center justify-between gap-2 px-4 py-3 rounded-xl border text-xs font-medium ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedbackBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="font-semibold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top action and filter bar */}
      <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input
              aria-label="Search orders"
              placeholder="Search by order #, party, station, agent..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-stone-50/70"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {sharedDraftDesigns > 0 && (
              <Button
                type="button"
                onClick={openCreateForm}
                className="bg-orange-700 hover:bg-orange-800 text-white shrink-0 gap-1.5 flex-1 sm:flex-initial"
              >
                <ClipboardList className="w-4 h-4" />
                <span>
                  Resume Draft ({sharedDraftDesigns}{' '}
                  {sharedDraftDesigns === 1 ? 'Design' : 'Designs'} · {sharedDraftSets}{' '}
                  {sharedDraftSets === 1 ? 'Set' : 'Sets'})
                </span>
              </Button>
            )}
            <Button
              onClick={openCreateForm}
              className="bg-stone-900 hover:bg-stone-800 text-white shrink-0 flex-1 sm:flex-initial"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Create New Order
            </Button>
          </div>
        </div>

        {/* Status filters */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-stone-100 text-xs">
          <span className="font-semibold text-stone-500 uppercase tracking-wider mr-1">
            Order Status:
          </span>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'all'
                ? 'bg-stone-900 text-white'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
            }`}
          >
            All Orders ({orders.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('draft')}
            className={`px-3 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'draft'
                ? 'bg-amber-700 text-white'
                : 'bg-amber-50 text-amber-800 border border-amber-200/70 hover:bg-amber-100'
            }`}
          >
            Drafts ({orders.filter((o) => !o.status || o.status === 'draft').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('confirmed')}
            className={`px-3 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'confirmed'
                ? 'bg-emerald-700 text-white'
                : 'bg-emerald-50 text-emerald-800 border border-emerald-200/70 hover:bg-emerald-100'
            }`}
          >
            Confirmed ({orders.filter((o) => o.status === 'confirmed').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('cancelled')}
            className={`px-3 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'cancelled'
                ? 'bg-red-700 text-white'
                : 'bg-red-50 text-red-700 border border-red-200/70 hover:bg-red-100'
            }`}
          >
            Cancelled ({orders.filter((o) => o.status === 'cancelled').length})
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-stone-200/80 rounded-xl overflow-hidden shadow-2xs">
        {loading ? (
          <LoadingState message="Loading wholesale orders..." />
        ) : filteredOrders.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart className="w-6 h-6" />}
            title="No wholesale orders found"
            description='Click "Create New Order" or convert a Buyer QR Request above to start.'
            action={
              <Button onClick={openCreateForm} size="sm">
                <Plus className="w-4 h-4 mr-1.5" /> Create Wholesale Order
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200/80 text-stone-600 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Order No</th>
                  <th className="px-4 py-3 text-left">Party Details</th>
                  <th className="px-4 py-3 text-left">Station & Agent</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-stone-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <a
                        href={`/${activeSlug}/order/${encodeURIComponent(ord.order_no)}`}
                        className="font-mono font-bold text-orange-700 hover:text-orange-800 hover:underline block"
                      >
                        {ord.order_no}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-stone-900">{ord.party_name}</p>
                      {ord.gst_number && (
                        <p className="font-mono text-xs text-stone-500 mt-0.5">{ord.gst_number}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-stone-800 font-medium">{ord.station || '—'}</p>
                      {ord.agent && <p className="text-xs text-stone-500">Ag: {ord.agent}</p>}
                    </td>
                    <td className="px-4 py-3 text-stone-600 text-xs whitespace-nowrap">
                      {formatDate(ord.order_date || ord.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-stone-900 tabular-nums">
                      {formatCurrency(ord.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={ord.status || 'draft'} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {ord.status !== 'confirmed' && ord.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            onClick={() => setConfirmModalOrder(ord)}
                            className="h-8 px-2.5 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-semibold"
                          >
                            Confirm
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Download Order PDF"
                          onClick={() => handleDownloadPdf(ord)}
                          className="h-8 w-8 p-0 text-orange-700 hover:text-orange-800 hover:bg-orange-50"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Duplicate Order"
                          onClick={() => handleDuplicate(ord)}
                          className="h-8 w-8 p-0 text-stone-600 hover:text-stone-900"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        {!isStaff && ord.status !== 'confirmed' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit Order"
                            onClick={() => openEditForm(ord)}
                            className="h-8 w-8 p-0 text-stone-600 hover:text-stone-900"
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
                            className="h-8 w-8 p-0 text-stone-500 hover:text-red-700 hover:bg-red-50"
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
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
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

      {/* Create / Edit Order Modal */}
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
        <DialogContent className="sm:max-w-[780px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-stone-900">
              {editingOrder ? `Edit Order — ${editingOrder.order_no}` : 'Create Wholesale Order'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {formError && (
              <p className="text-xs font-semibold text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-200">
                {formError}
              </p>
            )}

            {/* Header / Party Details */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 bg-stone-50 p-4 rounded-xl border border-stone-200/80">
              <div className="space-y-1.5 relative">
                <Label htmlFor="order-party-name">Party Name *</Label>
                <Input
                  id="order-party-name"
                  value={partyName}
                  onChange={(e) => handlePartyChange(e.target.value)}
                  placeholder="e.g. Radhika Sarees"
                  required
                />
                {showPartySuggestions && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white border border-stone-200 rounded-lg shadow-lg mt-1 overflow-hidden">
                    {partySuggestions.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => selectParty(p)}
                        className="w-full p-2.5 hover:bg-stone-100 text-left text-xs flex justify-between items-center"
                      >
                        <span className="font-bold text-stone-900">{p.name}</span>
                        <span className="text-stone-500">{p.station}</span>
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
                  placeholder="e.g. Ramesh Bhai"
                />
                {showAgentSuggestions && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white border border-stone-200 rounded-lg shadow-lg mt-1 overflow-hidden">
                    {agentSuggestions.map((a) => (
                      <button
                        type="button"
                        key={a.id}
                        onClick={() => selectAgent(a)}
                        className="w-full p-2.5 hover:bg-stone-100 text-left text-xs"
                      >
                        <span className="font-bold text-stone-900">{a.name}</span>
                        {a.station && <span className="text-stone-500 ml-1">({a.station})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="order-gst">GST Number</Label>
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
                <Label htmlFor="order-export-date">Dispatch / Export Date</Label>
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

            {/* Design Item Entry Bar */}
            <div className="bg-stone-900 text-white p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-300">
                  Add Designs to Order
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowScanner(!showScanner)}
                  className={`h-8 text-xs ${
                    showScanner
                      ? 'bg-orange-700 text-white border-orange-700 hover:bg-orange-800'
                      : 'bg-stone-800 text-stone-100 border-stone-700 hover:bg-stone-700 hover:text-white'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5 mr-1.5" />
                  {showScanner ? 'Close Camera' : 'Scan Product QR'}
                </Button>
              </div>

              {/* QR Scanner Component */}
              {showScanner && (
                <div className="bg-stone-950 p-3 rounded-lg border border-stone-800 space-y-2">
                  <div
                    id="order-qr-reader"
                    className="w-full max-w-xs mx-auto rounded overflow-hidden aspect-video bg-black"
                  />
                  <p className="text-[11px] text-center text-stone-400">
                    Point camera at product QR. Repeated scans increment set quantities automatically.
                  </p>
                </div>
              )}

              {/* Manual Search */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <Input
                  aria-label="Type design number to search and add"
                  placeholder="Type design number to search and add..."
                  value={itemSearch}
                  onChange={(e) => handleSearchItem(e.target.value)}
                  className="pl-9 bg-stone-800 border-stone-700 text-white placeholder:text-stone-400 focus-visible:border-orange-500"
                />

                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white text-stone-900 border border-stone-200 rounded-lg shadow-xl mt-1 overflow-hidden divide-y divide-stone-100">
                    {searchResults.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => addItemFromProduct(p)}
                        className="w-full p-2.5 hover:bg-orange-50 text-left flex items-center justify-between text-xs transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          {p.image_url && (
                            <img
                              src={p.image_url}
                              alt=""
                              className="w-8 h-8 rounded object-cover border border-stone-200"
                            />
                          )}
                          <div>
                            <p className="font-bold text-stone-900">Design #{p.design_no}</p>
                            <p className="text-stone-500 text-[10px]">
                              {p.brand || 'Kala'} • {p.fabric || 'Standard'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-orange-700">
                            {formatCurrency(p.rate || 0)}/pc
                          </p>
                          <p className="text-stone-500 text-[10px]">{p.pcs_per_set || 1} pcs/set</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Order Items Table */}
            <div className="border border-stone-200/80 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 border-b border-stone-200/80 text-stone-600 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3 text-left">Design No</th>
                      <th className="py-2.5 px-3 text-right w-24">Rate (₹)</th>
                      <th className="py-2.5 px-3 text-center w-20">Sets</th>
                      <th className="py-2.5 px-3 text-center w-20">Pcs/Set</th>
                      <th className="py-2.5 px-3 text-center w-20">Total Pcs</th>
                      <th className="py-2.5 px-3 text-right w-28">Amount</th>
                      <th className="py-2.5 px-2 text-center w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-stone-500">
                          No designs added yet. Scan a product QR code or search by design number above.
                        </td>
                      </tr>
                    ) : (
                      items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-stone-50/70">
                          <td className="py-2 px-3 font-bold text-stone-900">
                            <div className="flex items-center gap-2">
                              {item.thumbnail && (
                                <img
                                  src={item.thumbnail}
                                  alt=""
                                  className="w-7 h-7 rounded object-cover border border-stone-200"
                                />
                              )}
                              <span>#{item.design_no}</span>
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
                          <td className="py-2 px-3 text-center">
                            <Input
                              aria-label={`Sets for design ${item.design_no}`}
                              type="number"
                              min="1"
                              max="500"
                              value={item.sets}
                              onChange={(e) => updateItem(idx, 'sets', parseInt(e.target.value) || 1)}
                              className="h-8 text-center text-xs px-2 font-bold text-stone-900 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <Input
                              aria-label={`Pieces per set for design ${item.design_no}`}
                              type="number"
                              min="1"
                              value={item.pcs_per_set}
                              onChange={(e) =>
                                updateItem(idx, 'pcs_per_set', parseInt(e.target.value) || 1)
                              }
                              className="h-8 text-center text-xs px-2 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 text-center font-bold text-stone-700 font-mono tabular-nums">
                            {item.total_pcs}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-stone-900 tabular-nums">
                            {formatCurrency(item.line_total)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              title="Remove item"
                              onClick={() => removeItem(idx)}
                              className="text-red-600 hover:text-red-700 p-1 rounded hover:bg-red-50"
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

            {/* Calculations Summary Box */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 bg-stone-50 p-4 rounded-xl border border-stone-200/80">
              <div className="flex flex-wrap gap-5 text-xs text-stone-600 font-medium">
                <span>
                  Total Designs: <strong className="text-stone-900">{items.length}</strong>
                </span>
                <span>
                  Total Sets: <strong className="text-stone-900">{totalSets}</strong>
                </span>
                <span>
                  Total Pieces: <strong className="text-stone-900">{totalPieces}</strong>
                </span>
              </div>
              <div className="sm:text-right">
                <span className="text-[11px] font-semibold text-stone-500 block uppercase tracking-wider">
                  Total Order Amount
                </span>
                <span className="text-2xl font-extrabold text-orange-700 tabular-nums">
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            </div>

            {/* Form actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-stone-200/80">
              <div>
                {!editingOrder && (items.length > 0 || partyName.trim()) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={discardSharedDraftAndReset}
                    className="text-red-700 hover:text-red-800 hover:bg-red-50 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Discard Draft
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveOrder}
                  disabled={formLoading || items.length === 0}
                  className="bg-orange-700 hover:bg-orange-800 text-white"
                >
                  {formLoading ? 'Saving...' : editingOrder ? 'Update Order' : 'Save Draft Order'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation & Stock Deduction Modal */}
      <Dialog open={confirmModalOrder !== null} onOpenChange={() => setConfirmModalOrder(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-stone-900">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
              Confirm Order & Deduct Stock
            </DialogTitle>
          </DialogHeader>

          {confirmModalOrder && (
            <div className="space-y-4 pt-2 text-sm">
              <p className="text-stone-600 leading-relaxed">
                Confirming Order <strong className="text-stone-900">{confirmModalOrder.order_no}</strong> for{' '}
                <strong className="text-stone-900">{confirmModalOrder.party_name}</strong> will lock pricing and
                atomically deduct inventory sets.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-location">Deduct Inventory From Location *</Label>
                <select
                  id="confirm-location"
                  value={deductLocationId}
                  onChange={(e) => setDeductLocationId(e.target.value)}
                  className="w-full h-10 bg-white border border-stone-300 rounded-lg px-3 text-sm font-medium text-stone-900 focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-700"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-staff">Staff Authorizing</Label>
                <Input
                  id="confirm-staff"
                  value={confirmStaffName}
                  onChange={(e) => setConfirmStaffName(e.target.value)}
                  placeholder="Staff member name"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200/80">
                <Button variant="outline" onClick={() => setConfirmModalOrder(null)}>
                  Keep Draft
                </Button>
                <Button
                  onClick={handleExecuteConfirmation}
                  disabled={confirmLoading}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold"
                >
                  {confirmLoading ? 'Processing Deduction...' : 'Confirm & Deduct Stock'}
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
            <AlertDialogAction onClick={handleDelete} className="bg-red-700 hover:bg-red-800 text-white">
              Delete Order
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
