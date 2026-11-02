import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { fetchProduct, fetchProductMedia } from '@/services/products'
import type { Product, ProductMedia } from '@/types'
import { formatCurrency } from '@/utils/formatters'
import { Camera, X } from 'lucide-react'

export default function ShopScanTab() {
  const navigate = useNavigate()
  const [isScanning, setIsScanning] = useState(false)
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null)
  const [scannedMedia, setScannedMedia] = useState<ProductMedia[]>([])
  const [error, setError] = useState('')
  const scannerRef = useRef<any>(null)

  useEffect(() => {
    if (!isScanning) return

    let scanner: any = null
    const initScanner = async () => {
      const { Html5Qrcode } = await import('html5-qrcode')
      scanner = new Html5Qrcode('shop-qr-reader')
      scannerRef.current = scanner

      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText: string) => {
            const match = decodedText.match(/\/p\/([^/?#]+)/)
            if (match) {
              try {
                scanner.pause()
                const product = await fetchProduct(match[1])
                setScannedProduct(product)
                const media = await fetchProductMedia(product.id)
                setScannedMedia(media)
                setError('')
              } catch {
                setError(`Product "${match[1]}" not found`)
              }
              // Resume for next scan after a delay
              setTimeout(() => {
                if (scanner?.isScanning) scanner.resume()
              }, 2000)
            }
          },
          () => {}
        )
      } catch (err) {
        console.error('QR Scanner error:', err)
        setError('Camera access denied or not available')
      }
    }

    initScanner()
    return () => {
      if (scanner?.isScanning) {
        scanner.stop().catch(() => {})
      }
    }
  }, [isScanning])

  const handleClose = () => {
    if (scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(() => {})
    }
    setIsScanning(false)
    setScannedProduct(null)
    setScannedMedia([])
    setError('')
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Shop Floor Scanner</h2>
        <p className="text-gray-500 text-sm mb-6">Scan product QR codes to view details</p>

        {!isScanning ? (
          <Button
            onClick={() => setIsScanning(true)}
            className="bg-orange-600 hover:bg-orange-700 h-16 px-8 text-lg"
          >
            <Camera className="w-6 h-6 mr-2" />
            Start Scanning
          </Button>
        ) : (
          <div className="max-w-md mx-auto space-y-4">
            <div className="relative">
              <div id="shop-qr-reader" className="w-full rounded-lg overflow-hidden" />
              <button
                onClick={handleClose}
                className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            {scannedProduct && (
              <div className="bg-white border rounded-xl p-4 shadow-sm text-left space-y-3 animate-in fade-in">
                {scannedMedia.length > 0 && (
                  <img
                    src={scannedMedia[0].media_url}
                    alt={scannedProduct.design_no}
                    className="w-full h-48 object-cover rounded-lg"
                  />
                )}
                <div className="space-y-1">
                  <h3 className="text-xl font-bold">{scannedProduct.design_no}</h3>
                  <div className="flex flex-wrap gap-2 text-sm text-gray-600">
                    {scannedProduct.brand && <span className="bg-gray-100 px-2 py-0.5 rounded">{scannedProduct.brand}</span>}
                    {scannedProduct.collection_name && <span className="bg-gray-100 px-2 py-0.5 rounded">{scannedProduct.collection_name}</span>}
                    {scannedProduct.fabric && <span className="bg-gray-100 px-2 py-0.5 rounded">{scannedProduct.fabric}</span>}
                  </div>
                  {scannedProduct.rate && (
                    <p className="text-2xl font-bold text-orange-600">{formatCurrency(scannedProduct.rate)}/pc</p>
                  )}
                  {scannedProduct.pcs_per_set && (
                    <p className="text-sm text-gray-500">{scannedProduct.pcs_per_set} pcs per set</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate(`/p/${scannedProduct.design_no}`)}
                >
                  View Full Details
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
