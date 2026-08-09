"use client";

import { useId, useState } from "react";
import Icon, { type IconName } from "./icon";

/**
 * The panel: a slab with a ruled header.
 *
 * Every surface on this screen is the same object — a warm-ink gradient face,
 * a 1px hairline, and a lit top arris that gives it thickness. The header is a
 * ruled bar: an icon and a tracked-out uppercase eyebrow on the left, actions
 * on the right, a hairline beneath. Repeating one anatomy is what makes a
 * data-dense screen legible; five different card treatments is what makes it
 * noise.
 *
 * Gilt is a material here, never an accent. A panel goes gilt-edged when it is
 * ceremonial (the seat, the crest), and ember is spent on exactly one thing on
 * this screen: the button that moves money.
 *
 * ## Collapsing
 *
 * Every panel folds to its header. The screen is a four-row grid of dense
 * readouts and not all of them matter at once — a sixteen-action menu is
 * essential while planning and noise while reading a response — so the chevron
 * is on the shared anatomy rather than added per pane. One header, one control,
 * every card.
 *
 * **Collapsed state is deliberately not persisted.** Nothing about this console
 * survives a reload on purpose (the plan does not, the ceiling is re-read, the
 * seat is re-fetched), and a panel that came back folded would hide a money
 * readout from someone who had forgotten they folded it three days earlier.
 * Every reload shows the whole instrument.
 *
 * The body is UNMOUNTED rather than hidden with CSS. Hiding it would leave a
 * collapsed Fighters panel polling the arena from behind its own header, which
 * is the sort of thing that is invisible until it shows up in a rate limit.
 */
export default function Panel({
  icon,
  title,
  actions,
  tone,
  collapsible = true,
  children,
  className,
}: {
  icon: IconName;
  title: string;
  actions?: React.ReactNode;
  tone?: "gilt";
  /** Set false for a pane whose header is the whole pane. */
  collapsible?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const folded = collapsible && !open;

  return (
    <section
      className={`panel${tone === "gilt" ? " panel-gilt" : ""}${className ? ` ${className}` : ""}`}
      aria-label={title}
      data-collapsed={folded}
    >
      <header className="panel-head">
        <span className="panel-title">
          <Icon name={icon} size={15} />
          {title}
        </span>
        <span className="panel-actions">
          {/* The pane's own actions stay put when it folds away — several of
              them are refresh buttons, and a collapsed pane is exactly when you
              want to re-read without unfolding first. */}
          {actions}
          {collapsible && (
            <button
              type="button"
              className="icon-btn"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
              title={open ? "Collapse" : "Expand"}
              onClick={() => setOpen((prev) => !prev)}
            >
              <Icon name={open ? "chevron-up" : "chevron-down"} size={13} />
            </button>
          )}
        </span>
      </header>
      {/* `panel-body-wrap` is layout-transparent on purpose: `.panel` is a flex
          column and the rail's inner scroll depends on being a shrinkable child
          of it, so the wrapper has to pass `flex` and `min-height: 0` straight
          through rather than becoming a new block. */}
      {!folded && (
        <div id={bodyId} className="panel-body-wrap">
          {children}
        </div>
      )}
    </section>
  );
}
