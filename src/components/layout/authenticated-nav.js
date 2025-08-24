"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
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
    { href: "/questionnaires", label: "Questionnaires" },
    { href: "/datasets", label: "Datasets" },
    // { href: "/integrations", label: "Integrations" },
    { href: "/team", label: "Team" },
    // { href: "/billing", label: "Billing" },
  ];

  return (
    <header className="border-b border-border bg-card">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-semibold text-foreground mr-4">
            Sec Req
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