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
import { useAuth } from '@/contexts/AuthContext'
import type { Product } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import { generateQRCodeForProduct, downloadQRCode, printProductLabel } from '@/utils/qrcode'
import { StatusBadge, EmptyState, LoadingState } from '@/components/ui/primitives'
import {
  Trash2,
  Edit2,
  Printer,
  Download,
  Plus,
  Image as ImageIcon,
  Search,
  QrCode,
  Film,
  Star,
  ExternalLink,
} from 'lucide-react'

interface StagedMediaFile {
  id: string
  file: File
  preview: string
  type: 'image' | 'video'
  isPrimary: boolean
}

export default function ProductTab() {
  const { business } = useAuth()
  const activeSlug = business?.slug || 'rangoli'

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
      const isAvailable = await checkDesignNoAvailable(designNo, editingProduct?.id)
      if (!isAvailable) {
        setFormError(`Design number "${designNo}" is already registered.`)
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

      if (stagedFiles.length > 0 && savedProduct.id) {
        let primaryUrl: string | null = null

        for (let i = 0; i < stagedFiles.length; i++) {
          const item = stagedFiles[i]
          try {
            const targetBusinessId = savedProduct.business_id ?? business?.id
            if (!targetBusinessId) {
              throw new Error('Unable to determine active business for media upload.')
            }
            const mediaUrl = await uploadProductMedia(targetBusinessId, savedProduct.id, item.file)
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

  const handleOpenQrModal = async (product: Product) => {
    try {
      const qrData = await generateQRCodeForProduct(product.design_no, activeSlug)
      setPreviewQrProduct(product)
      setPreviewQrDataUrl(qrData)
    } catch (err: any) {
      alert(`Could not generate QR: ${err?.message || 'Error'}`)
    }
  }

  const handlePrintLabel = (product: Product, qrDataUrl: string) => {
    printProductLabel(product, qrDataUrl)
  }

  const activeCount = products.filter(p => p.is_active !== false).length
  const hasActiveFilters =
    brandFilter !== 'all' || collectionFilter !== 'all' || statusFilter !== 'all' || Boolean(searchQuery)

  return (
    <div className="space-y-4">
      {/* Toolbar: Search, Filters & Primary Action */}
      <div className="bg-white p-4 rounded-[6px] border border-[#E3E5EA] space-y-3">
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <Input
              aria-label="Search products"
              placeholder="Search design no, brand, fabric..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={openCreateForm} className="w-full sm:w-auto shrink-0">
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#E3E5EA] text-xs">
          <select
            aria-label="Filter by brand"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="h-8 bg-white border border-[#E3E5EA] rounded-[6px] px-2.5 text-xs font-medium text-[#1A1D24]"
          >
            <option value="all">All Brands</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <select
            aria-label="Filter by collection"
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
            className="h-8 bg-white border border-[#E3E5EA] rounded-[6px] px-2.5 text-xs font-medium text-[#1A1D24]"
          >
            <option value="all">All Collections</option>
            {uniqueCollections.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-8 bg-white border border-[#E3E5EA] rounded-[6px] px-2.5 text-xs font-medium text-[#1A1D24]"
          >
            <option value="all">All Status ({products.length})</option>
            <option value="active">Active ({activeCount})</option>
            <option value="archived">Archived ({products.length - activeCount})</option>
          </select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBrandFilter('all')
                setCollectionFilter('all')
                setStatusFilter('all')
                setSearchQuery('')
              }}
              className="h-8 px-2.5 text-xs text-[#1E2A4A]"
            >
              Reset
            </Button>
          )}

          <span className="ml-auto text-[#667085] tabular-nums">
            {filteredProducts.length} of {products.length} designs
          </span>
        </div>
      </div>

      {/* Dense Products Table */}
      <div className="bg-white border border-[#E3E5EA] rounded-[6px] overflow-hidden">
        {loading ? (
          <LoadingState message="Loading product catalog..." />
        ) : filteredProducts.length === 0 ? (
          <EmptyState
            title="No products found matching your filters."
            action={
              <Button onClick={openCreateForm} size="sm">
                <Plus className="w-3.5 h-3.5" />
                <span>Add Product</span>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F4F5F7] border-b border-[#E3E5EA] text-[#667085] text-xs font-medium">
                <tr>
                  <th className="px-4 py-2.5 text-left w-14">Photo</th>
                  <th className="px-4 py-2.5 text-left">Design No</th>
                  <th className="px-4 py-2.5 text-left">Brand / Collection</th>
                  <th className="px-4 py-2.5 text-left">Fabric</th>
                  <th className="px-4 py-2.5 text-right">Rate</th>
                  <th className="px-4 py-2.5 text-right">Pcs / Set</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E5EA]">
                {filteredProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-[#F4F5F7]/60">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setMediaProduct(p)
                          setShowMediaDialog(true)
                        }}
                        title="Manage Media"
                        className="block w-10 h-10 rounded-[6px] overflow-hidden border border-[#E3E5EA] bg-[#F4F5F7] flex items-center justify-center cursor-pointer"
                      >
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt={`Design ${p.design_no}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-[#667085]" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-semibold text-[#1A1D24]">{p.design_no}</div>
                      <a
                        href={`/${activeSlug}/p/${encodeURIComponent(p.design_no)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[#1E2A4A] hover:underline inline-flex items-center gap-1"
                      >
                        <span>Public page</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#1A1D24]">{p.brand || '—'}</div>
                      {p.collection_name && (
                        <div className="text-xs text-[#667085]">{p.collection_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#667085]">{p.fabric || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#1A1D24] tabular-nums whitespace-nowrap">
                      {p.rate ? formatCurrency(p.rate) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-[#1A1D24] tabular-nums whitespace-nowrap">
                      {p.pcs_per_set || 1}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(p)}
                        title="Toggle active status"
                        className="inline-flex rounded-[6px] cursor-pointer"
                      >
                        <StatusBadge status={p.is_active !== false ? 'active' : 'archived'} />
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="QR Code & Label"
                          onClick={() => handleOpenQrModal(p)}
                          className="h-8 w-8 p-0 text-[#1E2A4A]"
                        >
                          <QrCode className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Media Gallery"
                          onClick={() => {
                            setMediaProduct(p)
                            setShowMediaDialog(true)
                          }}
                          className="h-8 w-8 p-0 text-[#667085] hover:text-[#1A1D24]"
                        >
                          <ImageIcon className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Edit Product"
                          onClick={() => openEditForm(p)}
                          className="h-8 w-8 p-0 text-[#667085] hover:text-[#1A1D24]"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete Product"
                          onClick={() => setDeleteConfirm(p.id)}
                          className="h-8 w-8 p-0 text-[#B42318]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Product Right-Side Drawer */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="fixed left-auto right-0 top-0 bottom-0 translate-x-0 translate-y-0 w-full max-w-[500px] h-full max-h-none rounded-none border-y-0 border-r-0 border-l border-[#E3E5EA] p-0 flex flex-col gap-0">
          <DialogHeader className="px-5 py-4 border-b border-[#E3E5EA] shrink-0">
            <DialogTitle>
              {editingProduct ? `Edit Product — ${editingProduct.design_no}` : 'Add Product'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveProduct} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {formError && (
                <p className="text-xs font-medium text-[#B42318] bg-white p-3 rounded-[6px] border border-[#B42318]">
                  {formError}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="prod-design-no">Design Number *</Label>
                  <Input
                    id="prod-design-no"
                    value={formDesignNo}
                    onChange={(e) => setFormDesignNo(e.target.value.toUpperCase())}
                    placeholder="e.g. 4955"
                    required
                    className="font-semibold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prod-rate">Wholesale Rate (₹/pc)</Label>
                  <Input
                    id="prod-rate"
                    type="number"
                    step="0.01"
                    value={formRate}
                    onChange={(e) => setFormRate(e.target.value)}
                    placeholder="e.g. 850"
                    className="tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="prod-brand">Brand</Label>
                  <Input
                    id="prod-brand"
                    value={formBrand}
                    onChange={(e) => setFormBrand(e.target.value)}
                    placeholder="e.g. Kala"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prod-collection">Collection</Label>
                  <Input
                    id="prod-collection"
                    value={formCollection}
                    onChange={(e) => setFormCollection(e.target.value)}
                    placeholder="e.g. Silk Edition"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prod-fabric">Fabric</Label>
                  <Input
                    id="prod-fabric"
                    value={formFabric}
                    onChange={(e) => setFormFabric(e.target.value)}
                    placeholder="e.g. Pure Cotton"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="prod-pcs-per-set">Pieces Per Set</Label>
                  <Input
                    id="prod-pcs-per-set"
                    type="number"
                    min="1"
                    value={formPcsPerSet}
                    onChange={(e) => setFormPcsPerSet(e.target.value)}
                    placeholder="1"
                    className="tabular-nums"
                  />
                </div>
                <div className="flex items-center gap-2 sm:pt-6">
                  <input
                    type="checkbox"
                    id="prod-is-active"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    className="w-4 h-4 rounded border-[#E3E5EA] accent-[#1E2A4A]"
                  />
                  <Label htmlFor="prod-is-active" className="cursor-pointer text-sm font-medium text-[#1A1D24]">
                    Active in public catalog
                  </Label>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prod-description">Description</Label>
                <textarea
                  id="prod-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Product specifications, embroidery details, wash care..."
                  rows={3}
                  className="w-full text-sm rounded-[6px] border border-[#E3E5EA] bg-white p-2.5 text-[#1A1D24] placeholder:text-[#667085]"
                />
              </div>

              {/* Media Upload */}
              <div className="space-y-2.5 border-t border-[#E3E5EA] pt-4">
                <div className="flex justify-between items-center">
                  <Label className="text-[#1A1D24] font-medium">Photos &amp; Videos</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Files</span>
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
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {stagedFiles.map((sf) => (
                      <div
                        key={sf.id}
                        className={`relative rounded-[6px] overflow-hidden border aspect-square bg-[#F4F5F7] ${
                          sf.isPrimary ? 'border-[#1E2A4A] border-2' : 'border-[#E3E5EA]'
                        }`}
                      >
                        {sf.type === 'video' ? (
                          <video src={sf.preview} className="w-full h-full object-cover" />
                        ) : (
                          <img src={sf.preview} alt="" className="w-full h-full object-cover" />
                        )}

                        <div className="absolute inset-x-0 bottom-0 bg-[#1A1D24]/70 p-1 flex items-center justify-between gap-1">
                          {sf.type === 'image' && (
                            <button
                              type="button"
                              title="Set primary photo"
                              onClick={() => setPrimaryStaged(sf.id)}
                              className="p-1 rounded bg-white text-[#1A1D24]"
                            >
                              <Star className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Remove file"
                            onClick={() => removeStagedFile(sf.id)}
                            className="p-1 rounded bg-[#B42318] text-white ml-auto"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        {sf.isPrimary && (
                          <div className="absolute top-1 left-1 bg-[#1E2A4A] text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px]">
                            Primary
                          </div>
                        )}
                        {sf.type === 'video' && (
                          <div className="absolute top-1 right-1 bg-[#1A1D24]/80 text-white p-0.5 rounded-[4px]">
                            <Film className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[#E3E5EA] bg-white flex justify-end gap-2 shrink-0">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={formSaving}>
                {formSaving ? 'Saving...' : editingProduct ? 'Save Changes' : 'Create Product'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* QR Code & Label Modal */}
      <Dialog open={previewQrProduct !== null} onOpenChange={() => setPreviewQrProduct(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>QR Label — Design {previewQrProduct?.design_no}</DialogTitle>
          </DialogHeader>

          {previewQrProduct && previewQrDataUrl && (
            <div className="space-y-4 py-2 text-center">
              <div className="p-4 bg-white border border-[#E3E5EA] rounded-[6px] inline-block mx-auto">
                <img
                  src={previewQrDataUrl}
                  alt={`QR for ${previewQrProduct.design_no}`}
                  className="w-48 h-48 mx-auto"
                />
                <p className="text-xs font-mono text-[#667085] mt-2">
                  /{activeSlug}/p/{previewQrProduct.design_no}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => downloadQRCode(previewQrDataUrl, `QR_${previewQrProduct.design_no}`)}
                >
                  <Download className="w-4 h-4" />
                  <span>Download PNG</span>
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => handlePrintLabel(previewQrProduct, previewQrDataUrl)}
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Label</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Media Manager */}
      <MediaManager
        product={mediaProduct}
        open={showMediaDialog}
        onOpenChange={(open) => {
          setShowMediaDialog(open)
          if (!open) loadProducts()
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the product design and its uploaded media.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)}
              className="bg-[#B42318] hover:bg-[#911C13] text-white"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
