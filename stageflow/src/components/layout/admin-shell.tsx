"use client";

import * as React from "react";
import { Shield } from "lucide-react";

import { cn } from "@/lib/utils";
import { Sidebar, type NavGroup } from "@/components/layout/sidebar";
import { TopBar, type Breadcrumb, type UserInfo } from "@/components/layout/top-bar";
import { Badge } from "@/components/ui/badge";

interface AdminShellProps {
  children: React.ReactNode;
  navGroups: NavGroup[];
  breadcrumbs?: Breadcrumb[];
  user?: UserInfo;
  notificationCount?: number;
  onSearch?: (query: string) => void;
  onSignOut?: () => void;
  className?: string;
}

function AdminShell({
  children,
  navGroups,
  breadcrumbs,
  user,
  notificationCount,
  onSearch,
  onSignOut,
  className,
}: AdminShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  const adminHeader = (
    <div className="flex items-center gap-2">
      <Shield className="h-5 w-5 text-[#FFC000]" />
      {!sidebarCollapsed && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">StageFlow</span>
          <Badge variant="outline" className="text-[10px]">
            Admin
          </Badge>
        </div>
      )}
    </div>
  );

  return (
    <div className={cn("flex h-screen overflow-hidden bg-black", className)}>
      <Sidebar
        groups={navGroups}
        header={adminHeader}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Admin banner */}
        <div className="flex h-8 items-center justify-center bg-[#FFC000] text-xs font-bold text-black">
          Platform Administration
        </div>

        <TopBar
          breadcrumbs={breadcrumbs}
          user={user}
          notificationCount={notificationCount}
          onSearch={onSearch}
          onSignOut={onSignOut}
        />

        <main className="flex-1 overflow-y-auto bg-black p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export { AdminShell };
