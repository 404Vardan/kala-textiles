import { useState, useEffect } from 'react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchProducts } from '@/services/products'
import { fetchLocations, fetchAllStock, transferStock, intakeStock, fetchStockMovements } from '@/services/inventory'
import type { Product, InventoryLocation, InventoryStock, StockMovement } from '@/types'
import { formatDateTime } from '@/utils/formatters'
import { ArrowRightLeft, History, Plus, Warehouse, Store, ArrowDownLeft, Search } from 'lucide-react'

export default function StockTab() {
  const [products, setProducts] = useState<Product[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [stock, setStock] = useState<InventoryStock[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Modals
  const [showTransfer, setShowTransfer] = useState(false)
  const [showIntake, setShowIntake] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Transfer form
  const [transferProductId, setTransferProductId] = useState('')
  const [fromLocation, setFromLocation] = useState('')
  const [toLocation, setToLocation] = useState('')
  const [transferSets, setTransferSets] = useState('')
  const [transferStaff, setTransferStaff] = useState('Admin')
  const [transferNotes, setTransferNotes] = useState('')
  const [transferError, setTransferError] = useState('')
  const [transferLoading, setTransferLoading] = useState(false)

  // Intake form
  const [intakeProductId, setIntakeProductId] = useState('')
  const [intakeLocationId, setIntakeLocationId] = useState('')
  const [intakeSets, setIntakeSets] = useState('')
  const [intakeStaff, setIntakeStaff] = useState('Admin')
  const [intakeNotes, setIntakeNotes] = useState('')
  const [intakeRefNo, setIntakeRefNo] = useState('')
  const [intakeError, setIntakeError] = useState('')
  const [intakeLoading, setIntakeLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [prods, locs, stk] = await Promise.all([
        fetchProducts({ limit: 500 }),
        fetchLocations(),
        fetchAllStock(),
      ])
      setProducts(prods)
      setLocations(locs)
      setStock(stk)

      // Set default intake location to Godown
      const godown = locs.find(l => l.name.toLowerCase() === 'godown')
      if (godown) setIntakeLocationId(String(godown.id))
    } catch (error) {
      console.error('Error loading stock data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMovements = async () => {
    try {
      const data = await fetchStockMovements(100)
      setMovements(data)
      setShowHistory(true)
    } catch (error) {
      console.error('Error loading movements:', error)
    }
  }

  const getStockForProductLocation = (productId: number, locationId: number) => {
    return stock.find(s => s.product_id === productId && s.location_id === locationId)
  }

  const getProductById = (id: number) => products.find(p => p.id === id)
  const getLocationById = (id: number) => locations.find(l => l.id === id)

  // Stock Intake (Godown inward)
  const handleIntake = async (e: React.FormEvent) => {
    e.preventDefault()
    setIntakeError('')
    setIntakeLoading(true)

    try {
      const prod = products.find(p => p.id === parseInt(intakeProductId, 10))
      if (!prod) throw new Error('Please select a product')
      if (!intakeLocationId) throw new Error('Please select receiving location')
      const sets = parseInt(intakeSets, 10)
      if (isNaN(sets) || sets <= 0) throw new Error('Sets must be greater than zero')

      await intakeStock(
        prod.id,
        parseInt(intakeLocationId, 10),
        sets,
        prod.pcs_per_set || 1,
        intakeStaff.trim() || 'Admin',
        intakeNotes.trim() || 'Godown inward stock intake',
        intakeRefNo.trim() || undefined
      )

      setShowIntake(false)
      setIntakeProductId('')
      setIntakeSets('')
      setIntakeNotes('')
      setIntakeRefNo('')
      await loadData()
    } catch (err: any) {
      setIntakeError(err.message || 'Stock intake failed')
    } finally {
      setIntakeLoading(false)
    }
  }

  // Stock Transfer (Godown -> Shop)
  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    setTransferError('')
    setTransferLoading(true)

    try {
      const prod = products.find(p => p.id === parseInt(transferProductId, 10))
      if (!prod) throw new Error('Please select a valid product')
      if (!fromLocation || !toLocation) throw new Error('Select both source and destination')
      if (fromLocation === toLocation) throw new Error('Source and destination cannot be identical')

      const sets = parseInt(transferSets, 10)
      if (isNaN(sets) || sets <= 0) throw new Error('Transfer sets must be greater than zero')

      // Check available quantity
      const sourceStock = getStockForProductLocation(prod.id, parseInt(fromLocation, 10))
      const available = sourceStock?.sets || 0
      if (available < sets) {
        throw new Error(`Insufficient stock at source! Available: ${available} sets, Requested: ${sets} sets`)
      }

      await transferStock(
        prod.id,
        parseInt(fromLocation, 10),
        parseInt(toLocation, 10),
        sets,
        prod.pcs_per_set || 1,
        transferStaff.trim() || 'Admin',
        transferNotes.trim() || 'Location transfer'
      )

      setShowTransfer(false)
      setTransferProductId('')
      setFromLocation('')
      setToLocation('')
      setTransferSets('')
      setTransferNotes('')
      await loadData()
    } catch (err: any) {
      setTransferError(err.message || 'Transfer failed')
    } finally {
      setTransferLoading(false)
    }
  }

  // Quick helper to fill transfer modal for specific product
  const quickTransferProduct = (productId: number) => {
    setTransferProductId(String(productId))
    const godown = locations.find(l => l.name.toLowerCase() === 'godown')
    const shop = locations.find(l => l.name.toLowerCase() === 'shop')
    if (godown) setFromLocation(String(godown.id))
    if (shop) setToLocation(String(shop.id))
    setTransferSets('1')
    setTransferError('')
    setShowTransfer(true)
  }

  // Calculate totals
  const godownId = locations.find(l => l.name.toLowerCase() === 'godown')?.id
  const shopId = locations.find(l => l.name.toLowerCase() === 'shop')?.id

  const godownTotalSets = stock.filter(s => s.location_id === godownId).reduce((sum, s) => sum + (s.sets || 0), 0)
  const godownTotalPcs = stock.filter(s => s.location_id === godownId).reduce((sum, s) => sum + (s.total_pcs || 0), 0)

  const shopTotalSets = stock.filter(s => s.location_id === shopId).reduce((sum, s) => sum + (s.sets || 0), 0)
  const shopTotalPcs = stock.filter(s => s.location_id === shopId).reduce((sum, s) => sum + (s.total_pcs || 0), 0)

  // Products with aggregated stock
  const productsWithStock = products
    .map(p => {
      const gStock = godownId ? getStockForProductLocation(p.id, godownId) : null
      const sStock = shopId ? getStockForProductLocation(p.id, shopId) : null
      const totalSets = (gStock?.sets || 0) + (sStock?.sets || 0)
      const totalPcs = (gStock?.total_pcs || 0) + (sStock?.total_pcs || 0)

      return {
        product: p,
        godownSets: gStock?.sets || 0,
        godownPcs: gStock?.total_pcs || 0,
        shopSets: sStock?.sets || 0,
        shopPcs: sStock?.total_pcs || 0,
        totalSets,
        totalPcs,
      }
    })
    .filter(item => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        item.product.design_no.toLowerCase().includes(q) ||
        (item.product.brand && item.product.brand.toLowerCase().includes(q)) ||
        (item.product.collection_name && item.product.collection_name.toLowerCase().includes(q))
      )
    })

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Godown Stock Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Warehouse className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Godown Warehouse</p>
            <p className="text-2xl font-black text-slate-900 mt-0.5">{godownTotalSets} <span className="text-sm font-normal text-slate-500">sets</span></p>
            <p className="text-xs text-slate-600 font-medium">{godownTotalPcs.toLocaleString('en-IN')} pieces in stock</p>
          </div>
        </div>

        {/* Shop Stock Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Shop Floor</p>
            <p className="text-2xl font-black text-slate-900 mt-0.5">{shopTotalSets} <span className="text-sm font-normal text-slate-500">sets</span></p>
            <p className="text-xs text-slate-600 font-medium">{shopTotalPcs.toLocaleString('en-IN')} pieces ready for display</p>
          </div>
        </div>

        {/* Total Stock Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <ArrowRightLeft className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Combined Stock</p>
            <p className="text-2xl font-black text-slate-900 mt-0.5">{godownTotalSets + shopTotalSets} <span className="text-sm font-normal text-slate-500">sets</span></p>
            <p className="text-xs text-slate-600 font-medium">{(godownTotalPcs + shopTotalPcs).toLocaleString('en-IN')} total pieces</p>
          </div>
        </div>
      </div>

      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search by design number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-50 border-slate-200"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => setShowIntake(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="w-4 h-4 mr-1.5" /> Intake Stock
          </Button>
          <Button onClick={() => setShowTransfer(true)} className="bg-slate-900 hover:bg-slate-800 text-white">
            <ArrowRightLeft className="w-4 h-4 mr-1.5" /> Transfer Stock
          </Button>
          <Button variant="outline" onClick={loadMovements}>
            <History className="w-4 h-4 mr-1.5 text-slate-600" /> Audit Log
          </Button>
        </div>
      </div>

      {/* Stock Levels Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left w-14">Photo</th>
                <th className="px-4 py-3 text-left">Design No</th>
                <th className="px-4 py-3 text-left">Brand</th>
                <th className="px-4 py-3 text-center bg-blue-50/50" colSpan={2}>
                  Godown Warehouse
                </th>
                <th className="px-4 py-3 text-center bg-orange-50/50" colSpan={2}>
                  Shop Floor
                </th>
                <th className="px-4 py-3 text-center" colSpan={2}>
                  Combined Total
                </th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
              <tr className="border-t border-slate-200 text-[10px] text-slate-500 bg-slate-100/60 font-mono">
                <th className="py-1 px-4" />
                <th className="py-1 px-4" />
                <th className="py-1 px-4" />
                <th className="py-1 px-2 text-center bg-blue-50/50">Sets</th>
                <th className="py-1 px-2 text-center bg-blue-50/50">Pieces</th>
                <th className="py-1 px-2 text-center bg-orange-50/50">Sets</th>
                <th className="py-1 px-2 text-center bg-orange-50/50">Pieces</th>
                <th className="py-1 px-2 text-center">Sets</th>
                <th className="py-1 px-2 text-center">Pieces</th>
                <th className="py-1 px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">Loading stock records...</td>
                </tr>
              ) : productsWithStock.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    No products found. Click "Intake Stock" to add inventory to Godown.
                  </td>
                </tr>
              ) : (
                productsWithStock.map((row) => (
                  <tr key={row.product.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-2.5">
                      {row.product.image_url ? (
                        <img
                          src={row.product.image_url}
                          alt={row.product.design_no}
                          className="w-10 h-10 object-cover rounded-md border border-slate-200"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 rounded-md flex items-center justify-center text-slate-400 text-xs">
                          N/A
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-slate-900">{row.product.design_no}</td>
                    <td className="px-4 py-2.5 text-slate-600">{row.product.brand || '-'}</td>

                    {/* Godown */}
                    <td className="px-2 py-2.5 text-center font-bold text-blue-900 bg-blue-50/20">{row.godownSets}</td>
                    <td className="px-2 py-2.5 text-center text-slate-500 font-mono bg-blue-50/20">{row.godownPcs}</td>

                    {/* Shop */}
                    <td className="px-2 py-2.5 text-center font-bold text-orange-900 bg-orange-50/20">{row.shopSets}</td>
                    <td className="px-2 py-2.5 text-center text-slate-500 font-mono bg-orange-50/20">{row.shopPcs}</td>

                    {/* Total */}
                    <td className="px-2 py-2.5 text-center font-black text-slate-900">{row.totalSets}</td>
                    <td className="px-2 py-2.5 text-center font-bold text-slate-600 font-mono">{row.totalPcs}</td>

                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => quickTransferProduct(row.product.id)}
                        className="h-8 text-xs font-medium"
                      >
                        <ArrowRightLeft className="w-3 h-3 mr-1" /> Transfer
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Intake Dialog (Godown Inward) */}
      <Dialog open={showIntake} onOpenChange={setShowIntake}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
              Stock Intake (Warehouse Inward)
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleIntake} className="space-y-4 pt-2">
            {intakeError && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 p-2.5 rounded border border-rose-200">
                {intakeError}
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Select Product *</Label>
              <Select value={intakeProductId} onValueChange={setIntakeProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose design..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {products.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.design_no} {p.brand ? `(${p.brand})` : ''} — {p.pcs_per_set || 1} pcs/set
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Receiving Location *</Label>
                <Select value={intakeLocationId} onValueChange={setIntakeLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(l => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Sets to Inward *</Label>
                <Input
                  type="number"
                  min="1"
                  value={intakeSets}
                  onChange={(e) => setIntakeSets(e.target.value)}
                  placeholder="e.g. 50"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Staff In-Charge</Label>
                <Input
                  value={intakeStaff}
                  onChange={(e) => setIntakeStaff(e.target.value)}
                  placeholder="e.g. Suresh"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bill / Batch Ref</Label>
                <Input
                  value={intakeRefNo}
                  onChange={(e) => setIntakeRefNo(e.target.value)}
                  placeholder="e.g. BATCH-2026-01"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                value={intakeNotes}
                onChange={(e) => setIntakeNotes(e.target.value)}
                placeholder="Mill delivery, fresh packaging, etc."
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => setShowIntake(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={intakeLoading || !intakeProductId} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {intakeLoading ? 'Adding Stock...' : 'Confirm Stock Intake'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stock Transfer Dialog */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-orange-600" />
              Transfer Stock
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleTransfer} className="space-y-4 pt-2">
            {transferError && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 p-2.5 rounded border border-rose-200">
                {transferError}
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Select Product *</Label>
              <Select value={transferProductId} onValueChange={setTransferProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose design..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {products.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.design_no} {p.brand ? `(${p.brand})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From (Source) *</Label>
                <Select value={fromLocation} onValueChange={setFromLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(l => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>To (Destination) *</Label>
                <Select value={toLocation} onValueChange={setToLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(l => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sets to Transfer *</Label>
                <Input
                  type="number"
                  min="1"
                  value={transferSets}
                  onChange={(e) => setTransferSets(e.target.value)}
                  placeholder="Sets"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Staff In-Charge</Label>
                <Input
                  value={transferStaff}
                  onChange={(e) => setTransferStaff(e.target.value)}
                  placeholder="Staff name"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Transfer Notes</Label>
              <Input
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                placeholder="Reason or notes..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => setShowTransfer(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={transferLoading || !transferProductId} className="bg-slate-900 hover:bg-slate-800 text-white">
                {transferLoading ? 'Transferring...' : 'Execute Transfer'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stock Movement Audit Log Modal */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="sm:max-w-[750px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <History className="w-5 h-5 text-slate-600" />
              Stock Movement Audit Log
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b text-slate-700 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2.5 text-left">Timestamp</th>
                  <th className="px-3 py-2.5 text-left">Ref No</th>
                  <th className="px-3 py-2.5 text-left">Type</th>
                  <th className="px-3 py-2.5 text-left">Design</th>
                  <th className="px-3 py-2.5 text-left">Route</th>
                  <th className="px-3 py-2.5 text-center">Sets</th>
                  <th className="px-3 py-2.5 text-center">Pcs</th>
                  <th className="px-3 py-2.5 text-left">Staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">No stock movements recorded yet.</td>
                  </tr>
                ) : (
                  movements.map((m) => {
                    const prod = getProductById(m.product_id)
                    const fromLoc = m.from_location_id ? getLocationById(m.from_location_id) : null
                    const toLoc = m.to_location_id ? getLocationById(m.to_location_id) : null

                    return (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{m.reference_no || '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            m.movement_type === 'INTAKE' ? 'bg-emerald-50 text-emerald-700' :
                            m.movement_type === 'TRANSFER' ? 'bg-blue-50 text-blue-700' :
                            'bg-orange-50 text-orange-700'
                          }`}>
                            {m.movement_type || 'TRANSFER'}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-bold text-slate-900">{prod?.design_no || `#${m.product_id}`}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {fromLoc?.name || 'Inward'} → {toLoc?.name || 'Dispatch'}
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-slate-900">{m.sets}</td>
                        <td className="px-3 py-2 text-center font-mono text-slate-500">{m.total_pcs}</td>
                        <td className="px-3 py-2 text-slate-600">{m.staff_name || '-'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
