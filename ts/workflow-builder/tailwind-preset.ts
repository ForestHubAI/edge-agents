import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Tailwind preset for @foresthubai/workflow-builder.
 *
 * This is the single source of truth that binds the design-system tokens
 * defined in `src/styles/index.css` (raw HSL triplets like `--primary`) to the
 * Tailwind utility classes the builder's components reference (`bg-primary`,
 * `text-muted-foreground`, `border-border`, `bg-node-agent`, …). It also ships
 * the `darkMode` strategy, the accordion keyframes, and the
 * `tailwindcss-animate` plugin that the builder's shadcn components depend on.
 *
 * Any consumer embedding the builder must:
 *   1. spread this preset:  `presets: [workflowBuilderPreset]`
 *   2. import the tokens once:  `import "@foresthubai/workflow-builder/styles/index.css"`
 *   3. add the builder to their Tailwind `content` so its classes are emitted
 *      (a glob over its built JS under node_modules/@foresthubai/workflow-builder,
 *      or, when consuming source as this monorepo does, the builder's src tree).
 *
 * `content` is intentionally NOT part of the preset: its globs are
 * consumer-relative (source tree in this monorepo, node_modules in a published
 * install), so each consumer owns that path.
 */
const preset: Omit<Config, "content"> = {
  darkMode: ["class"],
  theme: {
    extend: {
      fontFamily: {
        // The builder's base body face (applied on the .fh-workflow-builder root)
        // and its display/heading face. Defined here so `font-sans`/`font-heading`
        // resolve to the builder's type even in portaled content (dialogs, menus)
        // that renders outside the root and can't inherit the root's font.
        sans: ["Poppins", "system-ui", "sans-serif"],
        heading: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        // ───────────────────────────────────────────────────────────
        // GENERAL UI — surfaces, text, controls. Reusable by host apps.
        // ───────────────────────────────────────────────────────────

        // Surfaces & controls
        border: "hsl(var(--border))",
        input: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        field: "hsl(var(--field))",
        overlay: "hsl(var(--overlay))",

        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          glow: "hsl(var(--primary-glow))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Status
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },

        // Sidebar
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },

        // ───────────────────────────────────────────────────────────
        // BUILDER / GRAPH ONLY — canvas, edges, node categories.
        // Host apps embedding the builder don't reference these.
        // ───────────────────────────────────────────────────────────
        canvas: {
          bg: "hsl(var(--canvas-background))",
        },
        panel: {
          background: "hsl(var(--panel-background))",
          border: "hsl(var(--panel-border))",
        },
        edge: {
          default: "hsl(var(--edge-default))",
        },
        "selection-glow": "hsl(var(--selection-glow))",

        // Node category signals
        node: {
          agent: "hsl(var(--node-agent))",
          input: "hsl(var(--node-input))",
          output: "hsl(var(--node-output))",
          trigger: "hsl(var(--node-trigger))",
          logic: "hsl(var(--node-logic))",
          data: "hsl(var(--node-data))",
          tool: "hsl(var(--node-tool))",
          function: "hsl(var(--node-function))",
          shadow: "hsl(var(--node-shadow))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        "gradient-subtle": "var(--gradient-subtle)",
        "gradient-glass": "var(--gradient-glass)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        glow: "var(--shadow-glow)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
};

export default preset;
