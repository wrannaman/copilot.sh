"use client";

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/toast-provider';
import { Upload, FileSpreadsheet, File, X, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

// AI-powered Excel structure analysis
const analyzeExcelStructureWithAI = async (rawData) => {
  try {
    // Prepare sample of first 20 rows for AI analysis
    const sampleRows = rawData.slice(0, 20).map((row, index) => ({
      rowIndex: index,
      content: row.map(cell => String(cell || '').substring(0, 100)) // Limit cell content
    }));

    const response = await fetch('/api/analyze-excel-structure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: sampleRows })
    });

    if (!response.ok) {
      throw new Error('AI analysis failed');
    }

    const result = await response.json();
    return {
      headerRowIndex: result.headerRowIndex || 0,
      questionColumnIndex: result.questionColumnIndex || 0,
      confidence: result.confidence || 'low'
    };
  } catch (error) {
    console.error('🚨 AI structure analysis failed, falling back to simple logic:', error);

    // Fallback: simple logic for header detection
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (!row) continue;

      const cellTexts = row.map(cell => String(cell || '').toLowerCase());
      const hasQuestionKeyword = cellTexts.some(text =>
        text.includes('question') || text.includes('response') || text.includes('answer')
      );

      if (hasQuestionKeyword && cellTexts.filter(t => t.length > 2).length >= 2) {
        return { headerRowIndex: i, questionColumnIndex: 0, confidence: 'fallback' };
      }
    }

    return { headerRowIndex: 0, questionColumnIndex: 0, confidence: 'fallback' };
  }
};

