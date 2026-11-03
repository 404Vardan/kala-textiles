import { jsPDF } from 'jspdf'
import type { Invoice, InvoiceItem } from '@/types'
import { formatDate } from '@/utils/formatters'
import { resolveBrandName } from '@/components/common/KalaLogo'

export interface InvoicePdfData {
  invoice: Invoice
  items: InvoiceItem[]
  businessName?: string | null
}

/**
 * Draws the vector KALA emblem mark at (x, y) with given size (mm)
 */
function drawKalaMark(doc: jsPDF, x: number, y: number, size: number) {
  doc.setFillColor(28, 25, 23) // #1C1917
  doc.roundedRect(x, y, size, size, 2, 2, 'F')

  doc.setFillColor(194, 65, 12) // #C2410C
  doc.roundedRect(x + size * 0.18, y + size * 0.2, size * 0.16, size * 0.6, 0.6, 0.6, 'F')

  doc.setDrawColor(248, 247, 244)
  doc.setLineWidth(size * 0.12)
  doc.line(x + size * 0.36, y + size * 0.5, x + size * 0.74, y + size * 0.24)
  doc.line(x + size * 0.36, y + size * 0.5, x + size * 0.74, y + size * 0.76)

  doc.setFillColor(234, 88, 12)
  doc.circle(x + size * 0.78, y + size * 0.5, size * 0.08, 'F')
}

