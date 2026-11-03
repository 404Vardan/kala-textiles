import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { SummaryCard, StatusBadge, EmptyState } from '@/components/ui/primitives'
import { fetchDashboardSummary, fetchStockMovements } from '@/services/inventory'
import { fetchOrders } from '@/services/orders'
import { useAuth } from '@/contexts/AuthContext'
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
} from 'lucide-react'

interface DashboardTabProps {
  onNavigateTab: (tab: string) => void
}

export default function DashboardTab({ onNavigateTab }: DashboardTabProps) {
  const { business } = useAuth()
  const activeSlug = (business?.slug || 'rangoli').trim().toLowerCase() || 'rangoli'

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
      {/* Operational KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Catalog Designs"
          value={loading ? '—' : stats?.total_products ?? 0}
          unit="designs"
          subtitle={
            loading
              ? 'Loading catalog...'
              : `${stats?.active_products ?? 0} active • ${
                  Math.max(0, (stats?.total_products ?? 0) - (stats?.active_products ?? 0))
                } archived`
          }
          icon={Package}
          iconClassName="bg-stone-100 text-stone-700"
        />

        <SummaryCard
          label="Godown Stock"
          value={loading ? '—' : stats?.godown_sets ?? 0}
          unit="sets"
          subtitle={
            loading
              ? 'Loading warehouse...'
              : `${(stats?.godown_pcs ?? 0).toLocaleString('en-IN')} pieces stored`
          }
          icon={Warehouse}
          iconClassName="bg-sky-50 text-sky-700 border border-sky-200/70"
        />

        <SummaryCard
          label="Shop Floor Stock"
          value={loading ? '—' : stats?.shop_sets ?? 0}
          unit="sets"
          subtitle={
            loading
              ? 'Loading shop floor...'
              : `${(stats?.shop_pcs ?? 0).toLocaleString('en-IN')} pieces ready`
          }
          icon={Store}
          iconClassName="bg-orange-50 text-orange-700 border border-orange-200/70"
        />

        <SummaryCard
          label="Wholesale Orders"
          value={loading ? '—' : stats?.total_orders ?? 0}
          unit="orders"
          subtitle={
            loading
              ? 'Loading orders...'
              : `${stats?.confirmed_orders ?? 0} confirmed • ${stats?.draft_orders ?? 0} drafts`
          }
          icon={ShoppingCart}
          iconClassName="bg-emerald-50 text-emerald-700 border border-emerald-200/70"
        />
      </div>

      {/* Quick Operations Bar */}
      <section className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-stone-900">Quick Operations</h2>
            <p className="text-xs text-stone-500">
              Direct shortcuts for daily wholesale orders, inventory intake, and QR scanning
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <Button
            onClick={() => onNavigateTab('orders')}
            className="h-10 justify-start px-3.5 text-xs sm:text-sm"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Order</span>
          </Button>

          <Button
            variant="outline"
            onClick={() => onNavigateTab('stock')}
            className="h-10 justify-start px-3.5 text-xs sm:text-sm"
          >
            <Warehouse className="w-4 h-4 text-sky-700 shrink-0" />
            <span>Intake Stock</span>
          </Button>

          <Button
            variant="outline"
            onClick={() => onNavigateTab('stock')}
            className="h-10 justify-start px-3.5 text-xs sm:text-sm"
          >
            <ArrowRightLeft className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>Transfer Stock</span>
          </Button>

          <Button
            variant="outline"
            onClick={() => onNavigateTab('products')}
            className="h-10 justify-start px-3.5 text-xs sm:text-sm"
          >
            <Package className="w-4 h-4 text-orange-700 shrink-0" />
            <span>Add Design</span>
          </Button>

          <Button
            variant="outline"
            onClick={() => onNavigateTab('shopscan')}
            className="h-10 justify-start px-3.5 text-xs sm:text-sm col-span-2 sm:col-span-1"
          >
            <ScanLine className="w-4 h-4 text-stone-700 shrink-0" />
            <span>Scan QR</span>
          </Button>
        </div>
      </section>

      {/* Two Column Operational Activity Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Wholesale Orders */}
        <section className="bg-white border border-stone-200 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between gap-2">
            <h3 className="font-bold text-stone-900 text-sm sm:text-base flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-orange-700" />
              <span>Recent Wholesale Orders</span>
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigateTab('orders')}
              className="text-xs text-orange-700 hover:text-orange-800 gap-1"
            >
              <span>View All</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="divide-y divide-stone-100 flex-1">
            {recentOrders.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="No Orders Recorded"
                description="Wholesale orders created by staff or owners will appear here."
                className="py-10"
              />
            ) : (
              recentOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-stone-50/70 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/${activeSlug}/order/${encodeURIComponent(ord.order_no)}`}
                        className="font-mono text-xs font-bold text-orange-700 hover:underline"
                      >
                        {ord.order_no}
                      </a>
                      <span className="text-xs text-stone-400">•</span>
                      <span className="text-xs text-stone-500">
                        {formatDate(ord.order_date || ord.created_at)}
                      </span>
                    </div>
                    <p className="font-bold text-stone-900 text-sm truncate mt-0.5">
                      {ord.party_name}
                    </p>
                    {ord.station && (
                      <p className="text-xs text-stone-500 truncate">Station: {ord.station}</p>
                    )}
                  </div>

                  <div className="text-right space-y-1 shrink-0">
                    <p className="font-bold text-stone-900 text-sm tabular-nums">
                      {formatCurrency(ord.total_amount)}
                    </p>
                    <StatusBadge status={ord.status || 'draft'} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Recent Stock Movements */}
        <section className="bg-white border border-stone-200 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between gap-2">
            <h3 className="font-bold text-stone-900 text-sm sm:text-base flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-sky-700" />
              <span>Recent Stock Movements</span>
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigateTab('stock')}
              className="text-xs text-orange-700 hover:text-orange-800 gap-1"
            >
              <span>Audit Log</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="divide-y divide-stone-100 flex-1">
            {recentMovements.length === 0 ? (
              <EmptyState
                icon={ArrowRightLeft}
                title="No Stock Movements"
                description="Godown inward intakes, location transfers, and order dispatches will appear here."
                className="py-10"
              />
            ) : (
              recentMovements.map((move) => (
                <div
                  key={move.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-stone-50/70 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={move.movement_type || 'TRANSFER'} />
                      <span className="font-mono text-xs font-bold text-stone-800">
                        {move.reference_no || `#${move.id}`}
                      </span>
                    </div>
                    <p className="text-xs text-stone-600 truncate">
                      {move.notes || 'Warehouse stock movement'}
                    </p>
                    <p className="text-xs text-stone-400">
                      {formatDateTime(move.created_at)} • by {move.staff_name || 'Staff'}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-bold text-stone-900 text-sm tabular-nums">
                      {move.sets} {move.sets === 1 ? 'set' : 'sets'}
                    </p>
                    <p className="text-xs font-mono text-stone-500 tabular-nums">
                      {move.total_pcs} pcs
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
