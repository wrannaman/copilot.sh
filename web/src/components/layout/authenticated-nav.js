"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { usePathname } from "next/navigation";
import { NavUser } from "./nav-user";

export function AuthenticatedNav() {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const handleLogout = async () => {
    await logout();
  };

  const navLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/record", label: "Record" },
    { href: "/sessions", label: "Sessions" },
  ];

  return (
    <header className="border-b border-border bg-card">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-semibold text-foreground mr-4">
            <span className="inline-flex items-center gap-2">
              <img src="/favicon.ico" alt="Copilot.sh" className="h-6 w-6 rounded-full" />
              <span>Copilot.sh</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition-colors hover:text-primary ${pathname === link.href
                  ? "text-foreground underline underline-offset-4"
                  : "text-muted-foreground"
                  }`}
              >
                {link.label}
              </Link>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 px-2 text-sm font-medium text-muted-foreground hover:text-primary">
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <Link href="/integrations">
                  <DropdownMenuItem>
                    Integrations
                  </DropdownMenuItem>
                </Link>
                <Link href="/settings">
                  <DropdownMenuItem>
                    Settings
                  </DropdownMenuItem>
                </Link>
                <Link href="/team">
                  <DropdownMenuItem>
                    Team
                  </DropdownMenuItem>
                </Link>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <ModeToggle />
          <NavUser />
        </div>
      </div>
    </header>
  );
} 