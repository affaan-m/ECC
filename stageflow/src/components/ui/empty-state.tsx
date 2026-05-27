import * as React from "react";
import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: ButtonProps["variant"];
  };
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-none border border-dashed border-white/10 bg-[#202020] p-8 text-center",
        className,
      )}
      {...props}
    >
      {Icon && (
        <div className="flex h-16 w-16 items-center justify-center rounded-none bg-[#181818]">
          <Icon className="h-8 w-8 text-white/40" />
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-white/60">
            {description}
          </p>
        )}
      </div>
      {action && (
        <Button
          variant={action.variant ?? "default"}
          onClick={action.onClick}
          className="mt-2"
        >
          {action.label}
        </Button>
      )}
      {children}
    </div>
  );
}

export { EmptyState, type EmptyStateProps };
