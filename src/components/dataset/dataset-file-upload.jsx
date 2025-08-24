"use client";

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/toast-provider';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/utils/supabase/client';
// File processing now happens server-side via /api/process-file
import {
  Upload,
  File,
  X,
  Loader2,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  CheckCircle,
  AlertCircle
} from 'lucide-react';

export function DatasetFileUpload({ datasetId, datasetName, onUploadComplete }) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const fileInputRef = useRef(null);
  const { toast } = useToast();
  const { user, currentOrganization } = useAuth();
  const supabase = createClient();

  const acceptedTypes = '.pdf,.txt,.csv,.xlsx,.xls,.docx,.md';
  const maxFileSize = 50 * 1024 * 1024; // 50MB

  const getFileIcon = (type) => {
    if (type.includes('pdf')) return <FileText className="h-8 w-8 text-red-500" />;
    if (type.includes('spreadsheet') || type.includes('excel')) return <FileSpreadsheet className="h-8 w-8 text-green-500" />;
    if (type.includes('image')) return <ImageIcon className="h-8 w-8 text-blue-500" />;
    return <File className="h-8 w-8 text-gray-500" />;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const validateFile = (file) => {
    if (file.size > maxFileSize) {
      toast.error('File too large', {
        description: `${file.name} is larger than 50MB. Please use a smaller file.`
      });
      return false;
    }

    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown'
    ];

    if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.md')) {
      toast.error('Unsupported file type', {
        description: `${file.name} is not a supported file type. Please use PDF, TXT, CSV, Excel, Word, or Markdown files.`
      });
      return false;
    }

    return true;
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(validateFile);
    setSelectedFiles(prev => [...prev, ...validFiles]);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    const validFiles = files.filter(validateFile);
    setSelectedFiles(prev => [...prev, ...validFiles]);
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    const results = {
      successful: [],
      failed: []
    };

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const fileId = `file-${i}`;

        setUploadProgress(prev => ({
          ...prev,
          [fileId]: { status: 'uploading', progress: 0 }
        }));

        try {
          // 1. Upload file to Supabase Storage
          const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          const filePath = `datasets/${datasetId}/${fileName}`;

          setUploadProgress(prev => ({
            ...prev,
            [fileId]: { status: 'uploading', progress: 25 }
          }));

          console.log('📤 [UPLOAD] Uploading to storage:', { filePath, fileType: file.type, fileSize: file.size });

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('copilot.sh')
            .upload(filePath, file, {
              contentType: file.type,
              upsert: false
            });

          if (uploadError) {
            console.error('❌ [UPLOAD] Storage upload failed:', uploadError);
            throw uploadError;
          }

          console.log('✅ [UPLOAD] File uploaded to storage:', uploadData);

          setUploadProgress(prev => ({
            ...prev,
            [fileId]: { status: 'uploading', progress: 50 }
          }));

          // 2. Store file metadata in database with storage path
          const { data: fileData, error: fileError } = await supabase
            .from('dataset_files')
            .insert({
              dataset_id: datasetId,
              name: file.name,
              file_path: uploadData.path,
              file_size: file.size,
              file_type: file.type,
              status: 'processing',
              uploaded_by: user?.id
            })
            .select()
            .single();

          if (fileError) throw fileError;

          setUploadProgress(prev => ({
            ...prev,
            [fileId]: { status: 'processing', progress: 75 }
          }));

          // 3. Process file server-side
          const processResponse = await fetch('/api/process-file', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filePath: uploadData.path,
              fileId: fileData.id,
              userId: user?.id,
              datasetId: datasetId
            })
          });

          if (!processResponse.ok) {
            const errorData = await processResponse.json();
            throw new Error(errorData.error || 'File processing failed');
          }

          const processResult = await processResponse.json();

          // 3. Update file status to completed (if status column exists)
          try {
            await supabase
              .from('dataset_files')
              .update({ status: 'completed' })
              .eq('id', finalFileData.id);
          } catch (statusError) {
            // Ignore error if status column doesn't exist
            if (statusError.code !== 'PGRST204') {
              console.warn('Could not update file status:', statusError);
            }
          }

          setUploadProgress(prev => ({
            ...prev,
            [fileId]: { status: 'completed', progress: 100 }
          }));

          results.successful.push({
            name: file.name,
            chunks: processResult.chunksCreated
          });

        } catch (error) {
          console.error(`Failed to upload ${file.name}:`, error);

          // Error is handled by the server-side API
          // It will update the file status to 'failed' automatically

          setUploadProgress(prev => ({
            ...prev,
            [fileId]: { status: 'error', progress: 0 }
          }));
          results.failed.push({ name: file.name, error: error.message });
        }
      }

      // Show results
      if (results.successful.length > 0) {
        const totalChunks = results.successful.reduce((sum, file) => sum + (file.chunks || 0), 0);
        toast.success('Files uploaded successfully', {
          description: `${results.successful.length} file(s) processed into ${totalChunks} searchable chunks`
        });
      }

      if (results.failed.length > 0) {
        toast.error('Some files failed to upload', {
          description: `${results.failed.length} file(s) failed to process`
        });
      }

      // Clear files and notify parent
      setSelectedFiles([]);
      setUploadProgress({});
      onUploadComplete?.();

    } catch (error) {
      toast.error('Upload failed', {
        description: error.message
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload Files to {datasetName}
        </CardTitle>
        <CardDescription>
          Upload PDFs, documents, and text files to build your knowledge base
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedTypes}
            onChange={handleFileSelect}
            className="hidden"
            disabled={uploading}
          />

          <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-medium text-lg mb-2">
            Drop files here or click to browse
          </h3>
          <p className="text-muted-foreground text-sm">
            Support for PDF, TXT, CSV, Excel, Word, and Markdown files up to 50MB
          </p>
        </div>

        {/* Selected Files */}
        {selectedFiles.length > 0 && (
          <div className="space-y-4">
            <h4 className="font-medium">Selected Files ({selectedFiles.length})</h4>
            <div className="space-y-3">
              {selectedFiles.map((file, index) => {
                const fileId = `file-${index}`;
                const progress = uploadProgress[fileId];

                return (
                  <div key={index} className="flex items-center gap-3 p-3 border rounded-lg">
                    {getFileIcon(file.type)}
                    <div className="flex-1">
                      <p className="font-medium text-sm">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                      {progress && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">
                              {progress.status === 'uploading' && 'Processing...'}
                              {progress.status === 'completed' && 'Completed'}
                              {progress.status === 'error' && 'Failed'}
                            </span>
                            {progress.status === 'completed' && (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            )}
                            {progress.status === 'error' && (
                              <AlertCircle className="h-3 w-3 text-red-500" />
                            )}
                          </div>
                          <Progress value={progress.progress} className="h-1" />
                        </div>
                      )}
                    </div>
                    {!uploading && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upload Button */}
        {selectedFiles.length > 0 && (
          <Button
            onClick={uploadFiles}
            disabled={uploading}
            className="w-full gap-2"
            size="lg"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing {selectedFiles.length} file(s)...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload {selectedFiles.length} file(s)
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
