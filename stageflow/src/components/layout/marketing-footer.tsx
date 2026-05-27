import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

export interface FooterLinkGroup {
  title: string;
  links: {
    label: string;
    href: string;
  }[];
}

interface MarketingFooterProps extends React.HTMLAttributes<HTMLElement> {
  logo?: React.ReactNode;
  description?: string;
  linkGroups: FooterLinkGroup[];
  copyright?: string;
  socialLinks?: React.ReactNode;
}

function MarketingFooter({
  logo,
  description,
  linkGroups,
  copyright,
  socialLinks,
  className,
  ...props
}: MarketingFooterProps) {
  return (
    <footer
      className={cn("border-t border-white/10 bg-black", className)}
      {...props}
    >
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-5">
          {/* Brand column */}
          <div className="col-span-2 lg:col-span-2">
            <div className="mb-4">
              {logo ?? (
                <span className="text-lg font-bold text-white">
                  Stage<span className="text-[#FFC000]">Flow</span>
                </span>
              )}
            </div>
            {description && (
              <p className="max-w-xs text-sm text-white/50">{description}</p>
            )}
            {socialLinks && <div className="mt-4">{socialLinks}</div>}
          </div>

          {/* Link groups */}
          {linkGroups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
                {group.title}
              </h3>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/60 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-xs text-white/40">
            {copyright ?? `© ${new Date().getFullYear()} StageFlow. All rights reserved.`}
          </p>
        </div>
      </div>
    </footer>
  );
}

export { MarketingFooter };
