import { jsPDF } from 'jspdf'
import type { Order, OrderItem, Product } from '@/types'
import { formatDate } from '@/utils/formatters'
import { resolveBrandName } from '@/components/common/KalaLogo'

export interface OrderPdfItem extends OrderItem {
  product?: Product | null
}

export interface OrderPdfData {
  order: Order
  items: OrderPdfItem[]
  businessName?: string | null
}

// Convert image URL to Base64 data URL for embedding in jsPDF
async function getBase64ImageFromUrl(url: string): Promise<string | null> {
  try {
    return await new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'Anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
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
          resolve(canvas.toDataURL('image/jpeg', 0.82))
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

/**
 * Draws the vector KALA emblem mark at (x, y) with given size (mm)
 */
function drawKalaMark(doc: jsPDF, x: number, y: number, size: number) {
  // Deep charcoal rounded tile
  doc.setFillColor(28, 25, 23) // #1C1917
  doc.roundedRect(x, y, size, size, 2, 2, 'F')

  // Burnt orange inner accent bar
  doc.setFillColor(194, 65, 12) // #C2410C
  doc.roundedRect(x + size * 0.18, y + size * 0.2, size * 0.16, size * 0.6, 0.6, 0.6, 'F')

  // Warm ivory K diagonals
  doc.setDrawColor(248, 247, 244)
  doc.setLineWidth(size * 0.12)
  doc.line(x + size * 0.36, y + size * 0.5, x + size * 0.74, y + size * 0.24)
  doc.line(x + size * 0.36, y + size * 0.5, x + size * 0.74, y + size * 0.76)

  // Terracotta diamond node
  doc.setFillColor(234, 88, 12)
  doc.circle(x + size * 0.78, y + size * 0.5, size * 0.08, 'F')
}

export async function generateOrderPdf({
  order,
  items,
  businessName,
}: OrderPdfData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  const displayBrand = resolveBrandName(businessName)
  const pageWidth = 210
  const pageHeight = 297
  const margin = 14
  const contentWidth = pageWidth - margin * 2 // 182mm

  // Pre-load product thumbnails
  const itemImages: Record<number, string | null> = {}
  await Promise.all(
    items.map(async (item, idx) => {
      const key = item.id || idx + 1
      const imgUrl = item.product?.image_url
      if (imgUrl) {
        itemImages[key] = await getBase64ImageFromUrl(imgUrl)
      } else {
        itemImages[key] = null
      }
    })
  )

  let currentY = margin

  const statusUpper = (order.status || 'draft').toUpperCase()
  const statusColors: Record<string, { bg: [number, number, number]; text: [number, number, number] }> = {
    CONFIRMED: { bg: [220, 252, 231], text: [21, 128, 61] },
    CANCELLED: { bg: [254, 226, 226], text: [185, 28, 28] },
    DRAFT: { bg: [254, 243, 199], text: [180, 83, 9] },
  }
  const statusStyle = statusColors[statusUpper] || statusColors.DRAFT

  const drawTableHeaders = () => {
    doc.setFillColor(28, 25, 23) // #1C1917
    doc.rect(margin, currentY, contentWidth, 8.5, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(255, 255, 255)

    // Columns (total 182mm):
    // S.No (10) | Photo (18) | Design & Description (56) | Pcs/Set (18) | Sets (18) | Total Pcs (20) | Rate (20) | Amount (22)
    let hX = margin
    doc.text('S.NO', hX + 2, currentY + 5.6)
    hX += 10
    doc.text('PHOTO', hX + 2, currentY + 5.6)
    hX += 18
    doc.text('DESIGN NO & DESCRIPTION', hX + 2, currentY + 5.6)
    hX += 56
    doc.text('PCS/SET', hX + 16, currentY + 5.6, { align: 'right' })
    hX += 18
    doc.text('SETS', hX + 16, currentY + 5.6, { align: 'right' })
    hX += 18
    doc.text('TOTAL PCS', hX + 18, currentY + 5.6, { align: 'right' })
    hX += 20
    doc.text('RATE (Rs.)', hX + 18, currentY + 5.6, { align: 'right' })
    hX += 20
    doc.text('AMOUNT (Rs.)', hX + 20, currentY + 5.6, { align: 'right' })

    currentY += 8.5
  }

  const drawHeader = (isFirstPage: boolean) => {
    // Top terracotta & charcoal brand bar
    doc.setFillColor(194, 65, 12) // #C2410C
    doc.rect(margin, currentY, 42, 2.5, 'F')
    doc.setFillColor(28, 25, 23) // #1C1917
    doc.rect(margin + 42, currentY, contentWidth - 42, 2.5, 'F')
    currentY += 6.5

    if (isFirstPage) {
      // KALA vector mark + wordmark
      drawKalaMark(doc, margin, currentY - 1, 12)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(19)
      doc.setTextColor(28, 25, 23)
      doc.text(displayBrand.toUpperCase(), margin + 15, currentY + 5.2)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(194, 65, 12)
      doc.text('KALA — TEXTILE WHOLESALE MANAGEMENT SYSTEM', margin + 15, currentY + 9.8)

      // Document Type & Status Badge on the right
      doc.setFillColor(28, 25, 23)
      doc.roundedRect(pageWidth - margin - 52, currentY - 1, 52, 7.5, 1.2, 1.2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(255, 255, 255)
      doc.text('WHOLESALE ORDER FORM', pageWidth - margin - 26, currentY + 4, { align: 'center' })

      // Status Pill below badge
      doc.setFillColor(...statusStyle.bg)
      doc.roundedRect(pageWidth - margin - 32, currentY + 8, 32, 5.5, 1, 1, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...statusStyle.text)
      doc.text(`STATUS: ${statusUpper}`, pageWidth - margin - 16, currentY + 11.8, {
        align: 'center',
      })

      currentY += 17

      // Customer / Party & Order Metadata Box
      doc.setFillColor(248, 247, 244) // Warm Ivory #F8F7F4
      doc.setDrawColor(214, 211, 209) // Stone-300
      doc.setLineWidth(0.3)
      doc.roundedRect(margin, currentY, contentWidth, 24, 1.5, 1.5, 'FD')

      const col1 = margin + 4
      const col2 = margin + contentWidth * 0.42
      const col3 = margin + contentWidth * 0.72

      let metaY = currentY + 5.5

      // Row 1
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(120, 113, 108)
      doc.text('PARTY / BUYER:', col1, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text((order.party_name || '-').toUpperCase().substring(0, 28), col1 + 23, metaY)

      doc.setTextColor(120, 113, 108)
      doc.text('ORDER NO:', col2, metaY)
      doc.setTextColor(194, 65, 12)
      doc.text(order.order_no, col2 + 18, metaY)

      doc.setTextColor(120, 113, 108)
      doc.text('ORDER DATE:', col3, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text(formatDate(order.order_date || order.created_at), col3 + 20, metaY)

      metaY += 6

      // Row 2
      doc.setTextColor(120, 113, 108)
      doc.text('STATION:', col1, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text(order.station ? order.station.toUpperCase() : '-', col1 + 23, metaY)

      doc.setTextColor(120, 113, 108)
      doc.text('AGENT:', col2, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text((order.agent || 'Direct').substring(0, 22), col2 + 18, metaY)

      doc.setTextColor(120, 113, 108)
      doc.text('DISPATCH:', col3, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text(order.export_date ? formatDate(order.export_date) : '-', col3 + 20, metaY)

      metaY += 6

      // Row 3
      doc.setTextColor(120, 113, 108)
      doc.text('GSTIN:', col1, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text(order.gst_number || '-', col1 + 23, metaY)

      doc.setTextColor(120, 113, 108)
      doc.text('BRAND / LINE:', col2, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text(order.brand || displayBrand, col2 + 21, metaY)

      currentY += 28
    } else {
      // Compact continuation header on subsequent pages
      drawKalaMark(doc, margin, currentY - 1, 7)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(28, 25, 23)
      doc.text(
        `${displayBrand.toUpperCase()} — ORDER ${order.order_no} (${order.party_name})`,
        margin + 9,
        currentY + 4
      )
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(120, 113, 108)
      doc.text(formatDate(order.order_date || order.created_at), pageWidth - margin, currentY + 4, {
        align: 'right',
      })
      currentY += 9
    }

    drawTableHeaders()
  }

  // Draw Page 1 Header
  drawHeader(true)

  const rowHeight = 18.5

  items.forEach((item, index) => {
    const key = item.id || index + 1
    if (currentY + rowHeight > pageHeight - 28) {
      doc.addPage()
      currentY = margin
      drawHeader(false)
    }

    // Zebra striping
    if (index % 2 === 1) {
      doc.setFillColor(250, 250, 249) // Stone-50
      doc.rect(margin, currentY, contentWidth, rowHeight, 'F')
    }

    // Row bottom divider
    doc.setDrawColor(231, 229, 228) // Stone-200
    doc.setLineWidth(0.2)
    doc.line(margin, currentY + rowHeight, margin + contentWidth, currentY + rowHeight)

    let rX = margin

    // 1. S. No (10mm)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(120, 113, 108)
    doc.text(String(index + 1), rX + 2.5, currentY + 10.5)
    rX += 10

    // 2. Photo thumbnail (18mm)
    const imgData = itemImages[key]
    if (imgData) {
      try {
        doc.addImage(imgData, 'JPEG', rX + 1, currentY + 1.8, 14.5, 14.5)
      } catch {
        doc.setFillColor(245, 245, 244)
        doc.rect(rX + 1, currentY + 1.8, 14.5, 14.5, 'F')
      }
    } else {
      doc.setFillColor(245, 245, 244)
      doc.roundedRect(rX + 1, currentY + 1.8, 14.5, 14.5, 1, 1, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(5.5)
      doc.setTextColor(168, 162, 158)
      doc.text('DESIGN', rX + 8.25, currentY + 9.8, { align: 'center' })
    }
    rX += 18

    // 3. Design No & Description (56mm)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(28, 25, 23)
    doc.text(`Design #${item.design_no || '-'}`, rX + 2, currentY + 8)

    const descParts = [item.product?.brand || order.brand, item.product?.fabric].filter(Boolean)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(120, 113, 108)
    doc.text(
      (descParts.length > 0 ? descParts.join(' • ') : 'Wholesale Catalog Item').substring(0, 34),
      rX + 2,
      currentY + 13
    )
    rX += 56

    // 4. Pcs/Set (18mm)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(68, 64, 60)
    doc.text(String(item.pcs_per_set || 1), rX + 16, currentY + 10.5, { align: 'right' })
    rX += 18

    // 5. Sets (18mm)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(28, 25, 23)
    doc.text(String(item.sets || 0), rX + 16, currentY + 10.5, { align: 'right' })
    rX += 18

    // 6. Total Pcs (20mm)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(28, 25, 23)
    doc.text(String(item.total_pcs || 0), rX + 18, currentY + 10.5, { align: 'right' })
    rX += 20

    // 7. Rate (20mm)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(68, 64, 60)
    doc.text(
      (item.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      rX + 18,
      currentY + 10.5,
      { align: 'right' }
    )
    rX += 20

    // 8. Amount (22mm)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(28, 25, 23)
    doc.text(
      (item.line_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      rX + 20,
      currentY + 10.5,
      { align: 'right' }
    )

    currentY += rowHeight
  })

  // Summary & Notes Section
  const totalSets = items.reduce((s, i) => s + (i.sets || 0), 0)
  const totalPieces = items.reduce((s, i) => s + (i.total_pcs || 0), 0)
  const totalAmount = items.reduce((s, i) => s + (i.line_total || 0), 0)

  if (currentY + 34 > pageHeight - 22) {
    doc.addPage()
    currentY = margin
    drawHeader(false)
  }

  currentY += 5

  // Left: Notes / Terms Box
  if (order.notes) {
    doc.setFillColor(254, 252, 232)
    doc.setDrawColor(253, 224, 71)
    doc.roundedRect(margin, currentY, 90, 24, 1.5, 1.5, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(161, 98, 7)
    doc.text('ORDER NOTES / DISPATCH INSTRUCTIONS:', margin + 3.5, currentY + 5.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(68, 64, 60)
    const splitNotes = doc.splitTextToSize(order.notes, 83)
    doc.text(splitNotes.slice(0, 3), margin + 3.5, currentY + 11)
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(120, 113, 108)
    doc.text('ORDER NOTES:', margin, currentY + 5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(
      `Order Reference: ${order.order_no}  |  Party: ${order.party_name || '-'}`,
      margin,
      currentY + 10
    )
    doc.text(
      'No additional dispatch notes recorded for this wholesale order.',
      margin,
      currentY + 14.5
    )
  }

  // Right: Grand Total Summary Box
  const sumWidth = 86
  const sumX = pageWidth - margin - sumWidth
  doc.setFillColor(248, 247, 244)
  doc.setDrawColor(214, 211, 209)
  doc.roundedRect(sumX, currentY, sumWidth, 26, 1.5, 1.5, 'FD')

  let sumY = currentY + 5.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(120, 113, 108)
  doc.text('TOTAL DESIGNS / SETS:', sumX + 4, sumY)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(28, 25, 23)
  doc.text(`${items.length} Designs  |  ${totalSets} Sets`, pageWidth - margin - 4, sumY, {
    align: 'right',
  })

  sumY += 6
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 113, 108)
  doc.text('TOTAL PIECES:', sumX + 4, sumY)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(28, 25, 23)
  doc.text(`${totalPieces} Pcs`, pageWidth - margin - 4, sumY, { align: 'right' })

  sumY += 6.5
  doc.setFillColor(194, 65, 12) // #C2410C
  doc.roundedRect(sumX, sumY - 3.5, sumWidth, 8, 0, 0, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text('GRAND TOTAL:', sumX + 4, sumY + 1.8)
  doc.text(
    `Rs. ${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    pageWidth - margin - 4,
    sumY + 1.8,
    { align: 'right' }
  )

  // Two-pass footer with accurate Page X of Y numbering
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(214, 211, 209)
    doc.setLineWidth(0.25)
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(28, 25, 23)
    doc.text('KALA', margin, pageHeight - 8)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 113, 108)
    doc.text(
      ` — Textile Wholesale Management System  •  Order ${order.order_no}`,
      margin + 9,
      pageHeight - 8
    )

    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8, {
      align: 'right',
    })
  }

  return doc
}

export async function downloadOrderPdf(orderData: OrderPdfData, filename?: string) {
  const doc = await generateOrderPdf(orderData)
  const name = filename || `Kala_Order_${orderData.order.order_no || 'Document'}.pdf`
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
