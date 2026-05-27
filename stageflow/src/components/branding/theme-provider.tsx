import * as React from "react";

interface OrganizationBranding {
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  branding?: OrganizationBranding | null;
}

const DEFAULT_BRANDING = {
  primaryColor: "#FFC000",
  accentColor: "#1EAEDB",
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  fontFamily: "system-ui, -apple-system, sans-serif",
} satisfies Required<OrganizationBranding>;

/**
 * Server component that reads organization branding and injects CSS custom
 * properties. Falls back to the StageFlow defaults when no org context is
 * provided.
 */
function ThemeProvider({ children, branding }: ThemeProviderProps) {
  const resolved = {
    ...DEFAULT_BRANDING,
    ...branding,
  };

  const style = {
    "--brand-primary": resolved.primaryColor,
    "--brand-accent": resolved.accentColor,
    "--brand-bg": resolved.backgroundColor,
    "--brand-text": resolved.textColor,
    "--brand-font": resolved.fontFamily,
  } as React.CSSProperties;

  return <div style={style}>{children}</div>;
}

export { ThemeProvider, DEFAULT_BRANDING, type OrganizationBranding };
