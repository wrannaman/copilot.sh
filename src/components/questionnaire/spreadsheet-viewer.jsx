'use client'

import { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import ExcelJS from 'exceljs'

const SpreadsheetViewer = forwardRef(function SpreadsheetViewer({ signedUrl, filename, onColumnHeaderClick, highlightColumns = {}, onSelectionChange, onRowsChange, selectionMode = 'question', onRangeSelect, highlightRanges = {}, onClearSelections, onSheetChange }, ref) {
  const [rows, setRows] = useState([])
  const [maxColumns, setMaxColumns] = useState(0)
  const [mergeMap, setMergeMap] = useState(new Map())
  const [skipCells, setSkipCells] = useState(new Set())
  const [columnWidths, setColumnWidths] = useState({})

  // Multi-sheet support
  const [sheets, setSheets] = useState([]) // [{ name, rows, maxColumns, mergeMap, skipCells, columnWidths }]
  const [activeSheet, setActiveSheet] = useState(null) // sheet name
  const [selected, setSelected] = useState(null) // {r, c}
  const [editing, setEditing] = useState(null) // {r, c}
  const [editingValue, setEditingValue] = useState("")
  const editorRef = useRef(null)
  const dragStartRef = useRef(null) // {row, col}
  const tempRangeRef = useRef(null) // {col, start, end}
  const [tempRangeTick, setTempRangeTick] = useState(0)
  const lastRangeRef = useRef(null) // persists last finalized vertical range for copy/paste
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])

  const containerRef = useRef(null)
  const rootRef = useRef(null)
  const rafIdRef = useRef(null)
  const lastScrollTopRef = useRef(0)
  const lastScrollLeftRef = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [visibleCols, setVisibleCols] = useState({ start: 1, end: 12, leftWidth: 0, rightWidth: 0 })
  const rowHeight = 28
  const viewportHeight = 520
  const [selectedRows, setSelectedRows] = useState(new Set())
  const lastSelectedRowRef = useRef(null)

  const widths = useMemo(() => {
    // Guard against zero/negative columns and stale widths
    const count = Math.max(0, Number.isFinite(maxColumns) ? maxColumns : 0)
    const arr = new Array(count)
    for (let i = 0; i < count; i++) arr[i] = columnWidths[i + 1] || 140
    return arr
  }, [maxColumns, columnWidths])

  const prefixSums = useMemo(() => {
    const p = new Array(widths.length + 1)
    p[0] = 0
    for (let i = 1; i <= widths.length; i++) p[i] = p[i - 1] + widths[i - 1]
    return p
  }, [widths])

  const computeVisibleColumns = useCallback(() => {
    const el = containerRef.current
    if (!el) {
      // Fallback: show first few columns until container is ready
      const end = Math.min(Number.isFinite(maxColumns) && maxColumns > 0 ? maxColumns : 12, 12)
      setVisibleCols({ start: 1, end, leftWidth: 0, rightWidth: 0 })
      return
    }
    const scrollLeft = el.scrollLeft
    const viewportWidth = el.clientWidth
    if (!Number.isFinite(maxColumns) || maxColumns <= 0 || prefixSums.length <= 1) {
      const end = Math.min(Number.isFinite(maxColumns) && maxColumns > 0 ? maxColumns : 12, 12)
      setVisibleCols({ start: 1, end, leftWidth: 0, rightWidth: 0 })
      return
    }

    let start = 1
    while (start <= maxColumns && prefixSums[start] <= scrollLeft) start++
    let end = start
    const rightEdge = scrollLeft + viewportWidth
    while (end <= maxColumns && prefixSums[end] < rightEdge) end++

    start = Math.max(1, start - 3)
    end = Math.min(maxColumns, end + 3)

    const totalWidth = prefixSums[maxColumns]
    const leftWidth = prefixSums[start - 1] || 0
    const centerWidth = prefixSums[end] - prefixSums[start - 1]
    const rightWidth = Math.max(0, totalWidth - leftWidth - centerWidth)
    setVisibleCols({ start, end, leftWidth, rightWidth })
  }, [maxColumns, prefixSums])

  const onScroll = useCallback((e) => {
    lastScrollTopRef.current = e.currentTarget.scrollTop
    lastScrollLeftRef.current = e.currentTarget.scrollLeft
    if (rafIdRef.current != null) return
    rafIdRef.current = window.requestAnimationFrame(() => {
      setScrollTop(lastScrollTopRef.current)
      // also update horizontal columns in the same frame
      computeVisibleColumns()
      rafIdRef.current = null
    })
  }, [computeVisibleColumns])

  useEffect(() => {
    if (!signedUrl) return
    try { console.log('[SpreadsheetViewer] starting load', { filename, signedUrl }) } catch (_) { }
    const load = async () => {
      const res = await fetch(signedUrl)
      const contentType = res.headers.get('content-type') || ''
      const isCsv = contentType.includes('text/csv') || (filename || '').toLowerCase().endsWith('.csv')

      if (isCsv) {
        try { console.log('[SpreadsheetViewer] detected CSV content') } catch (_) { }
        // Parse CSV (use Papaparse if available; fallback to a simple split)
        const text = await res.text()
        try {
          const Papa = (await import('papaparse')).default
          const parsed = Papa.parse(text, { skipEmptyLines: false })
          const data = Array.isArray(parsed.data) ? parsed.data : []
          const maxCols = Math.min(
            Math.max(
              ...data.map(row => (Array.isArray(row) ? row.length : 0))
            ),
            512
          )
          let normalized = data.map((row, i) => ({
            index: i + 1,
            cells: Array.from({ length: maxCols }, (_, ci) => ({
              column: ci + 1,
              value: normalizeCellValue(Array.isArray(row) ? row[ci] : '')
            }))
          }))
          normalized = trimTrailingEmptyRows(normalized)
          // Single-sheet CSV
          const csvSheet = {
            name: 'Sheet1',
            rows: normalized,
            maxColumns: maxCols,
            mergeMap: new Map(),
            skipCells: new Set(),
            columnWidths: {}
          }
          setSheets([csvSheet])
          setActiveSheet('Sheet1')
          // Load into active view
          setRows(csvSheet.rows)
          setMaxColumns(csvSheet.maxColumns)
          setMergeMap(csvSheet.mergeMap)
          setSkipCells(csvSheet.skipCells)
          setColumnWidths(csvSheet.columnWidths)
          try { console.log('[SpreadsheetViewer] CSV loaded', { rows: normalized.length, cols: maxCols, filename }) } catch (_) { }
          return
        } catch (err) {
          // Fallback naive CSV parsing (handles basic quoted fields, may not handle all edge cases)
          const lines = text.split(/\r?\n/)
          const data = lines.map(parseCsvLine)
          const maxCols = Math.min(
            Math.max(...data.map(r => r.length)),
            512
          )
          let normalized = data.map((row, i) => ({
            index: i + 1,
            cells: Array.from({ length: maxCols }, (_, ci) => ({
              column: ci + 1,
              value: normalizeCellValue(row[ci])
            }))
          }))
          normalized = trimTrailingEmptyRows(normalized)
          const csvSheet = {
            name: 'Sheet1',
            rows: normalized,
            maxColumns: maxCols,
            mergeMap: new Map(),
            skipCells: new Set(),
            columnWidths: {}
          }
          setSheets([csvSheet])
          setActiveSheet('Sheet1')
          setRows(csvSheet.rows)
          setMaxColumns(csvSheet.maxColumns)
          setMergeMap(csvSheet.mergeMap)
          setSkipCells(csvSheet.skipCells)
          setColumnWidths(csvSheet.columnWidths)
          try { console.log('[SpreadsheetViewer] CSV (fallback) loaded', { rows: normalized.length, cols: maxCols, filename }) } catch (_) { }
          return
        }
      }

      // XLSX path
      try { console.log('[SpreadsheetViewer] detected XLSX content') } catch (_) { }
      const buf = await res.arrayBuffer()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(buf)
      // Build per-sheet models
      const builtSheets = []
      const addrToRC = (addr) => {
        const match = addr.match(/([A-Z]+)(\d+)/)
        const col = lettersToNumber(match[1])
        const row = parseInt(match[2], 10)
        return { row, col }
      }

      for (const ws of workbook.worksheets) {
        const wsColCount = ws?.columnCount || (ws?.columns?.length || 0) || 0
        const colLimit = Math.min(Math.max(wsColCount, 1), 16384, 512)
        const merges = (ws.model && ws.model.merges) ? ws.model.merges : []
        const mergeMapLocal = new Map()
        const skipLocal = new Set()
        merges.forEach(range => {
          const [start, end] = range.split(":")
          const { row: r1, col: c1 } = addrToRC(start)
          const { row: r2, col: c2 } = addrToRC(end)
          mergeMapLocal.set(`${r1}:${c1}`, { rowSpan: r2 - r1 + 1, colSpan: c2 - c1 + 1 })
          for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
              if (!(r === r1 && c === c1)) skipLocal.add(`${r}:${c}`)
            }
          }
        })

        const dataRows = []
        for (let r = 1; r <= ws.rowCount; r++) {
          const excelRow = ws.getRow(r)
          const rowData = { index: r, cells: [] }
          for (let c = 1; c <= colLimit; c++) {
            const cell = excelRow.getCell(c)
            const v = normalizeCellValue(cell.value)
            rowData.cells.push({ column: c, value: v })
          }
          dataRows.push(rowData)
        }

        const trimmed = dataRows // optional trim
        builtSheets.push({
          name: ws.name || `Sheet${builtSheets.length + 1}`,
          rows: trimmed,
          maxColumns: colLimit,
          mergeMap: mergeMapLocal,
          skipCells: skipLocal,
          columnWidths: {}
        })
      }

      // Prefer first non-empty sheet
      const firstNonEmpty = builtSheets.find(s => Array.isArray(s.rows) && s.rows.length > 0) || builtSheets[0]
      setSheets(builtSheets)
      setActiveSheet(firstNonEmpty?.name || null)

      if (firstNonEmpty) {
        setRows(firstNonEmpty.rows)
        setMaxColumns(firstNonEmpty.maxColumns)
        setMergeMap(firstNonEmpty.mergeMap)
        setSkipCells(firstNonEmpty.skipCells)
        setColumnWidths(firstNonEmpty.columnWidths)
        try { console.log('[SpreadsheetViewer] XLSX loaded', { sheetCount: builtSheets.length, active: firstNonEmpty.name, rows: firstNonEmpty.rows.length, cols: firstNonEmpty.maxColumns, filename }) } catch (_) { }
      }
    }
    load()
  }, [signedUrl])

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])


  useEffect(() => {
    // Compute immediately and again on next frame to ensure container measurements are ready
    computeVisibleColumns()
    const id = requestAnimationFrame(() => computeVisibleColumns())
    return () => cancelAnimationFrame(id)
  }, [computeVisibleColumns])

  // Switch active sheet helper: persists current view state back into sheets[], then loads the target
  const switchActiveSheet = useCallback((targetName) => {
    if (!targetName || targetName === activeSheet) return
    setSheets(prev => {
      const cloned = prev.map(s => ({ ...s }))
      // persist current sheet state back
      const idxPrev = cloned.findIndex(s => s.name === activeSheet)
      if (idxPrev >= 0) {
        cloned[idxPrev] = {
          ...cloned[idxPrev],
          rows,
          maxColumns,
          mergeMap,
          skipCells,
          columnWidths
        }
      }
      // load next
      const next = cloned.find(s => s.name === targetName)
      if (next) {
        // clear selections and editing when switching
        clearAllSelections()
        setRows(next.rows)
        setMaxColumns(next.maxColumns)
        setMergeMap(next.mergeMap)
        setSkipCells(next.skipCells)
        setColumnWidths(next.columnWidths || {})
      }
      return cloned
    })
    setActiveSheet(targetName)
    if (onSheetChange) {
      try { onSheetChange(targetName) } catch (_) { }
    }
  }, [activeSheet, rows, maxColumns, mergeMap, skipCells, columnWidths, onSheetChange])

  const beginDrag = (rowIndex, colIndex) => {
    if (editing) return
    dragStartRef.current = { row: rowIndex, col: colIndex }
    tempRangeRef.current = { col: colIndex, start: rowIndex, end: rowIndex }
    setTempRangeTick(t => t + 1)
  }

  const extendDrag = (rowIndex, colIndex) => {
    const start = dragStartRef.current
    if (!start) return
    if (colIndex !== start.col) return
    const s = Math.min(start.row, rowIndex)
    const e = Math.max(start.row, rowIndex)
    tempRangeRef.current = { col: start.col, start: s, end: e }
    setTempRangeTick(t => t + 1)
  }

  const endDrag = (rowIndex, colIndex) => {
    const r = tempRangeRef.current
    dragStartRef.current = null
    tempRangeRef.current = null
    setTempRangeTick(t => t + 1)
    if (!r) return
    if (onRangeSelect) onRangeSelect({ mode: selectionMode, ...r })
    lastRangeRef.current = r
  }

  useEffect(() => {
    const onResize = () => computeVisibleColumns()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [computeVisibleColumns])

  const startRow = Math.max(1, Math.floor(scrollTop / rowHeight) + 1)
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + 20
  const endRow = Math.min(rows.length, startRow + visibleCount)
  const safeStart = Math.min(startRow, Math.max(1, rows.length))
  const safeEnd = Math.min(endRow, rows.length)

  useEffect(() => {
    if (onSelectionChange) onSelectionChange(Array.from(selectedRows))
  }, [selectedRows, onSelectionChange])

  useEffect(() => {
    try { console.log('[SpreadsheetViewer] rows updated -> notifying parent. rows=%d', rows.length) } catch (_) { }
    if (onRowsChange) onRowsChange(rows)
  }, [rows])

  const toggleRowSelection = (rowIndex, withRange = false) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (withRange && lastSelectedRowRef.current != null) {
        const start = Math.min(lastSelectedRowRef.current, rowIndex)
        const end = Math.max(lastSelectedRowRef.current, rowIndex)
        for (let r = start; r <= end; r++) next.add(r)
      } else {
        if (next.has(rowIndex)) {
          next.delete(rowIndex)
        } else {
          next.add(rowIndex)
        }
        lastSelectedRowRef.current = rowIndex
      }
      return next
    })
  }

  const handleKeyDown = async (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      clearAllSelections()
      return
    }
    // Undo / Redo (Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z)
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z')) {
      e.preventDefault()
      if (e.shiftKey) {
        // Redo
        if (redoStack.length > 0) {
          const redo = redoStack[redoStack.length - 1]
          setRedoStack(prev => prev.slice(0, -1))
          setUndoStack(prev => [...prev, rows])
          setRows(redo)
          if (onRowsChange) onRowsChange(redo)
        }
      } else {
        // Undo
        if (undoStack.length > 0) {
          const prevRows = undoStack[undoStack.length - 1]
          setUndoStack(prev => prev.slice(0, -1))
          setRedoStack(prev => [...prev, rows])
          setRows(prevRows)
          if (onRowsChange) onRowsChange(prevRows)
        }
      }
      return
    }
    if (!selected) return
    const { r, c } = selected
    if (e.key === 'Enter' && !editing) {
      e.preventDefault()
      const value = rows[r - 1]?.cells?.[c - 1]?.value || ''
      setEditing({ r, c })
      setEditingValue(value)
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault()
      let out = ''
      const range = lastRangeRef.current
      if (range && range.col) {
        const vals = []
        for (let rowIndex = range.start; rowIndex <= range.end; rowIndex++) {
          vals.push(String(rows[rowIndex - 1]?.cells?.[range.col - 1]?.value ?? ''))
        }
        out = vals.join('\n')
      } else {
        out = String(rows[r - 1]?.cells?.[c - 1]?.value ?? '')
      }
      try { await navigator.clipboard.writeText(out) } catch (_) { }
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault()
      try {
        const text = await navigator.clipboard.readText()
        const lines = text.split(/\r?\n/)
        const snapshot = rows.map(row => ({ index: row.index, cells: row.cells.map(cell => ({ ...cell })) }))
        setUndoStack(prev => [...prev, snapshot])
        setRedoStack([])
        const next = snapshot.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell })) }))
        const startRow = r
        const pasteCol = (lastRangeRef.current && lastRangeRef.current.col) ? lastRangeRef.current.col : c
        for (let i = 0; i < lines.length; i++) {
          const rowIdx = startRow + i
          if (!next[rowIdx - 1]) break
          const cell = next[rowIdx - 1].cells[pasteCol - 1]
          if (cell) cell.value = lines[i]
        }
        setRows(next)
        if (onRowsChange) onRowsChange(next)
      } catch (_) { }
      return
    }
    // Delete content in selected range or cell
    if ((e.key === 'Delete' || e.key === 'Backspace') && !editing) {
      e.preventDefault()
      const snapshot = rows.map(row => ({ index: row.index, cells: row.cells.map(cell => ({ ...cell })) }))
      setUndoStack(prev => [...prev, snapshot])
      setRedoStack([])
      const next = snapshot.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell })) }))
      if (lastRangeRef.current && lastRangeRef.current.col) {
        const { col, start, end } = lastRangeRef.current
        for (let rowIndex = start; rowIndex <= end; rowIndex++) {
          const cell = next[rowIndex - 1]?.cells?.[col - 1]
          if (cell) cell.value = ''
        }
      } else if (selected) {
        const cell = next[r - 1]?.cells?.[c - 1]
        if (cell) cell.value = ''
      }
      setRows(next)
      if (onRowsChange) onRowsChange(next)
      return
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault()
      const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
      const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      setSelected({ r: Math.max(1, r + dr), c: Math.max(1, c + dc) })
    }
  }

  const clearAllSelections = () => {
    setEditing(null)
    setSelected(null)
    setSelectedRows(new Set())
    dragStartRef.current = null
    tempRangeRef.current = null
    setTempRangeTick(t => t + 1)
    if (onRangeSelect) onRangeSelect(null)
    if (onClearSelections) onClearSelections()
  }

  // Auto-resize inline editor based on content length
  const updateEditorHeight = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    el.style.height = 'auto'
    const minH = 28 // px, roughly one row height
    const maxH = 220 // clamp to avoid huge jumps
    const next = Math.min(maxH, Math.max(minH, el.scrollHeight))
    el.style.height = `${next}px`
  }, [])

  useEffect(() => {
    updateEditorHeight()
  }, [editing, editingValue, updateEditorHeight])

  useImperativeHandle(ref, () => ({
    getRows: () => rows,
    getSelectedRows: () => Array.from(selectedRows),
    getCellValue: (rowIndex, colIndex) => rows[rowIndex - 1]?.cells?.[colIndex - 1]?.value || '',
    getColumnWidths: () => widths,
    getMerges: () => {
      const out = []
      mergeMap.forEach((val, key) => {
        const [r, c] = key.split(":").map(n => parseInt(n, 10))
        out.push({ row: r, col: c, rowSpan: val?.rowSpan || 1, colSpan: val?.colSpan || 1 })
      })
      return out
    },
    getSheetNames: () => sheets.map(s => s.name),
    getActiveSheetName: () => activeSheet,
    setActiveSheetName: (name) => switchActiveSheet(name),
    setRowsFromSnapshot: (snapshotRows = []) => {
      const normalized = Array.isArray(snapshotRows) ? snapshotRows.map((r, idx) => ({
        index: r.index || idx + 1,
        cells: Array.isArray(r.cells) ? r.cells.map((c, ci) => ({ column: c?.column || ci + 1, value: c?.value ?? '' })) : []
      })) : []
      setRows(normalized)
      setSelected(null)
      setSelectedRows(new Set())
      clearAllSelections()
      // persist into current active sheet model
      setSheets(prev => prev.map(s => s.name === activeSheet ? { ...s, rows: normalized } : s))
    },
    setCellValue: (rowIndex, colIndex, value) => {
      setRows(prev => {
        const next = prev.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell })) }))
        const cell = next[rowIndex - 1]?.cells?.[colIndex - 1]
        if (cell) cell.value = value
        // also persist into sheet model
        setSheets(prevSheets => prevSheets.map(s => s.name === activeSheet ? { ...s, rows: next } : s))
        return next
      })
    },
    clearSelections: () => clearAllSelections()
  }))

  const setWidth = (c, w) => setColumnWidths(prev => ({ ...prev, [c]: Math.max(60, Math.min(480, w)) }))

  const handleCopy = (e) => {
    let out = ''
    const range = lastRangeRef.current
    if (range && range.col) {
      const vals = []
      for (let rowIndex = range.start; rowIndex <= range.end; rowIndex++) {
        vals.push(String(rows[rowIndex - 1]?.cells?.[range.col - 1]?.value ?? ''))
      }
      out = vals.join('\n')
    } else if (selected) {
      out = String(rows[selected.r - 1]?.cells?.[selected.c - 1]?.value ?? '')
    }
    if (out) {
      e.preventDefault()
      try { e.clipboardData.setData('text/plain', out) } catch (_) { }
    }
  }

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const lines = text.split(/\r?\n/)
    const startRow = selected ? selected.r : 1
    const pasteCol = (lastRangeRef.current && lastRangeRef.current.col) ? lastRangeRef.current.col : (selected ? selected.c : 1)
    const next = rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell })) }))
    for (let i = 0; i < lines.length; i++) {
      const rowIdx = startRow + i
      if (!next[rowIdx - 1]) break
      const cell = next[rowIdx - 1].cells[pasteCol - 1]
      if (cell) cell.value = lines[i]
    }
    setRows(next)
  }

  return (
    <div ref={rootRef} className="w-full" tabIndex={0} onKeyDown={handleKeyDown} onCopy={handleCopy} onPaste={handlePaste}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-2 mb-2 overflow-x-auto no-scrollbar">
          {sheets.map((s) => (
            <button
              key={s.name}
              className={`px-3 py-1.5 text-xs rounded border transition-colors whitespace-nowrap ${activeSheet === s.name ? 'bg-muted border-primary text-foreground' : 'bg-background hover:bg-muted/70 border-muted-foreground/30 text-muted-foreground'}`}
              onClick={() => switchActiveSheet(s.name)}
              title={s.name}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="border rounded overflow-auto bg-background"
        style={{ height: viewportHeight }}
      >
        <table
          className="w-max min-w-full text-xs border-collapse"
          onMouseDown={(e) => {
            const tag = (e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '')
            if (tag === 'textarea' || tag === 'input') return
            if (rootRef.current) rootRef.current.focus()
          }}
        >
          <thead className="sticky top-0 bg-background z-10">
            <tr>
              <th className="w-10 border bg-muted text-center select-none">
                <div className="px-1 py-0.5 text-[10px]">
                  Rows
                </div>
                <div className="flex gap-1 p-1">
                  <button className="px-1.5 py-0.5 border rounded text-[10px]" onClick={(e) => { e.preventDefault(); setSelectedRows(new Set(rows.map(r => r.index))) }}>All</button>
                  <button className="px-1.5 py-0.5 border rounded text-[10px]" onClick={(e) => { e.preventDefault(); setSelectedRows(new Set()) }}>Clear</button>
                </div>
              </th>
              {visibleCols.leftWidth > 0 ? (
                <th className="border bg-muted" style={{ width: visibleCols.leftWidth }} />
              ) : null}
              {Array.from({ length: Math.max(0, visibleCols.end - visibleCols.start + 1) }, (_, i) => visibleCols.start + i).map(c => (
                <th
                  key={c}
                  className={`relative border text-center font-normal select-none ${highlightColumns[c] ? (highlightColumns[c] === 'question' ? 'bg-blue-900/30 dark:bg-blue-900/30 bg-blue-100' : 'bg-emerald-900/30 dark:bg-emerald-900/30 bg-emerald-100') : 'bg-muted'}`}
                  style={{ width: columnWidths[c] || 140 }}
                  onClick={() => { if (onColumnHeaderClick) onColumnHeaderClick(c) }}
                >
                  {numberToLetters(c)}
                  <div
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                    onMouseDown={(e) => initDrag(e, c, columnWidths[c] || 140, setWidth)}
                  />
                </th>
              ))}
              {visibleCols.rightWidth > 0 ? (
                <th className="border bg-muted" style={{ width: visibleCols.rightWidth }} />
              ) : null}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: (startRow - 1) * rowHeight }} />
            {rows.slice(safeStart - 1, safeEnd).map((row) => (
              <tr key={row.index} style={{ height: rowHeight }}>
                <td
                  className={`w-10 text-center border select-none cursor-pointer ${selectedRows.has(row.index) ? 'bg-blue-900/20 dark:bg-blue-900/20' : 'bg-muted'}`}
                  onClick={(e) => toggleRowSelection(row.index, e.shiftKey)}
                  title="Click to select row; shift-click to select a range"
                >
                  {row.index}
                </td>
                {visibleCols.leftWidth > 0 ? (
                  <td className="border" style={{ width: visibleCols.leftWidth }} />
                ) : null}
                {Array.from({ length: Math.max(0, visibleCols.end - visibleCols.start + 1) }, (_, i) => visibleCols.start + i).map(c => {
                  if (skipCells.has(`${row.index}:${c}`)) return null
                  const cell = row.cells[c - 1]
                  const m = mergeMap.get(`${row.index}:${c}`)
                  const isSel = selected && selected.r === row.index && selected.c === c
                  const q = highlightRanges?.question
                  const a = highlightRanges?.answer
                  const isInQ = q && c === q.col && row.index >= q.start && row.index <= q.end
                  const isInA = a && c === a.col && row.index >= a.start && row.index <= a.end
                  const tmp = tempRangeRef.current
                  const isInTemp = tmp && selectionMode && c === tmp.col && row.index >= tmp.start && row.index <= tmp.end

                  return (
                    <td
                      key={c}
                      colSpan={m?.colSpan}
                      rowSpan={m?.rowSpan}
                      className={`border p-1 align-top select-none ${isSel ? 'ring-2 ring-blue-400' : ''}
                        ${isInQ ? 'bg-blue-100 text-blue-950 dark:bg-blue-900/40 dark:text-blue-100 ring-1 ring-blue-400/60' : ''}
                        ${isInA ? 'bg-emerald-100 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-100 ring-1 ring-emerald-400/60' : ''}
                        ${isInTemp ? (selectionMode === 'question' ? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-300/50' : 'bg-emerald-50 dark:bg-emerald-900/30 ring-1 ring-emerald-300/50') : ''}
                        ${highlightColumns[c] ? (highlightColumns[c] === 'question' ? 'bg-blue-100 text-blue-950 dark:bg-blue-900/20 dark:text-blue-100' : 'bg-emerald-100 text-emerald-950 dark:bg-emerald-900/20 dark:text-emerald-100') : ''}`}
                      style={{ width: columnWidths[c] || 140 }}
                      onMouseDown={(e) => {
                        // If currently editing this same cell, allow default so textarea can focus
                        if (editing && editing.r === row.index && editing.c === c) {
                          return
                        }
                        e.preventDefault();
                        beginDrag(row.index, c);
                        setSelected({ r: row.index, c })
                      }}
                      onMouseEnter={() => extendDrag(row.index, c)}
                      onMouseUp={(e) => { e.preventDefault(); endDrag(row.index, c) }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        const value = rows[row.index - 1]?.cells?.[c - 1]?.value || ''
                        setSelected({ r: row.index, c })
                        setEditing({ r: row.index, c })
                        setEditingValue(value)
                      }}
                    >
                      {editing && editing.r === row.index && editing.c === c ? (
                        <textarea
                          ref={editorRef}
                          className="w-full text-xs border rounded p-1 bg-background text-foreground resize-none"
                          value={editingValue}
                          onChange={(e) => { setEditingValue(e.target.value); updateEditorHeight(); }}
                          onBlur={() => {
                            setRows(prev => {
                              const next = prev.map(rw => ({ ...rw, cells: rw.cells.map(cl => ({ ...cl })) }))
                              const target = next[row.index - 1]?.cells?.[c - 1]
                              if (target) target.value = editingValue
                              return next
                            })
                            setEditing(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault(); setEditing(null)
                            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              setRows(prev => {
                                const next = prev.map(rw => ({ ...rw, cells: rw.cells.map(cl => ({ ...cl })) }))
                                const target = next[row.index - 1]?.cells?.[c - 1]
                                if (target) target.value = editingValue
                                return next
                              })
                              setEditing(null)
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <div
                          className="truncate cursor-text"
                          onDoubleClick={() => {
                            const value = rows[row.index - 1]?.cells?.[c - 1]?.value || ''
                            setEditing(null)
                            setTimeout(() => {
                              setEditing({ r: row.index, c })
                              setEditingValue(value)
                            }, 0)
                          }}
                        >
                          {cell?.value || ''}
                        </div>
                      )}
                    </td>
                  )
                })}
                {visibleCols.rightWidth > 0 ? (
                  <td className="border" style={{ width: visibleCols.rightWidth }} />
                ) : null}
              </tr>
            ))}
            <tr style={{ height: Math.max(0, (rows.length - endRow)) * rowHeight }} />
          </tbody>
        </table>
      </div>
    </div>
  )
})

export default SpreadsheetViewer

function lettersToNumber(letters) {
  let num = 0
  for (let i = 0; i < letters.length; i++) {
    num = num * 26 + (letters.charCodeAt(i) - 64)
  }
  return num
}

function numberToLetters(num) {
  let letters = ''
  while (num > 0) {
    const rem = (num - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    num = Math.floor((num - 1) / 26)
  }
  return letters
}

function normalizeCellValue(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    // rich text at top-level
    if (Array.isArray(value.richText)) return value.richText.map(rt => rt.text || '').join('')
    // hyperlink objects may store text as nested richText
    if (value.text && typeof value.text === 'object' && Array.isArray(value.text.richText)) {
      return value.text.richText.map(rt => rt.text || '').join('')
    }
    // plain text
    if (typeof value.text === 'string') return value.text
    // hyperlink with text string
    if (value.hyperlink && value.text != null) return String(value.text)
    // formula result
    if (value.result != null) return String(value.result)
    // shared string
    if (value.sharedString != null) return String(value.sharedString)
    // try common keys
    for (const k of ['display', 'value', 'val', 'content', 'data']) {
      if (value[k] != null) return String(value[k])
    }
  }
  return String(value || '')
}

function initDrag(e, col, startWidth, setWidth) {
  e.preventDefault()
  const startX = e.clientX
  const onMove = (ev) => {
    setWidth(col, startWidth + (ev.clientX - startX))
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// Trim trailing empty rows only if there are 10+ consecutive empty at the end
function trimTrailingEmptyRows(rows) {
  let end = rows.length - 1
  let emptyStreak = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const isEmpty = rows[i].cells.every(c => !String(c.value || '').trim())
    if (isEmpty) {
      emptyStreak++
    } else {
      // Only trim if we found 10+ empty rows at the end
      if (emptyStreak >= 10) {
        end = i
        break
      }
      emptyStreak = 0
      end = i
    }
  }
  // Final check: if we ended with empty rows, only trim if 10+ consecutive
  if (emptyStreak >= 10) {
    end = rows.length - emptyStreak - 1
  }
  return rows.slice(0, end + 1)
}

// Very small CSV parser for fallback (handles simple quotes, no escapes inside quotes)
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      // toggle quotes or handle double quotes
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue }
      inQuotes = !inQuotes
      continue
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}


