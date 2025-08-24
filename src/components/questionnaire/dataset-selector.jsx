"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/toast-provider';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/utils/supabase/client';
import {
  Database,
  FolderOpen,
  CheckCircle,
  Plus,
  File
} from 'lucide-react';
import Link from 'next/link';

export function DatasetSelector({ onDatasetSelect, selectedDatasets = [] }) {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const { currentOrganization } = useAuth();
  const { toast } = useToast();
  const supabase = createClient();

  useEffect(() => {
    if (currentOrganization?.org_id) {
      fetchDatasets();
    } else {
      setLoading(false);
    }
  }, [currentOrganization?.org_id]);

  const fetchDatasets = async () => {
    try {
      const { data, error } = await supabase
        .from('datasets')
        .select(`
          id,
          name,
          description,
          created_at,
          dataset_files (count)
        `)
        .eq('organization_id', currentOrganization.org_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDatasets(data || []);
    } catch (error) {
      toast.error('Failed to load datasets', {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDatasetToggle = (dataset, checked) => {
    let newSelected;
    if (checked) {
      newSelected = [...selectedDatasets, dataset];
    } else {
      newSelected = selectedDatasets.filter(d => d.id !== dataset.id);
    }
    onDatasetSelect?.(newSelected);
  };

  const isSelected = (datasetId) => {
    return selectedDatasets.some(d => d.id === datasetId);
  };

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

  if (datasets.length === 0) return null;

  return (
    <Card className="p-2">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Database className="h-3 w-3" />
          <span>Knowledge Base</span>
          {selectedDatasets.length > 0 && (
            <Badge variant="secondary" className="ml-1">{selectedDatasets.length} selected</Badge>
          )}
          <div className="ml-auto text-[10px] opacity-70">click to toggle</div>
        </div>
        <div className="space-y-1">
          {datasets.map((dataset) => {
            const selected = isSelected(dataset.id);
            return (
              <button
                key={dataset.id}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded border text-left hover:bg-muted ${selected ? 'bg-primary/10 border-primary' : 'border-border'}`}
                onClick={() => handleDatasetToggle(dataset, !selected)}
              >
                <Checkbox checked={selected} onCheckedChange={(checked) => handleDatasetToggle(dataset, checked)} />
                <FolderOpen className="h-3 w-3 text-primary" />
                <span className="truncate text-sm">{dataset.name}</span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  );
}
