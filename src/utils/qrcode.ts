import QRCode from 'qrcode'
import type { Product } from '@/types'

export interface ParsedProductQR {
  slug: string
  designNo: string
  isLegacy: boolean
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Shared product QR URL parser.
 * Parses:
 *  - https://domain.com/:slug/p/:designNo
 *  - https://domain.com/p/:designNo (legacy, defaults slug to defaultSlug)
 *  - /:slug/p/:designNo or /p/:designNo
 *  - Raw design number codes (e.g. "D-101")
 * Rejects /order/ and /invoice/ URLs or arbitrary non-product URLs by returning null.
 */
export function parseProductQRUrl(
  rawInput: string,
  defaultSlug: string = 'rangoli'
): ParsedProductQR | null {
  const trimmed = (rawInput || '').trim()
  if (!trimmed) return null

  const normalizedDefaultSlug = (defaultSlug || 'rangoli').trim().toLowerCase() || 'rangoli'

  // Explicitly reject order and invoice QR URLs in product scan flows
  if (/\/(order|invoice|order-request)(\/|$|\?|#)/i.test(trimmed)) {
    return null
  }

  let pathname = trimmed
  const isUrlLike = /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/') || trimmed.includes('/p/')

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const urlObj = new URL(trimmed)
      pathname = urlObj.pathname
    } catch {
      return null
    }
  } else if (trimmed.includes('/p/') && !trimmed.startsWith('/')) {
    // Handle domain without protocol e.g. rangolitextiles.in/rangoli/p/101
    const slashIdx = trimmed.indexOf('/')
    pathname = slashIdx >= 0 ? trimmed.slice(slashIdx) : trimmed
  }

  if (isUrlLike) {
    // Match /:slug/p/:designNo
    const tenantMatch = pathname.match(/^\/([^/]+)\/p\/([^/?#]+)\/?$/i)
    if (tenantMatch) {
      const slug = safeDecodeURIComponent(tenantMatch[1]).trim().toLowerCase()
      const designNo = safeDecodeURIComponent(tenantMatch[2]).trim()
      if (!slug || !designNo) return null
      return {
        slug,
        designNo,
        isLegacy: false,
      }
    }

    // Match legacy /p/:designNo
    const legacyMatch = pathname.match(/^\/p\/([^/?#]+)\/?$/i)
    if (legacyMatch) {
      const designNo = safeDecodeURIComponent(legacyMatch[1]).trim()
      if (!designNo) return null
      return {
        slug: normalizedDefaultSlug,
        designNo,
        isLegacy: true,
      }
    }

    // Any other URL path is not a valid product QR
    return null
  }

  // Raw design number fallback (for plain text QR/barcodes without URL structure)
  if (trimmed.includes('/') || trimmed.includes(' ')) {
    // Allow spaces inside design numbers only if reasonable length and not a sentence/URL
    if (trimmed.includes('://') || trimmed.length > 60) {
      return null
    }
  }

  const designNo = safeDecodeURIComponent(trimmed).trim()
  if (!designNo || designNo.length > 60) return null

  return {
    slug: normalizedDefaultSlug,
    designNo,
    isLegacy: true,
  }
}

export function getPermanentProductUrl(designNo: string, slug: string = 'rangoli', customDomain?: string): string {
  const domain = (
    customDomain ||
    import.meta.env.VITE_PUBLISHED_DOMAIN ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://rangolitextiles.in')
  ).replace(/\/$/, '')

  return `${domain}/${slug}/p/${encodeURIComponent(designNo.trim())}`
}

export async function generateQRCode(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 400,
      margin: 1,
      color: {
        dark: '#1e293b',
        light: '#ffffff',
      },
    })
  } catch (error) {
    console.error('Error generating QR code:', error)
    throw error
  }
}

export async function generateQRCodeForProduct(designNo: string, slug: string = 'rangoli', customDomain?: string): Promise<string> {
  const url = getPermanentProductUrl(designNo, slug, customDomain)
  return generateQRCode(url)
}

export async function generateQRCodeForInvoice(invoiceNo: string, slug: string = 'rangoli', customDomain?: string): Promise<string> {
  const domain = (
    customDomain ||
    import.meta.env.VITE_PUBLISHED_DOMAIN ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://rangolitextiles.in')
  ).replace(/\/$/, '')
  return generateQRCode(`${domain}/${slug}/invoice/${encodeURIComponent(invoiceNo)}`)
}


export function downloadQRCode(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function printProductLabel(product: Product, qrDataUrl: string) {
  const printWindow = window.open('', '_blank', 'width=600,height=700')
  if (!printWindow) {
    alert('Please allow popups to print labels.')
    return
  }

  const publicUrl = getPermanentProductUrl(product.design_no)

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Label - ${product.design_no}</title>
      <style>
        @page {
          size: 75mm 50mm;
          margin: 0;
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        body {
          width: 75mm;
          height: 50mm;
          padding: 3mm 4mm;
          background: #fff;
          color: #0f172a;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1.5px solid #0f172a;
          padding-bottom: 2mm;
        }
        .brand-title {
          font-size: 11pt;
          font-weight: 900;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .tagline {
          font-size: 6pt;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
        }
        .body {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 3mm;
          flex: 1;
          padding: 2mm 0;
        }
        .details {
          flex: 1;
        }
        .design-label {
          font-size: 7pt;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
        }
        .design-no {
          font-size: 16pt;
          font-weight: 900;
          color: #0f172a;
          line-height: 1.1;
          margin-bottom: 1.5mm;
        }
        .meta-row {
          font-size: 7.5pt;
          line-height: 1.3;
          color: #334155;
        }
        .meta-row strong {
          font-weight: 700;
          color: #0f172a;
        }
        .qr-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .qr-box img {
          width: 25mm;
          height: 25mm;
          display: block;
        }
        .qr-caption {
          font-size: 5pt;
          color: #64748b;
          margin-top: 1mm;
          text-align: center;
        }
        .footer {
          border-top: 1px dashed #cbd5e1;
          padding-top: 1.5mm;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 6.5pt;
          font-weight: 600;
          color: #475569;
        }
        .price {
          font-size: 10pt;
          font-weight: 900;
          color: #ea580c;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="brand-title">RANGOLI TEXTILES</div>
          <div class="tagline">Wholesale Fabrics</div>
        </div>
        <div style="font-size: 7pt; font-weight: 800; background: #0f172a; color: #fff; padding: 1mm 2mm; border-radius: 1mm;">
          ORIGINAL
        </div>
      </div>

      <div class="body">
        <div class="details">
          <div class="design-label">Design No</div>
          <div class="design-no">${product.design_no}</div>
          ${product.brand ? `<div class="meta-row"><strong>Brand:</strong> ${product.brand}</div>` : ''}
          ${product.collection_name ? `<div class="meta-row"><strong>Col:</strong> ${product.collection_name}</div>` : ''}
          ${product.fabric ? `<div class="meta-row"><strong>Fabric:</strong> ${product.fabric}</div>` : ''}
          ${product.pcs_per_set ? `<div class="meta-row"><strong>Set:</strong> ${product.pcs_per_set} Pcs</div>` : ''}
        </div>
        <div class="qr-box">
          <img src="${qrDataUrl}" alt="QR Code" />
          <div class="qr-caption">Scan for Catalog</div>
        </div>
      </div>

      <div class="footer">
        <div>${publicUrl.replace(/^https?:\/\//, '')}</div>
        ${product.rate ? `<div class="price">₹${product.rate}/pc</div>` : ''}
      </div>

      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `)
  printWindow.document.close()
}
