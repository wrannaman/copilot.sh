"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  X,
  FileText,
  ExternalLink,
  Copy,
  Star,
  Quote,
  MapPin
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function CitationsViewer({ item, onClose }) {
  const [selectedCitation, setSelectedCitation] = useState(null);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const getConfidenceColor = (score) => {
    if (score >= 0.8) return 'text-green-600 bg-green-50';
    if (score >= 0.6) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const citations = item.citations || [];

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Quote className="h-5 w-5" />
            Citations & Sources
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full overflow-hidden">
          {/* Question & Answer */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Question</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{item.question}</p>
                {item.section && (
                  <Badge variant="outline" className="mt-2">
                    {item.section}
                  </Badge>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Generated Answer</CardTitle>
                  {item.confidence_score && (
                    <Badge className={getConfidenceColor(item.confidence_score)}>
                      <Star className="h-3 w-3 mr-1" />
                      {Math.round(item.confidence_score * 100)}%
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">
                  {item.draft_answer || item.final_answer || 'No answer generated yet.'}
                </p>

                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(item.draft_answer || item.final_answer || '')}
                  >
                    <Copy className="h-3 w-3 mr-2" />
                    Copy Answer
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Citations */}
          <div className="space-y-4 overflow-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Sources ({citations.length})
              </h3>
            </div>

            {citations.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-2">No Citations Available</h3>
                  <p className="text-sm text-muted-foreground">
                    This answer was generated without specific source citations.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {citations.map((citation, index) => (
                  <Card
                    key={index}
                    className={`cursor-pointer transition-colors ${selectedCitation === index ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
                      }`}
                    onClick={() => setSelectedCitation(selectedCitation === index ? null : index)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="h-4 w-4 text-primary" />
                            <span className="font-medium text-sm">
                              {citation.source || `Source ${index + 1}`}
                            </span>
                            {citation.relevance_score && (
                              <Badge variant="outline" className="text-xs">
                                {Math.round(citation.relevance_score * 100)}% match
                              </Badge>
                            )}
                          </div>

                          {citation.page && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                              <MapPin className="h-3 w-3" />
                              Page {citation.page}
                              {citation.section && ` • ${citation.section}`}
                            </div>
                          )}

                          <p className="text-sm text-muted-foreground line-clamp-3">
                            {citation.content || citation.text || 'No preview available'}
                          </p>

                          {selectedCitation === index && citation.content && (
                            <div className="mt-3 pt-3 border-t">
                              <div className="bg-muted/50 p-3 rounded text-sm">
                                <div className="font-medium mb-2">Full Context:</div>
                                <div className="whitespace-pre-wrap">
                                  {citation.content}
                                </div>
                              </div>

                              <div className="flex gap-2 mt-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(citation.content);
                                  }}
                                >
                                  <Copy className="h-3 w-3 mr-2" />
                                  Copy
                                </Button>

                                {citation.url && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(citation.url, '_blank');
                                    }}
                                  >
                                    <ExternalLink className="h-3 w-3 mr-2" />
                                    Open
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {citations.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">
                    <p className="mb-2">
                      <strong>How citations work:</strong> Our AI searches through your selected
                      datasets to find relevant information that supports the generated answers.
                    </p>
                    <p>
                      Relevance scores indicate how closely each source matches the question context.
                      Higher scores suggest more relevant and reliable sources.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
