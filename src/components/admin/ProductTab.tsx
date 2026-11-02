import { useState, useEffect } from 'react'
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
import { fetchProducts, deleteProduct, searchProducts, createProduct, updateProduct } from '@/services/products'
import { fetchProductMedia, createProductMedia } from '@/services/products'
import { uploadProductMedia, deleteMediaFile, getPathFromUrl } from '@/services/storage'
import MediaManager from '@/components/admin/MediaManager'
import type { Product } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import { generateQRCodeForProduct } from '@/utils/qrcode'
import { Trash2, Edit2, Printer, Download, Plus, Image, Upload } from 'lucide-react'

export default function ProductTab() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [showMediaDialog, setShowMediaDialog] = useState(false)
  const [mediaProduct, setMediaProduct] = useState<Product | null>(null)

  // Form fields
  const [formDesignNo, setFormDesignNo] = useState('')
  const [formBrand, setFormBrand] = useState('')
  const [formCollection, setFormCollection] = useState('')
  const [formFabric, setFormFabric] = useState('')
  const [formRate, setFormRate] = useState('')
  const [formPcsPerSet, setFormPcsPerSet] = useState('1')
  const [formDescription, setFormDescription] = useState('')
  const [formSaving, setFormSaving] = useState(false)
  const [formImage, setFormImage] = useState<File | null>(null)
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null)

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const data = await fetchProducts()
      setProducts(data)
    } catch (error) {
      console.error('Error loading products:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (query.trim()) {
      try {
        const data = await searchProducts(query)
        setProducts(data)
      } catch (error) {
        console.error('Error searching products:', error)
      }
    } else {
      loadProducts()
    }
  }

  const handleDelete = async (id: number) => {
    try {
      // Delete associated media files from storage first
      const productMedia = await fetchProductMedia(id)
      for (const m of productMedia) {
        const path = getPathFromUrl(m.media_url)
        await deleteMediaFile(path).catch(() => {})
      }
      await deleteProduct(id)
      setProducts(products.filter(p => p.id !== id))
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Error deleting product:', error)
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
    setFormImage(null)
    setFormImagePreview(null)
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
    setFormImage(null)
    setFormImagePreview(product.image_url || null)
    setShowForm(true)
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormSaving(true)

    try {
      // Save product data directly — no QR generation (QR is generated on-demand when printing labels)
      const productData: Record<string, any> = {
        design_no: formDesignNo.trim(),
        brand: formBrand.trim() || null,
        collection_name: formCollection.trim() || null,
        fabric: formFabric.trim() || null,
        rate: formRate ? parseFloat(formRate) : null,
        pcs_per_set: parseInt(formPcsPerSet) || 1,
        description: formDescription.trim() || null,
      }

      let savedProduct: any

      if (editingProduct) {
        savedProduct = editingProduct
        await updateProduct(editingProduct.id, productData)
      } else {
        savedProduct = await createProduct(productData as any)
      }

      // Close form immediately so user sees instant feedback
      setShowForm(false)

      // Upload image in background (non-blocking UI)
      if (formImage && savedProduct?.id) {
        try {
          const mediaUrl = await uploadProductMedia(savedProduct.id, formImage)
          await createProductMedia(savedProduct.id, mediaUrl, 'image', 0)
          await updateProduct(savedProduct.id, { image_url: mediaUrl })
        } catch (imgErr) {
          console.error('Image upload failed:', imgErr)
        }
      }

      setFormImage(null)
      setFormImagePreview(null)
      await loadProducts()
    } catch (error: any) {
      console.error('Error saving product:', error)
      alert(`Error saving product: ${error?.message || 'Unknown error'}`)
    } finally {
      setFormSaving(false)
    }
  }

  const openMediaManager = (product: Product) => {
    setMediaProduct(product)
    setShowMediaDialog(true)
  }



  const handlePrintLabel = async (product: Product) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    let qrUrl = product.qr_code_url || ''
    if (!qrUrl) {
      const domain = import.meta.env.VITE_PUBLISHED_DOMAIN || window.location.origin
      try {
        qrUrl = await generateQRCodeForProduct(product.design_no, domain)
      } catch (err) {
        console.error('QR generation failed:', err)
      }
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Label - ${product.design_no}</title>
        <style>
          @page { size: 4in 6in; margin: 0; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { width: 4in; height: 6in; font-family: Arial, sans-serif; display: flex; }
          .sidebar {
            writing-mode: vertical-rl;
            text-orientation: mixed;
            background: #1a1a1a;
            color: white;
            padding: 8px 4px;
            font-size: 14px;
            font-weight: bold;
            letter-spacing: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 0.6in;
          }
          .content {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 16px;
            gap: 12px;
          }
          .qr img { width: 2in; height: 2in; }
          .design-no { font-size: 28px; font-weight: bold; }
          .rate { font-size: 22px; color: #333; }
        </style>
      </head>
      <body>
        <div class="sidebar">RANGOLI TEXTILES</div>
        <div class="content">
          <div class="qr"><img src="${qrUrl}" /></div>
          <div class="design-no">D.No: ${product.design_no}</div>
          <div class="rate">Rate: ₹${product.rate || 0}/pc</div>
        </div>
      </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.print()
  }

  const handleDownloadQR = async (product: Product) => {
    try {
      let qrUrl = product.qr_code_url
      if (!qrUrl) {
        const domain = import.meta.env.VITE_PUBLISHED_DOMAIN || window.location.origin
        qrUrl = await generateQRCodeForProduct(product.design_no, domain)
      }

      if (qrUrl) {
        const link = document.createElement('a')
        link.href = qrUrl
        link.download = `QR_${product.design_no}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    } catch (err) {
      console.error('Error downloading QR:', err)
      alert('Failed to download QR code')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10">Loading products...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <Input
          placeholder="Search by design no, brand, or collection..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1"
        />
        <Button onClick={openCreateForm} className="bg-orange-600 hover:bg-orange-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Product
        </Button>
      </div>

      <div className="border rounded-lg overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Design No</th>
              <th className="px-4 py-3 text-left font-medium">Brand</th>
              <th className="px-4 py-3 text-left font-medium">Collection</th>
              <th className="px-4 py-3 text-left font-medium">Rate</th>
              <th className="px-4 py-3 text-left font-medium">Pcs/Set</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No products found
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr key={product.id} className="hover:bg-orange-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {product.image_url && (
                        <img src={product.image_url} alt="" className="w-8 h-8 rounded object-cover" />
                      )}
                      <span className="font-medium">{product.design_no}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">{product.brand || '-'}</td>
                  <td className="px-4 py-3">{product.collection_name || '-'}</td>
                  <td className="px-4 py-3">{formatCurrency(product.rate || 0)}</td>
                  <td className="px-4 py-3">{product.pcs_per_set || 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditForm(product)} title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openMediaManager(product)} title="Media">
                        <Image className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handlePrintLabel(product)} title="Print Label">
                        <Printer className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDownloadQR(product)} title="Download QR">
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(product.id)} title="Delete">
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

      {/* Create/Edit Product Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Edit Product' : 'Add Product'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveProduct} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label>Design No *</Label>
                <Input
                  value={formDesignNo}
                  onChange={(e) => setFormDesignNo(e.target.value)}
                  placeholder="e.g. RT-2024-001"
                  disabled={!!editingProduct}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Brand</Label>
                <Input value={formBrand} onChange={(e) => setFormBrand(e.target.value)} placeholder="Brand" />
              </div>
              <div className="space-y-1">
                <Label>Collection</Label>
                <Input value={formCollection} onChange={(e) => setFormCollection(e.target.value)} placeholder="Collection" />
              </div>
              <div className="space-y-1">
                <Label>Fabric</Label>
                <Input value={formFabric} onChange={(e) => setFormFabric(e.target.value)} placeholder="Fabric type" />
              </div>
              <div className="space-y-1">
                <Label>Rate (per piece)</Label>
                <Input type="number" value={formRate} onChange={(e) => setFormRate(e.target.value)} placeholder="₹" min="0" step="0.01" />
              </div>
              <div className="space-y-1">
                <Label>Pcs per Set</Label>
                <Input type="number" value={formPcsPerSet} onChange={(e) => setFormPcsPerSet(e.target.value)} min="1" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Description</Label>
                <Input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Description" />
              </div>

              {/* Image Upload */}
              <div className="space-y-2 col-span-2">
                <Label>Product Image</Label>
                <div
                  onClick={() => document.getElementById('product-image-input')?.click()}
                  className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-orange-300 hover:bg-orange-50/50 transition-colors"
                >
                  {formImagePreview ? (
                    <div className="relative">
                      <img src={formImagePreview} alt="Preview" className="w-full h-32 object-contain rounded" />
                      <p className="text-xs text-gray-400 mt-1">{formImage ? formImage.name : 'Current image'} — click to change</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-gray-400">
                      <Upload className="w-6 h-6" />
                      <p className="text-sm">Click to upload an image</p>
                    </div>
                  )}
                  <input
                    id="product-image-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        setFormImage(file)
                        setFormImagePreview(URL.createObjectURL(file))
                      }
                    }}
                  />
                </div>
              </div>
            </div>
            <Button type="submit" className="w-full bg-orange-600 hover:bg-orange-700" disabled={formSaving || !formDesignNo.trim()}>
              {formSaving ? 'Saving...' : editingProduct ? 'Update Product' : 'Create Product'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Media Manager (enhanced) */}
      <MediaManager
        product={mediaProduct}
        open={showMediaDialog}
        onOpenChange={setShowMediaDialog}
      />

      {/* Delete Confirm */}
      <AlertDialog open={deleteConfirm !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? This will delete the product and all associated media files.
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
