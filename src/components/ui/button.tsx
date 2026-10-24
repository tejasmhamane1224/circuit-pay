import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "secondary" | "outline" | "ghost" | "destructive" | "emerald";
  size?: "sm" | "md" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer";

    const variantStyles = {
      default: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-800 shadow-sm",
      primary: "bg-indigo-600 text-white hover:bg-indigo-500 active:bg-indigo-700 shadow-sm",
      secondary: "bg-zinc-800/80 text-zinc-200 hover:bg-zinc-800 hover:text-white border border-zinc-700",
      outline: "border border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800/60 hover:text-white",
      ghost: "bg-transparent text-zinc-300 hover:bg-zinc-800/60 hover:text-white",
      destructive: "bg-red-600 text-white hover:bg-red-500 active:bg-red-700 shadow-sm",
      emerald: "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700 shadow-sm",
    };

    const sizeStyles = {
      sm: "h-8 px-3 text-xs gap-1.5",
      md: "h-10 px-4 text-sm gap-2",
      lg: "h-12 px-6 text-base gap-2.5",
      icon: "h-9 w-9 p-0",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
