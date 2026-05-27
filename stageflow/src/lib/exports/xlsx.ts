/**
 * XLSX export utilities.
 *
 * Uses the `xlsx` (SheetJS) library to generate Excel workbooks.
 */
import * as XLSX from 'xlsx'

export interface XlsxColumn<T> {
  /** Column header label */
  header: string
  /** Function to extract the cell value from a row */
  accessor: (row: T) => string | number | boolean | Date | null | undefined
  /** Optional column width in characters */
  width?: number
}

export interface XlsxSheetConfig<T> {
  /** Sheet name (max 31 characters) */
  name: string
  /** Column definitions */
  columns: XlsxColumn<T>[]
  /** Data rows */
  rows: T[]
}

/**
 * Generate an XLSX workbook buffer from one or more sheet configurations.
 *
 * @param sheets - Array of sheet definitions
 * @returns Buffer containing the XLSX file data
 */
export function generateXlsx<T>(sheets: XlsxSheetConfig<T>[]): Buffer {
  const workbook = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const headers = sheet.columns.map((col) => col.header)
    const data = sheet.rows.map((row) =>
      sheet.columns.map((col) => {
        const value = col.accessor(row)
        return value === null || value === undefined ? '' : value
      }),
    )

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data])

    // Apply column widths if specified
    const colWidths = sheet.columns.map((col) => ({
      wch: col.width ?? Math.max(col.header.length, 12),
    }))
    worksheet['!cols'] = colWidths

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      sheet.name.slice(0, 31),
    )
  }

  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true,
  }) as Buffer

  return buffer
}

/**
 * Create a Response object for downloading an XLSX file.
 */
export function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new Response(buffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
