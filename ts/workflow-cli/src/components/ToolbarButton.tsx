// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// A toolbar action: leading icon + label. `primary` is the accent-filled variant
// (use for the one default action, Save); everything else is `secondary`.
export function ToolbarButton({
  icon: Icon,
  onClick,
  variant = "secondary",
  disabled = false,
  title,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const tone =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:opacity-90"
      : "bg-secondary text-secondary-foreground hover:bg-muted";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded border border-border transition-colors disabled:opacity-40 disabled:pointer-events-none ${tone}`}
    >
      <Icon className="w-4 h-4" />
      {children}
    </button>
  );
}
