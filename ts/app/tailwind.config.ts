import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Maps the CSS variables defined in @foresthub/workflow-builder/src/styles/index.css
 * to Tailwind utility colors so classes like `bg-canvas-bg`, `text-muted-foreground`,
 * `border-border`, `bg-node-agent`, etc. resolve.
 *
 * Conventional shadcn pattern: each token has a DEFAULT (the surface) and an
 * optional `-foreground` paired text color.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../workflow-builder/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
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

        // Workflow builder
        canvas: {
          bg: "hsl(var(--canvas-background))",
        },
        panel: {
          background: "hsl(var(--panel-background))",
          border: "hsl(var(--panel-border))",
        },
        edge: {
          default: "hsl(var(--edge-default))",
          active: "hsl(var(--edge-active))",
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

export default config;