export function UploadQuestionnaire({ onUpload, onSheetSelection }) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [preview, setPreview] = useState(null);
  const { toast } = useToast();

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  }, []);

  const handleFileInput = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelection(selectedFile);
    }
  };

  const handleFileSelection = async (selectedFile) => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (selectedFile.size > maxSize) {
      toast.error('File too large', {
        description: 'Please select a file smaller than 10MB.'
      });
      return;
    }

    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];

    if (!allowedTypes.includes(selectedFile.type)) {
      toast.error('Invalid file type', {
        description: 'Please select a CSV or Excel file.'
      });
      return;
    }

    setFile(selectedFile);
    setIsProcessing(true);

    try {
      if (selectedFile.type === 'text/csv') {
        await processCSV(selectedFile);
      } else {
        await processExcel(selectedFile);
      }
    } catch (error) {
      toast.error('Error processing file', {
        description: error.message || 'Could not read the file.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const processCSV = async (file) => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          if (result.errors.length > 0) {
            reject(new Error('CSV parsing error: ' + result.errors[0].message));
            return;
          }

          const data = result.data;
          setSheets([{ name: 'Sheet1', data }]);
          setSelectedSheet('Sheet1');
          setPreview(data.slice(0, 5));
          resolve();
        },
        error: (error) => {
          reject(error);
        }
      });
    });
  };

  const processExcel = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });

          const sheetsData = await Promise.all(workbook.SheetNames.map(async (sheetName) => {
            const worksheet = workbook.Sheets[sheetName];

            // Get the range of the worksheet
            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');

            // Convert to array format first to analyze structure
            const rawData = XLSX.utils.sheet_to_json(worksheet, {
              header: 1,
              defval: '',
              raw: false,
              dateNF: 'yyyy-mm-dd'
            });

            if (rawData.length === 0) return null;

            // Use AI to intelligently find the header row and data structure
            const structureAnalysis = await analyzeExcelStructureWithAI(rawData);
            let headerRowIndex = structureAnalysis.headerRowIndex;

            console.log(`🤖 AI found headers at row ${headerRowIndex}:`, structureAnalysis);

            const headers = rawData[headerRowIndex]
              .map((header, index) => {
                if (header === null || header === undefined || header === '') {
                  return `Column_${index + 1}`;
                }
                return String(header).trim();
              })
              .filter((header, index, arr) => {
                // Remove duplicate headers by appending number
                const originalHeader = header;
                let counter = 1;
                while (arr.slice(0, index).includes(header)) {
                  header = `${originalHeader}_${counter}`;
                  counter++;
                }
                arr[index] = header;
                return true;
              });

            // Get data rows (skip header and any empty rows before it)
            const dataRows = rawData.slice(headerRowIndex + 1).filter(row => {
              if (!row || row.length === 0) return false;

              // Keep row if it has substantive content
              const nonEmptyCount = row.filter(cell =>
                cell !== null && cell !== undefined && cell !== '' &&
                String(cell).trim() !== ''
              ).length;

              // Must have at least 1 non-empty cell
              if (nonEmptyCount === 0) return false;

              // For questionnaires, the first column usually contains the question
              const firstCol = String(row[0] || '').trim();

              // Skip rows that are obviously not questions
              if (firstCol.length < 5) return false; // Too short
              if (/^(row|#|\d+\.?\d*$)/.test(firstCol.toLowerCase())) return false; // Just numbers/row labels
              if (/^(total|sum|count|average)/.test(firstCol.toLowerCase())) return false; // Summary rows

              return true;
            });

            if (dataRows.length === 0) return null;

            // Convert to object format with proper column handling
            const formattedData = dataRows.map((row, rowIndex) => {
              const obj = {};
              headers.forEach((header, colIndex) => {
                let cellValue = row[colIndex];

                // Handle different cell types
                if (cellValue === null || cellValue === undefined) {
                  cellValue = '';
                } else if (typeof cellValue === 'number') {
                  // Check if it's a date (Excel dates are numbers)
                  if (cellValue > 25569 && cellValue < 73050) { // Reasonable date range
                    try {
                      const date = new Date((cellValue - 25569) * 86400 * 1000);
                      if (!isNaN(date.getTime())) {
                        cellValue = date.toISOString().split('T')[0];
                      }
                    } catch (e) {
                      // Keep as number if date conversion fails
                    }
                  }
                } else if (typeof cellValue === 'boolean') {
                  cellValue = cellValue ? 'Yes' : 'No';
                } else {
                  cellValue = String(cellValue).trim();
                }

                obj[header] = cellValue;
              });
              return obj;
            });

            return {
              name: sheetName,
              data: formattedData,
              meta: {
                headerRowIndex,
                totalRows: rawData.length,
                dataRows: formattedData.length,
                columns: headers.length
              }
            };
          })).then(results => results.filter(Boolean));

          if (sheetsData.length === 0) {
            reject(new Error('No usable data found in the file. Please check that your Excel file contains tabular data.'));
            return;
          }

          setSheets(sheetsData);

          if (sheetsData.length === 1) {
            setSelectedSheet(sheetsData[0].name);
            setPreview(sheetsData[0].data.slice(0, 5));
          }

          resolve();
        } catch (error) {
          reject(new Error('Failed to read Excel file: ' + error.message));
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsArrayBuffer(file);
    });
  };

  const handleSheetSelect = (sheetName) => {
    setSelectedSheet(sheetName);
    const sheet = sheets.find(s => s.name === sheetName);
    if (sheet) {
      setPreview(sheet.data.slice(0, 5));
      onSheetSelection?.(sheet);
    }
  };

  const handleUpload = () => {
    const sheet = sheets.find(s => s.name === selectedSheet);
    if (sheet && file) {
      onUpload?.({
        file,
        sheet: sheet.data,
        sheetName: selectedSheet,
        columns: Object.keys(sheet.data[0] || {})
      });
    }
  };

  const resetUpload = () => {
    setFile(null);
    setSheets([]);
    setSelectedSheet('');
    setPreview(null);
  };

  if (file && sheets.length > 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                File Ready for Processing
              </CardTitle>
              <CardDescription>
                {file.name} • {(file.size / 1024).toFixed(1)} KB
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={resetUpload}>
              <X className="h-4 w-4 mr-2" />
              Remove
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {sheets.length > 1 && (
            <div className="space-y-2">
              <Label>Select Sheet</Label>
              <div className="grid grid-cols-1 gap-2">
                {sheets.map((sheet) => (
                  <Button
                    key={sheet.name}
                    variant={selectedSheet === sheet.name ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleSheetSelect(sheet.name)}
                    className="justify-start h-auto p-3"
                  >
                    <div className="text-left">
                      <div className="font-medium">{sheet.name}</div>
                      <div className="text-xs opacity-70">
                        {sheet.data.length} rows • {sheet.meta?.columns || 0} columns
                        {sheet.meta?.headerRowIndex > 0 && ` • Headers on row ${sheet.meta.headerRowIndex + 1}`}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {preview && (
            <div className="space-y-2">
              <Label>Data Preview</Label>
              <div className="text-xs text-muted-foreground mb-2">
                Found {Object.keys(preview[0] || {}).length} columns: {Object.keys(preview[0] || {}).join(', ')}
              </div>
              <div className="border rounded-md overflow-hidden">
                <div className="overflow-x-auto max-w-full">
                  <table className="min-w-full text-sm border-collapse">
                    <thead className="bg-muted">
                      <tr>
                        {Object.keys(preview[0] || {}).map((header) => (
                          <th key={header} className="px-3 py-2 text-left font-medium border-r border-muted-foreground/20 min-w-[120px] max-w-[200px]">
                            <div className="truncate" title={header}>
                              {header}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, index) => (
                        <tr key={index} className="border-t">
                          {Object.values(row).map((cell, cellIndex) => (
                            <td key={cellIndex} className="px-3 py-2 border-r border-muted-foreground/10 min-w-[120px] max-w-[200px]">
                              <div className="truncate" title={String(cell)}>
                                {String(cell).substring(0, 30)}
                                {String(cell).length > 30 && '...'}
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Showing first 5 rows of {sheets.find(s => s.name === selectedSheet)?.data.length || 0} total rows • Scroll horizontally to see all columns
              </p>
            </div>
          )}

          <Button
            onClick={handleUpload}
            className="w-full"
            disabled={!selectedSheet}
          >
            <Upload className="h-4 w-4 mr-2" />
            Process Questionnaire
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload Questionnaire
        </CardTitle>
        <CardDescription>
          Upload a CSV or Excel file containing your security questionnaire
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25'
            }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isProcessing ? (
            <div className="space-y-4">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">Processing file...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <File className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <p className="text-lg font-medium">
                  Drag and drop your file here
                </p>
                <p className="text-muted-foreground">
                  or click to browse files
                </p>
              </div>
              <div className="space-y-2">
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileInput}
                  className="cursor-pointer"
                />
                <p className="text-xs text-muted-foreground">
                  Supports CSV and Excel files up to 10MB
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
