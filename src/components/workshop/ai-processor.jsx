"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast-provider';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/utils/supabase/client';
import {
  Play,
  Pause,
  Square,
  CheckCircle,
  Clock,
  AlertTriangle,
  Sparkles,
  Zap
} from 'lucide-react';

export function AIProcessor({ questionnaireId, questions, onQuestionUpdate, compact = false }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [hasAttemptedProcessing, setHasAttemptedProcessing] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [processingStats, setProcessingStats] = useState({
    avgConfidence: 0,
    highConfidence: 0,
    needsReview: 0
  });
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);

  const { currentOrganization } = useAuth();
  const { toast } = useToast();
  const supabase = createClient();

  // Check if processing has been attempted and auto-start if needed
  useEffect(() => {
    const checkAndAutoStart = async () => {
      if (!questionnaireId || !currentOrganization || autoStarted) return;

      try {
        // Check if AI processing has been attempted
        const { data: questionnaire, error } = await supabase
          .from('questionnaires')
          .select('ai_processing_attempted, ai_processing_started_at')
          .eq('id', questionnaireId)
          .single();

        if (error) {
          console.error('❌ [AI-PROCESSOR] Failed to check processing status:', error);
          return;
        }

        setHasAttemptedProcessing(questionnaire.ai_processing_attempted || false);

        // Auto-start if never attempted and we have pending questions
        const pendingQuestions = questions.filter(q => !q.draft_answer && q.status === 'pending');

        if (!questionnaire.ai_processing_attempted && pendingQuestions.length > 0) {
          console.log('🚀 [AI-PROCESSOR] Auto-starting AI processing for first time...');
          setAutoStarted(true);

          // Mark as attempted
          await supabase
            .from('questionnaires')
            .update({
              ai_processing_attempted: true,
              ai_processing_started_at: new Date().toISOString()
            })
            .eq('id', questionnaireId);

          // Start processing automatically
          setTimeout(() => {
            startProcessing(true); // true = auto-started
          }, 1000); // Small delay to let UI settle
        }
      } catch (error) {
        console.error('❌ [AI-PROCESSOR] Auto-start check failed:', error);
      }
    };

    checkAndAutoStart();
  }, [questionnaireId, currentOrganization, questions.length, autoStarted]);

  // Calculate initial stats
  useEffect(() => {
    const completed = questions.filter(q => q.draft_answer);
    setProcessedCount(completed.length);

    if (completed.length > 0) {
      const avgConf = completed.reduce((sum, q) => sum + (q.confidence_score || 0), 0) / completed.length;
      const highConf = completed.filter(q => (q.confidence_score || 0) > 0.7).length;
      const needsReview = completed.filter(q => q.status === 'ai_generated').length;

      setProcessingStats({
        avgConfidence: avgConf,
        highConfidence: highConf,
        needsReview: needsReview
      });
    }
  }, [questions]);

  // Real-time subscription to question updates
  useEffect(() => {
    const channel = supabase
      .channel('questionnaire-updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'questionnaire_items',
        filter: `questionnaire_id=eq.${questionnaireId}`
      }, (payload) => {
        console.log('📡 [AI-PROCESSOR] Real-time update:', payload.new);
        onQuestionUpdate?.(payload.new);

        // Update local stats
        if (payload.new.draft_answer) {
          setProcessedCount(prev => prev + 1);

          if (payload.new.confidence_score > 0.7) {
            toast.success(`High confidence answer generated!`, {
              description: `Question ${payload.new.row_number}: ${payload.new.confidence_score.toFixed(2)} confidence`
            });
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [questionnaireId, supabase, onQuestionUpdate]);

  const pendingQuestions = questions.filter(q => !q.draft_answer && q.status === 'pending');
  const totalQuestions = questions.length;
  const progressPercentage = totalQuestions === 0 ? 0 : (processedCount / totalQuestions) * 100;

  const startProcessing = async (autoStarted = false) => {
    if (pendingQuestions.length === 0) {
      if (!autoStarted) {
        toast.info('No questions to process', {
          description: 'All questions have already been processed.'
        });
      }
      return;
    }

    setIsProcessing(true);
    setIsPaused(false);
    setErrorCount(0);

    if (autoStarted) {
      toast.success('🤖 AI automatically starting answer generation!', {
        description: `Processing ${pendingQuestions.length} questions in batches of 5. Sit back and watch the magic happen!`
      });
    } else {
      toast.success('AI processing restarted!', {
        description: `Processing ${pendingQuestions.length} remaining questions in batches of 5.`
      });
    }

    let index = 0;
    const BATCH_SIZE = 5;
    setTotalBatches(Math.ceil(pendingQuestions.length / BATCH_SIZE));

    while (index < pendingQuestions.length && !isPaused) {
      const batch = pendingQuestions.slice(index, index + BATCH_SIZE);
      setCurrentIndex(index);
      setCurrentBatch(Math.floor(index / BATCH_SIZE) + 1);

      console.log(`🔄 [AI-PROCESSOR] Processing batch ${Math.floor(index / BATCH_SIZE) + 1}/${Math.ceil(pendingQuestions.length / BATCH_SIZE)}`);

      // Process batch in parallel
      const batchPromises = batch.map(async (question) => {
        try {
          const response = await fetch('/api/generate-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              questionId: question.id,
              organizationId: currentOrganization.org_id
            })
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const result = await response.json();

          if (!result.success) {
            throw new Error(result.error);
          }

          return { success: true, questionId: question.id };
        } catch (error) {
          console.error('❌ [AI-PROCESSOR] Failed to process question:', question.id, error);
          setErrorCount(prev => prev + 1);
          return { success: false, questionId: question.id, error: error.message };
        }
      });

      const results = await Promise.all(batchPromises);
      // Increment processed count by successful batch items to reflect progress immediately
      const successes = results.filter(r => r.success).length;
      setProcessedCount(prev => Math.min(totalQuestions, prev + successes));

      index += BATCH_SIZE;

      // Small delay between batches to avoid overwhelming the API
      if (index < pendingQuestions.length && !isPaused) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setIsProcessing(false);

    if (!isPaused) {
      // Check if all questions are now processed and update questionnaire status
      try {
        const allQuestions = questions;
        const allProcessed = allQuestions.every(q => q.draft_answer || q.final_answer);

        if (allProcessed) {
          console.log('🎉 [AI-PROCESSOR] All questions processed, updating questionnaire status to completed');

          await supabase
            .from('questionnaires')
            .update({
              status: 'completed',
              ai_processing_completed_at: new Date().toISOString()
            })
            .eq('id', questionnaireId);

          toast.success('Questionnaire completed!', {
            description: `All ${allQuestions.length} questions have been processed. Ready for export!`
          });
        } else {
          toast.success('AI processing completed!', {
            description: `Processed ${pendingQuestions.length} questions. ${errorCount > 0 ? `${errorCount} errors occurred.` : 'All successful!'}`
          });
        }
      } catch (error) {
        console.error('❌ [AI-PROCESSOR] Failed to update questionnaire status:', error);
        toast.success('AI processing completed!', {
          description: `Processed ${pendingQuestions.length} questions. ${errorCount > 0 ? `${errorCount} errors occurred.` : 'All successful!'}`
        });
      }
    }
  };

  const pauseProcessing = () => {
    setIsPaused(true);
    setIsProcessing(false);
    toast.info('Processing paused', {
      description: 'You can resume processing anytime.'
    });
  };

  const stopProcessing = () => {
    setIsPaused(false);
    setIsProcessing(false);
    setCurrentIndex(0);
    toast.info('Processing stopped', {
      description: 'Progress has been saved.'
    });
  };

  if (compact) {
    return (
      <div className="bg-muted/50 border rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="font-medium text-sm">AI Processing</span>
            </div>

            <div className="flex items-center gap-1">
              <Progress value={progressPercentage} className="w-24 h-2" />
              <span className="text-xs text-muted-foreground ml-2">
                {processedCount}/{totalQuestions}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>{processingStats.highConfidence} high confidence</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>{processingStats.needsReview} AI generated</span>
              </div>
              {errorCount > 0 && (
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span>{errorCount} errors</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Status Messages */}
            {isProcessing && (
              <div className="flex items-center gap-2 text-blue-600">
                <Zap className="h-3 w-3 animate-pulse" />
                <span className="text-xs">Processing batch {Math.floor(currentIndex / 5) + 1}...</span>
              </div>
            )}

            {!isProcessing && !hasAttemptedProcessing && pendingQuestions.length > 0 && (
              <div className="flex items-center gap-2 text-green-600">
                <Sparkles className="h-3 w-3 animate-pulse" />
                <span className="text-xs">Auto-starting...</span>
              </div>
            )}

            {!isProcessing && hasAttemptedProcessing && pendingQuestions.length === 0 && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-3 w-3" />
                <span className="text-xs">Complete</span>
              </div>
            )}

            {/* Emergency Controls */}
            {isProcessing && (
              <div className="flex items-center gap-1">
                <Button onClick={pauseProcessing} variant="ghost" size="sm" className="h-6 px-2 text-xs">
                  <Pause className="h-3 w-3" />
                </Button>
                <Button onClick={stopProcessing} variant="ghost" size="sm" className="h-6 px-2 text-xs">
                  <Square className="h-3 w-3" />
                </Button>
              </div>
            )}

            {!isProcessing && hasAttemptedProcessing && pendingQuestions.length > 0 && (
              <Button onClick={() => startProcessing(false)} variant="ghost" size="sm" className="h-6 px-2 text-xs">
                <Play className="h-3 w-3 mr-1" />
                Process {pendingQuestions.length}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Response Generator
        </CardTitle>
        <CardDescription>
          Generate AI-powered responses for your security questions in real-time
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Overview */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Processing Progress</span>
            <span className="text-sm text-muted-foreground">
              {processedCount} of {totalQuestions} completed
            </span>
          </div>
          <Progress value={progressPercentage} className="w-full" />
          <div className="text-xs text-muted-foreground">
            {progressPercentage.toFixed(1)}% complete
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-lg font-bold text-green-700">{processingStats.highConfidence}</div>
            <div className="text-xs text-green-600">High Confidence</div>
          </div>
          <div className="text-center p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="text-lg font-bold text-yellow-700">{processingStats.needsReview}</div>
            <div className="text-xs text-yellow-600">Needs Review</div>
          </div>
          <div className="text-center p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-lg font-bold text-red-700">{errorCount}</div>
            <div className="text-xs text-red-600">Errors</div>
          </div>
        </div>

        {/* Status Messages - Tell user what's happening */}
        <div className="space-y-3">
          {isProcessing && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Zap className="h-4 w-4 text-blue-600 animate-pulse" />
              <span className="text-sm font-medium text-blue-900">
                🤖 AI is processing batch {Math.floor(currentIndex / 5) + 1}...
              </span>
            </div>
          )}

          {!isProcessing && !hasAttemptedProcessing && pendingQuestions.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Sparkles className="h-4 w-4 text-green-600 animate-pulse" />
              <span className="text-sm font-medium text-green-900">
                🚀 AI will automatically start processing your {pendingQuestions.length} questions in a moment...
              </span>
            </div>
          )}

          {!isProcessing && hasAttemptedProcessing && pendingQuestions.length === 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-900">
                ✅ All questions have been processed! Review the answers below.
              </span>
            </div>
          )}

          {!isProcessing && hasAttemptedProcessing && pendingQuestions.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-900">
                ⚠️ {pendingQuestions.length} questions still need processing.
              </span>
            </div>
          )}
        </div>

        {/* Emergency Controls - Only show when absolutely necessary */}
        {(isProcessing || (hasAttemptedProcessing && pendingQuestions.length > 0)) && (
          <div className="flex items-center gap-2">
            {isProcessing && (
              <>
                <Button onClick={pauseProcessing} variant="outline" size="sm" className="gap-2">
                  <Pause className="h-4 w-4" />
                  Pause
                </Button>
                <Button onClick={stopProcessing} variant="destructive" size="sm" className="gap-2">
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              </>
            )}

            {isPaused && (
              <Button onClick={() => startProcessing(false)} size="sm" className="gap-2">
                <Play className="h-4 w-4" />
                Resume
              </Button>
            )}

            {!isProcessing && hasAttemptedProcessing && pendingQuestions.length > 0 && (
              <Button onClick={() => startProcessing(false)} size="sm" className="gap-2">
                <Play className="h-4 w-4" />
                Process Remaining ({pendingQuestions.length})
              </Button>
            )}
          </div>
        )}

        {/* Summary */}
        {processedCount > 0 && (
          <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-lg">
            Average confidence: {(processingStats.avgConfidence * 100).toFixed(1)}% •
            High confidence answers: {processingStats.highConfidence} •
            Answers needing review: {processingStats.needsReview}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
