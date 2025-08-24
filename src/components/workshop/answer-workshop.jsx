"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/toast-provider';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  MessageCircle,
  Download,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  Clock,
  Send,
  Sparkles,
  Eye,
  Edit,
  Save,
  X,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  RotateCcw
} from 'lucide-react';
import { ChatInterface } from './chat-interface';
import { CitationsViewer } from './citations-viewer';
import { AIProcessor } from './ai-processor';
import Link from 'next/link';
import { updateQuestionnaireStatus } from '@/utils/questionnaire-status';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'New', icon: Clock, color: 'bg-gray-500' },
  { value: 'ai_generated', label: 'AI Generated', icon: Sparkles, color: 'bg-blue-500' },
  { value: 'reviewed', label: 'Reviewed', icon: CheckCircle, color: 'bg-green-500' },
  { value: 'needs_review', label: 'Needs Review', icon: AlertTriangle, color: 'bg-amber-500' }
];

export function AnswerWorkshop({
  questionnaireId,
  questionnaireName,
  items = [],
  onItemUpdate,
  onBulkUpdate,
  selectedDatasets = [],
  chatAutoOpen = false
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [chatOpen, setChatOpen] = useState(chatAutoOpen);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [retryModalOpen, setRetryModalOpen] = useState(false);
  const [retryItem, setRetryItem] = useState(null);
  const [retryGuidance, setRetryGuidance] = useState('');

  const { toast } = useToast();

  // Auto-open chat if specified
  useEffect(() => {
    if (chatAutoOpen) {
      setChatOpen(true);
    }
  }, [chatAutoOpen]);

  // Keyboard shortcuts
  useHotkeys('ctrl+f', (e) => {
    e.preventDefault();
    document.getElementById('search-input')?.focus();
  });

  useHotkeys('escape', () => {
    setEditingCell(null);
    setEditValue('');
  });

  useHotkeys('enter', () => {
    if (editingCell) {
      saveEdit();
    }
  });

  // Filter items based on search and filters
  const filteredItems = items.filter(item => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !item.question?.toLowerCase().includes(query) &&
        !item.draft_answer?.toLowerCase().includes(query) &&
        !item.final_answer?.toLowerCase().includes(query) &&
        !item.section?.toLowerCase().includes(query)
      ) {
        return false;
      }
    }

    // Status filter
    if (statusFilter !== 'all' && item.status !== statusFilter) {
      return false;
    }

    // Confidence filter
    if (confidenceFilter !== 'all') {
      if (confidenceFilter === 'low' && (item.confidence_score || 0) >= 0.6) return false;
      if (confidenceFilter === 'medium' && ((item.confidence_score || 0) < 0.6 || (item.confidence_score || 0) >= 0.8)) return false;
      if (confidenceFilter === 'high' && (item.confidence_score || 0) < 0.8) return false;
    }

    return true;
  });

  const handleCellEdit = (itemId, field, value) => {
    setEditingCell({ itemId, field });
    setEditValue(value || '');
  };

  const saveEdit = useCallback(() => {
    if (!editingCell) return;

    const { itemId, field } = editingCell;
    onItemUpdate?.(itemId, { [field]: editValue });
    setEditingCell(null);
    setEditValue('');

    toast.success('Cell updated', {
      description: 'Changes have been saved.'
    });
  }, [editingCell, editValue, onItemUpdate, toast]);

  const handleStatusChange = (itemId, newStatus) => {
    onItemUpdate?.(itemId, { status: newStatus });
    toast.success('Status updated', {
      description: `Item marked as ${newStatus}.`
    });
  };

  const handleBulkStatusChange = (newStatus) => {
    const itemIds = Array.from(selectedItems);
    onBulkUpdate?.(itemIds, { status: newStatus });
    setSelectedItems(new Set());

    toast.success('Bulk update completed', {
      description: `${itemIds.length} items updated to ${newStatus}.`
    });
  };

  const handleAcceptAll = () => {
    const aiGeneratedItems = filteredItems
      .filter(item => item.status === 'ai_generated' && item.draft_answer)
      .map(item => item.id);

    if (aiGeneratedItems.length === 0) {
      toast.error('No AI-generated answers to accept');
      return;
    }

    onBulkUpdate?.(aiGeneratedItems, { status: 'reviewed' });

    toast.success('All AI answers accepted', {
      description: `${aiGeneratedItems.length} answers marked as reviewed.`
    });
  };

  const handleRetryQuestion = (item) => {
    setRetryItem(item);
    setRetryGuidance('');
    setRetryModalOpen(true);
  };

  const handleSubmitRetry = async () => {
    if (!retryItem) return;

    try {
      setRetryModalOpen(false);

      // Update item status to show it's being reprocessed
      onItemUpdate?.(retryItem.id, {
        status: 'pending',
        draft_answer: null,
        confidence_score: null
      });

      // Call the generation API with guidance
      const response = await fetch('/api/generate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: retryItem.id,
          organizationId: retryItem.questionnaires?.organization_id,
          guidance: retryGuidance.trim() || undefined
        })
      });

      if (!response.ok) {
        throw new Error('Failed to regenerate answer');
      }

      const { question: updatedQuestion } = await response.json();

      onItemUpdate?.(retryItem.id, {
        draft_answer: updatedQuestion.draft_answer,
        confidence_score: updatedQuestion.confidence_score,
        citations: updatedQuestion.citations,
        status: 'ai_generated'
      });

      toast.success('Answer regenerated', {
        description: retryGuidance
          ? 'AI has regenerated the answer with your guidance.'
          : 'AI has regenerated the answer.'
      });

    } catch (error) {
      console.error('Retry failed:', error);
      toast.error('Failed to regenerate answer', {
        description: error.message
      });

      // Revert the item back to its original state
      onItemUpdate?.(retryItem.id, {
        status: 'ai_generated',
        draft_answer: retryItem.draft_answer,
        confidence_score: retryItem.confidence_score
      });
    } finally {
      setRetryItem(null);
      setRetryGuidance('');
    }
  };

  const toggleItemSelection = (itemId) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setSelectedItems(newSelection);
  };

  const selectAll = () => {
    setSelectedItems(new Set(filteredItems.map(item => item.id)));
  };

  const clearSelection = () => {
    setSelectedItems(new Set());
  };

  const getConfidenceColor = (score) => {
    if (!score) return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
    if (score >= 0.8) return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400';
    if (score >= 0.6) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400';
    return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400';
  };

  const getConfidenceLabel = (score) => {
    if (!score) return null;
    if (score >= 0.8) return 'High';
    if (score >= 0.6) return 'Med';
    return 'Low';
  };

  const getStatusIcon = (status) => {
    const statusOption = STATUS_OPTIONS.find(opt => opt.value === status);
    if (statusOption) {
      const Icon = statusOption.icon;
      return <Icon className="h-4 w-4" />;
    }
    return <Clock className="h-4 w-4" />;
  };

  const handleExport = () => {
    // Create CSV content
    const headers = ['Question', 'Answer', 'Section', 'Status', 'Confidence'];
    const csvContent = [
      headers.join(','),
      ...items.map(item => [
        `"${(item.question || '').replace(/"/g, '""')}"`,
        `"${(item.final_answer || item.draft_answer || '').replace(/"/g, '""')}"`,
        `"${(item.section || '').replace(/"/g, '""')}"`,
        `"${(item.status || 'pending').replace(/"/g, '""')}"`,
        `"${item.confidence_score ? Math.round(item.confidence_score * 100) + '%' : ''}"`
      ].join(','))
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `questionnaire-answers-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success('Export completed', {
      description: 'Your questionnaire answers have been downloaded as CSV.'
    });
  };

  return (
    <div className="flex h-full w-full">
      {/* Main Workshop Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <Card className="border-b rounded-none">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Answer Workshop
                <Badge variant="outline">{filteredItems.length} items</Badge>
              </CardTitle>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAcceptAll}
                  disabled={filteredItems.filter(item => item.status === 'ai_generated' && item.draft_answer).length === 0}
                >
                  <ThumbsUp className="h-4 w-4 mr-2" />
                  Accept All AI Answers
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setChatOpen(!chatOpen)}
                >
                  <MessageCircle className="h-4 w-4 mr-2" />
                  Chat
                </Button>

                <Button asChild variant="outline" size="sm">
                  <Link href={`/questionnaires/${questionnaireId}/excel-mapping`}>
                    <Download className="h-4 w-4 mr-2" />
                    Export Excel
                  </Link>
                </Button>
              </div>
            </div>

            {/* Compact AI Processor Status */}
            <div className="mt-4">
              <AIProcessor
                questionnaireId={questionnaireId}
                questions={items}
                onQuestionUpdate={onItemUpdate}
                compact={true}
              />
            </div>

            {/* Filters and Search */}
            <div className="flex items-center gap-4 pt-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search-input"
                  placeholder="Search questions, answers, sections..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-input bg-background px-3 py-2 text-sm rounded-md"
              >
                <option value="all">All Status</option>
                {STATUS_OPTIONS.map(status => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>

              <select
                value={confidenceFilter}
                onChange={(e) => setConfidenceFilter(e.target.value)}
                className="border border-input bg-background px-3 py-2 text-sm rounded-md"
              >
                <option value="all">All Confidence</option>
                <option value="low">Low (&lt; 60%)</option>
                <option value="medium">Med (60-80%)</option>
                <option value="high">High (&gt; 80%)</option>
              </select>
            </div>

            {/* Bulk Actions */}
            {selectedItems.size > 0 && (
              <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
                <span className="text-sm font-medium">
                  {selectedItems.size} items selected
                </span>

                <div className="flex items-center gap-2">
                  {STATUS_OPTIONS.map(status => (
                    <Button
                      key={status.value}
                      variant="outline"
                      size="sm"
                      onClick={() => handleBulkStatusChange(status.value)}
                    >
                      {getStatusIcon(status.value)}
                      <span className="ml-1">{status.label}</span>
                    </Button>
                  ))}

                  <Separator orientation="vertical" className="h-6" />

                  <Button variant="outline" size="sm" onClick={clearSelection}>
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </CardHeader>
        </Card>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <div className="min-w-full">
            {/* Header Row */}
            <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b flex items-center gap-2 p-2 text-sm font-medium z-10 shadow-sm">
              <div className="w-8 flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                  onChange={() => selectedItems.size === filteredItems.length ? clearSelection() : selectAll()}
                  className="h-4 w-4 rounded border-gray-300"
                />
              </div>
              <div className="flex-1 min-w-0">Question</div>
              <div className="flex-1 min-w-0">Draft Answer</div>
              <div className="w-32">Status</div>
              <div className="w-24">Section</div>
              <div className="w-56">Actions</div>
            </div>

            {/* Data Rows */}
            {filteredItems.map((item, index) => (
              <div
                key={item.id}
                className={`flex items-center gap-2 p-2 border-b hover:bg-muted/50 transition-all duration-300 ${selectedItems.has(item.id) ? 'bg-primary/5' :
                  item.status === 'pending' && !item.draft_answer ? 'border-l-2 border-l-blue-500 dark:border-l-blue-400' :
                    item.status === 'ai_generated' ? 'border-l-2 border-l-green-500 dark:border-l-green-400' :
                      ''
                  }`}
              >
                {/* Checkbox */}
                <div className="w-8 flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={selectedItems.has(item.id)}
                    onChange={() => toggleItemSelection(item.id)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </div>

                {/* Question */}
                <div className="flex-1 min-w-0 text-sm">
                  <div className={`font-medium truncate flex items-center gap-2 ${item.status === 'pending' && !item.draft_answer ? 'text-blue-600' : ''
                    }`} title={item.question}>
                    {/* PROCESSING INDICATOR */}
                    {item.status === 'pending' && !item.draft_answer && (
                      <div className="flex-shrink-0">
                        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}

                    {/* COMPLETED INDICATOR */}
                    {item.draft_answer && item.status === 'ai_generated' && (
                      <div className="flex-shrink-0">
                        <CheckCircle className="w-3 h-3 text-green-500 animate-pulse" />
                      </div>
                    )}

                    <span className={item.status === 'pending' && !item.draft_answer ? 'font-semibold' : ''}>{item.question}</span>
                  </div>
                  {item.row_number && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <span>Row {item.row_number}</span>
                      {item.status === 'pending' && !item.draft_answer && (
                        <span className="text-blue-500 font-medium">• Queued for AI</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Draft Answer */}
                <div className="flex-1 min-w-0">
                  {editingCell?.itemId === item.id && editingCell?.field === 'draft_answer' ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="text-sm min-h-[100px] resize-y"
                        autoFocus
                        placeholder="Enter your answer here..."
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="default" onClick={saveEdit}>
                          <Save className="h-3 w-3 mr-1" />
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingCell(null)}>
                          <X className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      {/* AI PROCESSING STATE - MINIMAL FEEDBACK */}
                      {item.status === 'pending' && !item.draft_answer && (
                        <div className="flex items-center gap-2 p-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                          <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">AI is generating answer...</span>
                        </div>
                      )}

                      {/* ANSWER JUST APPEARED - MAGICAL ENTRANCE */}
                      {item.draft_answer && item.status === 'ai_generated' && (
                        <div
                          className="text-sm cursor-pointer hover:bg-muted p-2 rounded min-h-[24px] bg-gradient-to-r from-green-500/10 to-blue-500/10 dark:from-green-400/10 dark:to-blue-400/10 border border-green-500/30 dark:border-green-400/30 animate-in slide-in-from-left-2 duration-700"
                          onClick={() => handleCellEdit(item.id, 'draft_answer', item.draft_answer)}
                          title={item.draft_answer}
                        >
                          <div className="flex items-start gap-2">
                            <Sparkles className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 animate-pulse" />
                            <div className="flex-1">
                              <div className="text-green-800 dark:text-green-300 font-medium text-xs mb-1">✨ AI Generated</div>
                              <div className="text-foreground leading-relaxed">{item.draft_answer}</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* REGULAR ANSWER (for other statuses) */}
                      {item.draft_answer && item.status !== 'ai_generated' && (
                        <div
                          className="text-sm cursor-pointer hover:bg-muted p-2 rounded min-h-[24px]"
                          onClick={() => handleCellEdit(item.id, 'draft_answer', item.draft_answer)}
                          title={item.draft_answer}
                        >
                          <span>{item.draft_answer}</span>
                        </div>
                      )}

                      {/* EMPTY STATE */}
                      {!item.draft_answer && item.status !== 'pending' && (
                        <div
                          className="text-sm cursor-pointer hover:bg-muted p-2 rounded min-h-[24px]"
                          onClick={() => handleCellEdit(item.id, 'draft_answer', item.draft_answer)}
                        >
                          <span className="text-muted-foreground italic">Click to add answer</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Status */}
                <div className="w-32">
                  {/* MINIMAL STATUS INDICATORS */}
                  {item.status === 'pending' && !item.draft_answer ? (
                    <div className="flex items-center gap-1 text-xs">
                      <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full animate-pulse"></div>
                      <span className="text-blue-600 dark:text-blue-400 font-medium">Processing</span>
                    </div>
                  ) : item.status === 'ai_generated' ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1 text-xs animate-in fade-in duration-500">
                        <Sparkles className="w-3 h-3 text-green-600 dark:text-green-400" />
                        <span className="text-green-600 dark:text-green-400 font-medium">AI Generated</span>
                      </div>
                      {item.confidence_score && (
                        <Badge
                          variant="outline"
                          className={`text-xs w-fit ${getConfidenceColor(item.confidence_score)}`}
                        >
                          {getConfidenceLabel(item.confidence_score)} ({Math.round((item.confidence_score || 0) * 100)}%)
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <select
                      value={item.status || 'pending'}
                      onChange={(e) => handleStatusChange(item.id, e.target.value)}
                      className="text-sm border border-input bg-background px-2 py-1 rounded w-full"
                    >
                      {STATUS_OPTIONS.map(status => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>



                {/* Section */}
                <div className="w-24 text-sm truncate" title={item.section}>
                  {item.section}
                </div>

                {/* Actions */}
                <div className="w-56 flex items-center gap-1 flex-wrap">
                  {item.draft_answer && item.status === 'ai_generated' ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatusChange(item.id, 'reviewed')}
                        title="Accept this answer"
                        className="h-7 text-xs text-green-600 border-green-200 hover:bg-green-50"
                      >
                        <ThumbsUp className="h-3 w-3 mr-1" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRetryQuestion(item)}
                        title="Retry with guidance"
                        className={`h-7 text-xs ${(item.confidence_score || 0) < 0.6
                          ? 'text-orange-600 border-orange-200 hover:bg-orange-50'
                          : ''
                          }`}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Retry
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCellEdit(item.id, 'draft_answer', item.draft_answer)}
                        title="Edit this answer"
                        className="h-7 text-xs"
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                    </>
                  ) : item.draft_answer ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatusChange(item.id, 'reviewed')}
                        title="Mark as reviewed"
                        className="h-7 text-xs text-green-600 border-green-200 hover:bg-green-50"
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Done
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCellEdit(item.id, 'draft_answer', item.draft_answer)}
                        title="Edit answer"
                        className="h-7 text-xs"
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Waiting for AI...
                    </div>
                  )}
                </div>
              </div>
            ))}

            {filteredItems.length === 0 && (
              <div className="text-center py-12">
                <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-lg mb-2">No items found</h3>
                <p className="text-muted-foreground">
                  {searchQuery || statusFilter !== 'all' || confidenceFilter !== 'all'
                    ? 'Try adjusting your filters.'
                    : 'Upload a questionnaire to get started.'
                  }
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat Sidebar */}
      {chatOpen && (
        <div className="w-96 min-w-96 max-w-96 border-l bg-background flex-shrink-0 flex flex-col">
          <ChatInterface
            questionnaireId={questionnaireId}
            selectedDatasets={selectedDatasets}
            onClose={() => setChatOpen(false)}
          />
        </div>
      )}

      {/* Citations Viewer Modal */}
      {citationsOpen && selectedItem && (
        <CitationsViewer
          item={selectedItem}
          onClose={() => {
            setCitationsOpen(false);
            setSelectedItem(null);
          }}
        />
      )}



      {/* Retry Guidance Modal */}
      <Dialog open={retryModalOpen} onOpenChange={setRetryModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Retry AI Answer</DialogTitle>
            <DialogDescription>
              Give the AI specific guidance to improve the answer for:
              <span className="font-medium text-foreground block mt-1">
                "{retryItem?.question?.substring(0, 100)}{retryItem?.question?.length > 100 ? '...' : ''}"
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Guidance (optional)</label>
              <Textarea
                value={retryGuidance}
                onChange={(e) => setRetryGuidance(e.target.value)}
                placeholder="e.g., 'Look at the security policy document' or 'Focus on SOC2 compliance requirements' or 'The question is asking about data retention, not backup procedures'"
                className="mt-1 min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Provide specific instructions to help the AI generate a better answer.
              </p>
            </div>

            {retryItem?.confidence_score && (
              <div className="bg-muted p-3 rounded-lg">
                <p className="text-sm">
                  <span className="font-medium">Current confidence:</span>
                  <Badge className={`ml-2 ${getConfidenceColor(retryItem.confidence_score)}`}>
                    {getConfidenceLabel(retryItem.confidence_score)} ({Math.round(retryItem.confidence_score * 100)}%)
                  </Badge>
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRetryModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitRetry}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry Answer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
