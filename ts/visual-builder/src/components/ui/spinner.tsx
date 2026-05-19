import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "../../lib/utils"

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl"
  label?: string
}

const sizeClasses = {
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-8 h-8",
  xl: "w-12 h-12",
}

/**
 * Spinner Component
 * 
 * Loading spinner with optional label.
 * Use for loading states, async operations.
 * 
 * @example
 * // Basic usage
 * <Spinner />
 * 
 * @example
 * // With label
 * <Spinner size="lg" label="Loading projects..." />
 * 
 * @example
 * // Custom styling
 * <Spinner className="text-primary" />
 */
export const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ size = "md", label, className, ...props }, ref) => {
    return (
      <div 
        ref={ref}
        className={cn("flex flex-col items-center justify-center gap-2", className)}
        role="status"
        aria-label={label || "Loading"}
        {...props}
      >
        <Loader2 
          className={cn("animate-spin", sizeClasses[size])} 
          aria-hidden="true"
        />
        {label && (
          <p className="text-sm text-muted-foreground">
            {label}
          </p>
        )}
        <span className="sr-only">{label || "Loading"}</span>
      </div>
    )
  }
)
Spinner.displayName = "Spinner"

/**
 * InlineSpinner
 * Compact spinner for buttons and inline use
 */
export const InlineSpinner = React.forwardRef<SVGSVGElement, React.ComponentPropsWithoutRef<typeof Loader2>>(
  ({ className, ...props }, ref) => {
    return (
      <Loader2 
        ref={ref}
        className={cn("animate-spin w-4 h-4", className)}
        aria-hidden="true"
        {...props}
      />
    )
  }
)
InlineSpinner.displayName = "InlineSpinner"

/**
 * FullPageSpinner
 * Centered spinner for full-page loading
 */
export interface FullPageSpinnerProps extends SpinnerProps {
  overlay?: boolean
}

export const FullPageSpinner = React.forwardRef<HTMLDivElement, FullPageSpinnerProps>(
  ({ overlay = false, size = "lg", label, className, ...props }, ref) => {
    return (
      <div 
        ref={ref}
        className={cn(
          "flex items-center justify-center",
          overlay 
            ? "fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
            : "min-h-screen",
          className
        )}
        {...props}
      >
        <Spinner size={size} label={label} />
      </div>
    )
  }
)
FullPageSpinner.displayName = "FullPageSpinner"
