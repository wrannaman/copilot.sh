import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient as createServiceClient } from '@/utils/supabase/server'

export async function POST(req, { params }) {
  try {
    const { id } = await params
    const { rows, sheetName, basePath, filename = `questionnaire-${id}.xlsx` } = await req.json()
    if (!Array.isArray(rows)) return NextResponse.json({ error: 'rows required' }, { status: 400 })
    if (!basePath) return NextResponse.json({ error: 'basePath required to preserve styles' }, { status: 400 })

    // Load original workbook from storage to preserve formatting/styles
    const supabase = await createServiceClient()
    const { data: file, error: dlErr } = await supabase.storage.from('copilot.sh').download(basePath)
    if (dlErr) throw dlErr
    const arrayBuf = await file.arrayBuffer()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(arrayBuf)

    // Pick target sheet
    const ws = sheetName ? wb.getWorksheet(sheetName) : (wb.worksheets[0] || wb.addWorksheet('Sheet1'))
    if (!ws) return NextResponse.json({ error: `Worksheet not found: ${sheetName}` }, { status: 400 })

    // Overlay values without touching styles/widths/merges
    const maxCols = Math.max(...rows.map(r => (r.cells || []).length), 0)
    for (const r of rows) {
      const rowIdx = r.index
      const row = ws.getRow(rowIdx)
      for (let c = 1; c <= maxCols; c++) {
        const val = r.cells?.[c - 1]?.value ?? ''
        row.getCell(c).value = val
      }
      row.commit && row.commit()
    }

    const buffer = await wb.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    })
  } catch (err) {
    console.error('❌ /api/questionnaires/[id]/export failed:', err)
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 })
  }
}


