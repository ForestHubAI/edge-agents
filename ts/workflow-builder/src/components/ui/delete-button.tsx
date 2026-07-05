// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { cn } from "../../cn";

type DeleteButtonProps = Omit<ButtonProps, "variant">;

/**
 * The canonical full-width destructive delete button (trash icon + label) used at
 * the bottom of config panels. Spreads props (and forwards its ref) so it works
 * both with a direct `onClick` and as an `<AlertDialogTrigger asChild>` child.
 */
const DeleteButton = React.forwardRef<HTMLButtonElement, DeleteButtonProps>(
  ({ className, children, ...props }, ref) => (
    <Button ref={ref} variant="destructive" className={cn("w-full", className)} {...props}>
      <Trash2 className="w-4 h-4 mr-2" />
      {children}
    </Button>
  ),
);
DeleteButton.displayName = "DeleteButton";

export { DeleteButton };