export async function generateInvoicePdf({
  invoice,
  items,
  businessName,
}: InvoicePdfData): Promise<jsPDF> {
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

  let currentY = margin

  const drawTableHeaders = () => {
    doc.setFillColor(28, 25, 23) // #1C1917
    doc.rect(margin, currentY, contentWidth, 8.5, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(255, 255, 255)

    // Columns (total 182mm):
    // S.No (12) | Design No (36) | Description (46) | Pcs/Set (20) | Sets (20) | Total Pcs (22) | Rate (26) -> wait: 12+36+42+18+18+20+18+18 = 182
    let hX = margin
    doc.text('S.NO', hX + 2, currentY + 5.6)
    hX += 12
    doc.text('DESIGN NO', hX + 2, currentY + 5.6)
    hX += 34
    doc.text('DESCRIPTION', hX + 2, currentY + 5.6)
    hX += 44
    doc.text('PCS/SET', hX + 16, currentY + 5.6, { align: 'right' })
    hX += 18
    doc.text('SETS', hX + 16, currentY + 5.6, { align: 'right' })
    hX += 18
    doc.text('TOTAL PCS', hX + 18, currentY + 5.6, { align: 'right' })
    hX += 20
    doc.text('RATE (Rs.)', hX + 16, currentY + 5.6, { align: 'right' })
    hX += 18
    doc.text('AMOUNT (Rs.)', hX + 16, currentY + 5.6, { align: 'right' })

    currentY += 8.5
  }

  const drawHeader = (isFirstPage: boolean) => {
    doc.setFillColor(194, 65, 12) // #C2410C
    doc.rect(margin, currentY, 42, 2.5, 'F')
    doc.setFillColor(28, 25, 23) // #1C1917
    doc.rect(margin + 42, currentY, contentWidth - 42, 2.5, 'F')
    currentY += 6.5

    if (isFirstPage) {
      drawKalaMark(doc, margin, currentY - 1, 12)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(19)
      doc.setTextColor(28, 25, 23)
      doc.text(displayBrand.toUpperCase(), margin + 15, currentY + 5.2)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(194, 65, 12)
      doc.text('KALA — TEXTILE WHOLESALE MANAGEMENT SYSTEM', margin + 15, currentY + 9.8)

      // Invoice Badge
      doc.setFillColor(194, 65, 12)
      doc.roundedRect(pageWidth - margin - 48, currentY - 1, 48, 8.5, 1.2, 1.2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(255, 255, 255)
      doc.text('WHOLESALE INVOICE', pageWidth - margin - 24, currentY + 4.5, { align: 'center' })

      currentY += 16

      // Billing & Invoice Metadata Box
      doc.setFillColor(248, 247, 244)
      doc.setDrawColor(214, 211, 209)
      doc.setLineWidth(0.3)
      doc.roundedRect(margin, currentY, contentWidth, 20, 1.5, 1.5, 'FD')

      const col1 = margin + 4
      const col2 = margin + contentWidth * 0.52

      let metaY = currentY + 6.5
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(120, 113, 108)
      doc.text('BILLED TO (PARTY):', col1, metaY)
      doc.setFontSize(9)
      doc.setTextColor(28, 25, 23)
      doc.text((invoice.party_name || '-').toUpperCase(), col1 + 30, metaY)

      doc.setFontSize(7.5)
      doc.setTextColor(120, 113, 108)
      doc.text('INVOICE NO:', col2, metaY)
      doc.setFontSize(9)
      doc.setTextColor(194, 65, 12)
      doc.text(invoice.invoice_no, col2 + 22, metaY)

      metaY += 7
      doc.setFontSize(7.5)
      doc.setTextColor(120, 113, 108)
      doc.text('ACCOUNT TYPE:', col1, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text('WHOLESALE TEXTILE DISPATCH', col1 + 30, metaY)

      doc.setTextColor(120, 113, 108)
      doc.text('INVOICE DATE:', col2, metaY)
      doc.setTextColor(28, 25, 23)
      doc.text(
        formatDate(invoice.export_date || invoice.created_at),
        col2 + 22,
        metaY
      )

      currentY += 24
    } else {
      drawKalaMark(doc, margin, currentY - 1, 7)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(28, 25, 23)
      doc.text(
        `${displayBrand.toUpperCase()} — INVOICE ${invoice.invoice_no} (${invoice.party_name})`,
        margin + 9,
        currentY + 4
      )
      currentY += 9
    }

    drawTableHeaders()
  }

  drawHeader(true)

  const rowHeight = 11
  items.forEach((item, index) => {
    if (currentY + rowHeight > pageHeight - 40) {
      doc.addPage()
      currentY = margin
      drawHeader(false)
    }

    if (index % 2 === 1) {
      doc.setFillColor(250, 250, 249)
      doc.rect(margin, currentY, contentWidth, rowHeight, 'F')
    }

    doc.setDrawColor(231, 229, 228)
    doc.setLineWidth(0.2)
    doc.line(margin, currentY + rowHeight, margin + contentWidth, currentY + rowHeight)

    let rX = margin
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(120, 113, 108)
    doc.text(String(index + 1), rX + 2.5, currentY + 7)
    rX += 12

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(28, 25, 23)
    doc.text(item.design_no || '-', rX + 2, currentY + 7)
    rX += 34

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(87, 83, 78)
    doc.text(`Wholesale Textile Set (${item.pcs_per_set || 1} pcs/set)`, rX + 2, currentY + 7)
    rX += 44

    doc.text(String(item.pcs_per_set || 1), rX + 16, currentY + 7, { align: 'right' })
    rX += 18

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(28, 25, 23)
    doc.text(String(item.sets || 0), rX + 16, currentY + 7, { align: 'right' })
    rX += 18

    doc.text(String(item.total_pcs || 0), rX + 18, currentY + 7, { align: 'right' })
    rX += 20

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(68, 64, 60)
    doc.text(
      (item.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      rX + 16,
      currentY + 7,
      { align: 'right' }
    )
    rX += 18

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(28, 25, 23)
    doc.text(
      (item.line_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      rX + 16,
      currentY + 7,
      { align: 'right' }
    )

    currentY += rowHeight
  })

  const totalSets = items.reduce((s, i) => s + (i.sets || 0), 0)
  const totalPieces = items.reduce((s, i) => s + (i.total_pcs || 0), 0)
  const totalAmount = items.reduce((s, i) => s + (i.line_total || 0), 0) || invoice.total_amount

  if (currentY + 42 > pageHeight - 20) {
    doc.addPage()
    currentY = margin
    drawHeader(false)
  }

  currentY += 6

  // Left: Document Notes & Signatory Box
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(120, 113, 108)
  doc.text('DOCUMENT DETAILS:', margin, currentY + 4)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(`Invoice Reference: ${invoice.invoice_no}`, margin, currentY + 9)
  doc.text(`System-generated wholesale invoice summary for ${invoice.party_name || '-'}.`, margin, currentY + 13.5)

  // Authorized Signatory Box
  doc.setDrawColor(214, 211, 209)
  doc.roundedRect(margin, currentY + 17, 72, 16, 1.2, 1.2, 'D')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(28, 25, 23)
  doc.text(`For ${displayBrand.toUpperCase()}`, margin + 4, currentY + 22)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 113, 108)
  doc.text('Authorized Signatory', margin + 4, currentY + 30.5)

  // Right: Financial Summary Card
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
  doc.setFillColor(194, 65, 12)
  doc.roundedRect(sumX, sumY - 3.5, sumWidth, 8, 0, 0, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text('INVOICE TOTAL:', sumX + 4, sumY + 1.8)
  doc.text(
    `Rs. ${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    pageWidth - margin - 4,
    sumY + 1.8,
    { align: 'right' }
  )

  // Two-pass footer with Page X of Y numbering
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
      ` — Textile Wholesale Management System  •  Invoice ${invoice.invoice_no}`,
      margin + 9,
      pageHeight - 8
    )

    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8, {
      align: 'right',
    })
  }

  return doc
}

export async function downloadInvoicePdf(invoiceData: InvoicePdfData, filename?: string) {
  const doc = await generateInvoicePdf(invoiceData)
  const name = filename || `Kala_Invoice_${invoiceData.invoice.invoice_no || 'Document'}.pdf`
  doc.save(name)
}

export async function printInvoicePdf(invoiceData: InvoicePdfData) {
  const doc = await generateInvoicePdf(invoiceData)
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

