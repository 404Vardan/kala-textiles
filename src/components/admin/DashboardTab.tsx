import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { fetchDashboardSummary, fetchStockMovements } from '@/services/inventory'
import { fetchOrders } from '@/services/orders'
import type { DashboardStats, Order, StockMovement } from '@/types'
import { formatCurrency, formatDate, formatDateTime } from '@/utils/formatters'
import {
  Package,
  Warehouse,
  Store,
  ShoppingCart,
  ArrowRightLeft,
  ScanLine,
  Plus,
  ArrowUpRight,
  Clock,
  CheckCircle2,
} from 'lucide-react'

interface DashboardTabProps {
  onNavigateTab: (tab: string) => void
}

export default function DashboardTab({ onNavigateTab }: DashboardTabProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [recentMovements, setRecentMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    try {
      setLoading(true)
      const [sum, ords, moves] = await Promise.all([
        fetchDashboardSummary(),
        fetchOrders({ limit: 6 }),
        fetchStockMovements(6),
      ])
      setStats(sum)
      setRecentOrders(ords)
      setRecentMovements(moves)
    } catch (err) {
      console.error('Error loading dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Executive KPI Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Designs */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="flex justify-between items-center text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Catalog Designs</span>
            <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900">
            {loading ? '...' : stats?.total_products || 0}
          </p>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Active in active collection
          </p>
        </div>

        {/* Godown Stock */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="flex justify-between items-center text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Godown Stock</span>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <Warehouse className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900">
            {loading ? '...' : `${stats?.godown_sets || 0} `}
            <span className="text-sm font-normal text-slate-500">sets</span>
          </p>
          <p className="text-xs text-blue-600 mt-1 font-mono font-medium">
            {stats?.godown_pcs.toLocaleString('en-IN') || 0} pieces stored
          </p>
        </div>

        {/* Shop Stock */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="flex justify-between items-center text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Shop Stock</span>
            <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
              <Store className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900">
            {loading ? '...' : `${stats?.shop_sets || 0} `}
            <span className="text-sm font-normal text-slate-500">sets</span>
          </p>
          <p className="text-xs text-orange-600 mt-1 font-mono font-medium">
            {stats?.shop_pcs.toLocaleString('en-IN') || 0} pieces ready
          </p>
        </div>

        {/* Total Orders */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="flex justify-between items-center text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Orders</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900">
            {loading ? '...' : stats?.total_orders || 0}
          </p>
          <p className="text-xs text-emerald-600 mt-1 font-medium">
            {stats?.confirmed_orders || 0} confirmed • {stats?.draft_orders || 0} drafts
          </p>
        </div>
      </div>

      {/* Prominent Quick Actions */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-5 rounded-2xl shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold">Quick Operations</h3>
            <p className="text-xs text-slate-400">Direct shortcuts for daily wholesale workflow</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
          <Button
            onClick={() => onNavigateTab('orders')}
            className="bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs h-11 justify-start px-3 rounded-xl shadow-xs"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Order
          </Button>

          <Button
            onClick={() => onNavigateTab('stock')}
            className="bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs h-11 justify-start px-3 border border-slate-700 rounded-xl"
          >
            <Warehouse className="w-4 h-4 mr-2 text-blue-400" />
            Intake Stock
          </Button>

          <Button
            onClick={() => onNavigateTab('stock')}
            className="bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs h-11 justify-start px-3 border border-slate-700 rounded-xl"
          >
            <ArrowRightLeft className="w-4 h-4 mr-2 text-emerald-400" />
            Transfer Stock
          </Button>

          <Button
            onClick={() => onNavigateTab('products')}
            className="bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs h-11 justify-start px-3 border border-slate-700 rounded-xl"
          >
            <Package className="w-4 h-4 mr-2 text-amber-400" />
            Add Design
          </Button>

          <Button
            onClick={() => onNavigateTab('shopscan')}
            className="bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs h-11 justify-start px-3 border border-slate-700 rounded-xl"
          >
            <ScanLine className="w-4 h-4 mr-2 text-rose-400" />
            Scan QR
          </Button>
        </div>
      </div>

      {/* Two Column Layout: Recent Orders & Recent Stock Movements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-orange-600" />
              Recent Wholesale Orders
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigateTab('orders')}
              className="text-xs text-orange-600 hover:text-orange-700"
            >
              View All <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>

          <div className="divide-y divide-slate-100">
            {recentOrders.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No orders recorded yet.</p>
            ) : (
              recentOrders.map((ord) => (
                <div key={ord.id} className="py-3 flex justify-between items-center">
                  <div>
                    <a
                      href={`/order/${ord.order_no}`}
                      className="font-mono text-xs font-bold text-orange-600 hover:underline"
                    >
                      {ord.order_no}
                    </a>
                    <p className="font-bold text-slate-900 text-sm mt-0.5">{ord.party_name}</p>
                    <p className="text-[11px] text-slate-400">
                      {ord.station ? `${ord.station} • ` : ''}
                      {formatDate(ord.order_date || ord.created_at)}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="font-black text-slate-900 text-sm">
                      {formatCurrency(ord.total_amount)}
                    </p>
                    {ord.status === 'confirmed' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Confirmed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                        <Clock className="w-2.5 h-2.5" /> Draft
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Stock Movements */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-blue-600" />
              Recent Stock Movements
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigateTab('stock')}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              Stock Audit <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>

          <div className="divide-y divide-slate-100">
            {recentMovements.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No stock movements recorded yet.</p>
            ) : (
              recentMovements.map((move) => (
                <div key={move.id} className="py-3 flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        move.movement_type === 'INTAKE' ? 'bg-emerald-50 text-emerald-700' :
                        move.movement_type === 'TRANSFER' ? 'bg-blue-50 text-blue-700' :
                        'bg-orange-50 text-orange-700'
                      }`}>
                        {move.movement_type || 'TRANSFER'}
                      </span>
                      <span className="font-mono text-xs font-bold text-slate-800">
                        {move.reference_no || `#${move.id}`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      {move.notes || 'Warehouse movement'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {formatDateTime(move.created_at)} • by {move.staff_name || 'Staff'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-slate-900 text-sm">{move.sets} sets</p>
                    <p className="text-xs font-mono text-slate-500">{move.total_pcs} pcs</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
