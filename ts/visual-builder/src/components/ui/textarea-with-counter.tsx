import * as React from "react"
import { Textarea, type TextareaProps } from "./textarea"
import { FormCharacterCount } from "./form-layout"
import { cn } from "../../lib/utils"

export interface TextareaWithCounterProps extends TextareaProps {
  maxLength: number
  showCounter?: boolean
  warningThreshold?: number
}

/**
 * TextareaWithCounter Component
 * 
 * Textarea with character count display.
 * Shows warning when approaching limit, error when exceeded.
 * 
 * @example
 * <TextareaWithCounter
 *   maxLength={500}
 *   placeholder="Enter description..."
 *   value={description}
 *   onChange={(e) => setDescription(e.target.value)}
 * />
 */
export const TextareaWithCounter = React.forwardRef<HTMLTextAreaElement, TextareaWithCounterProps>(
  ({ 
    maxLength,
    showCounter = true,
    warningThreshold = 0.9,
    value,
    onChange,
    className,
    ...props 
  }, ref) => {
    const currentLength = typeof value === 'string' ? value.length : 0
    const isExceeded = currentLength > maxLength

    return (
      <div className="space-y-2">
        <Textarea
          ref={ref}
          value={value}
          onChange={onChange}
          maxLength={maxLength}
          className={cn(
            isExceeded && "border-destructive focus-visible:ring-destructive",
            className
          )}
          aria-invalid={isExceeded}
          aria-describedby={showCounter ? "character-count" : undefined}
          {...props}
        />
        {showCounter && (
          <FormCharacterCount
            id="character-count"
            current={currentLength}
            max={maxLength}
            warningThreshold={warningThreshold}
          />
        )}
      </div>
    )
  }
)
TextareaWithCounter.displayName = "TextareaWithCounter"
