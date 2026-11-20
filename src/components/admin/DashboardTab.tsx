import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { SummaryCard, StatusBadge, EmptyState, LoadingState } from '@/components/ui/primitives'
import { fetchDashboardSummary, fetchStockMovements } from '@/services/inventory'
import { fetchOrders } from '@/services/orders'
import { useAuth } from '@/contexts/AuthContext'
import type { DashboardStats, Order, StockMovement } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { Plus, ArrowUpRight } from 'lucide-react'

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
        fetchOrders({ limit: 8 }),
        fetchStockMovements(8),
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
      {/* 4 Compact Stat Blocks */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard
          label="Catalog Designs"
          value={loading ? '—' : (stats?.total_products ?? 0).toLocaleString('en-IN')}
          subtitle={
            loading
              ? 'Loading...'
              : `${(stats?.active_products ?? 0).toLocaleString('en-IN')} active · ${Math.max(
                  0,
                  (stats?.total_products ?? 0) - (stats?.active_products ?? 0)
                ).toLocaleString('en-IN')} archived`
          }
        />

        <SummaryCard
          label="Godown Stock"
          value={loading ? '—' : (stats?.godown_sets ?? 0).toLocaleString('en-IN')}
          unit="sets"
          subtitle={
            loading
              ? 'Loading...'
              : `${(stats?.godown_pcs ?? 0).toLocaleString('en-IN')} pcs`
          }
        />

        <SummaryCard
          label="Shop Floor Stock"
          value={loading ? '—' : (stats?.shop_sets ?? 0).toLocaleString('en-IN')}
          unit="sets"
          subtitle={
            loading
              ? 'Loading...'
              : `${(stats?.shop_pcs ?? 0).toLocaleString('en-IN')} pcs`
          }
        />

        <SummaryCard
          label="Wholesale Orders"
          value={loading ? '—' : (stats?.total_orders ?? 0).toLocaleString('en-IN')}
          subtitle={
            loading
              ? 'Loading...'
              : `${(stats?.confirmed_orders ?? 0).toLocaleString('en-IN')} confirmed · ${(
                  stats?.draft_orders ?? 0
                ).toLocaleString('en-IN')} drafts`
          }
        />
      </div>

      {/* Recent Wholesale Orders Table */}
      <section className="bg-white border border-[#E3E5EA] rounded-[6px] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E3E5EA] flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1A1D24]">Recent Orders</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigateTab('orders')}
              className="text-xs text-[#1E2A4A] gap-1"
            >
              <span>View all</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {loading ? (
          <LoadingState message="Loading recent orders..." />
        ) : recentOrders.length === 0 ? (
          <EmptyState
            title="No orders recorded yet."
            action={
              <Button size="sm" onClick={() => onNavigateTab('orders')}>
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
                  <th className="px-4 py-2.5 text-left">Station</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E5EA]">
                {recentOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-[#F4F5F7]/60">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <a
                        href={`/${activeSlug}/order/${encodeURIComponent(ord.order_no)}`}
                        className="font-mono text-xs font-semibold text-[#1E2A4A] hover:underline"
                      >
                        {ord.order_no}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-[#1A1D24] max-w-[220px] truncate">
                      {ord.party_name}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#667085]">
                      {ord.station || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#667085] whitespace-nowrap tabular-nums">
                      {formatDate(ord.order_date || ord.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#1A1D24] tabular-nums whitespace-nowrap">
                      {formatCurrency(ord.total_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <StatusBadge status={ord.status || 'draft'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Stock Movements Table */}
      <section className="bg-white border border-[#E3E5EA] rounded-[6px] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E3E5EA] flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1A1D24]">Recent Stock Movements</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigateTab('stock')}
            className="text-xs text-[#1E2A4A] gap-1"
          >
            <span>Stock ledger</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {loading ? (
          <LoadingState message="Loading stock movements..." />
        ) : recentMovements.length === 0 ? (
          <EmptyState
            title="No stock movements recorded yet."
            action={
              <Button size="sm" onClick={() => onNavigateTab('stock')}>
                <span>Record Stock</span>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F4F5F7] border-b border-[#E3E5EA] text-[#667085] text-xs font-medium">
                <tr>
                  <th className="px-4 py-2.5 text-left">Type</th>
                  <th className="px-4 py-2.5 text-left">Reference</th>
                  <th className="px-4 py-2.5 text-left">Notes</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-right">Sets</th>
                  <th className="px-4 py-2.5 text-right">Pieces</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E5EA]">
                {recentMovements.map((move) => (
                  <tr key={move.id} className="hover:bg-[#F4F5F7]/60">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusBadge status={move.movement_type || 'TRANSFER'} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs font-medium text-[#1A1D24] whitespace-nowrap">
                      {move.reference_no || `#${move.id}`}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#667085] max-w-[260px] truncate">
                      {move.notes || 'Stock movement'}
                      {move.staff_name ? ` · ${move.staff_name}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#667085] whitespace-nowrap tabular-nums">
                      {formatDate(move.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#1A1D24] tabular-nums whitespace-nowrap">
                      {move.sets.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-[#667085] tabular-nums whitespace-nowrap">
                      {move.total_pcs.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
