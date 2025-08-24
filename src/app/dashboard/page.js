"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/auth-guard";
import { useToast } from "@/components/toast-provider";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import {
  FileText,
  BarChart3,
  Plus,
  Upload,
  Database,
  Sparkles,
  CheckCircle,
  Clock,
  AlertTriangle,
  FolderOpen,
  MessageCircle,
  Download
} from "lucide-react";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";

function DashboardContent() {
  const { user, currentOrganization } = useAuth();
  const { toast } = useToast();
  const [questionnaires, setQuestionnaires] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [stats, setStats] = useState({
    totalQuestionnaires: 0,
    draftCount: 0,
    needsReviewCount: 0,
    completedCount: 0
  });
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  const lastLoadedOrgId = useRef(null);

  useEffect(() => {
    const orgId = currentOrganization?.org_id;
    if (!orgId) return;

    if (lastLoadedOrgId.current === orgId) return; // prevent duplicate loads in StrictMode
    lastLoadedOrgId.current = orgId;
    loadDashboardData();
  }, [currentOrganization?.org_id, user?.id]);



  const loadDashboardData = async () => {
    const supabase = createClient()
    try {
      // Load questionnaires
      const { data: questionnaireData, error: qError } = await supabase
        .from('questionnaires')
        .select(`
          *,
          questionnaire_items(count)
        `)
        .eq('organization_id', currentOrganization.org_id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (qError) throw qError;
      setQuestionnaires(questionnaireData || []);

      // Load datasets
      const { data: datasetData, error: dError } = await supabase
        .from('datasets')
        .select('*')
        .eq('organization_id', currentOrganization.org_id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (dError) throw dError;
      setDatasets(datasetData || []);

      // Calculate stats by questionnaire status
      const totalQuestionnaires = questionnaireData?.length || 0;
      const draftCount = questionnaireData?.filter(q => q.status === 'draft')?.length || 0;
      const needsReviewCount = questionnaireData?.filter(q => q.status === 'needs_review')?.length || 0;
      const completedCount = questionnaireData?.filter(q => q.status === 'completed')?.length || 0;

      setStats({
        totalQuestionnaires,
        draftCount,
        needsReviewCount,
        completedCount
      });

    } catch (error) {
      toast.error('Failed to load dashboard data', {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-400';
      case 'needs_review': return 'bg-yellow-400';
      case 'draft': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return CheckCircle;
      case 'needs_review': return AlertTriangle;
      case 'draft': return Clock;
      default: return Clock;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading dashboard...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-2">
              {currentOrganization?.logo_url && (
                <img
                  src={currentOrganization.logo_url}
                  alt={`${currentOrganization.org_name || currentOrganization.name} logo`}
                  className="h-12 w-12 object-contain rounded"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              )}
              <div>
                <h1 className="text-3xl font-bold text-foreground">
                  {currentOrganization?.org_name || currentOrganization?.name || 'SecReq'} Dashboard
                </h1>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground">
                Respond to security questionnaires with AI-powered answers
              </p>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !currentOrganization || !user) return;
                    const supabase = createClient();
                    try {
                      const baseName = file.name.replace(/\.[^/.]+$/, "");
                      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
                      const unique = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                      const filePath = `questionnaires/${currentOrganization.org_id}/${unique}-${safeName}`;

                      const { error: uploadError } = await supabase
                        .storage
                        .from('secreq')
                        .upload(filePath, file, {
                          cacheControl: '3600',
                          upsert: false,
                          contentType: file.type || 'application/octet-stream'
                        });
                      if (uploadError) throw uploadError;

                      const { data: inserted, error: insertError } = await supabase
                        .from('questionnaires')
                        .insert({
                          organization_id: currentOrganization.org_id,
                          name: baseName,
                          original_file_name: file.name,
                          original_file_path: filePath,
                          status: 'draft',
                          created_by: user.id
                        })
                        .select('id')
                        .single();
                      if (insertError) throw insertError;

                      window.location.href = `/questionnaires/${inserted.id}`;
                    } catch (err) {
                      toast.error('Upload failed', { description: err.message });
                    } finally {
                      e.target.value = '';
                    }
                  }}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  New / Upload Questionnaire
                </Button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Questionnaires
                </CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalQuestionnaires}</div>
                <p className="text-xs text-muted-foreground">
                  Questionnaires to complete
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-gray-400 bg-gray-50/50 dark:bg-gray-900/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Draft
                </CardTitle>
                <Clock className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{stats.draftCount}</div>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Questionnaires in draft
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                  Needs Review
                </CardTitle>
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-800 dark:text-yellow-200">{stats.needsReviewCount}</div>
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  Ready for review
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-green-400 bg-green-50/50 dark:bg-green-900/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">
                  Completed
                </CardTitle>
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-800 dark:text-green-200">{stats.completedCount}</div>
                <p className="text-xs text-green-600 dark:text-green-400">
                  {stats.totalQuestionnaires > 0 ? Math.round((stats.completedCount / stats.totalQuestionnaires) * 100) : 0}% complete
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Main Content - Two Columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Recent Questionnaires */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent Questionnaires</CardTitle>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/questionnaires">View All</Link>
                  </Button>
                </div>
                <CardDescription>
                  Questionnaires you&apos;re working on
                </CardDescription>
              </CardHeader>
              <CardContent>
                {questionnaires.length === 0 ? (
                  <div className="text-center py-6">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium mb-2">No questionnaires yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Upload a questionnaire you received to get started
                    </p>
                    <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-4 w-4 mr-2" />
                      New / Upload Questionnaire
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="mb-4">
                      <Button className="w-full" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-4 w-4 mr-2" />
                        New / Upload Questionnaire
                      </Button>
                    </div>
                    {questionnaires.map((questionnaire) => {
                      const StatusIcon = getStatusIcon(questionnaire.status);
                      return (
                        <div key={questionnaire.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${getStatusColor(questionnaire.status)}`} />
                            <div>
                              <h4 className="font-medium text-sm">{questionnaire.name}</h4>
                              <p className="text-xs text-muted-foreground">
                                {questionnaire.questionnaire_items?.[0]?.count || 0} questions
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-xs ${questionnaire.status === 'completed' ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-600 dark:bg-green-900/20 dark:text-green-300' :
                                questionnaire.status === 'needs_review' ? 'border-yellow-300 bg-yellow-50 text-yellow-700 dark:border-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-300' :
                                  'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-900/20 dark:text-gray-300'
                                }`}
                            >
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {questionnaire.status}
                            </Badge>
                            <Button asChild variant="default" size="sm">
                              <Link href={`/questionnaires/${questionnaire.id}`}>
                                Open
                              </Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Datasets */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Datasets</CardTitle>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/datasets">Manage</Link>
                  </Button>
                </div>
                <CardDescription>
                  Your knowledge base for AI answers
                </CardDescription>
              </CardHeader>
              <CardContent>
                {datasets.length === 0 ? (
                  <div className="text-center py-6">
                    <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium mb-2">No datasets yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Upload documents to help AI generate better answers
                    </p>
                    <Button asChild size="sm">
                      <Link href="/datasets">
                        <Database className="h-4 w-4 mr-2" />
                        Create Dataset
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {datasets.map((dataset) => (
                      <div key={dataset.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                        <div className="flex items-center gap-3">
                          <FolderOpen className="h-4 w-4 text-primary" />
                          <div>
                            <h4 className="font-medium text-sm">{dataset.name}</h4>
                            <p className="text-xs text-muted-foreground">
                              {dataset.description || 'No description'}
                            </p>
                          </div>
                        </div>

                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/datasets/${dataset.id}`}>
                            View
                          </Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

        </div>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
} 