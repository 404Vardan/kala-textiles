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
import { formatCurrency } from '@/utils/formatters'
import { StatusBadge } from '@/components/ui/primitives'
import {
  Inbox,
  Phone,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  FileText,
  AlertCircle,
  Package,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

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
  const [collapsed, setCollapsed] = useState(false)
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
    <div className="bg-white border border-stone-200/80 rounded-xl shadow-2xs overflow-hidden">
      {/* Header Bar */}
      <div className="px-4 py-3.5 bg-stone-50 border-b border-stone-200/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-700 text-white flex items-center justify-center shrink-0">
            <Inbox className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-stone-900 text-sm sm:text-base">
                Buyer QR Order Requests
              </h3>
              <span
                className={`inline-flex items-center justify-center px-2.5 py-0.5 text-xs font-bold rounded-md border ${
                  pendingCount > 0
                    ? 'bg-orange-50 text-orange-800 border-orange-200'
                    : 'bg-stone-100 text-stone-600 border-stone-200'
                }`}
              >
                {pendingCount} Pending
              </span>
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Submitted from public QR catalog pages — convert into a Draft Order to review before confirming stock
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadRequests}
            disabled={loading || processingId !== null}
            className="h-8 text-xs gap-1.5 bg-white"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed((prev) => !prev)}
            className="h-8 text-xs text-stone-600"
          >
            {collapsed ? (
              <>
                <ChevronDown className="w-4 h-4 mr-1" /> Expand
              </>
            ) : (
              <>
                <ChevronUp className="w-4 h-4 mr-1" /> Collapse
              </>
            )}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4">
          {/* Request status filter tabs */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs border-b border-stone-100 pb-3">
            <span className="font-semibold text-stone-500 uppercase tracking-wider mr-1">
              View:
            </span>
            <button
              type="button"
              onClick={() => setStatusFilter('requested')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                statusFilter === 'requested'
                  ? 'bg-orange-700 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
              }`}
            >
              Requested ({pendingCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('converted')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                statusFilter === 'converted'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
              }`}
            >
              Converted ({convertedCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('rejected')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                statusFilter === 'rejected'
                  ? 'bg-stone-800 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
              }`}
            >
              Rejected ({rejectedCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                statusFilter === 'all'
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70'
              }`}
            >
              All ({requests.length})
            </button>
          </div>

          {conversionMessage && (
            <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3.5 py-2.5 rounded-lg text-xs font-medium">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{conversionMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setConversionMessage('')}
                className="text-emerald-800 hover:underline font-semibold"
              >
                Dismiss
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-lg text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-6 text-center text-xs text-stone-500">
              Loading buyer order requests...
            </div>
          ) : visibleRequests.length === 0 ? (
            <div className="py-6 text-center text-xs text-stone-500">
              {statusFilter === 'requested'
                ? 'No pending buyer QR order requests right now.'
                : `No ${statusFilter} buyer requests found.`}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {visibleRequests.map((req) => {
                const totalDesigns = req.items.length
                const totalSets = req.items.reduce((sum, item) => sum + (Number(item.sets) || 0), 0)
                const isBusy = processingId === req.id
                const isPending = req.status === 'requested'
                const formattedDate = new Date(req.created_at).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })

                return (
                  <div
                    key={req.id}
                    className="border border-stone-200/90 rounded-xl p-4 bg-stone-50/40 hover:bg-white transition-colors space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-mono font-bold bg-stone-200/70 text-stone-800 px-2 py-0.5 rounded">
                            Ref #{req.id}
                          </span>
                          <h4 className="font-bold text-stone-900 text-base">{req.party_name}</h4>
                          <StatusBadge status={req.status} />
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600">
                          <a
                            href={`tel:${req.phone}`}
                            className="inline-flex items-center gap-1 font-semibold text-orange-700 hover:underline"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            {req.phone}
                          </a>
                          <span className="inline-flex items-center gap-1 text-stone-500">
                            <Clock className="w-3.5 h-3.5" />
                            {formattedDate}
                          </span>
                          <span className="inline-flex items-center gap-1 font-semibold text-stone-800">
                            <Package className="w-3.5 h-3.5 text-stone-500" />
                            {totalDesigns} {totalDesigns === 1 ? 'design' : 'designs'} · {totalSets}{' '}
                            {totalSets === 1 ? 'set' : 'sets'}
                          </span>
                        </div>
                      </div>

                      {isPending && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleConvert(req)}
                            disabled={processingId !== null}
                            className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold gap-1.5"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            {isBusy ? 'Converting...' : 'Convert to Draft Order'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setRejectTarget(req)}
                            disabled={processingId !== null}
                            className="border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Requested Designs Grid */}
                    <div className="bg-white border border-stone-200/80 rounded-lg p-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {req.items.map((item) => {
                          const prod = item.product
                          const designNo = prod?.design_no || `#${item.product_id}`
                          const pcsPerSet =
                            prod?.pcs_per_set && prod.pcs_per_set > 0 ? prod.pcs_per_set : 1
                          const rate = prod?.rate && prod.rate > 0 ? prod.rate : 0

                          return (
                            <div
                              key={`${req.id}-${item.product_id}`}
                              className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-stone-50 border border-stone-200/60 text-xs"
                            >
                              <div>
                                <span className="font-bold text-stone-900">Design #{designNo}</span>
                                {prod?.brand && (
                                  <span className="text-stone-500 ml-1">({prod.brand})</span>
                                )}
                                <div className="text-[11px] text-stone-500 mt-0.5">
                                  {pcsPerSet} pcs/set
                                  {rate > 0 ? ` • ${formatCurrency(rate)}/pc` : ''}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="inline-block font-bold text-orange-800 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded tabular-nums">
                                  {item.sets} {item.sets === 1 ? 'set' : 'sets'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {req.note && (
                      <div className="text-xs text-stone-700 bg-amber-50/70 border border-amber-200/80 px-3 py-2 rounded-lg">
                        <strong className="text-amber-900">Buyer Note:</strong> {req.note}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Reject Request Confirmation Dialog */}
      <AlertDialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Buyer Order Request?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reject Request #{rejectTarget?.id} from{' '}
              <strong className="text-stone-900">{rejectTarget?.party_name}</strong>? It will be
              marked as Rejected and removed from your pending queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReject}
              className="bg-red-700 hover:bg-red-800 text-white"
            >
              Reject Request
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
