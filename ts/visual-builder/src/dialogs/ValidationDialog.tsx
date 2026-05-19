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
import { cn } from "../lib/utils";
import type { CanvasValidationResult, ValidationResult } from "../utils/diagnostics";

interface ValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  validation: ValidationResult;
  onContinue: () => void;
}

export default function ValidationDialog({ open, onOpenChange, validation, onContinue }: ValidationDialogProps) {
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
            {t("builder.validationIssues")}
          </DialogTitle>
          <DialogDescription>
            {hasErrors
              ? t("builder.validationErrorsDesc", {
                  errorCount: validation.totalErrors,
                  warningCount: validation.totalWarnings,
                })
              : t("builder.validationWarningsDesc", {
                  warningCount: validation.totalWarnings,
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <div className="flex flex-col gap-2">
            {validation.canvases.map((canvas) => (
              <CanvasSection key={canvas.canvasId} canvas={canvas} />
            ))}
          </div>
        </div>

        <DialogFooter>
          {hasErrors ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={onContinue}>{t("builder.continueWithWarnings")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CanvasSection({ canvas }: { canvas: CanvasValidationResult }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent/50 rounded-t-md"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 transition-transform", !open && "-rotate-90")} />
        <span className="truncate flex-1 font-medium">{canvas.canvasLabel}</span>
        <div className="flex items-center gap-1">
          {canvas.errorCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 leading-4 border-destructive/40 text-destructive bg-destructive/10"
            >
              {canvas.errorCount}
            </Badge>
          )}
          {canvas.warningCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 leading-4 border-warning/40 text-warning bg-warning/10"
            >
              {canvas.warningCount}
            </Badge>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-1.5 flex flex-col gap-0.5">
          {canvas.diagnostics.map((diag, i) => (
            <div key={i} className="flex items-start gap-1.5 px-1 py-1 text-xs">
              {diag.severity === "error" ? (
                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              )}
              <span className="text-muted-foreground">{diag.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
