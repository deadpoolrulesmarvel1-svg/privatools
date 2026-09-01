import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The one button. Variants mirror the four Daylight roles the site shipped
 * with (primary / ghost / quiet / ink), expressed through the design tokens so
 * every surface — the hand-written skin and the 112 tool UIs alike — presses,
 * lifts and colors the same way.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[11px] text-sm font-semibold tracking-[-0.01em] ring-offset-background transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[.97] disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border-strong bg-card text-foreground hover:border-muted-foreground/60 hover:shadow-sm",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
        ink: "bg-foreground text-background hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 rounded-[9px] px-4 text-[13px]",
        lg: "h-[52px] rounded-[12px] px-7 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
