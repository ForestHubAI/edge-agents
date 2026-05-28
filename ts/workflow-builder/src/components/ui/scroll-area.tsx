import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "../../cn";

/**
 * Radix-backed overlay scrollbar — the builder's canonical scrollable surface.
 *
 * Why Radix and not the native `::-webkit-scrollbar`:
 *  - Overlay positioning. The scrollbar is an absolutely-positioned div outside
 *    the content flow, so it never subtracts width from content (no reflow when
 *    it appears, no inconsistency between panels with and without overflow).
 *  - `type="hover"`: scrollbar fades in only while the pointer is over the
 *    panel, fades out otherwise — quiet by default.
 *  - Thumb is semi-transparent so any content the scrollbar floats over stays
 *    legible (the user explicitly wanted this).
 *  - No arrow buttons. Just a thumb on a transparent track.
 *
 * The native CSS scrollbar rules in styles/index.css remain in place as a
 * fallback for tiny scrollable surfaces (dropdown menu lists, select popovers,
 * dialog bodies) where wrapping in a ScrollArea is overkill.
 *
 * `viewportRef` exposes the inner scrollable element for callers that need
 * imperative scroll (e.g. DebugConsolePanel auto-scrolling to bottom on new
 * entries). The Root forwardRef points to the outer container, which is *not*
 * the element with `overflow: scroll`.
 */
interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  viewportRef?: React.Ref<HTMLDivElement>;
  /** Inner padding applied to the Viewport — usually what callers want when
   *  replacing a `overflow-y-auto p-3` div, since Radix's Root cannot itself
   *  carry the padding (it must clip cleanly for the overlay scrollbar). */
  viewportClassName?: string;
}

const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  ({ className, children, viewportRef, viewportClassName, type = "hover", ...props }, ref) => (
    <ScrollAreaPrimitive.Root
      ref={ref}
      type={type}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn("h-full w-full rounded-[inherit]", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner className="bg-transparent" />
    </ScrollAreaPrimitive.Root>
  ),
);
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

/**
 * Themed thin scrollbar. 6px to match the native fallback, transparent track,
 * thumb tinted with --muted-foreground at low opacity bumping on hover. No
 * padding/border (the prior `p-[1px]` + transparent border was what gave it
 * the inset look people noticed against the native bar in other panels).
 *
 * The opacity transitions are driven by Radix's `data-state` on the scrollbar
 * itself (`visible` / `hidden`), which `type="hover"` flips based on pointer
 * position + overflow presence.
 */
const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  // forceMount keeps the scrollbar in the DOM when Radix flips it to
  // data-state="hidden", so the opacity transition has something to animate.
  // Without it Radix unmounts the element after its hide delay and the bar
  // vanishes instantly instead of fading. The hidden bar is `pointer-events:
  // none` via opacity-0 + Radix not rendering interactive surfaces while
  // hidden, so this doesn't trap clicks.
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    forceMount
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-opacity duration-200",
      "data-[state=hidden]:opacity-0 data-[state=visible]:opacity-100",
      "data-[state=hidden]:pointer-events-none",
      orientation === "vertical" && "h-full w-1.5",
      orientation === "horizontal" && "h-1.5 flex-col w-full",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      className={cn(
        "relative flex-1 rounded-full bg-muted-foreground/30 transition-colors",
        "hover:bg-muted-foreground/55",
      )}
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
