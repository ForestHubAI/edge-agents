import * as React from "react"
import { type LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"
import { Input, type InputProps } from "./input"

export interface InputWithIconsProps extends InputProps {
  prefixIcon?: LucideIcon
  suffixIcon?: LucideIcon
  onSuffixClick?: () => void
  loading?: boolean
}

/**
 * InputWithIcons Component
 * 
 * Input field with optional prefix and/or suffix icons.
 * Suffix icon can be clickable (e.g., for password toggle, clear button).
 * 
 * @example
 * // With search icon prefix
 * <InputWithIcons
 *   prefixIcon={Search}
 *   placeholder="Search projects..."
 * />
 * 
 * @example
 * // With clickable suffix (password toggle)
 * <InputWithIcons
 *   type={showPassword ? "text" : "password"}
 *   suffixIcon={showPassword ? EyeOff : Eye}
 *   onSuffixClick={() => setShowPassword(!showPassword)}
 * />
 * 
 * @example
 * // With loading state
 * <InputWithIcons
 *   prefixIcon={Mail}
 *   loading={isValidating}
 * />
 */
export const InputWithIcons = React.forwardRef<HTMLInputElement, InputWithIconsProps>(
  ({ 
    prefixIcon: PrefixIcon, 
    suffixIcon: SuffixIcon, 
    onSuffixClick,
    loading,
    className,
    ...props 
  }, ref) => {
    return (
      <div className="relative">
        {PrefixIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            <PrefixIcon className="w-4 h-4" aria-hidden="true" />
          </div>
        )}
        
        <Input
          ref={ref}
          className={cn(
            PrefixIcon && "pl-9",
            (SuffixIcon || loading) && "pr-9",
            className
          )}
          {...props}
        />
        
        {loading ? (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
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
          </div>
        ) : SuffixIcon && (
          <button
            type="button"
            onClick={onSuffixClick}
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground",
              onSuffixClick 
                ? "hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded p-0.5" 
                : "pointer-events-none"
            )}
            tabIndex={onSuffixClick ? 0 : -1}
            aria-label={onSuffixClick ? "Toggle" : undefined}
          >
            <SuffixIcon className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    )
  }
)
InputWithIcons.displayName = "InputWithIcons"
