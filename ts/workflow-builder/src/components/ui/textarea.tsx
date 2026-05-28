import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../cn"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

const textareaVariants = cva(
  "flex w-full rounded-md border ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
  {
    variants: {
      size: {
        sm: "min-h-[72px] px-3 py-2 text-sm",
        md: "min-h-[80px] px-3 py-2 text-sm",
        lg: "min-h-[96px] px-4 py-3 text-base",
      },
      variant: {
        default: "border-input bg-field",
        subtle: "border-transparent bg-muted focus-visible:border-input",
        ghost: "border-border bg-transparent focus-visible:bg-background/60",
      },
      status: {
        none: "",
        success: "border-success focus-visible:ring-success",
        error: "border-destructive focus-visible:ring-destructive",
      },
    },
    defaultVariants: {
      size: "md",
      variant: "default",
      status: "none",
    },
  }
)

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size, variant, status, ...props }, ref) => {
    return (
      <textarea
        className={cn(textareaVariants({ size, variant, status }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea, textareaVariants }
