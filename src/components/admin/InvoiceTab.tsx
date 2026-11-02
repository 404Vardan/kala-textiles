import { useEffect, useState } from 'react'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { fetchInvoices, createInvoice, deleteInvoice, updateInvoice, deleteInvoiceItemsByInvoiceId, fetchInvoiceItems } from '@/services/invoices'
import { createInvoiceItemBatch } from '@/services/invoices'
import { fetchProducts } from '@/services/products'
import type { Invoice, Product } from '@/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { generateQRCodeForInvoice } from '@/utils/qrcode'
import { Plus, Trash2, Eye, Search, X, Edit2 } from 'lucide-react'

interface InvoiceItemDraft {
  design_no: string
  rate: number
  sets: number
  pcs_per_set: number
  total_pcs: number
  line_total: number
}

export default function InvoiceTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [products, setProducts] = useState<Product[]>([])

  // Create form
  const [invoiceNo, setInvoiceNo] = useState('')
  const [partyName, setPartyName] = useState('')
  const [exportDate, setExportDate] = useState('')
  const [items, setItems] = useState<InvoiceItemDraft[]>([])
  const [createLoading, setCreateLoading] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])

  useEffect(() => {
    loadInvoices()
    fetchProducts(500).then(setProducts).catch(console.error)
  }, [])

  const loadInvoices = async () => {
    try {
      setLoading(true)
      const data = await fetchInvoices()
      setInvoices(data)
    } catch (error: any) {
      console.error('Error loading invoices:', error)
      alert(`Error: ${error?.message || 'Failed to load invoices'}`)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setInvoiceNo('')
    setPartyName('')
    setExportDate('')
    setItems([])
    setEditingInvoice(null)
  }

  const openCreateForm = () => {
    resetForm()
    setShowCreate(true)
  }

  const openEditForm = async (invoice: Invoice) => {
    setEditingInvoice(invoice)
    setInvoiceNo(invoice.invoice_no)
    setPartyName(invoice.party_name)
    setExportDate(invoice.export_date || '')
    
    try {
      const invoiceItems = await fetchInvoiceItems(invoice.id)
      const drafts: InvoiceItemDraft[] = invoiceItems.map(item => ({
        design_no: item.design_no || '',
        rate: item.rate || 0,
        sets: item.sets || 1,
        pcs_per_set: item.pcs_per_set || 1,
        total_pcs: item.total_pcs || 0,
        line_total: item.line_total || 0,
      }))
      setItems(drafts)
    } catch {
      setItems([])
    }
    
    setShowCreate(true)
  }

  const handleSearchItem = (query: string) => {
    setItemSearch(query)
    if (query.trim()) {
      const q = query.toLowerCase()
      setSearchResults(products.filter(p => p.design_no.toLowerCase().includes(q)).slice(0, 10))
    } else {
      setSearchResults([])
    }
  }

  const addItemFromProduct = (product: Product) => {
    if (items.some(i => i.design_no === product.design_no)) {
      setItemSearch('')
      setSearchResults([])
      return
    }

    const pcsPerSet = product.pcs_per_set || 1
    setItems([...items, {
      design_no: product.design_no,
      rate: product.rate || 0,
      sets: 1,
      pcs_per_set: pcsPerSet,
      total_pcs: pcsPerSet,
      line_total: (product.rate || 0) * pcsPerSet,
    }])
    setItemSearch('')
    setSearchResults([])
  }

  const updateItem = (index: number, field: string, value: number) => {
    const updated = [...items]
    const item = { ...updated[index] }

    if (field === 'sets') {
      item.sets = value
      item.total_pcs = value * item.pcs_per_set
      item.line_total = item.rate * item.total_pcs
    } else if (field === 'rate') {
      item.rate = value
      item.line_total = value * item.total_pcs
    }

    updated[index] = item
    setItems(updated)
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const totalAmount = items.reduce((sum, i) => sum + i.line_total, 0)

  const handleSaveInvoice = async () => {
    setCreateLoading(true)
    try {
      const domain = import.meta.env.VITE_PUBLISHED_DOMAIN || window.location.origin
      const qrDataUrl = await generateQRCodeForInvoice(invoiceNo, domain)

      if (editingInvoice) {
        await updateInvoice(editingInvoice.id, {
          invoice_no: invoiceNo,
          party_name: partyName,
          export_date: exportDate || null,
          qr_code_url: qrDataUrl,
          total_amount: totalAmount,
        })

        await deleteInvoiceItemsByInvoiceId(editingInvoice.id)
        if (items.length > 0) {
          await createInvoiceItemBatch(items.map(i => ({
            invoice_id: editingInvoice.id,
            design_no: i.design_no,
            rate: i.rate,
            sets: i.sets,
            pcs_per_set: i.pcs_per_set,
            total_pcs: i.total_pcs,
            line_total: i.line_total,
          })))
        }
      } else {
        const invoice = await createInvoice({
          invoice_no: invoiceNo,
          party_name: partyName,
          export_date: exportDate || null,
          qr_code_url: qrDataUrl,
          total_amount: totalAmount,
        })

        if (items.length > 0) {
          await createInvoiceItemBatch(items.map(i => ({
            invoice_id: invoice.id,
            design_no: i.design_no,
            rate: i.rate,
            sets: i.sets,
            pcs_per_set: i.pcs_per_set,
            total_pcs: i.total_pcs,
            line_total: i.line_total,
          })))
        }
      }

      setShowCreate(false)
      resetForm()
      await loadInvoices()
    } catch (error: any) {
      console.error('Error saving invoice:', error)
      alert(`Error: ${error?.message || 'Failed to save invoice'}`)
    } finally {
      setCreateLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteInvoice(id)
      setInvoices(invoices.filter(i => i.id !== id))
      setDeleteConfirm(null)
    } catch (error: any) {
      console.error('Error deleting invoice:', error)
      alert(`Error: ${error?.message || 'Failed to delete invoice'}`)
    }
  }

  const handleViewInvoice = (invoice: Invoice) => {
    const domain = import.meta.env.VITE_PUBLISHED_DOMAIN || window.location.origin
    window.open(`${domain}/invoice/${invoice.invoice_no}`, '_blank')
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10">Loading invoices...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <Button onClick={openCreateForm} className="bg-orange-600 hover:bg-orange-700">
          <Plus className="w-4 h-4 mr-2" />
          Create Invoice
        </Button>
      </div>

      <div className="border rounded-lg overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Invoice No</th>
              <th className="px-4 py-3 text-left font-medium">Party Name</th>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Total Amount</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No invoices found</td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-orange-50/50">
                  <td className="px-4 py-3 font-medium text-orange-700">{invoice.invoice_no}</td>
                  <td className="px-4 py-3">{invoice.party_name}</td>
                  <td className="px-4 py-3">{invoice.export_date ? formatDate(invoice.export_date) : '-'}</td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(invoice.total_amount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleViewInvoice(invoice)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEditForm(invoice)}>
                        <Edit2 className="w-4 h-4 text-blue-500" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(invoice.id)}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Invoice Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); resetForm() } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingInvoice ? `Edit Invoice ${editingInvoice.invoice_no}` : 'Create Invoice'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Invoice No *</Label>
                <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-001" required />
              </div>
              <div className="space-y-1">
                <Label>Party Name *</Label>
                <Input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Party" required />
              </div>
              <div className="space-y-1">
                <Label>Export Date</Label>
                <Input type="date" value={exportDate} onChange={(e) => setExportDate(e.target.value)} />
              </div>
            </div>

            <hr />

            {/* Item Search */}
            <div className="relative">
              <div className="flex items-center gap-2 border rounded-lg px-3">
                <Search className="w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search product to add..."
                  value={itemSearch}
                  onChange={(e) => handleSearchItem(e.target.value)}
                  className="border-0 shadow-none focus-visible:ring-0"
                />
              </div>
              {searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {searchResults.map(p => (
                    <button
                      key={p.id}
                      onClick={() => addItemFromProduct(p)}
                      className="w-full text-left px-3 py-2 hover:bg-orange-50 text-sm"
                    >
                      <span className="font-medium">{p.design_no}</span>
                      <span className="text-gray-400 ml-2">₹{p.rate || 0}/pc</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Items Table */}
            {items.length > 0 && (
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">D.No</th>
                      <th className="px-3 py-2 text-center">Rate/pc</th>
                      <th className="px-3 py-2 text-center">Sets</th>
                      <th className="px-3 py-2 text-center">Total Pcs</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-medium">{item.design_no}</td>
                        <td className="px-3 py-2 text-center">
                          <Input type="number" value={item.rate} onChange={(e) => updateItem(idx, 'rate', parseFloat(e.target.value) || 0)} className="w-20 text-center mx-auto" min="0" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Input type="number" value={item.sets} onChange={(e) => updateItem(idx, 'sets', parseInt(e.target.value) || 0)} className="w-16 text-center mx-auto" min="1" />
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500">{item.total_pcs}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.line_total)}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                      <td className="px-3 py-2 text-right text-orange-700">{formatCurrency(totalAmount)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <Button
              onClick={handleSaveInvoice}
              className="w-full bg-orange-600 hover:bg-orange-700"
              disabled={createLoading || !invoiceNo.trim() || !partyName.trim() || items.length === 0}
            >
              {createLoading ? 'Saving...' : editingInvoice 
                ? `Update Invoice (${formatCurrency(totalAmount)})`
                : `Create Invoice (${formatCurrency(totalAmount)})`
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteConfirm !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? This will permanently delete this invoice and all its items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-4">
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteConfirm) handleDelete(deleteConfirm) }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
