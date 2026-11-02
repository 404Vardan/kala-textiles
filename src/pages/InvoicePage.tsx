import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchInvoice, fetchInvoiceItems } from '@/services/invoices'
import type { Invoice, InvoiceItem } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { ArrowLeft, FileText, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function InvoicePage() {
  const { invoiceNo } = useParams<{ invoiceNo: string }>()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!invoiceNo) return
    loadInvoice()
  }, [invoiceNo])

  const loadInvoice = async () => {
    try {
      setLoading(true)
      const inv = await fetchInvoice(invoiceNo!)
      setInvoice(inv)
      const invItems = await fetchInvoiceItems(inv.id)
      setItems(invItems)
    } catch {
      setError('Invoice not found')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <FileText className="w-16 h-16 text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-600">Invoice Not Found</h1>
        <Link to="/" className="text-orange-600 hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Print button — hidden on print */}
      <div className="print:hidden bg-white border-b py-3 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      {/* Invoice Content — A4-optimized */}
      <div className="max-w-4xl mx-auto my-6 print:my-0 bg-white shadow-lg print:shadow-none rounded-lg print:rounded-none">
        <div className="p-8 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start border-b pb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">INVOICE</h1>
              <p className="text-lg font-medium text-orange-600 mt-1">{invoice.invoice_no}</p>
            </div>
            <div className="text-right">
              <h2 className="text-xl font-bold bg-gradient-to-r from-orange-600 to-rose-600 bg-clip-text text-transparent">
                Rangoli Textiles
              </h2>
              {invoice.qr_code_url && (
                <img src={invoice.qr_code_url} alt="QR" className="w-20 h-20 ml-auto mt-2" />
              )}
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wide">Bill To</p>
              <p className="font-semibold text-lg mt-1">{invoice.party_name}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-500 text-xs uppercase tracking-wide">Date</p>
              <p className="font-medium mt-1">{invoice.export_date ? formatDate(invoice.export_date) : formatDate(invoice.created_at)}</p>
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="py-3 text-left font-semibold">#</th>
                <th className="py-3 text-left font-semibold">Design No</th>
                <th className="py-3 text-center font-semibold">Rate/pc</th>
                <th className="py-3 text-center font-semibold">Sets</th>
                <th className="py-3 text-center font-semibold">Total Pcs</th>
                <th className="py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-3">{index + 1}</td>
                  <td className="py-3 font-medium">{item.design_no || '-'}</td>
                  <td className="py-3 text-center">{formatCurrency(item.rate || 0)}</td>
                  <td className="py-3 text-center">{item.sets}</td>
                  <td className="py-3 text-center">{item.total_pcs}</td>
                  <td className="py-3 text-right">{formatCurrency(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300">
                <td colSpan={5} className="py-4 text-right font-bold text-lg">Grand Total</td>
                <td className="py-4 text-right font-bold text-lg text-orange-600">
                  {formatCurrency(invoice.total_amount)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Footer */}
          <div className="border-t pt-6 text-center text-xs text-gray-400">
            <p>This is a computer-generated invoice.</p>
            <p className="mt-1">Rangoli Textiles</p>
          </div>
        </div>
      </div>
    </div>
  )
}
