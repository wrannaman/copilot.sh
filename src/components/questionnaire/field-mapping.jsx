"use client";

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/components/toast-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, CheckCircle, AlertCircle, Settings, Brain, Loader2 } from 'lucide-react';

const SYSTEM_FIELDS = [
  { key: 'question', label: 'Question Text', required: true, description: 'The actual question you need to answer' },
  { key: 'original_answer', label: 'Existing Answer', required: false, description: 'Pre-filled answer if any (we can improve it)' },
  { key: 'section', label: 'Category/Section', required: false, description: 'Question topic (e.g., "Access Control", "Data Security")' },
  { key: 'row_number', label: 'Row Number', required: false, description: 'Question order/number in the original document' },
  { key: 'ignore', label: 'Skip Column', required: false, description: 'Ignore this column completely' }
];

export function FieldMapping({ columns, sampleData, onMappingComplete, initialMapping = {}, headerRowIndex = 1 }) {
  const [mapping, setMapping] = useState(initialMapping);
  const [isValid, setIsValid] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiConfidence, setAiConfidence] = useState(null);
  const [autoMapped, setAutoMapped] = useState(false);
  const [aiError, setAiError] = useState(null);
  const aiMappingStarted = useRef(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // Create a stable key based on the data to prevent re-runs
  const dataKey = `${columns.length}-${sampleData?.length}-${user?.id}`;

  useEffect(() => {
    const hasQuestion = Object.values(mapping).includes('question');
    setIsValid(hasQuestion);
  }, [mapping]);

  // Auto-run AI mapping when data is ready (only once per data set)
  useEffect(() => {
    const shouldRun = columns.length > 0 && sampleData && sampleData.length > 0 && user?.id && !autoMapped && !aiAnalyzing;

    console.log('🔍 [AI-MAPPING] Effect triggered:', {
      dataKey,
      shouldRun,
      aiMappingStarted: aiMappingStarted.current
    });

    // Only run if we haven't started for this specific dataset
    if (shouldRun && aiMappingStarted.current !== dataKey) {
      console.log('🚀 [AI-MAPPING] Auto-starting AI field mapping for:', dataKey);
      aiMappingStarted.current = dataKey;
      handleAiAutoMapping();
    }
  }, [dataKey, autoMapped, aiAnalyzing]);

  const handleFieldMapping = (column, systemField) => {
    const newMapping = { ...mapping };

    // Remove any existing mapping to this system field
    Object.keys(newMapping).forEach(key => {
      if (newMapping[key] === systemField) {
        delete newMapping[key];
      }
    });

    // Set new mapping
    if (systemField && systemField !== 'ignore') {
      newMapping[column] = systemField;
    } else {
      delete newMapping[column];
    }

    setMapping(newMapping);
  };

  const getUsedFields = () => {
    return Object.values(mapping).filter(field => field !== 'ignore');
  };

  const isFieldUsed = (field) => {
    return getUsedFields().includes(field);
  };

  const getMappedColumn = (field) => {
    return Object.keys(mapping).find(col => mapping[col] === field);
  };

  const handleAiAutoMapping = async () => {
    if (!sampleData || sampleData.length === 0) {
      toast.error('No sample data available for AI analysis');
      return;
    }

    setAiAnalyzing(true);

    try {
      console.log('🤖 [AI-MAPPING] Starting AI field mapping...');

      const response = await fetch('/api/ai-field-mapping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          columns,
          sampleData,
          userId: user?.id,
          headerRowIndex,
          maxColumns: 20,
          maxRows: 20
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'AI mapping failed');
      }

      const result = await response.json();
      console.log('✅ [AI-MAPPING] AI mapping successful:', result);

      setMapping(result.mapping);
      setAiConfidence(result.confidence);
      setAutoMapped(true);
      setAiError(null);

      toast.success(`AI mapped ${result.mappedFields} fields with ${result.confidence} confidence`, {
        description: result.confidence === 'high' ? 'Mapping looks great! You can proceed directly.' : 'Please review the mapping before continuing.'
      });

      // If high confidence, auto-proceed after a short delay
      if (result.confidence === 'high') {
        setTimeout(() => {
          toast.success('High confidence mapping - proceeding automatically!');
          onMappingComplete?.(result.mapping);
        }, 2000);
      }

    } catch (error) {
      console.error('❌ [AI-MAPPING] AI mapping failed:', error);
      toast.error('AI field mapping failed', {
        description: error.message + ' - Falling back to basic auto-mapping.'
      });
      setAiError(error.message || 'AI mapping failed');

      // Fallback to basic keyword mapping
      handleBasicAutoMapping();
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleBasicAutoMapping = () => {
    const autoMapping = {};
    const usedSystemFields = [];

    // Auto-map based on common column names
    const mappingHints = [
      { keywords: ['question', 'query', 'q'], field: 'question' },
      { keywords: ['answer', 'response', 'reply', 'a'], field: 'original_answer' },
      { keywords: ['section', 'category', 'domain', 'area'], field: 'section' },
      { keywords: ['row', 'number', 'index', '#'], field: 'row_number' }
    ];

    columns.forEach(column => {
      const lowerColumn = column.toLowerCase();

      for (const hint of mappingHints) {
        if (hint.keywords.some(keyword => lowerColumn.includes(keyword)) &&
          !usedSystemFields.includes(hint.field)) {
          autoMapping[column] = hint.field;
          usedSystemFields.push(hint.field);
          break;
        }
      }
    });

    setMapping(autoMapping);
  };

  const handleComplete = () => {
    onMappingComplete?.(mapping);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Field Mapping
            </CardTitle>
            <CardDescription>
              We auto-map your columns first. If needed, you can adjust below.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAiAutoMapping}
              disabled={aiAnalyzing || !sampleData}
            >
              {aiAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  AI Analyzing...
                </>
              ) : (
                <>
                  <Brain className="h-4 w-4 mr-2" />
                  AI Auto-Map
                </>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleBasicAutoMapping}>
              Basic Auto-Map
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Blocking: hide mapping UI until AI finishes its first attempt */}
        {aiAnalyzing && !autoMapped && !aiError ? (
          <div className="p-8 border rounded-lg bg-muted/30 text-center">
            <Loader2 className="h-6 w-6 mx-auto mb-3 animate-spin" />
            <div className="font-medium mb-1">Analyzing your spreadsheet</div>
            <div className="text-sm text-muted-foreground">Auto-mapping columns. We’ll show the mapping as soon as it’s ready.</div>
          </div>
        ) : (
          <>
            {/* AI Status & Validation */}
            <div className="space-y-3">
              {aiAnalyzing && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                  <span className="text-sm font-medium text-blue-900">
                    Auto-mapping your columns...
                  </span>
                </div>
              )}

              {aiError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                  <span className="text-sm font-medium text-amber-900">
                    Automatic mapping couldn’t complete. Map manually below.
                  </span>
                </div>
              )}

              {aiConfidence && autoMapped && (
                <div className={`flex items-center gap-2 p-3 rounded-lg ${aiConfidence === 'high' ? 'bg-green-50 border border-green-200' :
                  aiConfidence === 'medium' ? 'bg-yellow-50 border border-yellow-200' :
                    'bg-red-50 border border-red-200'
                  }`}>
                  <Brain className={`h-5 w-5 ${aiConfidence === 'high' ? 'text-green-600' :
                    aiConfidence === 'medium' ? 'text-yellow-600' :
                      'text-red-600'
                    }`} />
                  <span className={`text-sm font-medium ${aiConfidence === 'high' ? 'text-green-900' :
                    aiConfidence === 'medium' ? 'text-yellow-900' :
                      'text-red-900'
                    }`}>
                    AI mapped fields with {aiConfidence} confidence
                    {aiConfidence === 'high' && ' - proceeding automatically!'}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                {isValid ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                )}
                <span className="text-sm font-medium">
                  {isValid ? 'Mapping is valid' : 'Question field is required'}
                </span>
              </div>
            </div>

            {/* Instructions */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h3 className="font-medium text-blue-900 mb-2">How this works</h3>
              <p className="text-sm text-blue-800 mb-3">
                We auto-map first. If needed, you can adjust below. At least one column must be mapped to Question.
              </p>
              <div className="text-xs text-blue-700">
                <strong>Required:</strong> At least one column must be mapped to "Question" (the actual question text)
              </div>
            </div>

            {/* Column Mappings */}
            <div className="space-y-4">
              <Label className="text-base font-medium">Map Your Spreadsheet Columns</Label>
              <div className="grid gap-4">
                {columns.map((column, idx) => {
                  // Get sample data for this column
                  const sampleValues = sampleData?.slice(0, 3).map(row => row[column]).filter(val => val && String(val).trim()) || [];

                  return (
                    <div key={`${column}-${idx}`} className="flex items-center gap-4 p-4 border rounded-lg bg-card">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium mb-1">{column}</div>
                        {sampleValues.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">Sample data:</span>
                            <div className="mt-1 space-y-1">
                              {sampleValues.slice(0, 2).map((value, idx) => (
                                <div key={idx} className="truncate bg-muted/50 px-2 py-1 rounded">
                                  "{String(value).substring(0, 60)}{String(value).length > 60 ? '...' : ''}"
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                      <div className="flex-1">
                        <Select
                          value={mapping[column] || ''}
                          onValueChange={(value) => handleFieldMapping(column, value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="What type of data is this?" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ignore">
                              <span className="text-muted-foreground">Skip this column</span>
                            </SelectItem>
                            {SYSTEM_FIELDS.map((field) => (
                              <SelectItem
                                key={field.key}
                                value={field.key}
                                disabled={isFieldUsed(field.key)}
                              >
                                <div className="flex items-center gap-2">
                                  <span>{field.label}</span>
                                  {field.required && (
                                    <Badge variant="destructive" className="text-xs">Required</Badge>
                                  )}
                                  {isFieldUsed(field.key) && (
                                    <Badge variant="outline" className="text-xs">Used</Badge>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {mapping[column] && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {SYSTEM_FIELDS.find(f => f.key === mapping[column])?.description}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* System Fields Overview */}
            <div className="space-y-4">
              <Label className="text-base font-medium">System Fields Status</Label>
              <div className="grid grid-cols-2 gap-3">
                {SYSTEM_FIELDS.filter(field => field.key !== 'ignore').map((field) => {
                  const mappedColumn = getMappedColumn(field.key);
                  const isMapped = !!mappedColumn;

                  return (
                    <div
                      key={field.key}
                      className={`p-3 rounded-lg border ${isMapped
                        ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700'
                        : field.required
                          ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700'
                          : 'bg-muted/50'
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm">{field.label}</div>
                        {field.required && (
                          <Badge variant="destructive" className="text-xs">Required</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {isMapped ? `Mapped to: ${mappedColumn}` : 'Not mapped'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Continue Button */}
            <Button
              onClick={handleComplete}
              disabled={!isValid}
              className="w-full"
              size="lg"
            >
              Continue
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
