import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const headingVariants = cva("font-bold tracking-tight", {
  variants: {
    level: {
      h1: "text-4xl md:text-5xl lg:text-6xl",
      h2: "text-3xl md:text-4xl lg:text-5xl",
      h3: "text-2xl md:text-3xl lg:text-4xl",
      h4: "text-xl md:text-2xl lg:text-3xl",
      h5: "text-lg md:text-xl lg:text-2xl",
      h6: "text-base md:text-lg lg:text-xl",
    },
    gradient: {
      true: "gradient-text",
      false: "",
    },
  },
  defaultVariants: {
    level: "h2",
    gradient: false,
  },
})

export interface HeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
}

const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, level, gradient, as, children, ...props }, ref) => {
    const Component = as || level || "h2"
    
    return (
      <Component
        ref={ref}
        className={cn(headingVariants({ level: level || as, gradient, className }))}
        {...props}
      >
        {children}
      </Component>
    )
  }
)
Heading.displayName = "Heading"

const textVariants = cva("", {
  variants: {
    variant: {
      body: "text-base leading-7",
      lead: "text-xl text-muted-foreground leading-relaxed",
      large: "text-lg font-semibold",
      small: "text-sm font-medium leading-none",
      muted: "text-sm text-muted-foreground",
      code: "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
    },
  },
  defaultVariants: {
    variant: "body",
  },
})

export interface TextProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof textVariants> {
  as?: "p" | "span" | "div" | "code"
}

const Text = React.forwardRef<HTMLParagraphElement, TextProps>(
  ({ className, variant, as = "p", children, ...props }, ref) => {
    const Component = as
    
    return (
      <Component
        ref={ref as React.Ref<never>}
        className={cn(textVariants({ variant, className }))}
        {...props}
      >
        {children}
      </Component>
    )
  }
)
Text.displayName = "Text"

export { Heading, Text, headingVariants, textVariants }
