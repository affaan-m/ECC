"use client";

import { usePathname } from "next/navigation";
import {
  Users,
  Music,
  ClipboardList,
  FileText,
  Inbox,
  Settings,
  LayoutDashboard,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { BrandLogo } from "@/components/branding/brand-logo";
import type { NavGroup } from "@/components/layout/sidebar";

interface StudioLayoutProps {
  children: React.ReactNode;
  params: Promise<{ org: string; studio: string }>;
}

function useNavGroups(org: string, studio: string): NavGroup[] {
  const base = `/s/${org}/${studio}`;
  return [
    {
      title: "Studio",
      items: [
        { title: "Dashboard", href: `${base}/dashboard`, icon: LayoutDashboard },
        { title: "Dancers", href: `${base}/dancers`, icon: Users },
        { title: "Routines", href: `${base}/routines`, icon: Music },
        { title: "Entries", href: `${base}/entries`, icon: ClipboardList },
        { title: "Invoices", href: `${base}/invoices`, icon: FileText },
        { title: "Inbox", href: `${base}/inbox`, icon: Inbox },
      ],
    },
    {
      title: "Manage",
      items: [
        { title: "Settings", href: `${base}/settings`, icon: Settings },
      ],
    },
  ];
}

export default function StudioDashboardLayout({ children, params }: StudioLayoutProps) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const org = segments[1] ?? "";
  const studio = segments[2] ?? "";
  const navGroups = useNavGroups(org, studio);

  return (
    <AppShell
      navGroups={navGroups}
      sidebarHeader={<BrandLogo size="sm" />}
      breadcrumbs={[
        { label: org, href: `/s/${org}/${studio}/dashboard` },
        { label: studio, href: `/s/${org}/${studio}/dashboard` },
      ]}
    >
      {children}
    </AppShell>
  );
}
