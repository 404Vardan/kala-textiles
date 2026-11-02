import { jsPDF } from 'jspdf'
import type { Order, OrderItem, Product } from '@/types'
import { formatDate } from '@/utils/formatters'

interface OrderPdfItem extends OrderItem {
  product?: Product | null
}

interface OrderPdfData {
  order: Order
  items: OrderPdfItem[]
}

// Convert image URL to Base64 data URL for embedding in jsPDF
async function getBase64ImageFromUrl(url: string): Promise<string | null> {
  try {
    return await new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'Anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        // Resize to modest thumbnail to keep PDF small
        const maxDim = 160
        let w = img.width
        let h = img.height
        if (w > h) {
          if (w > maxDim) {
            h = (h * maxDim) / w
            w = maxDim
          }
        } else {
          if (h > maxDim) {
            w = (w * maxDim) / h
            h = maxDim
          }
        }
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', 0.8))
        } else {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = url
    })
  } catch {
    return null
  }
}

export async function generateOrderPdf({ order, items }: OrderPdfData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  const pageWidth = 210
  const pageHeight = 297
  const margin = 14
  const contentWidth = pageWidth - margin * 2

  // Pre-load images
  const itemImages: Record<number, string | null> = {}
  await Promise.all(
    items.map(async (item) => {
      const imgUrl = item.product?.image_url
      if (imgUrl) {
        itemImages[item.id] = await getBase64ImageFromUrl(imgUrl)
      } else {
        itemImages[item.id] = null
      }
    })
  )

  let currentPage = 1
  let currentY = margin

  const drawHeader = (isFirstPage: boolean) => {
    // Top border bar
    doc.setFillColor(15, 23, 42) // Dark Navy
    doc.rect(margin, currentY, contentWidth, 3, 'F')
    currentY += 7

    if (isFirstPage) {
      // Company Name
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.setTextColor(15, 23, 42)
      doc.text('RANGOLI TEXTILES', margin, currentY)

      // Subtitle
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(100, 116, 139)
      doc.text('PREMIUM WHOLESALE FABRICS & SUITS', margin, currentY + 4)

      // Order Title Pill
      doc.setFillColor(234, 88, 12) // Orange
      doc.roundedRect(pageWidth - margin - 46, currentY - 5, 46, 11, 1.5, 1.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(255, 255, 255)
      doc.text('ORDER CONFIRMATION', pageWidth - margin - 23, currentY + 2, { align: 'center' })

      currentY += 12

      // Metadata Grid Box
      doc.setFillColor(248, 250, 252)
      doc.setDrawColor(226, 232, 240)
      doc.roundedRect(margin, currentY, contentWidth, 24, 1.5, 1.5, 'FD')

      const col1 = margin + 4
      const col2 = margin + contentWidth * 0.38
      const col3 = margin + contentWidth * 0.70

      let metaY = currentY + 5

      // Row 1
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(100, 116, 139)
      doc.text('PARTY NAME:', col1, metaY)
      doc.setTextColor(15, 23, 42)
      doc.text(order.party_name.toUpperCase(), col1 + 22, metaY)

      doc.setTextColor(100, 116, 139)
      doc.text('ORDER NO:', col2, metaY)
      doc.setTextColor(15, 23, 42)
      doc.text(order.order_no, col2 + 18, metaY)

      doc.setTextColor(100, 116, 139)
      doc.text('DATE:', col3, metaY)
      doc.setTextColor(15, 23, 42)
      doc.text(formatDate(order.order_date || order.created_at), col3 + 12, metaY)

      metaY += 6

      // Row 2
      doc.setTextColor(100, 116, 139)
      doc.text('STATION:', col1, metaY)
      doc.setTextColor(15, 23, 42)
      doc.text(order.station ? order.station.toUpperCase() : '-', col1 + 22, metaY)

      doc.setTextColor(100, 116, 139)
      doc.text('AGENT:', col2, metaY)
      doc.setTextColor(15, 23, 42)
      doc.text(order.agent || '-', col2 + 18, metaY)

      doc.setTextColor(100, 116, 139)
      doc.text('EXPORT DATE:', col3, metaY)
      doc.setTextColor(15, 23, 42)
      doc.text(order.export_date ? formatDate(order.export_date) : '-', col3 + 22, metaY)

      metaY += 6

      // Row 3
      doc.setTextColor(100, 116, 139)
      doc.text('GST NUMBER:', col1, metaY)
      doc.setTextColor(15, 23, 42)
      doc.text(order.gst_number || '-', col1 + 22, metaY)

      if (order.brand) {
        doc.setTextColor(100, 116, 139)
        doc.text('BRAND:', col2, metaY)
        doc.setTextColor(15, 23, 42)
        doc.text(order.brand, col2 + 18, metaY)
      }

      currentY += 28
    } else {
      // Compact header on subsequent pages
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(15, 23, 42)
      doc.text(`RANGOLI TEXTILES — ORDER ${order.order_no} (${order.party_name})`, margin, currentY)
      currentY += 6
    }

    // Table Column Headers
    doc.setFillColor(15, 23, 42)
    doc.rect(margin, currentY, contentWidth, 8, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(255, 255, 255)

    // Columns: Photo (22), Design No (38), Rate (24), Total Set (24), Pcs/Set (20), Total Pcs (24), Amount (30)
    let hX = margin
    doc.text('PHOTO', hX + 4, currentY + 5.5)
    hX += 22
    doc.text('DESIGN NO', hX + 2, currentY + 5.5)
    hX += 38
    doc.text('RATE (₹)', hX + 22, currentY + 5.5, { align: 'right' })
    hX += 24
    doc.text('TOTAL SET', hX + 22, currentY + 5.5, { align: 'right' })
    hX += 24
    doc.text('PCS/SET', hX + 18, currentY + 5.5, { align: 'right' })
    hX += 20
    doc.text('TOTAL PCS', hX + 22, currentY + 5.5, { align: 'right' })
    hX += 24
    doc.text('AMOUNT (₹)', hX + 28, currentY + 5.5, { align: 'right' })

    currentY += 8
  }

  const drawFooter = (pageNum: number) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.setDrawColor(226, 232, 240)
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12)
    doc.text('Rangoli Textiles • System Generated Order Form', margin, pageHeight - 7)
    doc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
  }

  // Draw Page 1 Header
  drawHeader(true)

  const rowHeight = 20

  items.forEach((item, index) => {
    // Check if new page needed
    if (currentY + rowHeight > pageHeight - 32) {
      drawFooter(currentPage)
      doc.addPage()
      currentPage++
      currentY = margin
      drawHeader(false)
    }

    // Row zebra background
    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252)
      doc.rect(margin, currentY, contentWidth, rowHeight, 'F')
    }

    // Border line bottom
    doc.setDrawColor(226, 232, 240)
    doc.line(margin, currentY + rowHeight, margin + contentWidth, currentY + rowHeight)

    let rX = margin

    // 1. Photo thumbnail
    const imgData = itemImages[item.id]
    if (imgData) {
      try {
        doc.addImage(imgData, 'JPEG', rX + 2, currentY + 2, 16, 16)
      } catch {
        // Fallback placeholder box
        doc.setFillColor(241, 245, 249)
        doc.rect(rX + 2, currentY + 2, 16, 16, 'F')
      }
    } else {
      doc.setFillColor(241, 245, 249)
      doc.roundedRect(rX + 2, currentY + 2, 16, 16, 1, 1, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(148, 163, 184)
      doc.text('NO PIC', rX + 10, currentY + 11, { align: 'center' })
    }
    rX += 22

    // 2. Design No + details
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(15, 23, 42)
    doc.text(item.design_no || '-', rX + 2, currentY + 8)

    if (item.product?.fabric || item.product?.brand) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      const sub = [item.product?.brand, item.product?.fabric].filter(Boolean).join(' • ')
      doc.text(sub.substring(0, 26), rX + 2, currentY + 13)
    }
    rX += 38

    // 3. Rate
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(15, 23, 42)
    doc.text((item.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }), rX + 22, currentY + 11, { align: 'right' })
    rX += 24

    // 4. Total Set
    doc.setFont('helvetica', 'bold')
    doc.text(String(item.sets || 0), rX + 22, currentY + 11, { align: 'right' })
    rX += 24

    // 5. Pcs / Set
    doc.setFont('helvetica', 'normal')
    doc.text(String(item.pcs_per_set || 1), rX + 18, currentY + 11, { align: 'right' })
    rX += 20

    // 6. Total Pcs
    doc.setFont('helvetica', 'bold')
    doc.text(String(item.total_pcs || 0), rX + 22, currentY + 11, { align: 'right' })
    rX += 24

    // 7. Amount
    doc.text((item.line_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }), rX + 28, currentY + 11, { align: 'right' })

    currentY += rowHeight
  })

  // Summary Box
  const totalSets = items.reduce((s, i) => s + (i.sets || 0), 0)
  const totalPieces = items.reduce((s, i) => s + (i.total_pcs || 0), 0)
  const totalAmount = items.reduce((s, i) => s + (i.line_total || 0), 0)

  // Ensure enough room for totals
  if (currentY + 28 > pageHeight - 20) {
    drawFooter(currentPage)
    doc.addPage()
    currentPage++
    currentY = margin
    drawHeader(false)
  }

  currentY += 4

  // Grand Total Card
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(203, 213, 225)
  doc.roundedRect(pageWidth - margin - 85, currentY, 85, 24, 1.5, 1.5, 'FD')

  let sumY = currentY + 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('TOTAL SETS:', pageWidth - margin - 80, sumY)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(String(totalSets), pageWidth - margin - 6, sumY, { align: 'right' })

  sumY += 6
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text('TOTAL PIECES:', pageWidth - margin - 80, sumY)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(String(totalPieces), pageWidth - margin - 6, sumY, { align: 'right' })

  sumY += 7
  doc.setFillColor(234, 88, 12)
  doc.rect(pageWidth - margin - 85, sumY - 4, 85, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(255, 255, 255)
  doc.text('GRAND TOTAL:', pageWidth - margin - 80, sumY + 2)
  doc.text(`₹ ${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, pageWidth - margin - 6, sumY + 2, { align: 'right' })

  // Footer for last page
  drawFooter(currentPage)

  return doc
}

export async function downloadOrderPdf(orderData: OrderPdfData, filename?: string) {
  const doc = await generateOrderPdf(orderData)
  const name = filename || `Order_${orderData.order.order_no || 'Document'}.pdf`
  doc.save(name)
}

export async function printOrderPdf(orderData: OrderPdfData) {
  const doc = await generateOrderPdf(orderData)
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const printWindow = window.open(url)
  if (printWindow) {
    printWindow.onload = () => {
      printWindow.focus()
      printWindow.print()
    }
  }
}
