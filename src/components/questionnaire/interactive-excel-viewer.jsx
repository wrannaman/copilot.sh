'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  FileSpreadsheet,
  Target,
  CheckCircle,
  AlertCircle,
  Download,
  Edit3,
  Bot
} from 'lucide-react'
import { useToast } from '@/components/toast-provider'

export default function InteractiveExcelViewer({ questionnaireId, items = [], refreshTrigger = 0 }) {
  const [excelData, setExcelData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [populatedData, setPopulatedData] = useState(null)
  const [selectedAnswerColumn, setSelectedAnswerColumn] = useState(null)
  const [showInstructions, setShowInstructions] = useState(false)
  const [editingCellKey, setEditingCellKey] = useState(null)
  const [processing, setProcessing] = useState(false)
  const { toast } = useToast()

  // Get items with answers
  const itemsWithAnswers = items.filter(item =>
    item.final_answer || item.draft_answer
  )

  useEffect(() => {
    if (questionnaireId) {
      loadExcelPreview()
    }
  }, [questionnaireId, refreshTrigger])

  const loadExcelPreview = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/excel-preview/${questionnaireId}`)
      if (!response.ok) throw new Error('Failed to load Excel preview')

      const data = await response.json()
      console.log("🚀 ~ data:", data)
      setExcelData(data)

      // Auto-populate answers
      autoPopulateAnswers(data)

    } catch (error) {
      console.error('Failed to load Excel preview:', error)
      toast.error('Failed to load Excel preview', {
        description: error.message
      })
    } finally {
      setLoading(false)
    }
  }

  const autoPopulateAnswers = (data) => {
    if (!data.rows || itemsWithAnswers.length === 0) {
      setPopulatedData(data)
      return
    }

    console.log('🤖 Auto-populating answers...')

    const headerRowIndex = data.headerRowIndex

    // Find the best question column (has the most question-like content)
    let bestQuestionColumn = 1
    let maxQuestionScore = 0

    for (let colIndex = 1; colIndex <= Math.min(6, data.maxColumns); colIndex++) {
      let questionScore = 0

      data.rows.forEach(row => {
        if (row.index <= headerRowIndex) return

        const cell = row.cells.find(c => c.column === colIndex)
        if (!cell?.value || cell.value.length < 20) return

        const text = cell.value.toLowerCase()

        // Score this cell as a potential question
        if (text.includes('?')) questionScore += 3
        if (text.includes('do you') || text.includes('does the') || text.includes('have you')) questionScore += 2
        if (text.includes('organization') || text.includes('company') || text.includes('policy')) questionScore += 1
        if (text.length > 50) questionScore += 1
      })

      if (questionScore > maxQuestionScore) {
        maxQuestionScore = questionScore
        bestQuestionColumn = colIndex
      }
    }

    // Find the best answer/response/comments column based on header names near the detected header row
    let bestAnswerColumn = bestQuestionColumn + 1
    const headerRow = data.rows.find(r => r.index === headerRowIndex)
    if (headerRow) {
      const candidates = headerRow.cells
        .map(c => ({ col: c.column, text: (c.value || '').toLowerCase() }))
        .filter(c => c.text)
      const score = (t) => (
        (t.includes('response') ? 3 : 0) +
        (t.includes('answer') ? 3 : 0) +
        (t.includes('comment') ? 2 : 0) +
        (t.includes('supplier') ? 1 : 0)
      )
      let best = { col: bestAnswerColumn, s: -1 }
      candidates.forEach(c => {
        const s = score(c.text)
        if (s > best.s) best = { col: c.col, s }
      })
      if (best.s >= 0) bestAnswerColumn = best.col
    }

    // Clone the data
    const newData = JSON.parse(JSON.stringify(data))
    let matchCount = 0

    // Populate answers
    newData.rows.forEach(row => {
      if (row.index <= headerRowIndex) return

      const questionCell = row.cells.find(c => c.column === bestQuestionColumn)
      if (!questionCell?.value || questionCell.value.length < 20) return

      const excelQuestion = questionCell.value.toLowerCase().trim()

      // Find best matching AI answer
      let bestMatch = null
      let bestSimilarity = 0

      itemsWithAnswers.forEach(item => {
        const itemQuestion = item.question?.toLowerCase().trim()
        if (!itemQuestion) return

        const similarity = calculateSimilarity(itemQuestion, excelQuestion)
        if (similarity > bestSimilarity && similarity > 0.3) {
          bestSimilarity = similarity
          bestMatch = item
        }
      })

      if (bestMatch) {
        // Find or create the answer cell
        let answerCell = row.cells.find(c => c.column === bestAnswerColumn)
        if (!answerCell) {
          answerCell = { column: bestAnswerColumn, value: '', isEmpty: true }
          row.cells.push(answerCell)
          // Sort cells by column
          row.cells.sort((a, b) => a.column - b.column)
        }

        // Only populate if cell is empty (avoid overwriting existing responses)
        if (answerCell.isEmpty || !String(answerCell.value || '').trim()) {
          const answer = bestMatch.final_answer || bestMatch.draft_answer
          answerCell.value = answer
          answerCell.isEmpty = false
          answerCell.isAiGenerated = true
          answerCell.aiItemId = bestMatch.id
          answerCell.aiQuestion = bestMatch.question
          answerCell.confidence = Math.round(bestSimilarity * 100)

          matchCount++
        }
      }
    })

    setPopulatedData(newData)
    setSelectedAnswerColumn(bestAnswerColumn)

    if (matchCount > 0) {
      toast.success(`Auto-populated ${matchCount} answers`, {
        description: 'Click any blue answer to edit it'
      })
    } else {
      toast.warning('No matches found', {
        description: 'Click column headers to manually place answers'
      })
    }
  }

  const calculateSimilarity = (str1, str2) => {
    if (!str1 || !str2) return 0

    const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 3)

    let matches = 0
    words1.forEach(word1 => {
      words2.forEach(word2 => {
        if (word2.includes(word1) || word1.includes(word2)) {
          matches++
        }
      })
    })

    return matches / Math.max(words1.length, words2.length, 1)
  }

  const handleCellEdit = (rowIndex, colIndex, newValue) => {
    if (!populatedData) return

    const updatedData = JSON.parse(JSON.stringify(populatedData))
    const row = updatedData.rows.find(r => r.index === rowIndex)
    if (!row) return

    let cell = row.cells.find(c => c.column === colIndex)
    if (!cell) {
      cell = { column: colIndex, value: '', isEmpty: true }
      row.cells.push(cell)
      row.cells.sort((a, b) => a.column - b.column)
    }

    cell.value = newValue
    cell.isEmpty = !newValue.trim()

    setPopulatedData(updatedData)
    setEditingCellKey(null)
  }

  const handleColumnSelect = (columnIndex) => {
    if (!excelData || processing) return

    setProcessing(true)
    setSelectedAnswerColumn(columnIndex)

    // Re-populate all answers to this column
    // (simplified version - just move existing AI answers)
    const updatedData = JSON.parse(JSON.stringify(populatedData || excelData))

    // Clear existing AI answers
    updatedData.rows.forEach(row => {
      row.cells.forEach(cell => {
        if (cell.isAiGenerated) {
          cell.value = ''
          cell.isEmpty = true
          cell.isAiGenerated = false
          delete cell.aiItemId
        }
      })
    })

    // Re-run auto-population with new target column
    autoPopulateAnswers(updatedData)

    setProcessing(false)
    toast.success(`Moved answers to column ${String.fromCharCode(64 + columnIndex)}`)
  }

  const handleDownload = async () => {
    if (!populatedData || processing) return

    try {
      setProcessing(true)

      // Create column mapping
      const columnMapping = {}
      const answerEdits = {}

      populatedData.rows.forEach(row => {
        row.cells.forEach(cell => {
          if (cell.isAiGenerated && cell.aiItemId) {
            columnMapping[cell.aiItemId] = {
              column: cell.column,
              type: 'answers'
            }
            answerEdits[cell.aiItemId] = cell.value
          }
        })
      })

      const response = await fetch(`/api/questionnaire-excel/${questionnaireId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          columnMapping,
          answerEdits
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate Excel file')
      }

      // Download the file
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `${excelData.filename.replace(/\.[^/.]+$/, '')}_completed.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success('Excel file downloaded!', {
        description: 'Your completed questionnaire with all original formatting.'
      })

    } catch (error) {
      console.error('Download failed:', error)
      toast.error('Download failed', {
        description: error.message
      })
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="p-12 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <h3 className="font-medium text-lg mb-2">Loading Excel File</h3>
          <p className="text-muted-foreground">Reading your original file and matching questions...</p>
        </CardContent>
      </Card>
    )
  }

  if (!excelData) {
    return (
      <Card className="w-full">
        <CardContent className="p-12 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-medium text-lg mb-2">Could not load Excel file</h3>
          <p className="text-muted-foreground">There was an issue loading your Excel file for preview.</p>
        </CardContent>
      </Card>
    )
  }

  const displayData = populatedData || excelData
  const aiAnswerCount = (displayData.rows || []).reduce((count, row) => {
    return count + (row.cells ? row.cells.filter(cell => cell.isAiGenerated).length : 0)
  }, 0)

  return (
    <div className="w-full space-y-4">
      {/* Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-blue-500" />
                Auto-Populated Excel
              </CardTitle>
              <CardDescription>
                {aiAnswerCount > 0 ?
                  `${aiAnswerCount} answers populated from your AI responses. Blue cells are editable.` :
                  'No answers could be automatically matched. Click column headers to manually place answers.'
                }
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowInstructions(true)}
              >
                <Target className="w-4 h-4 mr-2" />
                Help
              </Button>
              <Badge variant="default" className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                {aiAnswerCount} AI answers
              </Badge>
              {aiAnswerCount > 0 && (
                <Button
                  onClick={handleDownload}
                  disabled={processing}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export Excel
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Excel Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            {excelData.filename}
          </CardTitle>
          <CardDescription>
            This is your original Excel file with AI answers filled in. Click blue cells to edit. Click column headers to move all answers to that column.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto border rounded max-h-[75vh]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-12 text-center text-xs border-r bg-muted">#</TableHead>
                  {Array.from({ length: Math.min(12, displayData.maxColumns) }, (_, i) => {
                    const colIndex = i + 1
                    const isSelectedAnswerCol = selectedAnswerColumn === colIndex
                    const hasAiAnswers = displayData.rows.some(row =>
                      row.cells.some(cell => cell.column === colIndex && cell.isAiGenerated)
                    )

                    return (
                      <TableHead
                        key={colIndex}
                        className={`text-center text-xs border-r cursor-pointer min-w-32 p-2 transition-colors ${isSelectedAnswerCol || hasAiAnswers ?
                          'bg-blue-100 dark:bg-blue-900 border-blue-500' :
                          'hover:bg-muted/70'
                          }`}
                        onClick={() => handleColumnSelect(colIndex)}
                        title={
                          hasAiAnswers ?
                            'Contains AI answers - click to move all answers here' :
                            'Click to place all AI answers in this column'
                        }
                      >
                        <div className="flex items-center justify-center gap-1">
                          {String.fromCharCode(64 + colIndex)}
                          {hasAiAnswers && <Bot className="w-3 h-3 text-blue-600" />}
                        </div>
                      </TableHead>
                    )
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayData.rows.slice(0, 100).map((row) => {
                  return (
                    <TableRow key={row.index}>
                      <TableCell className="text-center font-mono text-xs bg-muted/70 font-medium border-r">
                        {row.index}
                      </TableCell>
                      {Array.from({ length: Math.min(12, displayData.maxColumns) }, (_, i) => {
                        const colIndex = i + 1
                        const cell = row.cells.find(c => c.column === colIndex)
                        const cellKey = `${row.index}-${colIndex}`
                        const isEditing = editingCellKey === cellKey
                        const isAiAnswer = cell?.isAiGenerated

                        return (
                          <TableCell
                            key={colIndex}
                            className={`p-1 text-xs border-r max-w-64 relative ${isAiAnswer ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200' : ''
                              }`}
                          >
                            {isAiAnswer && (
                              <div className="absolute top-0 right-0 p-1">
                                <Bot className="w-3 h-3 text-blue-500" title={`AI Answer (${cell.confidence}% match)\nOriginal question: ${cell.aiQuestion}`} />
                              </div>
                            )}
                            {isEditing ? (
                              <Textarea
                                className="w-full min-h-16 text-xs border-none p-1 bg-white dark:bg-gray-800 resize-none"
                                value={cell?.value || ''}
                                onChange={(e) => handleCellEdit(row.index, colIndex, e.target.value)}
                                onBlur={() => setEditingCellKey(null)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') setEditingCellKey(null)
                                  if (e.key === 'Enter' && e.ctrlKey) setEditingCellKey(null)
                                }}
                                autoFocus
                              />
                            ) : (
                              <div
                                className={`break-words leading-tight p-1 ${isAiAnswer ? 'cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900 rounded' : ''
                                  }`}
                                onClick={() => isAiAnswer && setEditingCellKey(cellKey)}
                                title={isAiAnswer ? 'Click to edit this AI answer' : ''}
                              >
                                {cell?.value || ''}
                              </div>
                            )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Instructions Modal */}
      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-blue-500" />
              How Excel Auto-Population Works
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">What happens automatically:</h4>
              <ol className="text-sm space-y-1">
                <li>1. 📄 We load your original Excel file</li>
                <li>2. 🔍 We find the column with questions</li>
                <li>3. 🤖 We match your AI answers to Excel questions</li>
                <li>4. ✍️ We fill in answers in the next empty column</li>
              </ol>
            </div>

            <div>
              <h4 className="font-medium mb-2">How to edit:</h4>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-50 border border-blue-300 rounded"></div>
                  <Bot className="w-3 h-3 text-blue-500" />
                  <span>Blue cells = AI answers (click to edit)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-muted border rounded"></div>
                  <span>Gray cells = Original content (unchanged)</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">To move answers:</h4>
              <p className="text-sm">Click any column header (A, B, C...) to move all AI answers to that column.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}