import { useState, useEffect, useRef } from 'react'
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
import {
  fetchProducts,
  deleteProduct,
  createProduct,
  updateProduct,
  toggleProductActive,
  checkDesignNoAvailable,
  createProductMedia,
  fetchProductMedia,
} from '@/services/products'
import { uploadProductMedia, deleteMediaFile, getPathFromUrl } from '@/services/storage'
import MediaManager from '@/components/admin/MediaManager'
import type { Product } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import { generateQRCodeForProduct, downloadQRCode, printProductLabel } from '@/utils/qrcode'
import {
  Trash2,
  Edit2,
  Printer,
  Download,
  Plus,
  Image as ImageIcon,
  Search,
  CheckCircle2,
  XCircle,
  QrCode,
  Film,
  Star,
  Eye,
  Filter,
} from 'lucide-react'

interface StagedMediaFile {
  id: string
  file: File
  preview: string
  type: 'image' | 'video'
  isPrimary: boolean
}

export default function ProductTab() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [brandFilter, setBrandFilter] = useState('all')
  const [collectionFilter, setCollectionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all')

  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [showMediaDialog, setShowMediaDialog] = useState(false)
  const [mediaProduct, setMediaProduct] = useState<Product | null>(null)

  // QR Modal preview
  const [previewQrProduct, setPreviewQrProduct] = useState<Product | null>(null)
  const [previewQrDataUrl, setPreviewQrDataUrl] = useState<string | null>(null)

  // Form fields
  const [formDesignNo, setFormDesignNo] = useState('')
  const [formBrand, setFormBrand] = useState('')
  const [formCollection, setFormCollection] = useState('')
  const [formFabric, setFormFabric] = useState('')
  const [formRate, setFormRate] = useState('')
  const [formPcsPerSet, setFormPcsPerSet] = useState('1')
  const [formDescription, setFormDescription] = useState('')
  const [formIsActive, setFormIsActive] = useState(true)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Staged files for new or edited products
  const [stagedFiles, setStagedFiles] = useState<StagedMediaFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const data = await fetchProducts({ limit: 300 })
      setProducts(data)
    } catch (error) {
      console.error('Error loading products:', error)
    } finally {
      setLoading(false)
    }
  }

  // Derive unique brands and collections for filter selectors
  const uniqueBrands = Array.from(new Set(products.map(p => p.brand).filter(Boolean))) as string[]
  const uniqueCollections = Array.from(new Set(products.map(p => p.collection_name).filter(Boolean))) as string[]

  const filteredProducts = products.filter(p => {
    if (statusFilter === 'active' && p.is_active === false) return false
    if (statusFilter === 'archived' && p.is_active !== false) return false
    if (brandFilter !== 'all' && p.brand !== brandFilter) return false
    if (collectionFilter !== 'all' && p.collection_name !== collectionFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return (
        p.design_no.toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.collection_name && p.collection_name.toLowerCase().includes(q)) ||
        (p.fabric && p.fabric.toLowerCase().includes(q))
      )
    }
    return true
  })

  const handleDelete = async (id: number) => {
    try {
      const productMedia = await fetchProductMedia(id).catch(() => [])
      for (const m of productMedia) {
        const path = getPathFromUrl(m.media_url)
        await deleteMediaFile(path).catch(() => {})
      }
      await deleteProduct(id)
      setProducts(products.filter(p => p.id !== id))
      setDeleteConfirm(null)
    } catch (error: any) {
      alert(`Error deleting product: ${error?.message || 'Unknown error'}`)
    }
  }

  const handleToggleStatus = async (product: Product) => {
    try {
      const updated = await toggleProductActive(product.id, product.is_active ?? true)
      setProducts(products.map(p => (p.id === updated.id ? updated : p)))
    } catch (err: any) {
      alert(`Could not toggle status: ${err?.message || 'Error'}`)
    }
  }

  const openCreateForm = () => {
    setEditingProduct(null)
    setFormDesignNo('')
    setFormBrand('')
    setFormCollection('')
    setFormFabric('')
    setFormRate('')
    setFormPcsPerSet('1')
    setFormDescription('')
    setFormIsActive(true)
    setStagedFiles([])
    setFormError('')
    setShowForm(true)
  }

  const openEditForm = (product: Product) => {
    setEditingProduct(product)
    setFormDesignNo(product.design_no)
    setFormBrand(product.brand || '')
    setFormCollection(product.collection_name || '')
    setFormFabric(product.fabric || '')
    setFormRate(String(product.rate || ''))
    setFormPcsPerSet(String(product.pcs_per_set || 1))
    setFormDescription(product.description || '')
    setFormIsActive(product.is_active ?? true)
    setStagedFiles([])
    setFormError('')
    setShowForm(true)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files)

    const newStaged: StagedMediaFile[] = files.map((file, idx) => {
      const isVideo = file.type.startsWith('video/')
      return {
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
        type: isVideo ? 'video' : 'image',
        isPrimary: stagedFiles.length === 0 && idx === 0 && !isVideo,
      }
    })

    setStagedFiles(prev => [...prev, ...newStaged])
    e.target.value = ''
  }

  const removeStagedFile = (id: string) => {
    setStagedFiles(prev => {
      const target = prev.find(f => f.id === id)
      if (target) URL.revokeObjectURL(target.preview)
      const next = prev.filter(f => f.id !== id)
      if (target?.isPrimary && next.length > 0) {
        next[0].isPrimary = true
      }
      return next
    })
  }

  const setPrimaryStaged = (id: string) => {
    setStagedFiles(prev =>
      prev.map(f => ({
        ...f,
        isPrimary: f.id === id,
      }))
    )
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    const designNo = formDesignNo.trim()
    if (!designNo) {
      setFormError('Design number is required')
      return
    }

    setFormSaving(true)

    try {
      // Validate unique design number
      const isAvailable = await checkDesignNoAvailable(designNo, editingProduct?.id)
      if (!isAvailable) {
        setFormError(`Design number "${designNo}" is already registered. Please specify a unique design number.`)
        setFormSaving(false)
        return
      }

      const productPayload: Record<string, any> = {
        design_no: designNo,
        brand: formBrand.trim() || null,
        collection_name: formCollection.trim() || null,
        fabric: formFabric.trim() || null,
        rate: formRate ? parseFloat(formRate) : null,
        pcs_per_set: parseInt(formPcsPerSet) || 1,
        description: formDescription.trim() || null,
        is_active: formIsActive,
      }

      let savedProduct: Product

      if (editingProduct) {
        savedProduct = await updateProduct(editingProduct.id, productPayload)
      } else {
        savedProduct = await createProduct(productPayload as any)
      }

      // Upload any staged files
      if (stagedFiles.length > 0 && savedProduct.id) {
        let primaryUrl: string | null = null

        for (let i = 0; i < stagedFiles.length; i++) {
          const item = stagedFiles[i]
          try {
            const mediaUrl = await uploadProductMedia(savedProduct.id, item.file)
            await createProductMedia(savedProduct.id, mediaUrl, item.type, i)
            if (item.isPrimary || (!primaryUrl && item.type === 'image')) {
              primaryUrl = mediaUrl
            }
          } catch (uploadErr) {
            console.error('Failed to upload file:', item.file.name, uploadErr)
          }
        }

        if (primaryUrl && (!savedProduct.image_url || stagedFiles.some(f => f.isPrimary))) {
          await updateProduct(savedProduct.id, { image_url: primaryUrl })
        }
      }

      // Cleanup
      stagedFiles.forEach(f => URL.revokeObjectURL(f.preview))
      setStagedFiles([])
      setShowForm(false)
      await loadProducts()
    } catch (error: any) {
      setFormError(error?.message || 'Failed to save product')
    } finally {
      setFormSaving(false)
    }
  }

  // QR Label Print / Download
  const handleOpenQrModal = async (product: Product) => {
    try {
      const qrData = await generateQRCodeForProduct(product.design_no)
      setPreviewQrProduct(product)
      setPreviewQrDataUrl(qrData)
    } catch (err: any) {
      alert(`Could not generate QR: ${err?.message || 'Error'}`)
    }
  }

  const handlePrintLabel = (product: Product, qrDataUrl: string) => {
    printProductLabel(product, qrDataUrl)
  }

  return (
    <div className="space-y-6">
      {/* Action and Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search design number, fabric, brand..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-200"
            />
          </div>
          <Button onClick={openCreateForm} className="bg-slate-900 hover:bg-slate-800 text-white shrink-0">
            <Plus className="w-4 h-4 mr-1.5" /> New Product
          </Button>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
          <span className="font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Filters:
          </span>

          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium text-slate-700"
          >
            <option value="all">All Brands</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <select
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium text-slate-700"
          >
            <option value="all">All Collections</option>
            {uniqueCollections.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium text-slate-700"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="archived">Archived Only</option>
          </select>

          {(brandFilter !== 'all' || collectionFilter !== 'all' || statusFilter !== 'all' || searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBrandFilter('all')
                setCollectionFilter('all')
                setStatusFilter('all')
                setSearchQuery('')
              }}
              className="text-orange-600 hover:text-orange-700 h-7 px-2 text-xs"
            >
              Reset Filters
            </Button>
          )}

          <span className="ml-auto text-slate-400 font-medium">
            Showing {filteredProducts.length} of {products.length} designs
          </span>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left w-16">Photo</th>
                <th className="px-4 py-3 text-left">Design No</th>
                <th className="px-4 py-3 text-left">Brand & Collection</th>
                <th className="px-4 py-3 text-left">Fabric</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-center">Set Specs</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">Loading catalog...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No products found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-2.5">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.design_no}
                          className="w-12 h-12 object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-90"
                          onClick={() => {
                            setMediaProduct(p)
                            setShowMediaDialog(true)
                          }}
                        />
                      ) : (
                        <div
                          className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 border border-dashed border-slate-300 cursor-pointer hover:bg-slate-200"
                          onClick={() => {
                            setMediaProduct(p)
                            setShowMediaDialog(true)
                          }}
                        >
                          <ImageIcon className="w-5 h-5" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-slate-900 text-base">{p.design_no}</span>
                      </div>
                      <a
                        href={`/p/${p.design_no}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-orange-600 hover:underline flex items-center gap-0.5 mt-0.5 font-medium"
                      >
                        <Eye className="w-3 h-3" /> View Public Page
                      </a>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{p.brand || '-'}</p>
                      {p.collection_name && (
                        <p className="text-xs text-slate-500">{p.collection_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 font-medium">{p.fabric || '-'}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                      {p.rate ? formatCurrency(p.rate) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-center text-slate-600 text-xs">
                      <span className="bg-slate-100 px-2 py-1 rounded font-mono font-medium">
                        {p.pcs_per_set || 1} pcs/set
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleToggleStatus(p)}
                        className={`text-xs px-2.5 py-1 rounded-full font-semibold border transition-colors inline-flex items-center gap-1 ${
                          p.is_active !== false
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        {p.is_active !== false ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" /> Active
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" /> Archived
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="QR Code & Label"
                          onClick={() => handleOpenQrModal(p)}
                          className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900"
                        >
                          <QrCode className="w-4 h-4 text-orange-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Media Gallery"
                          onClick={() => {
                            setMediaProduct(p)
                            setShowMediaDialog(true)
                          }}
                          className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900"
                        >
                          <ImageIcon className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Edit Product"
                          onClick={() => openEditForm(p)}
                          className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete Product"
                          onClick={() => setDeleteConfirm(p.id)}
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Product Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {editingProduct ? `Edit Product — ${editingProduct.design_no}` : 'Add New Textile Product'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveProduct} className="space-y-4 pt-2">
            {formError && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 p-3 rounded-lg border border-rose-200">
                {formError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Design Number *</Label>
                <Input
                  value={formDesignNo}
                  onChange={(e) => setFormDesignNo(e.target.value.toUpperCase())}
                  placeholder="e.g. 4955"
                  required
                  className="font-bold text-slate-900"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Wholesale Rate (₹/pc)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formRate}
                  onChange={(e) => setFormRate(e.target.value)}
                  placeholder="e.g. 850"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Brand</Label>
                <Input
                  value={formBrand}
                  onChange={(e) => setFormBrand(e.target.value)}
                  placeholder="e.g. Rangoli"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Collection</Label>
                <Input
                  value={formCollection}
                  onChange={(e) => setFormCollection(e.target.value)}
                  placeholder="e.g. Silk Edition"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fabric</Label>
                <Input
                  value={formFabric}
                  onChange={(e) => setFormFabric(e.target.value)}
                  placeholder="e.g. Pure Cotton"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Pieces Per Set</Label>
                <Input
                  type="number"
                  min="1"
                  value={formPcsPerSet}
                  onChange={(e) => setFormPcsPerSet(e.target.value)}
                  placeholder="1"
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="prod-is-active"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="w-4 h-4 rounded text-orange-600 border-slate-300"
                />
                <Label htmlFor="prod-is-active" className="cursor-pointer text-sm font-medium">
                  Active in Catalog
                </Label>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description / Work Notes</Label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Product specifications, embroidery details, wash care..."
                rows={2}
                className="w-full text-sm rounded-md border border-slate-200 bg-white p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Media Upload & Preview */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex justify-between items-center">
                <Label className="text-slate-800 font-semibold">Product Photographs & Videos</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 text-xs border-dashed"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Photos / Videos
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {stagedFiles.length > 0 && (
                <div className="grid grid-cols-4 gap-2.5 pt-2">
                  {stagedFiles.map((sf) => (
                    <div
                      key={sf.id}
                      className={`relative rounded-lg overflow-hidden border-2 group aspect-square bg-slate-100 ${
                        sf.isPrimary ? 'border-orange-500 ring-2 ring-orange-200' : 'border-slate-200'
                      }`}
                    >
                      {sf.type === 'video' ? (
                        <video src={sf.preview} className="w-full h-full object-cover" />
                      ) : (
                        <img src={sf.preview} alt="" className="w-full h-full object-cover" />
                      )}

                      {/* Controls overlay */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                        {sf.type === 'image' && (
                          <button
                            type="button"
                            title="Set as primary"
                            onClick={() => setPrimaryStaged(sf.id)}
                            className={`p-1.5 rounded-full ${
                              sf.isPrimary ? 'bg-orange-500 text-white' : 'bg-white/80 hover:bg-white text-slate-800'
                            }`}
                          >
                            <Star className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Remove"
                          onClick={() => removeStagedFile(sf.id)}
                          className="p-1.5 rounded-full bg-rose-500 text-white hover:bg-rose-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {sf.isPrimary && (
                        <div className="absolute top-1 left-1 bg-orange-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                          PRIMARY
                        </div>
                      )}
                      {sf.type === 'video' && (
                        <div className="absolute bottom-1 right-1 bg-black/60 text-white p-0.5 rounded">
                          <Film className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={formSaving} className="bg-slate-900 hover:bg-slate-800 text-white">
                {formSaving ? 'Saving Product...' : editingProduct ? 'Update Product' : 'Create Product'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* QR Code & Label Modal */}
      <Dialog open={previewQrProduct !== null} onOpenChange={() => setPreviewQrProduct(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Product QR Label — {previewQrProduct?.design_no}
            </DialogTitle>
          </DialogHeader>

          {previewQrProduct && previewQrDataUrl && (
            <div className="space-y-4 py-2 text-center">
              <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs inline-block mx-auto">
                <img
                  src={previewQrDataUrl}
                  alt={`QR for ${previewQrProduct.design_no}`}
                  className="w-48 h-48 mx-auto"
                />
                <p className="text-xs font-mono text-slate-400 mt-2">
                  /p/{previewQrProduct.design_no}
                </p>
              </div>

              <div className="text-xs text-slate-500">
                This QR code permanently routes to the public catalog page. It remains valid even after price or photo changes.
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => downloadQRCode(previewQrDataUrl, `QR_${previewQrProduct.design_no}`)}
                >
                  <Download className="w-4 h-4 mr-1.5" /> Download QR
                </Button>
                <Button
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white"
                  onClick={() => handlePrintLabel(previewQrProduct, previewQrDataUrl)}
                >
                  <Printer className="w-4 h-4 mr-1.5" /> Print Label
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Media Manager for existing products */}
      {mediaProduct && (
        <MediaManager
          product={mediaProduct}
          open={showMediaDialog}
          onOpenChange={(open) => {
            setShowMediaDialog(open)
            if (!open) loadProducts()
          }}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete this design and its associated media files?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
