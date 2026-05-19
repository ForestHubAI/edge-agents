import * as React from "react"
import { type LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"
import { Skeleton } from "./skeleton"

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  description?: string
  icon?: LucideIcon
  iconClassName?: string
  titleAction?: React.ReactNode
  actions?: React.ReactNode
  loading?: boolean
}

/**
 * PageHeader Component
 * 
 * Standardized page header with title, optional description, icon, and actions.
 * Provides consistent layout across all pages.
 * 
 * @example
 * // Basic usage
 * <PageHeader 
 *   title="Projects" 
 *   description="Manage your projects"
 * />
 * 
 * @example
 * // With icon and actions
 * <PageHeader
 *   title="Dashboard"
 *   description="Overview of your workspace"
 *   icon={LayoutDashboard}
 *   actions={<Button>Create</Button>}
 * />
 * 
 * @example
 * // Loading state
 * <PageHeader title="Loading..." loading />
 */
export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ 
    title,
    description,
    icon: Icon,
    iconClassName,
    titleAction,
    actions,
    loading,
    className, 
    ...props 
  }, ref) => {
    if (loading) {
      return (
        <div ref={ref} className={cn("space-y-4", className)} {...props}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-96" />
              </div>
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      )
    }

    return (
      <div 
        ref={ref} 
        className={cn("space-y-4", className)} 
        {...props}
      >
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          {/* Title Section */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {Icon && (
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                "bg-primary",
                iconClassName
              )}>
                <Icon className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
              </div>
            )}
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold tracking-tight truncate">
                  {title}
                </h1>
                {titleAction}
              </div>
              {description && (
                <p className="text-muted-foreground text-sm md:text-base line-clamp-2">
                  {description}
                </p>
              )}
            </div>
          </div>

          {/* Actions Section */}
          {actions && (
            <div className="flex items-center gap-2 shrink-0 self-start md:self-center">
              {actions}
            </div>
          )}
        </div>
      </div>
    )
  }
)
PageHeader.displayName = "PageHeader"

/**
 * PageHeaderSkeleton
 * Loading state for PageHeader
 */
export const PageHeaderSkeleton = () => (
  <PageHeader title="" loading />
)
