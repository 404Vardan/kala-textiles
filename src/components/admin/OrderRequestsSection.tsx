import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
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
  convertOrderRequest,
  fetchOrderRequests,
  rejectOrderRequest,
} from '@/services/orderRequests'
import type { ConvertOrderRequestResult, OrderRequest, OrderRequestStatus } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { StatusBadge, EmptyState, LoadingState } from '@/components/ui/primitives'
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'

interface OrderRequestsSectionProps {
  onOrderConverted: (result: ConvertOrderRequestResult) => void
  onPendingCountChange?: (count: number) => void
}

export default function OrderRequestsSection({
  onOrderConverted,
  onPendingCountChange,
}: OrderRequestsSectionProps) {
  const [requests, setRequests] = useState<OrderRequest[]>([])
  const [statusFilter, setStatusFilter] = useState<OrderRequestStatus | 'all'>('requested')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [conversionMessage, setConversionMessage] = useState('')
  const [rejectTarget, setRejectTarget] = useState<OrderRequest | null>(null)

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchOrderRequests()
      setRequests(data)
      const pending = data.filter((r) => r.status === 'requested').length
      onPendingCountChange?.(pending)
    } catch (err: any) {
      setError(err?.message || 'Could not load buyer order requests')
    } finally {
      setLoading(false)
    }
  }, [onPendingCountChange])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  const handleConvert = async (req: OrderRequest) => {
    setProcessingId(req.id)
    setError('')
    setConversionMessage('')

    try {
      const result = await convertOrderRequest(req.id)
      setConversionMessage(
        `Converted Request #${req.id} (${req.party_name}) into Draft Order ${result.order_no}.`
      )
      await loadRequests()
      onOrderConverted(result)
    } catch (err: any) {
      setError(err?.message || `Failed to convert request #${req.id}`)
    } finally {
      setProcessingId(null)
    }
  }

  const handleConfirmReject = async () => {
    if (!rejectTarget) return
    const req = rejectTarget
    setRejectTarget(null)
    setProcessingId(req.id)
    setError('')
    setConversionMessage('')

    try {
      await rejectOrderRequest(req.id)
      setConversionMessage(`Request #${req.id} from "${req.party_name}" marked as rejected.`)
      await loadRequests()
    } catch (err: any) {
      setError(err?.message || `Failed to reject request #${req.id}`)
    } finally {
      setProcessingId(null)
    }
  }

  const pendingCount = requests.filter((r) => r.status === 'requested').length
  const convertedCount = requests.filter((r) => r.status === 'converted').length
  const rejectedCount = requests.filter((r) => r.status === 'rejected').length

  const visibleRequests =
    statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter)

  return (
    <div className="space-y-4">
      {conversionMessage && (
        <div className="flex items-center justify-between gap-2 bg-white border border-[#1F7A4D] text-[#1F7A4D] px-4 py-3 rounded-[6px] text-xs font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{conversionMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setConversionMessage('')}
            className="underline font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-white border border-[#B42318] text-[#B42318] px-4 py-3 rounded-[6px] text-xs font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white border border-[#E3E5EA] rounded-[6px] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { key: 'requested', label: `Pending (${pendingCount})` },
              { key: 'converted', label: `Converted (${convertedCount})` },
              { key: 'rejected', label: `Rejected (${rejectedCount})` },
              { key: 'all', label: `All (${requests.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 rounded-[6px] font-medium border transition-colors cursor-pointer tabular-nums ${
                statusFilter === tab.key
                  ? 'bg-[#1E2A4A] text-white border-[#1E2A4A]'
                  : 'bg-white text-[#1A1D24] border-[#E3E5EA] hover:bg-[#F4F5F7]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={loadRequests}
          disabled={loading || processingId !== null}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Requests Table */}
      <div className="bg-white border border-[#E3E5EA] rounded-[6px] overflow-hidden">
        {loading ? (
          <LoadingState message="Loading buyer order requests..." />
        ) : visibleRequests.length === 0 ? (
          <EmptyState
            title="No buyer order requests in this view."
            action={
              <Button variant="outline" size="sm" onClick={loadRequests}>
                Refresh
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F4F5F7] border-b border-[#E3E5EA] text-[#667085] text-xs font-medium">
                <tr>
                  <th className="px-4 py-2.5 text-left">Ref</th>
                  <th className="px-4 py-2.5 text-left">Buyer &amp; Phone</th>
                  <th className="px-4 py-2.5 text-left">Requested Designs</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-right">Sets</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E5EA]">
                {visibleRequests.map((req) => {
                  const totalSets = req.items.reduce((sum, item) => sum + (Number(item.sets) || 0), 0)
                  const isBusy = processingId === req.id
                  const isPending = req.status === 'requested'

                  return (
                    <tr key={req.id} className="hover:bg-[#F4F5F7]/60 align-top">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#1A1D24] whitespace-nowrap">
                        #{req.id}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#1A1D24]">{req.party_name}</div>
                        <a
                          href={`tel:${req.phone}`}
                          className="text-xs text-[#1E2A4A] hover:underline tabular-nums"
                        >
                          {req.phone}
                        </a>
                        {req.note && (
                          <div className="text-xs text-[#667085] mt-1 max-w-[220px]">
                            Note: {req.note}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1 text-xs">
                          {req.items.map((item) => {
                            const prod = item.product
                            const designNo = prod?.design_no || `#${item.product_id}`
                            return (
                              <div key={`${req.id}-${item.product_id}`} className="tabular-nums">
                                <span className="font-semibold text-[#1A1D24]">{designNo}</span>
                                <span className="text-[#667085]">
                                  {' '}· {item.sets} {item.sets === 1 ? 'set' : 'sets'}
                                  {prod?.rate ? ` · ${formatCurrency(prod.rate)}/pc` : ''}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#667085] whitespace-nowrap tabular-nums">
                        {formatDate(req.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#1A1D24] tabular-nums whitespace-nowrap">
                        {totalSets.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={req.status} />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isPending ? (
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleConvert(req)}
                              disabled={processingId !== null}
                            >
                              {isBusy ? 'Converting...' : 'Convert to Draft'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setRejectTarget(req)}
                              disabled={processingId !== null}
                              className="text-[#B42318]"
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-[#667085]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reject Confirmation */}
      <AlertDialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Buyer Order Request?</AlertDialogTitle>
            <AlertDialogDescription>
              Request #{rejectTarget?.id} from {rejectTarget?.party_name} will be marked as Rejected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReject}
              className="bg-[#B42318] hover:bg-[#911C13] text-white"
            >
              Reject Request
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
