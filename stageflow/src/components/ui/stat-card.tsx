import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  trend?: {
    value: number;
    direction: "up" | "down" | "neutral";
  };
  description?: string;
  icon?: React.ReactNode;
}

function StatCard({
  label,
  value,
  trend,
  description,
  icon,
  className,
  ...props
}: StatCardProps) {
  return (
    <Card className={cn("", className)} {...props}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-white/50">
              {label}
            </p>
            <p className="text-3xl font-bold text-white">{value}</p>
          </div>
          {icon && (
            <div className="flex h-10 w-10 items-center justify-center bg-[#181818] text-[#FFC000]">
              {icon}
            </div>
          )}
        </div>
        {(trend || description) && (
          <div className="mt-3 flex items-center gap-2">
            {trend && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-medium",
                  trend.direction === "up" && "text-emerald-400",
                  trend.direction === "down" && "text-red-400",
                  trend.direction === "neutral" && "text-white/50",
                )}
              >
                {trend.direction === "up" && (
                  <ArrowUp className="h-3 w-3" />
                )}
                {trend.direction === "down" && (
                  <ArrowDown className="h-3 w-3" />
                )}
                {trend.direction === "neutral" && (
                  <Minus className="h-3 w-3" />
                )}
                {trend.value > 0 ? "+" : ""}
                {trend.value}%
              </span>
            )}
            {description && (
              <span className="text-xs text-white/40">{description}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { StatCard, type StatCardProps };
