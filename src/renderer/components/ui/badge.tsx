import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@renderer/lib/cn";

/**
 * shadcn/ui Badge primitive — mirrored from `components/ui/badge.tsx`.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-accent/15 text-accent",
        secondary:
          "border-border bg-muted text-muted-foreground",
        destructive:
          "border-transparent bg-destructive/15 text-destructive",
        warning:
          "border-transparent bg-warning/15 text-warning",
        outline: "border-border text-foreground",
        tag:
          "border-border-strong bg-card text-foreground font-mono atr-micro",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
