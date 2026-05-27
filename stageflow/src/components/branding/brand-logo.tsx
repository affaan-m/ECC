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

  // Default StageFlow logo with SVG mark
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <svg
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(
          size === "sm" && "h-6 w-6",
          size === "default" && "h-8 w-8",
          size === "lg" && "h-12 w-12",
        )}
      >
        <path d="M128 96 L256 96 L384 224 L256 224 L128 96Z" fill="#FFC000" />
        <path d="M384 416 L256 416 L128 288 L256 288 L384 416Z" fill="#FFC000" />
        <path d="M256 224 L256 288" stroke="#FFC000" strokeWidth="32" />
      </svg>
      <span
        className={cn(
          "font-bold tracking-tight text-white",
          size === "sm" && "text-sm",
          size === "default" && "text-base",
          size === "lg" && "text-xl",
        )}
      >
        STAGE<span className="text-[#FFC000]">FLOW</span>
      </span>
    </div>
  );
}

export { BrandLogo, type BrandLogoProps };
