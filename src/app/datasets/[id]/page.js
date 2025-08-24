"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/auth-guard';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';
import { DatasetFileUpload } from '@/components/dataset/dataset-file-upload';
import { DatasetFileViewer } from '@/components/dataset/dataset-file-viewer';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast-provider';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/utils/supabase/client';
import { ArrowLeft, Database, Upload, FileText } from 'lucide-react';

function DatasetDetailPageContent() {
  const { id } = useParams();
  const router = useRouter();
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { currentOrganization } = useAuth();
  const { toast } = useToast();
  const supabase = createClient();

  useEffect(() => {
    if (id && currentOrganization) {
      fetchDataset();
    }
  }, [id, currentOrganization]);

  const fetchDataset = async () => {
    try {
      const { data, error } = await supabase
        .from('datasets')
        .select(`
          *,
          dataset_files (count)
        `)
        .eq('id', id)
        .eq('organization_id', currentOrganization.org_id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          toast.error('Dataset not found', {
            description: 'This dataset does not exist or you do not have access to it.'
          });
          router.push('/datasets');
          return;
        }
        throw error;
      }

      setDataset(data);

      // Show upload immediately if no files
      const fileCount = data.dataset_files?.[0]?.count || 0;
      if (fileCount === 0) {
        setShowUpload(true);
      }
    } catch (error) {
      toast.error('Failed to load dataset', {
        description: error.message
      });
      router.push('/datasets');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = () => {
    setShowUpload(false);
    setRefreshKey(prev => prev + 1);
    fetchDataset(); // Refresh dataset stats
  };

  const handleFileDeleted = () => {
    setRefreshKey(prev => prev + 1);
    fetchDataset(); // Refresh dataset stats
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading dataset...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!dataset) {
    return null; // Will redirect in useEffect
  }

  const fileCount = dataset.dataset_files?.[0]?.count || 0;

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />

      <main className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => router.push('/datasets')}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Datasets
              </Button>
              <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                  <Database className="h-8 w-8 text-primary" />
                  {dataset.name}
                </h1>
                {dataset.description && (
                  <p className="text-muted-foreground mt-2">
                    {dataset.description}
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  {fileCount} file(s) • Created {new Date(dataset.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!showUpload && (
                <Button
                  onClick={() => setShowUpload(true)}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Add Files
                </Button>
              )}
            </div>
          </div>

          {/* Upload Section */}
          {showUpload && (
            <DatasetFileUpload
              datasetId={dataset.id}
              datasetName={dataset.name}
              onUploadComplete={handleUploadComplete}
            />
          )}

          {/* Files Section */}
          <DatasetFileViewer
            key={refreshKey}
            datasetId={dataset.id}
            datasetName={dataset.name}
            onFileDeleted={handleFileDeleted}
          />

          {/* Knowledge Base Info */}
          {fileCount === 0 && !showUpload && (
            <div className="text-center py-12 border-2 border-dashed border-muted-foreground/25 rounded-lg">
              <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-6" />
              <h3 className="font-semibold text-lg mb-2">Your knowledge base is empty</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Upload security policies, procedures, SOC reports, and other documents to build an AI-powered knowledge base for questionnaire responses.
              </p>
              <Button
                onClick={() => setShowUpload(true)}
                size="lg"
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                Upload Your First Document
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function DatasetDetailPage() {
  return (
    <AuthGuard>
      <DatasetDetailPageContent />
    </AuthGuard>
  );
}
