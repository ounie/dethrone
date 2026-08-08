"use client";

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
 */
export default function Panel({
  icon,
  title,
  actions,
  tone,
  children,
  className,
}: {
  icon: IconName;
  title: string;
  actions?: React.ReactNode;
  tone?: "gilt";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`panel${tone === "gilt" ? " panel-gilt" : ""}${className ? ` ${className}` : ""}`}
      aria-label={title}
    >
      <header className="panel-head">
        <span className="panel-title">
          <Icon name={icon} size={15} />
          {title}
        </span>
        {actions && <span className="panel-actions">{actions}</span>}
      </header>
      {children}
    </section>
  );
}
