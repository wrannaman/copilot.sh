"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast-provider';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/utils/supabase/client';
import {
  FolderOpen,
  Upload,
  File,
  Plus,
  Trash2,
  Search,
  MoreHorizontal,
  FileText,
  Image,
  Archive,
  ArrowRight
} from 'lucide-react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function DatasetManager() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState('');
  const [newDatasetDescription, setNewDatasetDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { currentOrganization, organizations, user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const supabase = createClient();

  console.log('🔍 [DATASET-MANAGER] Render state:', {
    currentOrganization: currentOrganization?.org_id,
    organizationsCount: organizations?.length,
    user: user?.id,
    authLoading
  });

  useEffect(() => {
    console.log('🔍 [DATASET-MANAGER] Effect triggered:', { orgId: currentOrganization?.org_id });
    if (currentOrganization?.org_id) {
      console.log('📊 [DATASET-MANAGER] Fetching datasets for org:', currentOrganization.org_id);
      fetchDatasets();
    } else {
      console.log('❌ [DATASET-MANAGER] No organization found, skipping fetch');
      setLoading(false);
    }
  }, [currentOrganization?.org_id]); // Only depend on the org_id, not the whole object

  const fetchDatasets = async () => {
    console.log('🚀 [DATASET-MANAGER] Starting fetchDatasets...');
    try {
      console.log('📡 [DATASET-MANAGER] Making Supabase query...');
      const { data, error } = await supabase
        .from('datasets')
        .select(`
          *,
          dataset_files (count)
        `)
        .eq('organization_id', currentOrganization.org_id)
        .order('created_at', { ascending: false });

      console.log('📋 [DATASET-MANAGER] Query result:', { data, error });

      if (error) throw error;
      setDatasets(data || []);
      console.log('✅ [DATASET-MANAGER] Datasets loaded:', data?.length || 0);
    } catch (error) {
      console.error('💥 [DATASET-MANAGER] Error fetching datasets:', error);
      toast.error('Failed to load datasets', {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const createDataset = async () => {
    if (!newDatasetName.trim()) return;

    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('datasets')
        .insert({
          organization_id: currentOrganization.org_id,
          name: newDatasetName.trim(),
          description: newDatasetDescription.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      setDatasets(prev => [data, ...prev]);
      setNewDatasetName('');
      setNewDatasetDescription('');
      setShowCreateForm(false);

      toast.success('Dataset created', {
        description: `${data.name} is ready for file uploads.`
      });
    } catch (error) {
      toast.error('Failed to create dataset', {
        description: error.message
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteDataset = async (datasetId) => {
    try {
      const { error } = await supabase
        .from('datasets')
        .delete()
        .eq('id', datasetId);

      if (error) throw error;

      setDatasets(prev => prev.filter(d => d.id !== datasetId));

      toast.success('Dataset deleted', {
        description: 'Dataset and all its files have been removed.'
      });
    } catch (error) {
      toast.error('Failed to delete dataset', {
        description: error.message
      });
    }
  };



  const filteredDatasets = datasets.filter(dataset =>
    dataset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (dataset.description && dataset.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading datasets...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (datasets.length === 0 && !showCreateForm) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground mb-6" />
          <h3 className="font-semibold text-lg mb-2">Create your first dataset</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Datasets organize your security policies and evidence files. Start by creating a dataset, then add your documents.
          </p>
          <Button
            onClick={() => setShowCreateForm(true)}
            size="lg"
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Dataset
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create Dataset Form */}
      {showCreateForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New Dataset
            </CardTitle>
            <CardDescription>
              Give your dataset a name and description
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dataset-name">Dataset Name *</Label>
                <Input
                  id="dataset-name"
                  placeholder="e.g., Security Policies"
                  value={newDatasetName}
                  onChange={(e) => setNewDatasetName(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dataset-description">Description</Label>
                <Input
                  id="dataset-description"
                  placeholder="Brief description (optional)"
                  value={newDatasetDescription}
                  onChange={(e) => setNewDatasetDescription(e.target.value)}
                  disabled={creating}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={createDataset}
                disabled={!newDatasetName.trim() || creating}
                className="gap-2"
              >
                {creating ? (
                  <>Creating...</>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Create Dataset
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewDatasetName('');
                  setNewDatasetDescription('');
                }}
                disabled={creating}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">Your Datasets</h2>
            <Badge variant="secondary">{datasets.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {datasets.length > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search datasets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64"
                />
              </div>
            )}
            <Button
              onClick={() => setShowCreateForm(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New Dataset
            </Button>
          </div>
        </div>
      )}

      {/* Dataset List */}
      {datasets.length > 0 && !showCreateForm && (
        <div className="space-y-4">
          {filteredDatasets.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Search className="h-8 w-8 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-lg mb-2">No datasets found</h3>
                <p className="text-muted-foreground">
                  Try adjusting your search terms.
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredDatasets.map((dataset) => {
              const fileCount = dataset.dataset_files?.[0]?.count || 0;

              return (
                <Card
                  key={dataset.id}
                  className="transition-all hover:shadow-md"
                >
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <FolderOpen className="h-5 w-5 text-primary" />
                          <h3 className="font-semibold text-lg">{dataset.name}</h3>
                        </div>

                        {dataset.description && (
                          <p className="text-muted-foreground mb-3">
                            {dataset.description}
                          </p>
                        )}

                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <File className="h-4 w-4" />
                            {fileCount} files
                          </span>
                          <span>
                            Created {new Date(dataset.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {fileCount === 0 ? (
                          <Button asChild className="gap-2">
                            <Link href={`/datasets/${dataset.id}`}>
                              <Upload className="h-4 w-4" />
                              Add Files
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        ) : (
                          <Button asChild variant="outline" className="gap-2">
                            <Link href={`/datasets/${dataset.id}`}>
                              <Upload className="h-4 w-4" />
                              Add More Files
                            </Link>
                          </Button>
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/datasets/${dataset.id}`}>
                                <FileText className="h-4 w-4 mr-2" />
                                View Files
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => deleteDataset(dataset.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Dataset
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}


    </div>
  );
}