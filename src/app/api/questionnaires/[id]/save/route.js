import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@/utils/supabase/server'
import ExcelJS from 'exceljs'

export async function POST(req, { params }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { rows = [], sheetName, basePath, filename } = body || {}
    if (!id || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'id and rows required' }, { status: 400 })
    }
    console.log('💾 [Save] Saving version (preserving styles)', { rowCount: rows.length })

    // Load original workbook to preserve styles
    const supabase = await createServiceClient()
    let wb = new ExcelJS.Workbook()
    if (basePath) {
      const { data: file, error: dlErr } = await supabase.storage.from('secreq').download(basePath)
      if (dlErr) throw dlErr
      const arrayBuf = await file.arrayBuffer()
      await wb.xlsx.load(arrayBuf)
    }
    if ((wb.worksheets || []).length === 0) {
      wb = new ExcelJS.Workbook()
      wb.addWorksheet(sheetName || 'Sheet1')
    }
    const ws = sheetName ? (wb.getWorksheet(sheetName) || wb.addWorksheet(sheetName)) : (wb.worksheets[0])
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

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `questionnaires/${id}/versions/${timestamp}.xlsx`
    const { error } = await supabase.storage
      .from('secreq')
      .upload(path, Buffer.from(buffer), {
        upsert: false,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
    if (error) throw error

    return NextResponse.json({ success: true, path, version: timestamp, filename: filename || `${id}-${timestamp}.xlsx` })
  } catch (err) {
    console.error('❌ /api/questionnaires/[id]/save failed:', err)
    return NextResponse.json({ error: err.message || 'Save failed' }, { status: 500 })
  }
}


