"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Sidebar, type NavGroup } from "@/components/layout/sidebar";
import { TopBar, type Breadcrumb, type UserInfo } from "@/components/layout/top-bar";

interface AppShellProps {
  children: React.ReactNode;
  navGroups: NavGroup[];
  sidebarHeader?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  user?: UserInfo;
  notificationCount?: number;
  onSearch?: (query: string) => void;
  onSignOut?: () => void;
  className?: string;
}

function AppShell({
  children,
  navGroups,
  sidebarHeader,
  sidebarFooter,
  breadcrumbs,
  user,
  notificationCount,
  onSearch,
  onSignOut,
  className,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  return (
    <div className={cn("flex h-screen overflow-hidden bg-black", className)}>
      {/* Sidebar */}
      <Sidebar
        groups={navGroups}
        header={sidebarHeader}
        footer={sidebarFooter}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
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

export { AppShell };
