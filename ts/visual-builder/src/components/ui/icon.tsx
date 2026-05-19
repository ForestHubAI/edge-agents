import * as React from "react"
import { type LucideIcon, type LucideProps } from "lucide-react"
import { cn } from "../../lib/utils"

export interface IconProps extends Omit<LucideProps, 'ref'> {
  icon: LucideIcon
  label?: string
  decorative?: boolean
}

/**
 * Icon Wrapper Component
 * 
 * Provides consistent sizing and accessibility for Lucide icons.
 * 
 * @param icon - The Lucide icon component to render
 * @param label - Accessible label for the icon (required if not decorative)
 * @param decorative - If true, marks icon as decorative (aria-hidden)
 * @param size - Icon size: 16, 20, 24 (default), 32, 40, 48
 * @param className - Additional CSS classes
 * 
 * @example
 * // With label (accessible)
 * <Icon icon={Home} label="Home" size={24} />
 * 
 * @example
 * // Decorative (adjacent text provides context)
 * <Button>
 *   <Icon icon={Plus} decorative />
 *   Create Project
 * </Button>
 * 
 * @example
 * // Custom size and color
 * <Icon 
 *   icon={AlertCircle} 
 *   label="Warning" 
 *   size={32}
 *   className="text-warning"
 * />
 */
export const Icon = React.forwardRef<SVGSVGElement, IconProps>(
  ({ icon: LucideIcon, label, decorative = false, size = 24, className, ...props }, ref) => {
    // Validate accessibility
    if (!decorative && !label) {
      console.warn(
        'Icon component: Non-decorative icons should have a label prop for accessibility.'
      )
    }

    return (
      <LucideIcon
        ref={ref}
        size={size}
        className={cn("shrink-0", className)}
        aria-label={!decorative ? label : undefined}
        aria-hidden={decorative ? "true" : undefined}
        role={!decorative ? "img" : undefined}
        {...props}
      />
    )
  }
)
Icon.displayName = "Icon"
