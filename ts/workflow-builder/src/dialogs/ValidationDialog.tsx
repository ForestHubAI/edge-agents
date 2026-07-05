// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, AlertTriangle, ChevronDown } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { cn } from "../cn";
import type { Diagnostic, ValidationResult } from "@foresthubai/workflow-core/diagnostics";

interface ValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  validation: ValidationResult;
  /**
   * Export-gating flow only: when provided and there are no errors, the footer
   * offers "Continue with Warnings". Omit for a plain informational dialog (just
   * a Close button) — e.g. the standalone Validate action.
   */
  onContinue?: () => void;
  /** Clicking a diagnostic navigates to its target (canvas/node/edge/resource). */
  onSelectDiagnostic?: (diagnostic: Diagnostic) => void;
}

export default function ValidationDialog({
  open,
  onOpenChange,
  validation,
  onContinue,
  onSelectDiagnostic,
}: ValidationDialogProps) {
  const { t } = useTranslation();
  const hasErrors = validation.totalErrors > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasErrors ? (
              <AlertTriangle className="w-5 h-5 text-destructive" />
            ) : (
              <AlertCircle className="w-5 h-5 text-warning" />
            )}
            {t("validationIssues")}
          </DialogTitle>
          <DialogDescription>
            {hasErrors
              ? t("validationErrorsDesc", {
                  errorCount: validation.totalErrors,
                  warningCount: validation.totalWarnings,
                })
              : t("validationWarningsDesc", {
                  warningCount: validation.totalWarnings,
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <div className="flex flex-col gap-2">
            {validation.canvases.map((canvas) => (
              <Section
                key={canvas.canvasId}
                label={canvas.canvasLabel}
                diagnostics={canvas.diagnostics}
                onSelectDiagnostic={onSelectDiagnostic}
              />
            ))}
            {/* Project-scoped diagnostics (no canvasId) live in their own buckets. */}
            {validation.channelDiagnostics.length > 0 && (
              <Section
                label={t("channels")}
                diagnostics={validation.channelDiagnostics}
                onSelectDiagnostic={onSelectDiagnostic}
              />
            )}
            {validation.memoryDiagnostics.length > 0 && (
              <Section
                label={t("memoryFiles")}
                diagnostics={validation.memoryDiagnostics}
                onSelectDiagnostic={onSelectDiagnostic}
              />
            )}
            {validation.modelDiagnostics.length > 0 && (
              <Section
                label={t("models")}
                diagnostics={validation.modelDiagnostics}
                onSelectDiagnostic={onSelectDiagnostic}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          {hasErrors || !onContinue ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("close")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={onContinue}>{t("continueWithWarnings")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One collapsible group of diagnostics — used for both canvases and the
// project-scoped buckets (channels/memory/models). Counts are derived here.
function Section({
  label,
  diagnostics,
  onSelectDiagnostic,
}: {
  label: string;
  diagnostics: Diagnostic[];
  onSelectDiagnostic?: (diagnostic: Diagnostic) => void;
}) {
  const [open, setOpen] = useState(true);
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;

  return (
    <div className="rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent/50 rounded-t-md"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 transition-transform", !open && "-rotate-90")} />
        <span className="truncate flex-1 font-medium">{label}</span>
        <div className="flex items-center gap-1">
          {errorCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 leading-4 border-destructive/40 text-destructive bg-card"
            >
              {errorCount}
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 leading-4 border-warning/40 text-warning bg-card"
            >
              {warningCount}
            </Badge>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-1.5 flex flex-col gap-0.5">
          {diagnostics.map((diag, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDiagnostic?.(diag)}
              disabled={!onSelectDiagnostic}
              className="flex items-start gap-1.5 px-1 py-1 text-xs text-left rounded transition-colors enabled:hover:bg-accent/50 enabled:cursor-pointer disabled:cursor-default"
            >
              {diag.severity === "error" ? (
                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              )}
              <span className="text-muted-foreground">{diag.message}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
