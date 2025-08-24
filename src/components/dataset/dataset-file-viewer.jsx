"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast-provider';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  File,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Trash2,
  Search,
  Download,
  Eye,
  Clock,
  Database,
  MoreHorizontal,
  X,
  RefreshCw
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DatasetFileViewer({ datasetId, datasetName, onFileDeleted }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileChunks, setFileChunks] = useState([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const supabase = createClient();
  const pollIntervalRef = useRef(null);

  const fetchFiles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('dataset_files')
        .select(`
          *,
          document_chunks (count)
        `)
        .eq('dataset_id', datasetId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFiles(data || []);
    } catch (error) {
      toast.error('Failed to load files', {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  }, [datasetId, supabase, toast]);

  useEffect(() => {
    if (datasetId) {
      fetchFiles();
    }
  }, [datasetId, fetchFiles]);

  // Simple polling logic without dependencies on files array
  useEffect(() => {
    const processingCount = files.filter(file => file.status === 'processing').length;

    if (processingCount > 0 && !pollIntervalRef.current) {
      console.log(`🔄 [POLLING] Starting polling for ${processingCount} processing files`);
      setIsPolling(true);

      pollIntervalRef.current = setInterval(() => {
        console.log('📡 [POLLING] Checking file status...');
        fetchFiles();
      }, 5000);
    } else if (processingCount === 0 && pollIntervalRef.current) {
      console.log('✅ [POLLING] No processing files, stopping poll');
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      setIsPolling(false);
    }

    return () => {
      if (pollIntervalRef.current) {
        console.log('⏹️ [POLLING] Component cleanup - stopping poll');
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        setIsPolling(false);
      }
    };
  }, [files.length > 0 ? files.filter(f => f.status === 'processing').length : 0, fetchFiles]);

  // Removed duplicate fetchFiles function

  const deleteFile = async (fileId, fileName) => {
    try {
      // Delete file and all associated chunks (CASCADE will handle this)
      const { error } = await supabase
        .from('dataset_files')
        .delete()
        .eq('id', fileId);

      if (error) throw error;

      setFiles(prev => prev.filter(f => f.id !== fileId));
      onFileDeleted?.();

      toast.success('File deleted', {
        description: `${fileName} and all its content chunks have been removed`
      });
    } catch (error) {
      toast.error('Failed to delete file', {
        description: error.message
      });
    }
  };

  const viewFileDetails = async (file) => {
    setSelectedFile(file);
    setChunksLoading(true);

    try {
      const { data: chunks, error } = await supabase
        .from('document_chunks')
        .select('*')
        .eq('file_id', file.id)
        .order('chunk_index', { ascending: true });

      if (error) throw error;
      setFileChunks(chunks || []);
    } catch (error) {
      toast.error('Failed to load file details', {
        description: error.message
      });
      setFileChunks([]);
    } finally {
      setChunksLoading(false);
    }
  };

  const resetStuckFiles = async () => {
    try {
      // Find files that have been processing for more than 10 minutes
      const tenMinutesAgo = new Date();
      tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

      const { data: stuckFiles, error: findError } = await supabase
        .from('dataset_files')
        .select('id, name')
        .eq('dataset_id', datasetId)
        .eq('status', 'processing')
        .lt('created_at', tenMinutesAgo.toISOString());

      if (findError) throw findError;

      if (stuckFiles && stuckFiles.length > 0) {
        const { error: updateError } = await supabase
          .from('dataset_files')
          .update({ status: 'failed' })
          .in('id', stuckFiles.map(f => f.id));

        if (updateError) throw updateError;

        // Refresh the file list
        await fetchFiles();

        toast.info('Reset stuck files', {
          description: `${stuckFiles.length} file(s) were stuck in processing and have been marked as failed`
        });
      }
    } catch (error) {
      console.error('Failed to reset stuck files:', error);
    }
  };

  const retryProcessing = async (file) => {
    try {
      console.log(`🔄 [RETRY] Starting retry for file: ${file.name || file.file_name}`);

      // Reset file status to processing
      const { error: updateError } = await supabase
        .from('dataset_files')
        .update({
          status: 'processing'
        })
        .eq('id', file.id);

      if (updateError) throw updateError;

      // Delete existing chunks if any
      const { error: deleteError } = await supabase
        .from('document_chunks')
        .delete()
        .eq('file_id', file.id);

      if (deleteError) throw deleteError;

      console.log(`🗑️ [RETRY] Cleared existing chunks for file: ${file.name || file.file_name}`);

      // Call the processing API
      const response = await fetch('/api/process-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileId: file.id,
          filePath: file.file_path,
          datasetId: file.dataset_id,
          userId: user?.id
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to retry processing');
      }

      console.log(`✅ [RETRY] Successfully initiated retry for: ${file.name || file.file_name}`);
      toast.success(`Retrying processing for ${file.name || file.file_name}`);

      // Refresh files to show updated status
      fetchFiles();
    } catch (error) {
      console.error('❌ [RETRY] Retry processing error:', error);
      toast.error('Failed to retry processing', {
        description: error.message
      });

      // Reset status to failed if retry failed (without error_message column)
      await supabase
        .from('dataset_files')
        .update({
          status: 'failed'
        })
        .eq('id', file.id);

      fetchFiles();
    }
  };

  // Auto-reset stuck files when component loads
  useEffect(() => {
    if (datasetId) {
      const timer = setTimeout(() => {
        resetStuckFiles();
      }, 2000); // Wait 2 seconds after component loads

      return () => clearTimeout(timer);
    }
  }, [datasetId]);

  const getFileIcon = (type) => {
    if (type?.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />;
    if (type?.includes('spreadsheet') || type?.includes('excel')) return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
    if (type?.includes('image')) return <ImageIcon className="h-5 w-5 text-blue-500" />;
    return <File className="h-5 w-5 text-gray-500" />;
  };

  const getStatusBadge = (status, chunks) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            Processed
          </Badge>
        );
      case 'processing':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800 animate-pulse">
            Processing...
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            Pending
          </Badge>
        );
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Removed duplicate getStatusBadge function

  const filteredFiles = files.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading files...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Files in {datasetName}
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <span>
                {files.length} file(s) • {files.reduce((sum, f) => sum + (f.document_chunks?.[0]?.count || 0), 0)} content chunks
              </span>
              {isPolling && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 animate-pulse">
                  📡 Auto-updating...
                </Badge>
              )}
            </CardDescription>
          </div>
          {files.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <div className="text-center py-8">
            <File className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium text-lg mb-2">No files uploaded</h3>
            <p className="text-muted-foreground">
              Upload your first document to start building this knowledge base
            </p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center py-8">
            <Search className="h-8 w-8 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium text-lg mb-2">No files found</h3>
            <p className="text-muted-foreground">
              Try adjusting your search terms
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredFiles.map((file) => {
              const chunkCount = file.document_chunks?.[0]?.count || 0;

              return (
                <div key={file.id} className="flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  {getFileIcon(file.file_type)}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm truncate">{file.name}</p>
                      {getStatusBadge(file.status, file.document_chunks?.[0]?.count || 0)}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{formatFileSize(file.file_size)}</span>
                      <span className="flex items-center gap-1">
                        <Database className="h-3 w-3" />
                        {chunkCount} chunks
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(file.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => viewFileDetails(file)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        {(file.status === 'failed' || file.status === 'processing') && (
                          <DropdownMenuItem onClick={() => retryProcessing(file)}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Retry Processing
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem>
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => deleteFile(file.id, file.name)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete File
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* File Details Dialog */}
      <Dialog open={!!selectedFile} onOpenChange={() => setSelectedFile(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedFile && getFileIcon(selectedFile.file_type)}
              {selectedFile?.name}
            </DialogTitle>
            <DialogDescription>
              File details and content chunks
            </DialogDescription>
          </DialogHeader>

          {selectedFile && (
            <div className="space-y-6">
              {/* File Metadata */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">File Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">File Name</label>
                      <p className="text-sm">{selectedFile.name}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">File Size</label>
                      <p className="text-sm">{formatFileSize(selectedFile.file_size)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">File Type</label>
                      <p className="text-sm">{selectedFile.file_type || 'Unknown'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Status</label>
                      <div className="mt-1">{getStatusBadge(selectedFile.status, selectedFile.document_chunks?.[0]?.count || 0)}</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Upload Date</label>
                      <p className="text-sm">{new Date(selectedFile.created_at).toLocaleString()}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Content Chunks</label>
                      <p className="text-sm">{fileChunks.length} chunks</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Content Chunks */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Content Chunks</CardTitle>
                  <CardDescription>
                    Text chunks extracted from this file for AI processing
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {chunksLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                      <p className="mt-4 text-muted-foreground">Loading chunks...</p>
                    </div>
                  ) : fileChunks.length === 0 ? (
                    <div className="text-center py-8">
                      <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="font-medium text-lg mb-2">No chunks found</h3>
                      <p className="text-muted-foreground">
                        This file hasn't been processed yet or failed to process
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {fileChunks.map((chunk, index) => (
                        <div key={chunk.id} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">Chunk {index + 1}</span>
                            <Badge variant="outline" className="text-xs">
                              {chunk.content.length} characters
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground max-h-32 overflow-y-auto">
                            <pre className="whitespace-pre-wrap">{chunk.content}</pre>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
