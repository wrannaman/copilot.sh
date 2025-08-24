'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Download, FileSpreadsheet, Eye, CheckCircle, Clock, AlertCircle, ExternalLink } from 'lucide-react'
import { useToast } from '@/components/toast-provider'

export default function ExcelExport({ questionnaireId, questionnaireName, items = [] }) {
  const [isDownloading, setIsDownloading] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  // Calculate stats
  const totalItems = items.length
  const completedItems = items.filter(item =>
    item.final_answer || item.draft_answer
  ).length
  const pendingItems = totalItems - completedItems

  const completionPercentage = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

  const handleDownload = async () => {
    setIsDownloading(true)

    try {
      console.log('🔽 [EXCEL-EXPORT] Starting download for questionnaire:', questionnaireId)

      const response = await fetch(`/api/questionnaire-excel/${questionnaireId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Download failed: ${response.status}`)
      }

      // Get the filename from the response headers
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `${questionnaireName}_completed.xlsx`

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }

      // Download the file
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success('Excel file downloaded successfully!', {
        description: `Your completed questionnaire is ready in ${filename}`
      })

    } catch (error) {
      console.error('💥 [EXCEL-EXPORT] Download failed:', error)
      toast.error('Download failed', {
        description: error.message || 'Could not generate Excel file'
      })
    } finally {
      setIsDownloading(false)
    }
  }

  const getStatusBadge = (item) => {
    if (item.final_answer) {
      return <Badge variant="success" className="text-xs">
        <CheckCircle className="w-3 h-3 mr-1" />
        Final
      </Badge>
    } else if (item.draft_answer) {
      return <Badge variant="secondary" className="text-xs">
        <Clock className="w-3 h-3 mr-1" />
        Draft
      </Badge>
    } else {
      return <Badge variant="outline" className="text-xs">
        <AlertCircle className="w-3 h-3 mr-1" />
        Pending
      </Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Export Summary Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                Excel Export
              </CardTitle>
              <CardDescription>
                Download your original Excel file with AI-generated answers filled in
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-green-600">{completionPercentage}%</div>
              <div className="text-sm text-muted-foreground">Complete</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Progress Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{completedItems}</div>
                <div className="text-sm text-muted-foreground">Answered</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{pendingItems}</div>
                <div className="text-sm text-muted-foreground">Pending</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{totalItems}</div>
                <div className="text-sm text-muted-foreground">Total</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={() => router.push(`/questionnaires/${questionnaireId}/excel-mapping`)}
                className="flex-1"
              >
                <Download className="w-4 h-4 mr-2" />
                Map Answers to Excel
              </Button>
            </div>

            {/* Export Info */}
            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
              <div className="font-medium mb-1">How Excel Export Works:</div>
              <ul className="space-y-1">
                <li>• <strong>Interactive Mapping:</strong> See your actual Excel file and choose exactly where answers go</li>
                <li>• <strong>Visual Control:</strong> Click on questions, then click on Excel cells to map</li>
                <li>• <strong>Smart Detection:</strong> Auto-detects questions and suggests answer placement</li>
                <li>• <strong>Perfect Results:</strong> Preserves formatting and places answers exactly where you want</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>


    </div>
  )
}
