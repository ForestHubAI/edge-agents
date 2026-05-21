import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "glass-forest-button-primary hover:scale-[1.02]",
        destructive: "glass-forest-button bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "glass-forest-button hover:bg-primary/10 hover:text-primary",
        secondary: "glass-forest-button bg-secondary/50 text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:glass-forest-button hover:bg-primary/10",
        link: "text-primary underline-offset-4 hover:underline",
        glass: "glass-forest-button text-foreground",
        "glass-primary": "glass-forest-button-primary",
        "glass-cyan": "glass-forest-button bg-primary text-white hover:scale-[1.02]",
        success: "glass-forest-button bg-success text-success-foreground hover:bg-success/90",
        warning: "glass-forest-button bg-warning text-warning-foreground hover:bg-warning/90",
      },
      size: {
        default: "h-10 px-6 py-2 text-sm rounded-full",
        sm: "h-9 px-4 text-sm rounded-full",
        lg: "h-11 px-8 text-base rounded-full",
        xl: "h-12 px-10 text-base rounded-full",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
