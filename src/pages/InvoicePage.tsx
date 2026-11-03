import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchPublicInvoice } from '@/services/invoices'
import type { Invoice, InvoiceItem } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { downloadInvoicePdf, printInvoicePdf } from '@/utils/invoicePdfGenerator'
import { KalaLogo, resolveBrandName } from '@/components/common/KalaLogo'
import { ArrowLeft, FileText, Printer, Download, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function InvoicePage() {
  const { invoiceNo, slug = 'rangoli' } = useParams<{ invoiceNo: string; slug?: string }>()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [businessName, setBusinessName] = useState<string>('Kala')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pdfGenerating, setPdfGenerating] = useState(false)

  const displayBrand = resolveBrandName(businessName)

  useEffect(() => {
    if (!invoiceNo) return
    loadInvoice()
  }, [invoiceNo, slug])

  const loadInvoice = async () => {
    try {
      setLoading(true)
      const pubInv = await fetchPublicInvoice(slug, invoiceNo!)
      setBusinessName(resolveBrandName(pubInv.business_name))
      setInvoice({
        id: 0,
        invoice_no: pubInv.invoice_no,
        party_name: pubInv.party_name,
        export_date: pubInv.export_date,
        total_amount: pubInv.total_amount,
        created_at: pubInv.created_at,
        updated_at: pubInv.created_at,
      })
      setItems(
        pubInv.items.map((it) => ({
          id: it.id,
          invoice_id: 0,
          design_no: it.design_no,
          rate: it.rate,
          sets: it.sets,
          pcs_per_set: it.pcs_per_set,
          total_pcs: it.total_pcs,
          line_total: it.line_total,
          created_at: pubInv.created_at,
        }))
      )
    } catch {
      setError('Invoice not found')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadPDF = async () => {
    if (!invoice) return
    setPdfGenerating(true)
    try {
      await downloadInvoicePdf({ invoice, items, businessName: displayBrand })
    } catch {
      window.print()
    } finally {
      setPdfGenerating(false)
    }
  }

  const handlePrint = async () => {
    if (!invoice) return
    setPdfGenerating(true)
    try {
      await printInvoicePdf({ invoice, items, businessName: displayBrand })
    } catch {
      window.print()
    } finally {
      setPdfGenerating(false)
    }
  }

  const handleShareWhatsApp = () => {
    if (!invoice) return
    const url = window.location.href
    const text = `*KALA — WHOLESALE INVOICE*\nInvoice: ${invoice.invoice_no}\nParty: ${invoice.party_name}\nAmount: ${formatCurrency(invoice.total_amount)}\n\nView invoice: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f8f7f4]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-4 border-orange-200 border-t-orange-700 rounded-full animate-spin" />
          <p className="text-sm font-medium text-stone-600">Loading invoice...</p>
        </div>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-[#f8f7f4] px-4">
        <FileText className="w-16 h-16 text-stone-300" />
        <h1 className="text-2xl font-bold text-stone-800">Invoice Not Found</h1>
        <p className="text-stone-500 text-sm">We could not find an invoice matching "{invoiceNo}".</p>
        <Link
          to="/"
          className="text-orange-700 font-semibold hover:underline flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" /> Return to Kala Home
        </Link>
      </div>
    )
  }

  const totalSets = items.reduce((s, i) => s + (i.sets || 0), 0)
  const totalPieces = items.reduce((s, i) => s + (i.total_pcs || 0), 0)

  return (
    <div className="min-h-screen bg-[#f8f7f4] print:bg-white text-stone-900">
      {/* Actions bar — hidden on print */}
      <div className="print:hidden bg-white border-b border-stone-200 sticky top-0 z-30 shadow-2xs py-3 px-4">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/"
            className="text-stone-600 hover:text-stone-900 flex items-center gap-1.5 text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4" /> Kala Home
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleShareWhatsApp}>
              <Share2 className="w-4 h-4 mr-1 text-emerald-700" /> WhatsApp
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
              disabled={pdfGenerating}
            >
              <Download className="w-4 h-4 mr-1 text-orange-700" />
              {pdfGenerating ? 'Generating...' : 'Download PDF'}
            </Button>
            <Button
              className="bg-stone-900 hover:bg-stone-800 text-white"
              size="sm"
              onClick={handlePrint}
              disabled={pdfGenerating}
            >
              <Printer className="w-4 h-4 mr-1" /> Print Invoice
            </Button>
          </div>
        </div>
      </div>

      {/* Invoice Content — Print-Ready A4 Container */}
      <div className="max-w-4xl mx-auto my-6 print:my-0 bg-white shadow-sm print:shadow-none rounded-xl print:rounded-none overflow-hidden border print:border-none border-stone-200">
        {/* Top Terracotta & Charcoal Bar */}
        <div className="h-2 flex">
          <div className="w-36 bg-orange-700" />
          <div className="flex-1 bg-stone-900" />
        </div>

        <div className="p-6 sm:p-10 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-stone-200 pb-6 gap-4">
            <KalaLogo
              size="lg"
              titleOverride={displayBrand.toUpperCase()}
              subtitle="KALA — Textile Wholesale Management System"
            />
            <div className="text-left sm:text-right bg-stone-50 border border-stone-200 px-4 py-2.5 rounded-lg">
              <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 block">
                Wholesale Invoice
              </span>
              <p className="text-xl font-mono font-extrabold text-orange-700">
                {invoice.invoice_no}
              </p>
            </div>
          </div>

          {/* Billing & Date Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#f8f7f4] p-4 rounded-xl border border-stone-200 text-sm">
            <div className="space-y-1">
              <p className="text-stone-500 text-xs font-bold uppercase tracking-wider">
                Billed To (Customer / Party)
              </p>
              <p className="font-extrabold text-stone-900 text-base">{invoice.party_name}</p>
              <p className="text-xs text-stone-500">Wholesale Textile Account</p>
            </div>
            <div className="space-y-1 sm:text-right">
              <p className="text-stone-500 text-xs font-bold uppercase tracking-wider">
                Invoice Details
              </p>
              <p className="text-stone-700">
                Invoice Date:{' '}
                <strong className="text-stone-900">
                  {invoice.export_date
                    ? formatDate(invoice.export_date)
                    : formatDate(invoice.created_at)}
                </strong>
              </p>
              <p className="text-xs text-stone-500 font-mono">Ref: {invoice.invoice_no}</p>
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto border border-stone-200 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-stone-900 text-white font-bold text-xs tracking-wider uppercase">
                <tr>
                  <th className="py-3 px-3 text-left w-12">S.No</th>
                  <th className="py-3 px-3 text-left">Design No</th>
                  <th className="py-3 px-3 text-left">Description</th>
                  <th className="py-3 px-3 text-right">Pcs/Set</th>
                  <th className="py-3 px-3 text-right">Sets</th>
                  <th className="py-3 px-3 text-right">Total Pcs</th>
                  <th className="py-3 px-3 text-right">Rate (₹)</th>
                  <th className="py-3 px-4 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/80">
                {items.map((item, index) => (
                  <tr key={item.id} className={index % 2 === 1 ? 'bg-stone-50/70' : 'bg-white'}>
                    <td className="py-3 px-3 text-stone-500 font-mono text-xs tabular-nums">
                      {index + 1}
                    </td>
                    <td className="py-3 px-3 font-bold text-stone-900">{item.design_no || '-'}</td>
                    <td className="py-3 px-3 text-xs text-stone-600">
                      Wholesale Set ({item.pcs_per_set || 1} pcs/set)
                    </td>
                    <td className="py-3 px-3 text-right text-stone-700 tabular-nums">
                      {item.pcs_per_set || 1}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-stone-900 tabular-nums">
                      {item.sets}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-stone-900 tabular-nums">
                      {item.total_pcs}
                    </td>
                    <td className="py-3 px-3 text-right text-stone-700 tabular-nums">
                      {formatCurrency(item.rate || 0)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900 tabular-nums">
                      {formatCurrency(item.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Document Details, Signatory & Financial Summary */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6 pt-2">
            <div className="space-y-4 flex-1">
              <div className="text-xs text-stone-500 space-y-1">
                <p className="font-bold text-stone-700 uppercase tracking-wider text-[11px]">
                  Document Details
                </p>
                <p>Invoice Reference: {invoice.invoice_no}</p>
                <p>System-generated wholesale invoice summary for {invoice.party_name}.</p>
              </div>

              <div className="border border-stone-200 rounded-lg p-3.5 w-56 bg-stone-50/50">
                <p className="text-xs font-bold text-stone-900">
                  For {displayBrand.toUpperCase()}
                </p>
                <p className="text-[11px] text-stone-500 mt-6">Authorized Signatory</p>
              </div>
            </div>

            <div className="w-full sm:w-80 bg-[#f8f7f4] border border-stone-200 rounded-xl p-4 space-y-2.5 text-sm shrink-0">
              <div className="flex justify-between text-stone-600">
                <span>Total Designs:</span>
                <strong className="text-stone-900 font-mono tabular-nums">{items.length}</strong>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>Total Sets:</span>
                <strong className="text-stone-900 font-mono tabular-nums">{totalSets}</strong>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>Total Pieces:</span>
                <strong className="text-stone-900 font-mono tabular-nums">{totalPieces}</strong>
              </div>
              <div className="border-t border-stone-200 pt-2.5 flex justify-between items-baseline">
                <span className="font-extrabold text-stone-900 text-base">Invoice Total:</span>
                <span className="text-xl font-black text-orange-700 tabular-nums">
                  {formatCurrency(invoice.total_amount)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-stone-200 pt-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
            <p className="font-semibold text-stone-700">
              KALA — Textile Wholesale Management System
            </p>
            <p>Computer-generated wholesale invoice • {displayBrand}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
