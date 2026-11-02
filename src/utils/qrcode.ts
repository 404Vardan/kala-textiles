import QRCode from 'qrcode'

export async function generateQRCode(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      width: 300,
      margin: 1,
    })
  } catch (error) {
    console.error('Error generating QR code:', error)
    throw error
  }
}

export function downloadQRCode(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export async function generateQRCodeForProduct(designNo: string, publishedDomain: string): Promise<string> {
  const qrUrl = `${publishedDomain}/p/${designNo}`
  return generateQRCode(qrUrl)
}

export async function generateQRCodeForInvoice(invoiceNo: string, publishedDomain: string): Promise<string> {
  const qrUrl = `${publishedDomain}/invoice/${invoiceNo}`
  return generateQRCode(qrUrl)
}
