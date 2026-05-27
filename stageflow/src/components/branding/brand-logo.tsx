import * as React from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

interface BrandLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  logoUrl?: string | null;
  logoLightUrl?: string | null;
  orgName?: string;
  variant?: "light" | "dark" | "auto";
  size?: "sm" | "default" | "lg";
}

function BrandLogo({
  logoUrl,
  logoLightUrl,
  orgName,
  variant = "auto",
  size = "default",
  className,
  ...props
}: BrandLogoProps) {
  const sizeMap = {
    sm: { width: 24, height: 24 },
    default: { width: 32, height: 32 },
    lg: { width: 48, height: 48 },
  };

  const { width, height } = sizeMap[size];

  // Determine which logo to show
  const resolvedUrl =
    variant === "light" && logoLightUrl
      ? logoLightUrl
      : variant === "dark" && logoUrl
        ? logoUrl
        : logoUrl ?? logoLightUrl;

  if (resolvedUrl) {
    return (
      <div className={cn("flex items-center gap-2", className)} {...props}>
        <Image
          src={resolvedUrl}
          alt={orgName ? `${orgName} logo` : "Logo"}
          width={width}
          height={height}
          className="object-contain"
        />
        {orgName && (
          <span
            className={cn(
              "font-bold text-white",
              size === "sm" && "text-sm",
              size === "default" && "text-base",
              size === "lg" && "text-lg",
            )}
          >
            {orgName}
          </span>
        )}
      </div>
    );
  }

  // Default StageFlow logo
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <div
        className={cn(
          "flex items-center justify-center bg-[#FFC000]",
          size === "sm" && "h-6 w-6",
          size === "default" && "h-8 w-8",
          size === "lg" && "h-12 w-12",
        )}
      >
        <span
          className={cn(
            "font-black text-black",
            size === "sm" && "text-xs",
            size === "default" && "text-sm",
            size === "lg" && "text-lg",
          )}
        >
          SF
        </span>
      </div>
      <span
        className={cn(
          "font-bold text-white",
          size === "sm" && "text-sm",
          size === "default" && "text-base",
          size === "lg" && "text-lg",
        )}
      >
        Stage<span className="text-[#FFC000]">Flow</span>
      </span>
    </div>
  );
}

export { BrandLogo, type BrandLogoProps };
