import { useTranslation } from "react-i18next";

/**
 * The "view only" notice shown at the top of every config panel when the builder
 * is in a read-only mode (preview/debug). Callers gate it with their own
 * `{readOnly && <ReadOnlyBanner />}` so the visibility logic stays local.
 */
export function ReadOnlyBanner() {
  const { t } = useTranslation();
  return (
    <div className="text-xs font-medium text-muted-foreground bg-muted/50 rounded px-2 py-1">
      {t("preview.viewOnly")}
    </div>
  );
}
