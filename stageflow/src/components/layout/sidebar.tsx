"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: string | number;
  disabled?: boolean;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  groups: NavGroup[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function Sidebar({
  groups,
  header,
  footer,
  collapsed = false,
  onCollapsedChange,
  className,
  ...props
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          "relative flex h-full flex-col border-r border-white/10 bg-black transition-all duration-300",
          collapsed ? "w-16" : "w-64",
          className,
        )}
        {...props}
      >
        {/* Header */}
        {header && (
          <div className={cn("flex h-16 items-center px-4", collapsed && "justify-center")}>
            {header}
          </div>
        )}

        <Separator />

        {/* Navigation */}
        <ScrollArea className="flex-1 py-2">
          <nav className="flex flex-col gap-1 px-2">
            {groups.map((group, groupIndex) => (
              <div key={groupIndex}>
                {group.title && !collapsed && (
                  <p className="mb-1 mt-4 px-2 text-xs font-medium uppercase tracking-wider text-white/40">
                    {group.title}
                  </p>
                )}
                {group.title && collapsed && groupIndex > 0 && (
                  <Separator className="my-2" />
                )}
                {group.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;

                  const linkContent = (
                    <Link
                      href={item.disabled ? "#" : item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-none px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-[#FFC000]/10 text-[#FFC000]"
                          : "text-white/70 hover:bg-white/5 hover:text-white",
                        item.disabled && "pointer-events-none opacity-50",
                        collapsed && "justify-center px-2",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-[#FFC000]")} />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate">{item.title}</span>
                          {item.badge !== undefined && (
                            <span className="rounded-none bg-[#FFC000] px-1.5 py-0.5 text-[10px] font-bold text-black">
                              {item.badge}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={item.href}>
                        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                        <TooltipContent side="right" className="flex items-center gap-2">
                          {item.title}
                          {item.badge !== undefined && (
                            <span className="rounded-none bg-[#FFC000] px-1.5 py-0.5 text-[10px] font-bold text-black">
                              {item.badge}
                            </span>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return <React.Fragment key={item.href}>{linkContent}</React.Fragment>;
                })}
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Footer */}
        {footer && (
          <>
            <Separator />
            <div className={cn("p-2", collapsed && "flex justify-center")}>
              {footer}
            </div>
          </>
        )}

        {/* Collapse toggle */}
        {onCollapsedChange && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute -right-3 top-20 z-10 h-6 w-6 border border-white/10 bg-black hover:bg-[#202020]"
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronLeft className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}

export { Sidebar };
