import QRCode from 'qrcode'
import type { Product } from '@/types'

export function getPermanentProductUrl(designNo: string, customDomain?: string): string {
  const domain = (
    customDomain ||
    import.meta.env.VITE_PUBLISHED_DOMAIN ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://rangolitextiles.in')
  ).replace(/\/$/, '')

  return `${domain}/p/${encodeURIComponent(designNo.trim())}`
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

export async function generateQRCodeForProduct(designNo: string, customDomain?: string): Promise<string> {
  const url = getPermanentProductUrl(designNo, customDomain)
  return generateQRCode(url)
}

export async function generateQRCodeForInvoice(invoiceNo: string, customDomain?: string): Promise<string> {
  const domain = (
    customDomain ||
    import.meta.env.VITE_PUBLISHED_DOMAIN ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://rangolitextiles.in')
  ).replace(/\/$/, '')
  return generateQRCode(`${domain}/invoice/${encodeURIComponent(invoiceNo)}`)
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
