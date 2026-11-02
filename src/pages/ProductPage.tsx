import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchPublicProduct } from '@/services/products'
import { createPublicInquiry } from '@/services/inquiries'
import type { PublicProduct } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import { ChevronLeft, ChevronRight, Send, ArrowLeft, Package } from 'lucide-react'

export default function ProductPage() {
  const { designNo, slug = 'rangoli' } = useParams<{ designNo: string; slug?: string }>()
  const [product, setProduct] = useState<PublicProduct | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentSlide, setCurrentSlide] = useState(0)

  // Inquiry form
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!designNo) return
    loadProduct()
  }, [designNo, slug])

  const loadProduct = async () => {
    try {
      setLoading(true)
      const prod = await fetchPublicProduct(slug, designNo!)
      setProduct(prod)
    } catch {
      setError('Product not found')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitInquiry = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      await createPublicInquiry({
        slug,
        customerName: name,
        phone,
        designNo,
        message: message || undefined,
      })
      setSubmitted(true)
      setName('')
      setPhone('')
      setMessage('')
    } catch {
      console.error('Error submitting inquiry')
    } finally {
      setSubmitting(false)
    }
  }

  const media = product?.media || []


  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % media.length)
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + media.length) % media.length)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Package className="w-16 h-16 text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-600">Product Not Found</h1>
        <p className="text-gray-400">Design "{designNo}" could not be found</p>
        <Link to="/" className="text-orange-600 hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-bold text-lg bg-gradient-to-r from-orange-600 to-rose-600 bg-clip-text text-transparent">
            Rangoli Textiles
          </h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        {/* Media Carousel */}
        {media.length > 0 && (
          <div className="relative rounded-2xl overflow-hidden shadow-lg bg-gray-100">
            <div className="aspect-[4/3] relative">
              {media[currentSlide].media_type === 'video' ? (
                <video
                  key={currentSlide}
                  src={media[currentSlide].media_url}
                  className="w-full h-full object-contain bg-black"
                  controls
                  autoPlay
                  muted
                />
              ) : (
                <img
                  key={currentSlide}
                  src={media[currentSlide].media_url}
                  alt={product.design_no}
                  className="w-full h-full object-contain"
                />
              )}
            </div>

            {media.length > 1 && (
              <>
                <button
                  onClick={prevSlide}
                  className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={nextSlide}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {media.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentSlide(i)}
                      className={`w-2 h-2 rounded-full transition-colors ${i === currentSlide ? 'bg-white' : 'bg-white/50'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Thumbnail strip */}
        {media.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {media.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setCurrentSlide(i)}
                className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                  i === currentSlide ? 'border-orange-500' : 'border-transparent'
                }`}
              >
                {m.media_type === 'video' ? (
                  <video src={m.media_url} className="w-full h-full object-cover" />
                ) : (
                  <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Product Details */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 space-y-4">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">{product.design_no}</h2>
            <div className="flex flex-wrap gap-2 mt-2">
              {product.brand && (
                <span className="bg-orange-50 text-orange-700 px-3 py-1 rounded-full text-sm font-medium">{product.brand}</span>
              )}
              {product.collection_name && (
                <span className="bg-rose-50 text-rose-700 px-3 py-1 rounded-full text-sm font-medium">{product.collection_name}</span>
              )}
              {product.fabric && (
                <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full text-sm font-medium">{product.fabric}</span>
              )}
            </div>
          </div>

          {product.rate && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-orange-600">{formatCurrency(product.rate)}</span>
              <span className="text-gray-400">/piece</span>
            </div>
          )}

          {product.pcs_per_set && product.pcs_per_set > 1 && (
            <p className="text-sm text-gray-500">
              {product.pcs_per_set} pieces per set
              {product.rate && ` • ${formatCurrency(product.rate * product.pcs_per_set)}/set`}
            </p>
          )}

          {product.description && (
            <p className="text-gray-600 leading-relaxed">{product.description}</p>
          )}
        </div>

        {/* Inquiry Form */}
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4">Interested? Send an Inquiry</h3>

          {submitted ? (
            <div className="text-center py-6 space-y-2">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Send className="w-6 h-6 text-green-600" />
              </div>
              <p className="font-medium text-green-700">Inquiry Sent!</p>
              <p className="text-sm text-gray-500">We'll get back to you soon.</p>
              <Button variant="outline" size="sm" onClick={() => setSubmitted(false)}>
                Send Another
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmitInquiry} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Your Name *</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
                </div>
                <div className="space-y-1">
                  <Label>Phone Number *</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91..." required />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Message (optional)</Label>
                <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Any specific requirements..." />
              </div>
              <Button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700"
                disabled={submitting || !name.trim() || !phone.trim()}
              >
                {submitting ? 'Sending...' : 'Send Inquiry'}
              </Button>
            </form>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-sm text-gray-400">
        © Rangoli Textiles
      </footer>
    </div>
  )
}
