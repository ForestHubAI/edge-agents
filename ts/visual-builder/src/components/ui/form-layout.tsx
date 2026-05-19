import * as React from "react"
import { cn } from "../../lib/utils"

/**
 * FormSection
 * Groups related form fields with optional title and description
 */
export interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  description?: string
}

export const FormSection = React.forwardRef<HTMLDivElement, FormSectionProps>(
  ({ title, description, children, className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("space-y-6", className)} {...props}>
        {(title || description) && (
          <div className="space-y-1">
            {title && (
              <h3 className="text-lg font-medium">{title}</h3>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        )}
        <div className="space-y-4">
          {children}
        </div>
      </div>
    )
  }
)
FormSection.displayName = "FormSection"

/**
 * FormRow
 * Horizontal layout for form fields (responsive)
 */
export interface FormRowProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: 1 | 2 | 3 | 4
}

export const FormRow = React.forwardRef<HTMLDivElement, FormRowProps>(
  ({ columns = 2, children, className, ...props }, ref) => {
    const gridCols = {
      1: "grid-cols-1",
      2: "grid-cols-1 md:grid-cols-2",
      3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
      4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
    }

    return (
      <div 
        ref={ref}
        className={cn("grid gap-4", gridCols[columns], className)} 
        {...props}
      >
        {children}
      </div>
    )
  }
)
FormRow.displayName = "FormRow"

/**
 * FormField
 * Wrapper for individual form fields with label and error
 */
export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  htmlFor?: string
}

export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ label, error, hint, required, htmlFor, children, className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("space-y-2", className)} {...props}>
        {label && (
          <label 
            htmlFor={htmlFor}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {label}
            {required && <span className="text-destructive ml-1" aria-label="required">*</span>}
          </label>
        )}
        {children}
        {hint && !error && (
          <p className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {error && (
          <p className="text-xs text-destructive font-medium" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }
)
FormField.displayName = "FormField"

/**
 * FormActions
 * Footer section for form buttons (submit, cancel, etc.)
 */
export interface FormActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "left" | "center" | "right" | "between"
}

export const FormActions = React.forwardRef<HTMLDivElement, FormActionsProps>(
  ({ align = "right", children, className, ...props }, ref) => {
    const alignClasses = {
      left: "justify-start",
      center: "justify-center",
      right: "justify-end",
      between: "justify-between",
    }

    return (
      <div 
        ref={ref}
        className={cn(
          "flex flex-col-reverse sm:flex-row gap-2 pt-6 border-t",
          alignClasses[align],
          className
        )} 
        {...props}
      >
        {children}
      </div>
    )
  }
)
FormActions.displayName = "FormActions"

/**
 * FormCharacterCount
 * Character counter for textarea/input fields
 */
export interface FormCharacterCountProps extends React.HTMLAttributes<HTMLParagraphElement> {
  current: number
  max: number
  warningThreshold?: number
}

export const FormCharacterCount = React.forwardRef<HTMLParagraphElement, FormCharacterCountProps>(
  ({ current, max, warningThreshold = 0.9, className, ...props }, ref) => {
    const percentage = current / max
    const isWarning = percentage >= warningThreshold
    const isError = current > max

    return (
      <p 
        ref={ref}
        className={cn(
          "text-xs text-right tabular-nums",
          isError 
            ? "text-destructive font-medium" 
            : isWarning 
              ? "text-warning" 
              : "text-muted-foreground",
          className
        )}
        aria-live="polite"
        {...props}
      >
        {current} / {max}
      </p>
    )
  }
)
FormCharacterCount.displayName = "FormCharacterCount"
