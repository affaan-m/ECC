/**
 * PDF export utilities.
 *
 * Uses PDFKit to generate PDF documents server-side.
 */
import PDFDocument from 'pdfkit'

export interface PdfTableColumn {
  /** Column header label */
  header: string
  /** Column width in points */
  width: number
  /** Text alignment */
  align?: 'left' | 'center' | 'right'
}

export interface PdfDocumentOptions {
  /** Document title */
  title: string
  /** Optional subtitle (e.g. event name, date range) */
  subtitle?: string
  /** Page size. Default: "LETTER" */
  pageSize?: 'LETTER' | 'A4'
  /** Page orientation. Default: "portrait" */
  orientation?: 'portrait' | 'landscape'
  /** Footer text */
  footer?: string
}

/**
 * Generate a PDF buffer with a title page header and a data table.
 *
 * @param options - Document metadata and layout options
 * @param columns - Table column definitions
 * @param rows - Array of string arrays (one per row), pre-formatted
 * @returns Buffer containing the PDF file data
 */
export async function generatePdfTable(
  options: PdfDocumentOptions,
  columns: PdfTableColumn[],
  rows: string[][],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: options.pageSize ?? 'LETTER',
      layout: options.orientation ?? 'portrait',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: { Title: options.title },
    })

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Title
    doc.fontSize(18).font('Helvetica-Bold').text(options.title, { align: 'center' })
    doc.moveDown(0.5)

    // Subtitle
    if (options.subtitle) {
      doc.fontSize(12).font('Helvetica').text(options.subtitle, { align: 'center' })
      doc.moveDown(1)
    }

    // Table header
    const startX = doc.x
    let currentY = doc.y

    doc.fontSize(9).font('Helvetica-Bold')
    let xOffset = startX
    for (const col of columns) {
      doc.text(col.header, xOffset, currentY, {
        width: col.width,
        align: col.align ?? 'left',
      })
      xOffset += col.width
    }

    currentY += 15
    doc
      .moveTo(startX, currentY)
      .lineTo(startX + columns.reduce((sum, c) => sum + c.width, 0), currentY)
      .stroke()
    currentY += 5

    // Table rows
    doc.font('Helvetica').fontSize(8)
    for (const row of rows) {
      // Check if we need a new page
      if (currentY > doc.page.height - 70) {
        doc.addPage()
        currentY = 50
      }

      xOffset = startX
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]!
        const cellValue = row[i] ?? ''
        doc.text(cellValue, xOffset, currentY, {
          width: col.width,
          align: col.align ?? 'left',
        })
        xOffset += col.width
      }
      currentY += 14
    }

    // Footer
    if (options.footer) {
      const pageCount = doc.bufferedPageRange().count
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i)
        doc
          .fontSize(7)
          .font('Helvetica')
          .text(
            `${options.footer}  |  Page ${i + 1} of ${pageCount}`,
            50,
            doc.page.height - 40,
            { align: 'center', width: doc.page.width - 100 },
          )
      }
    }

    doc.end()
  })
}

/**
 * Create a Response object for downloading a PDF file.
 */
export function pdfResponse(buffer: Buffer, filename: string): Response {
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
