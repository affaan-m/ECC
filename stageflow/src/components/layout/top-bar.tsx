"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, ChevronRight, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface UserInfo {
  name: string;
  email: string;
  avatarUrl?: string;
  initials: string;
}

interface TopBarProps extends React.HTMLAttributes<HTMLDivElement> {
  breadcrumbs?: Breadcrumb[];
  user?: UserInfo;
  notificationCount?: number;
  onSearch?: (query: string) => void;
  onSignOut?: () => void;
  searchPlaceholder?: string;
}

function TopBar({
  breadcrumbs,
  user,
  notificationCount,
  onSearch,
  onSignOut,
  searchPlaceholder = "Search...",
  className,
  ...props
}: TopBarProps) {
  const [searchValue, setSearchValue] = React.useState("");

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchValue);
  };

  return (
    <header
      className={cn(
        "flex h-16 items-center justify-between border-b border-white/10 bg-black px-6",
        className,
      )}
      {...props}
    >
      {/* Left: Breadcrumbs */}
      <div className="flex items-center gap-1">
        {breadcrumbs?.map((crumb, index) => (
          <React.Fragment key={index}>
            {index > 0 && (
              <ChevronRight className="h-4 w-4 text-white/30" />
            )}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="text-sm font-medium text-white">
                {crumb.label}
              </span>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Right: Search, Notifications, User */}
      <div className="flex items-center gap-3">
        {onSearch && (
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 w-64 pl-9 text-xs"
            />
          </form>
        )}

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {notificationCount !== undefined && notificationCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-none bg-[#FFC000] px-1 text-[10px] font-bold text-black">
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          )}
        </Button>

        {/* User menu */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                  <AvatarFallback className="text-xs">
                    {user.initials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none text-white">
                    {user.name}
                  </p>
                  <p className="text-xs leading-none text-white/60">
                    {user.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              {onSignOut && (
                <DropdownMenuItem onClick={onSignOut}>
                  Sign out
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

export { TopBar };
