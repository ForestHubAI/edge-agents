import * as React from "react"
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from "./alert-dialog"
import { type LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"

export interface ConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "destructive"
  icon?: LucideIcon
  onConfirm: () => void | Promise<void>
  loading?: boolean
}

/**
 * ConfirmationDialog Component
 * 
 * Reusable confirmation dialog for destructive or important actions.
 * Built on AlertDialog with consistent styling and behavior.
 * 
 * @example
 * // Destructive action
 * <ConfirmationDialog
 *   open={showDelete}
 *   onOpenChange={setShowDelete}
 *   title="Delete Project?"
 *   description="This action cannot be undone. All project data will be permanently deleted."
 *   confirmLabel="Delete"
 *   cancelLabel="Cancel"
 *   variant="destructive"
 *   icon={Trash2}
 *   onConfirm={handleDelete}
 * />
 * 
 * @example
 * // Default confirmation
 * <ConfirmationDialog
 *   open={showConfirm}
 *   onOpenChange={setShowConfirm}
 *   title="Save Changes?"
 *   description="Do you want to save your changes before leaving?"
 *   confirmLabel="Save"
 *   onConfirm={handleSave}
 * />
 */
export const ConfirmationDialog = React.forwardRef<HTMLDivElement, ConfirmationDialogProps>(
  ({ 
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    variant = "default",
    icon: Icon,
    onConfirm,
    loading,
  }, ref) => {
    const [isProcessing, setIsProcessing] = React.useState(false)

    const handleConfirm = async () => {
      try {
        setIsProcessing(true)
        await onConfirm()
        onOpenChange(false)
      } catch (error) {
        console.error("Confirmation action failed:", error)
      } finally {
        setIsProcessing(false)
      }
    }

    const isLoading = loading || isProcessing

    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent ref={ref}>
          <AlertDialogHeader>
            {Icon && (
              <div className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center mb-2 mx-auto",
                variant === "destructive" 
                  ? "bg-destructive/10" 
                  : "bg-primary/10"
              )}>
                <Icon 
                  className={cn(
                    "w-6 h-6",
                    variant === "destructive" ? "text-destructive" : "text-primary"
                  )}
                  aria-hidden="true"
                />
              </div>
            )}
            <AlertDialogTitle className="text-center">
              {title}
            </AlertDialogTitle>
            {description && (
              <AlertDialogDescription className="text-center">
                {description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center gap-2">
            <AlertDialogCancel disabled={isLoading}>
              {cancelLabel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirm()
              }}
              disabled={isLoading}
              className={variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {isLoading ? (
                <>
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
                  Processing...
                </>
              ) : (
                confirmLabel
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
)
ConfirmationDialog.displayName = "ConfirmationDialog"
