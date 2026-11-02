/**
 * Ultra-fast QR Scanner using native BarcodeDetector API
 * Falls back to html5-qrcode if BarcodeDetector is not available.
 *
 * BarcodeDetector is the same native API that UPI/Google Pay scanners use
 * on Android — it runs at GPU-level speed, much faster than JS-based decoders.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

interface QRScannerProps {
  /** HTML element id for the scanner container */
  elementId: string
  /** Called when a QR code is successfully decoded */
  onScan: (text: string) => void
  /** Whether the scanner should be active */
  active: boolean
  /** Minimum time (ms) between scan callbacks */
  cooldownMs?: number
}

// Check if the native BarcodeDetector API is available
function hasBarcodeDetector(): boolean {
  return 'BarcodeDetector' in window
}

export function useQRScanner({ elementId, onScan, active, cooldownMs = 800 }: QRScannerProps) {
  const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const lastScanRef = useRef(0)
  const cleanupRef = useRef<(() => void) | null>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const beep = useCallback(() => {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 1200
      gain.gain.value = 0.3
      osc.start()
      osc.stop(ctx.currentTime + 0.08)
    } catch {}
  }, [])

  const handleDecode = useCallback((text: string) => {
    const now = Date.now()
    if (now - lastScanRef.current < cooldownMs) return
    lastScanRef.current = now
    beep()
    onScanRef.current(text)
  }, [cooldownMs, beep])

  useEffect(() => {
    if (!active) {
      cleanupRef.current?.()
      cleanupRef.current = null
      setStatus('idle')
      return
    }

    setStatus('starting')
    setError(null)

    let cancelled = false

    const startScanner = async () => {
      const container = document.getElementById(elementId)
      if (!container || cancelled) return

      if (hasBarcodeDetector()) {
        // ===== NATIVE BarcodeDetector (GPU-accelerated, ultra-fast) =====
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'environment',
              width: { ideal: 640 },
              height: { ideal: 480 },
            }
          })

          if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

          const video = document.createElement('video')
          video.srcObject = stream
          video.setAttribute('playsinline', 'true')
          video.style.width = '100%'
          video.style.borderRadius = '12px'
          video.style.display = 'block'
          container.innerHTML = ''
          container.appendChild(video)

          await video.play()
          if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

          setStatus('scanning')

          // @ts-ignore - BarcodeDetector exists on supported browsers
          const detector = new BarcodeDetector({ formats: ['qr_code'] })

          // Scan at ~30fps using requestAnimationFrame for smoothest detection
          let rafId: number
          const scan = async () => {
            if (cancelled) return
            try {
              if (video.readyState === video.HAVE_ENOUGH_DATA) {
                const barcodes = await detector.detect(video)
                for (const barcode of barcodes) {
                  if (barcode.rawValue) {
                    handleDecode(barcode.rawValue)
                  }
                }
              }
            } catch {}
            rafId = requestAnimationFrame(scan)
          }
          rafId = requestAnimationFrame(scan)

          cleanupRef.current = () => {
            cancelled = true
            cancelAnimationFrame(rafId)
            stream.getTracks().forEach(t => t.stop())
            video.remove()
          }
        } catch (err: any) {
          console.warn('BarcodeDetector failed, falling back:', err)
          if (!cancelled) await startFallback(container)
        }
      } else {
        await startFallback(container)
      }
    }

    const startFallback = async (container: HTMLElement) => {
      // ===== Fallback: html5-qrcode (JS-based) =====
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled) return

        // Ensure container is empty and has the right id
        container.innerHTML = ''
        const scannerId = elementId + '-fallback'
        const scanDiv = document.createElement('div')
        scanDiv.id = scannerId
        container.appendChild(scanDiv)

        const scanner = new Html5Qrcode(scannerId)

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 20,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
            disableFlip: false,
          },
          (decodedText: string) => handleDecode(decodedText),
          () => {}
        )

        if (cancelled) { await scanner.stop().catch(() => {}); return }

        setStatus('scanning')

        cleanupRef.current = () => {
          cancelled = true
          if (scanner.isScanning) {
            scanner.stop().catch(() => {})
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setStatus('error')
          setError(err?.message || 'Camera access denied')
        }
      }
    }

    startScanner()

    return () => {
      cancelled = true
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [active, elementId, handleDecode])

  return { status, error }
}
