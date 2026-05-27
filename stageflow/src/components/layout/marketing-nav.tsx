"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface MarketingNavLink {
  label: string;
  href: string;
}

interface MarketingNavProps extends React.HTMLAttributes<HTMLElement> {
  logo?: React.ReactNode;
  links: MarketingNavLink[];
  ctaLabel?: string;
  ctaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
}

function MarketingNav({
  logo,
  links,
  ctaLabel = "Get Started",
  ctaHref = "/signup",
  secondaryCtaLabel,
  secondaryCtaHref,
  className,
  ...props
}: MarketingNavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <nav
      className={cn(
        "fixed left-0 right-0 top-0 z-50 border-b border-white/5 bg-black/80 backdrop-blur-md",
        className,
      )}
      {...props}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          {logo ?? (
            <span className="text-lg font-bold text-white">
              Stage<span className="text-[#FFC000]">Flow</span>
            </span>
          )}
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm transition-colors",
                pathname === link.href
                  ? "font-medium text-white"
                  : "text-white/60 hover:text-white",
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-3 md:flex">
          {secondaryCtaLabel && secondaryCtaHref && (
            <Button variant="ghost" asChild>
              <Link href={secondaryCtaHref}>{secondaryCtaLabel}</Link>
            </Button>
          )}
          <Button asChild>
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>
        </div>

        {/* Mobile toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-white/10 bg-black px-6 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "py-2 text-sm transition-colors",
                  pathname === link.href
                    ? "font-medium text-white"
                    : "text-white/60 hover:text-white",
                )}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              {secondaryCtaLabel && secondaryCtaHref && (
                <Button variant="ghost" asChild className="w-full">
                  <Link href={secondaryCtaHref}>{secondaryCtaLabel}</Link>
                </Button>
              )}
              <Button asChild className="w-full">
                <Link href={ctaHref}>{ctaLabel}</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

export { MarketingNav };
