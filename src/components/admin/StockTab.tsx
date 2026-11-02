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
import { fetchLocations, fetchAllStock, transferStock, fetchStockMovements } from '@/services/inventory'
import type { Product, InventoryLocation, InventoryStock, StockMovement } from '@/types'
import { formatDateTime } from '@/utils/formatters'
import { ArrowRightLeft, History } from 'lucide-react'

export default function StockTab() {
  const [products, setProducts] = useState<Product[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [stock, setStock] = useState<InventoryStock[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Transfer form
  const [transferProductId, setTransferProductId] = useState('')
  const [fromLocation, setFromLocation] = useState('')
  const [toLocation, setToLocation] = useState('')
  const [transferSets, setTransferSets] = useState('')
  const [transferError, setTransferError] = useState('')
  const [transferLoading, setTransferLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [prods, locs, stk] = await Promise.all([
        fetchProducts(500),
        fetchLocations(),
        fetchAllStock(),
      ])
      setProducts(prods)
      setLocations(locs)
      setStock(stk)
    } catch (error) {
      console.error('Error loading stock data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMovements = async () => {
    try {
      const data = await fetchStockMovements(50)
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

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    setTransferError('')
    setTransferLoading(true)

    try {
      const product = products.find(p => p.id === parseInt(transferProductId))
      if (!product) throw new Error('Product not found')

      await transferStock(
        parseInt(transferProductId),
        parseInt(fromLocation),
        parseInt(toLocation),
        parseInt(transferSets),
        product.pcs_per_set || 1,
      )

      setShowTransfer(false)
      setTransferProductId('')
      setFromLocation('')
      setToLocation('')
      setTransferSets('')
      await loadData()
    } catch (err: any) {
      setTransferError(err.message || 'Transfer failed')
    } finally {
      setTransferLoading(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10">Loading stock data...</div>
  }

  // Build a summary view: products with their stock at each location
  const productsWithStock = products
    .map(p => ({
      product: p,
      stocks: locations.map(loc => ({
        location: loc,
        stock: getStockForProductLocation(p.id, loc.id),
      })),
    }))
    .filter(ps => ps.stocks.some(s => s.stock && (s.stock.sets > 0 || s.stock.total_pcs > 0)))

  return (
    <div className="space-y-6">
      <div className="flex gap-3 flex-wrap">
        <Button onClick={() => setShowTransfer(true)} className="bg-orange-600 hover:bg-orange-700">
          <ArrowRightLeft className="w-4 h-4 mr-2" />
          Transfer Stock
        </Button>
        <Button variant="outline" onClick={loadMovements}>
          <History className="w-4 h-4 mr-2" />
          Movement History
        </Button>
      </div>

      {/* Stock Levels Table */}
      <div className="border rounded-lg overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Design No</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Brand</th>
              {locations.map(loc => (
                <th key={loc.id} className="px-4 py-3 text-center font-medium text-gray-700" colSpan={2}>
                  {loc.name}
                </th>
              ))}
            </tr>
            <tr className="border-t bg-gray-50/50">
              <th className="px-4 py-1" />
              <th className="px-4 py-1" />
              {locations.map(loc => (
                <Fragment key={loc.id}>
                  <th className="px-2 py-1 text-xs text-gray-500 text-center">Sets</th>
                  <th className="px-2 py-1 text-xs text-gray-500 text-center">Pcs</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {productsWithStock.length === 0 ? (
              <tr>
                <td colSpan={2 + locations.length * 2} className="px-4 py-8 text-center text-gray-400">
                  No stock data found. Transfer stock to see it here.
                </td>
              </tr>
            ) : (
              productsWithStock.map(({ product, stocks }) => (
                <tr key={product.id} className="hover:bg-orange-50/50">
                  <td className="px-4 py-3 font-medium">{product.design_no}</td>
                  <td className="px-4 py-3 text-gray-600">{product.brand || '-'}</td>
                  {stocks.map(({ location, stock: s }) => (
                    <Fragment key={location.id}>
                      <td className="px-2 py-3 text-center">{s?.sets || 0}</td>
                      <td className="px-2 py-3 text-center text-gray-500">{s?.total_pcs || 0}</td>
                    </Fragment>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Transfer Dialog */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Stock</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTransfer} className="space-y-4">
            <div className="space-y-2">
              <Label>Product</Label>
              <Select value={transferProductId} onValueChange={setTransferProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.design_no}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>From</Label>
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
              <div className="space-y-2">
                <Label>To</Label>
                <Select value={toLocation} onValueChange={setToLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.filter(l => String(l.id) !== fromLocation).map(l => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sets to Transfer</Label>
              <Input
                type="number"
                min="1"
                value={transferSets}
                onChange={(e) => setTransferSets(e.target.value)}
                placeholder="Number of sets"
              />
              {transferProductId && transferSets && (
                <p className="text-xs text-gray-500">
                  Total pcs: {parseInt(transferSets || '0') * (products.find(p => p.id === parseInt(transferProductId))?.pcs_per_set || 1)}
                </p>
              )}
            </div>
            {transferError && <p className="text-sm text-red-600">{transferError}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={transferLoading || !transferProductId || !fromLocation || !toLocation || !transferSets}
            >
              {transferLoading ? 'Transferring...' : 'Transfer'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Movement History Dialog */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Stock Movement History</DialogTitle>
          </DialogHeader>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">From</th>
                  <th className="px-3 py-2 text-left font-medium">To</th>
                  <th className="px-3 py-2 text-center font-medium">Sets</th>
                  <th className="px-3 py-2 text-center font-medium">Pcs</th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {movements.map(m => (
                  <tr key={m.id}>
                    <td className="px-3 py-2">{getProductById(m.product_id)?.design_no || m.product_id}</td>
                    <td className="px-3 py-2">{m.from_location_id ? getLocationById(m.from_location_id)?.name : '-'}</td>
                    <td className="px-3 py-2">{m.to_location_id ? getLocationById(m.to_location_id)?.name : '-'}</td>
                    <td className="px-3 py-2 text-center">{m.sets}</td>
                    <td className="px-3 py-2 text-center">{m.total_pcs}</td>
                    <td className="px-3 py-2 text-xs">{formatDateTime(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Need Fragment for multiple <td> in map
import { Fragment } from 'react'
