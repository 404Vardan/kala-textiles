import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  convertOrderRequest,
  fetchOrderRequests,
  rejectOrderRequest,
} from '@/services/orderRequests'
import type { ConvertOrderRequestResult, OrderRequest } from '@/types'
import { formatCurrency } from '@/utils/formatters'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [conversionMessage, setConversionMessage] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchOrderRequests('requested')
      setRequests(data)
      onPendingCountChange?.(data.length)
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

  const handleReject = async (req: OrderRequest) => {
    if (!window.confirm(`Reject order request #${req.id} from "${req.party_name}"?`)) {
      return
    }

    setProcessingId(req.id)
    setError('')
    setConversionMessage('')

    try {
      await rejectOrderRequest(req.id)
      await loadRequests()
    } catch (err: any) {
      setError(err?.message || `Failed to reject request #${req.id}`)
    } finally {
      setProcessingId(null)
    }
  }

  const pendingCount = requests.length

  return (
    <div className="bg-white border border-orange-200 rounded-xl shadow-2xs overflow-hidden">
      {/* Header Bar */}
      <div className="px-4 py-3 bg-gradient-to-r from-orange-50/90 to-amber-50/60 border-b border-orange-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center shadow-2xs">
            <Inbox className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                Buyer QR Order Requests
              </h3>
              <span
                className={`inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full ${
                  pendingCount > 0
                    ? 'bg-orange-600 text-white animate-pulse'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {pendingCount} Pending
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Submitted by buyers from product QR pages — convert to Draft Order to review before
              confirming stock
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
            className="h-8 text-xs text-slate-600"
          >
            {collapsed ? (
              <>
                <ChevronDown className="w-4 h-4 mr-1" /> Show
              </>
            ) : (
              <>
                <ChevronUp className="w-4 h-4 mr-1" /> Hide
              </>
            )}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-3">
          {conversionMessage && (
            <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3.5 py-2.5 rounded-lg text-xs font-medium">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{conversionMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setConversionMessage('')}
                className="text-emerald-700 hover:underline font-bold"
              >
                Dismiss
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2.5 rounded-lg text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-6 text-center text-xs text-slate-500">
              Loading buyer order requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              No pending buyer QR order requests right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {requests.map((req) => {
                const totalDesigns = req.items.length
                const totalSets = req.items.reduce((sum, item) => sum + (Number(item.sets) || 0), 0)
                const isBusy = processingId === req.id
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
                    className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 hover:bg-white transition-colors space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-mono font-bold bg-orange-100 text-orange-800 px-2 py-0.5 rounded">
                            Request #{req.id}
                          </span>
                          <h4 className="font-bold text-slate-900 text-base">{req.party_name}</h4>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                          <a
                            href={`tel:${req.phone}`}
                            className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            {req.phone}
                          </a>
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <Clock className="w-3.5 h-3.5" />
                            {formattedDate}
                          </span>
                          <span className="inline-flex items-center gap-1 font-semibold text-orange-700">
                            <Package className="w-3.5 h-3.5" />
                            {totalDesigns} {totalDesigns === 1 ? 'design' : 'designs'} · {totalSets}{' '}
                            {totalSets === 1 ? 'set' : 'sets'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleConvert(req)}
                          disabled={processingId !== null}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          {isBusy ? 'Processing...' : 'Convert to Draft Order'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject(req)}
                          disabled={processingId !== null}
                          className="border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold gap-1"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </Button>
                      </div>
                    </div>

                    {/* Requested Designs Pills / Table */}
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
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
                              className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 border border-slate-100 text-xs"
                            >
                              <div>
                                <span className="font-bold text-slate-900">Design {designNo}</span>
                                {prod?.brand && (
                                  <span className="text-slate-500 ml-1">({prod.brand})</span>
                                )}
                                <div className="text-[11px] text-slate-500">
                                  {pcsPerSet} pcs/set
                                  {rate > 0 ? ` • ${formatCurrency(rate)}/pc` : ''}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="inline-block font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">
                                  {item.sets} {item.sets === 1 ? 'set' : 'sets'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {req.note && (
                      <div className="text-xs text-slate-700 bg-amber-50/70 border border-amber-200/80 px-3 py-2 rounded-lg">
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
    </div>
  )
}

