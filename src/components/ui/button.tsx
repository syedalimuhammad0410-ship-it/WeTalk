"use client";
import { forwardRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent/90 shadow-sm",
  secondary: "bg-fg text-bg hover:bg-fg/90 shadow-sm",
  outline: "border border-border bg-surface text-fg hover:bg-subtle shadow-sm",
  ghost: "text-muted hover:bg-subtle hover:text-fg",
  subtle: "bg-subtle text-fg hover:bg-border/60",
  danger: "bg-danger text-white hover:bg-danger/90 shadow-sm",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; loadingText?: string };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "md", loading, loadingText, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cn("inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,box-shadow,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50", variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});

export function ButtonLink({ href, variant = "primary", size = "md", className, children, ...rest }: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={cn("inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors", variants[variant], sizes[size], className)} {...rest}>
      {children}
    </Link>
  );
}
