import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Language } from "../i18n";

// The languages the builder ships translations for. Names are endonyms (shown in
// their own language) by design — a German speaker looks for "Deutsch", not
// "German". Keep this list in sync with the builder's bundled locales.
const languages: { code: Language; name: string; flag: string }[] = [
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "en", name: "English", flag: "🇺🇸" },
];

// Globe dropdown to pick the UI language — flag + name per entry, a ✓ on the
// active one. App holds the `language` state and feeds it down; selecting an
// entry drives both the host's i18n and the builder's `language` prop.
export function LanguageSwitcher({ language, onChange }: { language: Language; onChange: (lang: Language) => void }) {
  const { t } = useTranslation();
  const current = languages.find((l) => l.code === language) ?? languages[1];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground p-1.5 rounded hover:bg-muted/50 transition-colors"
          title={t("a11y.changeLanguage")}
          aria-label={t("a11y.changeLanguage")}
        >
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline text-sm">{current.flag}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
        >
          {languages.map((entry) => (
            <DropdownMenu.Item
              key={entry.code}
              onSelect={() => onChange(entry.code)}
              className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground"
            >
              <span>{entry.flag}</span>
              <span>{entry.name}</span>
              {language === entry.code && <span className="ml-auto text-primary">✓</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
