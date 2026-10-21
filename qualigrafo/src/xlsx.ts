// Minimal .xlsx reader for register imports: the first worksheet as rows of cell text.
// Handles shared strings, inline strings, numbers and booleans. Dates come back as Excel serial numbers
// (convert with excelDate). Only the workbook parts that are needed are decompressed, with a size limit.
import { strFromU8, unzipSync } from 'fflate'

const MAX_FILE = 10 * 1024 * 1024
const MAX_PART = 60 * 1024 * 1024

const xml = (bytes: Uint8Array | undefined) => (bytes ? new DOMParser().parseFromString(strFromU8(bytes), 'application/xml') : null)
const colIndex = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
const text = (el: Element) => [...el.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('')

export async function readXlsx(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE) throw new Error('The workbook is larger than 10 MB. Save the register sheet on its own or as CSV.')
  let parts: Record<string, Uint8Array>
  try {
    parts = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name)) return false
        if (f.originalSize > MAX_PART) throw new Error('The workbook is too large to read.')
        return true
      },
    })
  } catch (e) {
    throw new Error(e instanceof Error && e.message.includes('too large') ? e.message : 'This is not a readable .xlsx workbook. Save it as Excel Workbook (.xlsx) or CSV.')
  }
  // first sheet in workbook order -> its part name through the relationships
  const wb = xml(parts['xl/workbook.xml'])
  const rels = xml(parts['xl/_rels/workbook.xml.rels'])
  const rid = wb?.getElementsByTagName('sheet')[0]?.getAttribute('r:id')
  const target = rid && [...(rels?.getElementsByTagName('Relationship') ?? [])].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target')
  const name = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}` : 'xl/worksheets/sheet1.xml'
  const sheet = xml(parts[name] ?? parts['xl/worksheets/sheet1.xml'])
  if (!sheet) throw new Error('The workbook has no worksheet.')
  const shared = [...(xml(parts['xl/sharedStrings.xml'])?.getElementsByTagName('si') ?? [])].map(text)

  const rows: string[][] = []
  for (const row of [...sheet.getElementsByTagName('row')]) {
    const r = Number(row.getAttribute('r')) - 1
    const cells: string[] = []
    for (const c of [...row.getElementsByTagName('c')]) {
      const ref = c.getAttribute('r')
      const i = ref ? colIndex(ref) : cells.length
      const t = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
      cells[i] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? text(c) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v
    }
    rows[Number.isFinite(r) && r >= 0 ? r : rows.length] = Array.from(cells, (x) => x ?? '')
  }
  return Array.from(rows, (x) => x ?? []).filter((r) => r.some((c) => c.trim()))
}

/** Excel serial day number (1900 date system) -> YYYY-MM-DD; other text is returned trimmed. */
export function excelDate(v: string) {
  const t = v.trim()
  if (/^\d{4,5}(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000).toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return t.slice(0, 10)
  return t
}
