/**
 * CSV export utilities.
 *
 * Generates RFC 4180-compliant CSV content from typed row data.
 */

export interface CsvColumn<T> {
  /** Column header label */
  header: string
  /** Function to extract the cell value from a row */
  accessor: (row: T) => string | number | boolean | null | undefined
}

export interface CsvExportOptions {
  /** Include a UTF-8 BOM for Excel compatibility. Default: true */
  bom?: boolean
  /** Field delimiter. Default: "," */
  delimiter?: string
}

/**
 * Escape a value for inclusion in a CSV cell.
 * Wraps in quotes if the value contains the delimiter, quotes, or newlines.
 */
function escapeCell(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Generate CSV content from an array of typed rows.
 *
 * @param columns - Column definitions with headers and accessors
 * @param rows - Data rows
 * @param options - Export options
 * @returns CSV string ready to be sent as a file download
 */
export function generateCsv<T>(
  columns: CsvColumn<T>[],
  rows: T[],
  options: CsvExportOptions = {},
): string {
  const { bom = true, delimiter = ',' } = options

  const headerLine = columns
    .map((col) => escapeCell(col.header, delimiter))
    .join(delimiter)

  const dataLines = rows.map((row) =>
    columns
      .map((col) => {
        const raw = col.accessor(row)
        const value = raw === null || raw === undefined ? '' : String(raw)
        return escapeCell(value, delimiter)
      })
      .join(delimiter),
  )

  const csv = [headerLine, ...dataLines].join('\r\n')

  return bom ? `﻿${csv}` : csv
}

/**
 * Create a Response object for downloading a CSV file.
 */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
