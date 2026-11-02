import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetchProductMedia, createProductMedia, deleteProductMedia, updateMediaOrderBatch } from '@/services/products'
import { uploadProductMedia, deleteMediaFile, getPathFromUrl } from '@/services/storage'
import { updateProduct } from '@/services/products'
import type { Product, ProductMedia } from '@/types'
import { Upload, X, Trash2, GripVertical, ImagePlus, Film, Check } from 'lucide-react'

interface MediaManagerProps {
  product: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface UploadingFile {
  id: string
  file: File
  preview: string
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

export default function MediaManager({ product, open, onOpenChange }: MediaManagerProps) {
  const [media, setMedia] = useState<ProductMedia[]>([])
  const [uploading, setUploading] = useState<UploadingFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && product) {
      loadMedia()
    }
    return () => {
      // Cleanup preview URLs
      uploading.forEach(u => URL.revokeObjectURL(u.preview))
    }
  }, [open, product])

  const loadMedia = async () => {
    if (!product) return
    setLoading(true)
    try {
      const list = await fetchProductMedia(product.id)
      setMedia(list)
    } catch {
      setMedia([])
    } finally {
      setLoading(false)
    }
  }

  const processFiles = useCallback(async (files: File[]) => {
    if (!product) return

    // Filter valid files
    const validFiles = files.filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/')
    )

    if (validFiles.length === 0) return

    // Create upload items with previews
    const newUploads: UploadingFile[] = validFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      preview: URL.createObjectURL(file),
      progress: 0,
      status: 'pending' as const,
    }))

    setUploading(prev => [...prev, ...newUploads])

    // Upload sequentially
    for (const upload of newUploads) {
      try {
        // Update status to uploading
        setUploading(prev => prev.map(u =>
          u.id === upload.id ? { ...u, status: 'uploading' as const, progress: 30 } : u
        ))

        const mediaUrl = await uploadProductMedia(product.id, upload.file)

        setUploading(prev => prev.map(u =>
          u.id === upload.id ? { ...u, progress: 70 } : u
        ))

        const mediaType = upload.file.type.startsWith('video/') ? 'video' : 'image'
        await createProductMedia(product.id, mediaUrl, mediaType as 'image' | 'video', media.length + newUploads.indexOf(upload))

        setUploading(prev => prev.map(u =>
          u.id === upload.id ? { ...u, status: 'done' as const, progress: 100 } : u
        ))
      } catch (err: any) {
        setUploading(prev => prev.map(u =>
          u.id === upload.id ? { ...u, status: 'error' as const, error: err.message || 'Upload failed' } : u
        ))
      }
    }

    // After all uploads complete, refresh media list and clear uploads
    setTimeout(async () => {
      await loadMedia()
      setUploading(prev => prev.filter(u => u.status === 'error'))

      // Set first image as product image_url if product has none
      if (!product.image_url) {
        const updatedMedia = await fetchProductMedia(product.id)
        if (updatedMedia.length > 0) {
          await updateProduct(product.id, { image_url: updatedMedia[0].media_url })
        }
      }
    }, 500)
  }, [product, media.length])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    processFiles(files)
  }, [processFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files))
      e.target.value = ''
    }
  }

  const handleDeleteMedia = async (item: ProductMedia) => {
    try {
      const path = getPathFromUrl(item.media_url)
      await deleteMediaFile(path).catch(() => {})
      await deleteProductMedia(item.id)
      setMedia(prev => prev.filter(m => m.id !== item.id))
    } catch (error) {
      console.error('Error deleting media:', error)
    }
  }

  const handleClearError = (id: string) => {
    setUploading(prev => prev.filter(u => u.id !== id))
  }

  // Drag-to-reorder handlers
  const handleReorderDragStart = (index: number) => {
    setDragStartIndex(index)
  }

  const handleReorderDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleReorderDrop = async (targetIndex: number) => {
    if (dragStartIndex === null || dragStartIndex === targetIndex) {
      setDragStartIndex(null)
      setDragOverIndex(null)
      return
    }

    const reordered = [...media]
    const [moved] = reordered.splice(dragStartIndex, 1)
    reordered.splice(targetIndex, 0, moved)

    setMedia(reordered)
    setDragStartIndex(null)
    setDragOverIndex(null)

    // Save new order to DB
    try {
      const updates = reordered.map((m, i) => ({ id: m.id, sort_order: i }))
      await updateMediaOrderBatch(updates)

      // Update product thumbnail to first image
      if (reordered.length > 0 && product) {
        await updateProduct(product.id, { image_url: reordered[0].media_url })
      }
    } catch (error) {
      console.error('Error saving order:', error)
      await loadMedia() // Revert on error
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1048576).toFixed(1)} MB`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="w-5 h-5 text-orange-600" />
            Media — {product?.design_no}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
              transition-all duration-200 ease-out
              ${isDragging
                ? 'border-orange-500 bg-orange-50 scale-[1.02]'
                : 'border-gray-200 hover:border-orange-300 hover:bg-orange-50/50'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2">
              <div className={`
                w-14 h-14 rounded-full flex items-center justify-center transition-colors
                ${isDragging ? 'bg-orange-200' : 'bg-gray-100'}
              `}>
                <Upload className={`w-6 h-6 ${isDragging ? 'text-orange-600' : 'text-gray-400'}`} />
              </div>
              <div>
                <p className="font-medium text-gray-700">
                  {isDragging ? 'Drop files here' : 'Drag & drop images or videos'}
                </p>
                <p className="text-sm text-gray-400 mt-0.5">
                  or click to browse • JPG, PNG, WEBP, MP4
                </p>
              </div>
            </div>
          </div>

          {/* Upload Progress */}
          {uploading.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Uploading</p>
              {uploading.map(upload => (
                <div key={upload.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-2">
                  {/* Preview */}
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-200 shrink-0">
                    {upload.file.type.startsWith('video/') ? (
                      <div className="w-full h-full flex items-center justify-center bg-gray-800">
                        <Film className="w-5 h-5 text-white" />
                      </div>
                    ) : (
                      <img src={upload.preview} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>

                  {/* Info & Progress */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{upload.file.name}</p>
                    <p className="text-xs text-gray-400">{formatFileSize(upload.file.size)}</p>
                    {upload.status === 'uploading' && (
                      <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-500 rounded-full transition-all duration-500"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                    )}
                    {upload.status === 'error' && (
                      <p className="text-xs text-red-500 mt-0.5">{upload.error}</p>
                    )}
                  </div>

                  {/* Status Icon */}
                  <div className="shrink-0">
                    {upload.status === 'done' && (
                      <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-green-600" />
                      </div>
                    )}
                    {upload.status === 'uploading' && (
                      <div className="w-6 h-6 border-2 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
                    )}
                    {upload.status === 'error' && (
                      <button onClick={() => handleClearError(upload.id)} className="text-gray-400 hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Media Grid */}
          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading media...</div>
          ) : media.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                <ImagePlus className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-gray-400 text-sm">No media uploaded yet</p>
              <p className="text-gray-300 text-xs">Drop files above or click to browse</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {media.length} file{media.length !== 1 ? 's' : ''} • Drag to reorder
                </p>
                <p className="text-xs text-gray-400">First image = thumbnail</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {media.map((m, index) => (
                  <div
                    key={m.id}
                    draggable
                    onDragStart={() => handleReorderDragStart(index)}
                    onDragOver={(e) => handleReorderDragOver(e, index)}
                    onDrop={() => handleReorderDrop(index)}
                    onDragEnd={() => { setDragStartIndex(null); setDragOverIndex(null) }}
                    className={`
                      relative group rounded-xl overflow-hidden border-2 transition-all duration-200 cursor-grab active:cursor-grabbing
                      ${dragOverIndex === index ? 'border-orange-500 scale-105' : 'border-transparent'}
                      ${dragStartIndex === index ? 'opacity-50 scale-95' : 'opacity-100'}
                      ${index === 0 ? 'ring-2 ring-orange-300 ring-offset-2' : ''}
                    `}
                  >
                    {/* Media Content */}
                    <div className="aspect-square bg-gray-100">
                      {m.media_type === 'video' ? (
                        <video src={m.media_url} className="w-full h-full object-cover" />
                      ) : (
                        <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>

                    {/* Overlay Controls */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Top bar */}
                      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-2">
                        <div className="flex items-center gap-1 text-white/80">
                          <GripVertical className="w-4 h-4" />
                          <span className="text-xs font-medium">{index + 1}</span>
                        </div>
                        {m.media_type === 'video' && (
                          <span className="bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">
                            <Film className="w-3 h-3 inline mr-0.5" />VID
                          </span>
                        )}
                      </div>

                      {/* Bottom bar */}
                      <div className="absolute bottom-0 left-0 right-0 p-2 flex justify-between items-center">
                        {index === 0 && (
                          <span className="bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                            Thumbnail
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteMedia(m) }}
                          className="ml-auto bg-red-500/80 hover:bg-red-600 text-white rounded-full p-1.5 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
