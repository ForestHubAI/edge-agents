import * as React from "react";
import { Eye, EyeOff, Shield, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils";
import { Input, InputProps } from "./input";
import { Button } from "./button";
import { Progress } from "./progress";
import { sanitizeUserInput } from "@/lib/security/sanitization";
import { validatePasswordStrength, getPasswordStrengthDescription, type PasswordStrength } from "@/lib/security/passwordValidation";

export interface SecureInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  enableSanitization?: boolean;
  showPasswordStrength?: boolean;
  preventPaste?: boolean;
  maxLength?: number;
}

/**
 * Enhanced input component with built-in security features
 */
export const SecureInput = React.forwardRef<HTMLInputElement, SecureInputProps>(
  ({ 
    className,
    type = "text",
    value,
    onChange,
    enableSanitization = true,
    showPasswordStrength = false,
    preventPaste = false,
    maxLength = 1000,
    ...props 
  }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const [passwordStrength, setPasswordStrength] = React.useState<PasswordStrength | null>(null);
    const [isFocused, setIsFocused] = React.useState(false);
    
    const isPasswordField = type === "password" || showPasswordStrength;

    // Handle input changes with sanitization
    const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      let newValue = e.target.value;
      
      // Apply length limit
      if (newValue.length > maxLength) {
        newValue = newValue.substring(0, maxLength);
      }
      
      // Sanitize input if enabled (but not for passwords to avoid breaking special chars)
      if (enableSanitization && !isPasswordField) {
        newValue = sanitizeUserInput(newValue);
      }
      
      onChange(newValue);
      
      // Update password strength if it's a password field
      if (showPasswordStrength) {
        const strength = validatePasswordStrength(newValue);
        setPasswordStrength(strength);
      }
    }, [onChange, enableSanitization, isPasswordField, maxLength, showPasswordStrength]);

    // Handle paste events
    const handlePaste = React.useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
      if (preventPaste) {
        e.preventDefault();
        return;
      }
      
      // Allow paste but sanitize the content
      const pasteData = e.clipboardData.getData('text');
      if (enableSanitization && !isPasswordField) {
        const sanitized = sanitizeUserInput(pasteData);
        if (sanitized !== pasteData) {
          e.preventDefault();
          onChange(value + sanitized);
        }
      }
    }, [preventPaste, enableSanitization, isPasswordField, onChange, value]);

    const togglePasswordVisibility = () => {
      setShowPassword(!showPassword);
    };

    const inputType = isPasswordField && !showPassword ? "password" : "text";
    const strengthDescription = passwordStrength ? getPasswordStrengthDescription(passwordStrength.score) : null;

    return (
      <div className="relative w-full">
        <div className="relative">
          <Input
            ref={ref}
            type={inputType}
            value={value}
            onChange={handleChange}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className={cn(
              // Add padding for icons
              isPasswordField && "pr-20",
              enableSanitization && "pl-10 border-l-2 border-l-green-500/20",
              className
            )}
            maxLength={maxLength}
            {...props}
          />
          
          {/* Security indicator */}
          {enableSanitization && (
            <Shield className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-success/60" />
          )}
          
          {/* Password visibility toggle */}
          {isPasswordField && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={togglePasswordVisibility}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </div>
        
        {/* Password strength indicator */}
        {showPasswordStrength && passwordStrength && isFocused && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Password Strength:</span>
              <span className={cn("font-medium", strengthDescription?.className)}>
                {strengthDescription?.label}
              </span>
            </div>
            
            <Progress 
              value={passwordStrength.score} 
              className="h-2"
              style={{
                '--progress-color': strengthDescription?.color
              } as React.CSSProperties}
            />
            
            {/* Errors */}
            {passwordStrength.errors.length > 0 && (
              <div className="space-y-1">
                {passwordStrength.errors.map((error, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    <span>{error}</span>
                  </div>
                ))}
              </div>
            )}
            
            {/* Suggestions */}
            {passwordStrength.suggestions.length > 0 && passwordStrength.errors.length === 0 && (
              <div className="space-y-1">
                {passwordStrength.suggestions.slice(0, 2).map((suggestion, index) => (
                  <div key={index} className="text-sm text-muted-foreground">
                    💡 {suggestion}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Character count */}
        {isFocused && maxLength && (
          <div className="mt-1 text-xs text-muted-foreground text-right">
            {value.length}/{maxLength}
          </div>
        )}
      </div>
    );
  }
);

SecureInput.displayName = "SecureInput";