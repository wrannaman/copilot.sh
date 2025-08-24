"use client";

import { useState } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';
import { DatasetManager } from '@/components/dataset/dataset-manager';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Database, HelpCircle, Upload, FileText, Shield } from 'lucide-react';

function DatasetsPageContent() {
  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />

      <main className="container mx-auto px-4 py-8">
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Database className="h-8 w-8 text-primary" />
                Datasets
              </h1>
              <p className="text-muted-foreground mt-2">
                Create datasets and upload your security documents
              </p>
            </div>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <HelpCircle className="h-4 w-4 mr-2" />
                  How it works
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    How Datasets Work
                  </DialogTitle>
                  <DialogDescription>
                    Datasets organize your security policies, procedures, and evidence files that power AI-generated responses to vendor questionnaires.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-4 mt-4">
                  <div className="flex items-start gap-3 p-4 border rounded-lg">
                    <Upload className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <h3 className="font-medium text-sm">1. Upload Documents</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Add your security policies, SOC reports, and compliance documentation to a dataset
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 border rounded-lg">
                    <FileText className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <h3 className="font-medium text-sm">2. AI Processing</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Documents are automatically indexed and made searchable for AI-powered responses
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 border rounded-lg">
                    <Shield className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <h3 className="font-medium text-sm">3. Generate Answers</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Create precise questionnaire responses backed by your actual policies and evidence
                      </p>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <DatasetManager />
        </div>
      </main>
    </div>
  );
}

export default function DatasetsPage() {
  return (
    <AuthGuard>
      <DatasetsPageContent />
    </AuthGuard>
  );
}
