"use client";

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { AuthGuard } from '@/components/auth-guard';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';
import { useToast } from '@/components/toast-provider';
import { createClient } from '@/utils/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText,
  Upload,
  Search,
  MoreHorizontal,
  Clock,
  CheckCircle,
  AlertTriangle,
  Download,
  Eye,
  Trash2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import Link from 'next/link';

function QuestionnairesPageContent() {
  const { user, currentOrganization } = useAuth();
  const { toast } = useToast();
  const [questionnaires, setQuestionnaires] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const fileInputRef = useRef(null);

  const pageSize = 10;

  useEffect(() => {
    if (currentOrganization?.org_id) {
      loadQuestionnaires();
    }
  }, [currentOrganization?.org_id, currentPage, searchQuery, statusFilter]);

  const loadQuestionnaires = async () => {
    const supabase = createClient();
    try {
      let query = supabase
        .from('questionnaires')
        .select(`
          *,
          questionnaire_items(count)
        `, { count: 'exact' })
        .eq('organization_id', currentOrganization.org_id)
        .order('created_at', { ascending: false });

      // Apply filters
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (searchQuery.trim()) {
        query = query.ilike('name', `%${searchQuery.trim()}%`);
      }

      // Apply pagination
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      setQuestionnaires(data || []);
      setTotalCount(count || 0);
      setTotalPages(Math.ceil((count || 0) / pageSize));

    } catch (error) {
      toast.error('Failed to load questionnaires', {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const updateQuestionnaireStatus = async (questionnaireId, newStatus) => {
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('questionnaires')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', questionnaireId);

      if (error) throw error;

      // Reload questionnaires to reflect changes
      loadQuestionnaires();

      toast.success('Status updated', {
        description: `Questionnaire marked as ${newStatus}`
      });
    } catch (error) {
      toast.error('Failed to update status', {
        description: error.message
      });
    }
  };

  const deleteQuestionnaire = async (questionnaireId, name) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      return;
    }

    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('questionnaires')
        .delete()
        .eq('id', questionnaireId);

      if (error) throw error;

      loadQuestionnaires();
      toast.success('Questionnaire deleted', {
        description: `"${name}" has been permanently removed`
      });
    } catch (error) {
      toast.error('Failed to delete questionnaire', {
        description: error.message
      });
    }
  };

  const getStatusBadge = (status) => {
    const configs = {
      draft: {
        variant: 'outline',
        className: 'bg-gray-100 text-gray-800',
        icon: Clock,
        label: 'Draft'
      },
      needs_review: {
        variant: 'secondary',
        className: 'bg-yellow-100 text-yellow-800',
        icon: AlertTriangle,
        label: 'Needs Review'
      },
      completed: {
        variant: 'secondary',
        className: 'bg-green-100 text-green-800',
        icon: CheckCircle,
        label: 'Completed'
      }
    };

    const config = configs[status] || configs.draft;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className={config.className}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const handleFileUpload = async (file) => {
    if (!file || !currentOrganization || !user) return;

    const supabase = createClient();
    try {
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const unique = crypto.randomUUID();
      const filePath = `questionnaires/${currentOrganization.org_id}/${unique}-${safeName}`;

      // Upload file
      const { error: uploadError } = await supabase.storage
        .from('secreq')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream'
        });

      if (uploadError) throw uploadError;

      // Create questionnaire record
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

      // Reload questionnaires
      loadQuestionnaires();

      toast.success('Questionnaire uploaded successfully', {
        description: 'Click "Open" to start working on it'
      });

    } catch (error) {
      toast.error('Upload failed', {
        description: error.message
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading questionnaires...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />

      <main className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <FileText className="h-8 w-8 text-primary" />
                Questionnaires
              </h1>
              <p className="text-muted-foreground mt-2">
                Manage all your security questionnaires in one place
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileUpload(file);
                    e.target.value = '';
                  }
                }}
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                Create New Questionnaire
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search questionnaires..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1); // Reset to first page when searching
                    }}
                    className="pl-9"
                  />
                </div>

                <Select value={statusFilter} onValueChange={(value) => {
                  setStatusFilter(value);
                  setCurrentPage(1); // Reset to first page when filtering
                }}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="needs_review">Needs Review</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Results Summary */}
          <div className="text-sm text-muted-foreground">
            Showing {questionnaires.length} of {totalCount} questionnaires
            {searchQuery && ` matching "${searchQuery}"`}
            {statusFilter !== 'all' && ` with status "${statusFilter}"`}
          </div>

          {/* Questionnaires Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Questions</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {questionnaires.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12">
                        <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <h3 className="font-medium text-lg mb-2">
                          {searchQuery || statusFilter !== 'all' ? 'No questionnaires found' : 'No questionnaires yet'}
                        </h3>
                        <p className="text-muted-foreground mb-4">
                          {searchQuery || statusFilter !== 'all'
                            ? 'Try adjusting your search or filter criteria'
                            : 'Upload your first security questionnaire to get started'
                          }
                        </p>
                        {!searchQuery && statusFilter === 'all' && (
                          <Button onClick={() => fileInputRef.current?.click()}>
                            <Upload className="h-4 w-4 mr-2" />
                            Upload Questionnaire
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    questionnaires.map((questionnaire) => (
                      <TableRow key={questionnaire.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{questionnaire.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {questionnaire.original_file_name}
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          {getStatusBadge(questionnaire.status)}
                        </TableCell>

                        <TableCell>
                          <div className="text-sm">
                            {questionnaire.questionnaire_items?.[0]?.count || 0} questions
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="text-sm">
                            {new Date(questionnaire.created_at).toLocaleDateString()}
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="text-sm">
                            {new Date(questionnaire.updated_at || questionnaire.created_at).toLocaleDateString()}
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button asChild variant="default" size="sm">
                              <Link href={`/questionnaires/${questionnaire.id}`}>
                                <Eye className="h-4 w-4 mr-1" />
                                Open
                              </Link>
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => updateQuestionnaireStatus(questionnaire.id, 'draft')}
                                  disabled={questionnaire.status === 'draft'}
                                >
                                  <Clock className="h-4 w-4 mr-2" />
                                  Mark as Draft
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateQuestionnaireStatus(questionnaire.id, 'needs_review')}
                                  disabled={questionnaire.status === 'needs_review'}
                                >
                                  <AlertTriangle className="h-4 w-4 mr-2" />
                                  Mark as Needs Review
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateQuestionnaireStatus(questionnaire.id, 'completed')}
                                  disabled={questionnaire.status === 'completed'}
                                >
                                  <CheckCircle className="h-4 w-4 mr-2" />
                                  Mark as Completed
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => deleteQuestionnaire(questionnaire.id, questionnaire.name)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function QuestionnairesPage() {
  return (
    <AuthGuard>
      <QuestionnairesPageContent />
    </AuthGuard>
  );
}
