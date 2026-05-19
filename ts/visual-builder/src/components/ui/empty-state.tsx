import * as React from "react"
import { type LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"
import { Button } from "./button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card"

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "no-data" | "no-results" | "no-permission" | "error" | "success"
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  illustrationUrl?: string
}

/**
 * EmptyState Component
 * 
 * Displays helpful empty states with icons, titles, descriptions and CTAs.
 * Use for empty lists, search results, permissions, errors, etc.
 * 
 * @example
 * // No data state
 * <EmptyState
 *   variant="no-data"
 *   icon={FolderOpen}
 *   title="No projects yet"
 *   description="Create your first project to get started"
 *   action={<Button onClick={onCreate}>Create Project</Button>}
 * />
 * 
 * @example
 * // No search results
 * <EmptyState
 *   variant="no-results"
 *   icon={Search}
 *   title="No results found"
 *   description="Try adjusting your search or filters"
 *   action={<Button variant="ghost" onClick={onClear}>Clear filters</Button>}
 * />
 * 
 * @example
 * // No permission
 * <EmptyState
 *   variant="no-permission"
 *   icon={Lock}
 *   title="Access denied"
 *   description="You don't have permission to view this content"
 * />
 */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ 
    variant = "no-data",
    icon: Icon, 
    title, 
    description, 
    action,
    illustrationUrl,
    className, 
    ...props 
  }, ref) => {
    const variantStyles = {
      "no-data": "border-dashed",
      "no-results": "border-dashed",
      "no-permission": "border-destructive/20 bg-destructive/5",
      "error": "border-destructive/20 bg-destructive/5",
      "success": "border-success/20 bg-success/5",
    }

    const iconColors = {
      "no-data": "text-muted-foreground",
      "no-results": "text-muted-foreground",
      "no-permission": "text-destructive",
      "error": "text-destructive",
      "success": "text-success",
    }

    return (
      <Card 
        ref={ref}
        className={cn(
          "max-w-md mx-auto",
          variantStyles[variant],
          className
        )} 
        {...props}
      >
        <CardHeader className="text-center space-y-4">
          {illustrationUrl ? (
            <div className="mx-auto mb-4">
              <img 
                src={illustrationUrl} 
                alt="" 
                className="w-48 h-48 object-contain opacity-50"
                aria-hidden="true"
              />
            </div>
          ) : Icon ? (
            <div className="mx-auto mb-4">
              <div className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center mx-auto",
                variant === "no-permission" || variant === "error" 
                  ? "bg-destructive/10" 
                  : variant === "success"
                    ? "bg-success/10"
                    : "bg-muted/50"
              )}>
                <Icon 
                  className={cn("w-8 h-8", iconColors[variant])} 
                  aria-hidden="true"
                />
              </div>
            </div>
          ) : null}
          
          <div className="space-y-2">
            <CardTitle className="text-xl">{title}</CardTitle>
            {description && (
              <CardDescription className="text-base">
                {description}
              </CardDescription>
            )}
          </div>
        </CardHeader>
        
        {action && (
          <CardContent className="text-center pb-6">
            {action}
          </CardContent>
        )}
      </Card>
    )
  }
)
EmptyState.displayName = "EmptyState"

/**
 * InlineEmptyState
 * Compact version for smaller areas (e.g., within tables, lists)
 */
export interface InlineEmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}

export const InlineEmptyState = React.forwardRef<HTMLDivElement, InlineEmptyStateProps>(
  ({ icon: Icon, title, description, action, className, ...props }, ref) => {
    return (
      <div 
        ref={ref}
        className={cn(
          "flex flex-col items-center justify-center py-12 px-4 text-center",
          className
        )} 
        {...props}
      >
        {Icon && (
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <Icon className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
          </div>
        )}
        
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        
        {description && (
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            {description}
          </p>
        )}
        
        {action && <div className="mt-2">{action}</div>}
      </div>
    )
  }
)
InlineEmptyState.displayName = "InlineEmptyState"
