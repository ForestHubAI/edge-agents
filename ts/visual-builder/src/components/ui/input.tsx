import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const inputVariants = cva(
  "flex w-full bg-field border border-input rounded-2xl placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground transition-all duration-300",
  {
    variants: {
      size: {
        sm: "h-9 px-3 py-1.5 text-sm",
        md: "h-10 px-4 py-2 text-sm",
        lg: "h-11 px-5 py-2.5 text-base",
      },
      variant: {
        default: "",
        subtle: "bg-muted/30 border-transparent backdrop-blur-md",
        ghost: "bg-transparent border-transparent hover:bg-card/40 hover:backdrop-blur-lg",
      },
      status: {
        none: "",
        success: "border-success focus:border-success focus:shadow-[0_0_0_3px_rgba(50,166,118,0.1)]",
        error: "border-destructive focus:border-destructive focus:shadow-[0_0_0_3px_rgba(220,38,38,0.1)]",
      },
    },
    defaultVariants: {
      size: "md",
      variant: "default",
      status: "none",
    },
  }
)

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  htmlSize?: number
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size, variant, status, htmlSize, ...props }, ref) => {
    return (
      <input
        type={type}
        size={htmlSize}
        className={cn(inputVariants({ size, variant, status }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input, inputVariants }
