import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, Calendar, Users, Zap } from "lucide-react";

export default function QuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>
          Common tasks and integrations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3">
          <Button asChild variant="outline" className="justify-start h-auto p-4">
            <Link href="/record">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded">
                  <Mic className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Start Recording</div>
                  <div className="text-xs text-muted-foreground">Begin a new session</div>
                </div>
              </div>
            </Link>
          </Button>

          <Button asChild variant="outline" className="justify-start h-auto p-4">
            <Link href="/integrations">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded">
                  <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Integrations</div>
                  <div className="text-xs text-muted-foreground">Connect Google Calendar</div>
                </div>
              </div>
            </Link>
          </Button>

          <Button asChild variant="outline" className="justify-start h-auto p-4">
            <Link href="/team">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded">
                  <Users className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Team Settings</div>
                  <div className="text-xs text-muted-foreground">Manage organization</div>
                </div>
              </div>
            </Link>
          </Button>

          <Button asChild variant="outline" className="justify-start h-auto p-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded">
                  <Zap className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="text-left">
                  <div className="font-medium">AI Features</div>
                  <div className="text-xs text-muted-foreground">Coming soon</div>
                </div>
              </div>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


