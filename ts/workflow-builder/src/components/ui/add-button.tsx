import * as React from "react";
import { Plus, type LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { cn } from "../../lib/utils";

interface AddButtonProps extends Omit<ButtonProps, "variant" | "size"> {
  /** Leading icon. Defaults to a plus sign. */
  icon?: LucideIcon;
}

/**
 * The canonical "add / create" action button: a full-width dashed outline row.
 * Used uniformly across the sidebar resource lists and the config panels so every
 * add affordance reads the same. Spreads props (and forwards its ref) so it can
 * also be used as a dialog trigger via `asChild`.
 */
const AddButton = React.forwardRef<HTMLButtonElement, AddButtonProps>(
  ({ icon: Icon = Plus, className, children, ...props }, ref) => (
    <Button
      ref={ref}
      variant="outline"
      size="sm"
      className={cn("w-full text-xs border-dashed", className)}
      {...props}
    >
      <Icon className="w-3.5 h-3.5 mr-1" />
      {children}
    </Button>
  ),
);
AddButton.displayName = "AddButton";

export { AddButton };
