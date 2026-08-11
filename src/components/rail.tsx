"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import Panel from "./panel";
import Icon from "./icon";
import type { Capabilities } from "@/lib/capability";
import { COMMANDS, GROUPS, type Command } from "@/lib/commands";
import { money } from "@/lib/format";
import {
  moveSection,
  nudgeSection,
  railPrefsSnapshot,
  serverRailPrefsSnapshot,
  subscribeRailPrefs,
  togglePin,
  writePrefs,
  type SectionId,
} from "@/lib/rail-prefs";

/**
 * The catalogue, grouped by cost.
 *
 * Grouping by price is the one true statement this UI can make about the arena
 * without importing a rule. Cost is the only access control in the system —
 * there are no roles and no scopes — so the left column *is* the permission
 * model, rendered.
 *
 * The colour carries it: teal where nothing is at stake, ember where USDC
 * settles the moment the handler succeeds. Colour is never the only signal,
 * though — every row also states its method and its price in words, because a
 * screen that spends money must not rely on a hue a colourblind operator
 * cannot separate.
 *
 * The price text comes from the server: the live number where the canon
 * publishes one, the catalogue's label otherwise. This component formats and
 * does not compute.
 */

/**
 * What each section is called. The ORDER is the operator's — see
 * `rail-prefs.ts` — but the grouping is not: cost is the only access control in
 * this system, so a tier cannot be merged, renamed or hidden, only moved.
 *
 * `pinned` is a heading in the same list and is not a tier. It renders through
 * the same component precisely so that it folds and moves like every other
 * section rather than being a special case that quietly behaves differently.
 */
const SECTION_LABELS: Record<SectionId, string> = {
  pinned: "Pinned",
  free: "Free reads",
  paid: "Paid writes",
  signed: "Signed — free, proves the wallet",
};

function priceLabel(cmd: Command, liveCents?: number): string {
  return liveCents === undefined ? cmd.price : money(liveCents);
}

/**
 * One command, wherever it is rendered.
 *
 * Extracted so the pinned section and the tier it belongs to draw the identical
 * row. Two renderings of one command is how a pinned copy quietly stops
 * carrying its price, or its disabled reason, or its `data-enabled` — and
 * `catalogue-render.test.ts` counts that last one.
 */
function CommandRow({
  cmd,
  cap,
  active,
  pinned,
  onSelect,
  onTogglePin,
}: {
  cmd: Command;
  cap: Capabilities[string];
  active: boolean;
  pinned: boolean;
  onSelect: (cmd: Command) => void;
  onTogglePin: (id: string) => void;
}) {
  return (
    <li className="rail-row">
      <button
        type="button"
        className="cmd"
        aria-current={active}
        data-paid={cmd.tier === "paid"}
        data-enabled={cap.enabled}
        data-reason={cap.reason}
        disabled={!cap.enabled}
        onClick={() => onSelect(cmd)}
        title={cmd.label}
      >
        <span className="method" data-method={cmd.method}>
          {cmd.method}
        </span>
        <span className="cmd-path ellipsis">{cmd.path}</span>
        <span className="tag num" data-tier={cmd.tier}>
          {priceLabel(cmd, cap.liveCents)}
        </span>
      </button>
      {/*
        The pin, and it is NEVER disabled.

        A keyless deploy renders every paid command disabled, and pinning one is
        still a reasonable thing to want — it is a bookmark, not a permission.
        It also carries no `data-enabled` and no `data-paid`, which is what
        keeps it out of `catalogue-render.test.ts`'s two counts: that file reads
        those attributes to prove a keyless boot registers nothing spendable,
        and a star that wore them would be counted as a command.
      */}
      <button
        type="button"
        className="rail-pin"
        data-pinned={pinned}
        aria-pressed={pinned}
        aria-label={`${pinned ? "Unpin" : "Pin"} ${cmd.label}`}
        title={pinned ? "Unpin" : "Pin for quick access"}
        onClick={() => onTogglePin(cmd.id)}
      >
        <Icon name={pinned ? "shield-check" : "circle"} size={11} />
      </button>
      {!cap.enabled && cap.reason && <p className="rail-reason">{cap.reason}</p>}
    </li>
  );
}

/**
 * One tier of the catalogue, foldable.
 *
 * Its own component because it holds state, and a `useState` inside the `.map`
 * below would be a hook in a loop. Open by default — a catalogue that hid
 * itself on load would make the console's central claim (here is everything
 * this deploy can do, priced) something you have to go looking for.
 *
 * `catalogue-render.test.ts` counts `data-enabled="true"` across this rendered
 * tree against the free-command count, so the default MUST stay open; folding
 * one by default would unmount rows the test is counting and read as a
 * capability regression. The toggle itself carries no `data-enabled` and is
 * never disabled, which keeps it out of both of that file's assertions.
 */
function RailGroup({
  tier,
  label,
  cmds,
  capabilities,
  activeId,
  onSelect,
  pinned,
  onTogglePin,
  drag,
}: {
  tier: SectionId;
  label: string;
  cmds: Command[];
  capabilities: Capabilities;
  activeId: string;
  onSelect: (cmd: Command) => void;
  pinned: string[];
  onTogglePin: (id: string) => void;
  drag: {
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    dragging: boolean;
  };
}) {
  const [open, setOpen] = useState(true);
  const listId = useId();

  return (
    <section
      className="rail-group"
      data-dragging={drag.dragging}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
    >
      {/*
        The header is the drag surface, exactly as a panel's is: it is the one
        strip of the group that holds no data, and making the LIST draggable
        would turn every attempt to select a path into a drag.
      */}
      <h3
        className="rail-group-head"
        data-tier={tier}
        draggable
        onDragStart={drag.onDragStart}
        onDragEnd={drag.onDragEnd}
      >
        <button
          type="button"
          className="rail-group-grip"
          aria-label={`Move ${label} — drag, or use the arrow keys`}
          title={`Move ${label}`}
          onKeyDown={drag.onKeyDown}
        >
          <Icon name="grip" size={11} />
        </button>
        <button
          type="button"
          className="rail-group-toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((prev) => !prev)}
        >
          <Icon name={open ? "chevron-up" : "chevron-down"} size={12} />
          <span className="rail-group-label">{label}</span>
          <span className="count num">{cmds.length}</span>
        </button>
      </h3>

      {open && (
        <ul className="rail-list" id={listId}>
          {cmds.map((cmd) => (
            <CommandRow
              key={cmd.id}
              cmd={cmd}
              cap={capabilities[cmd.id] ?? { enabled: true }}
              active={cmd.id === activeId}
              pinned={pinned.includes(cmd.id)}
              onSelect={onSelect}
              onTogglePin={onTogglePin}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Rail({
  capabilities,
  activeId,
  onSelect,
}: {
  capabilities: Capabilities;
  activeId: string;
  onSelect: (cmd: Command) => void;
}) {
  const prefs = useSyncExternalStore(
    subscribeRailPrefs,
    railPrefsSnapshot,
    serverRailPrefsSnapshot,
  );
  const [dragging, setDragging] = useState<SectionId | null>(null);

  const onTogglePin = useCallback((id: string) => {
    writePrefs(togglePin(railPrefsSnapshot(), id));
  }, []);

  const dragFor = useCallback(
    (tier: SectionId) => ({
      dragging: dragging === tier,
      onDragStart: (e: React.DragEvent) => {
        setDragging(tier);
        // Firefox refuses to begin a drag with nothing on the transfer. The
        // payload is never read back — `dragging` is.
        e.dataTransfer.setData("text/plain", tier);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => setDragging(null),
      onDragOver: (e: React.DragEvent) => {
        if (!dragging) return;
        e.preventDefault();
      },
      onDrop: (e: React.DragEvent) => {
        if (!dragging) return;
        e.preventDefault();
        e.stopPropagation();
        // Dropped ON a group means "take its place", which is `before` it.
        writePrefs(moveSection(railPrefsSnapshot(), dragging, tier));
        setDragging(null);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        const dir = e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
        if (!dir) return;
        e.preventDefault();
        writePrefs(nudgeSection(railPrefsSnapshot(), tier, dir));
      },
    }),
    [dragging],
  );

  /*
    The shelf is ADDITIVE.

    A pinned command still appears under its own tier, and the tier counts still
    say how many commands exist rather than how many are unpinned. That keeps
    cost as the grouping — this file's whole argument is that the left column IS
    the permission model — while giving the operator a shelf for the handful of
    endpoints they actually use.
  */
  return (
    <Panel icon="book-open" title="Catalogue" className="pane-rail">
      <div className="rail">
        {prefs.sectionOrder.map((section) => {
          /*
            One loop for every heading, including the shelf.

            Pinned used to be rendered above this as its own block with an inert
            header — which meant it could not fold and could not move, and it
            was the only section on the screen that behaved differently from the
            others for no reason an operator could see. Going through the same
            component is what makes "like the other sections" true rather than
            reimplemented.
          */
          const cmds =
            section === "pinned"
              ? // Ids resolved here rather than validated in `rail-prefs.ts`, so
                // a pin for a command that has since been renamed disappears.
                prefs.pinned
                  .map((id) => COMMANDS.find((c) => c.id === id))
                  .filter((c): c is Command => c !== undefined)
              : COMMANDS.filter((c) => c.tier === section);

          // An empty shelf is no heading at all. A tier with no commands is the
          // same case and was already handled this way.
          if (cmds.length === 0) return null;

          return (
            <RailGroup
              key={section}
              tier={section}
              label={SECTION_LABELS[section]}
              cmds={cmds}
              capabilities={capabilities}
              activeId={activeId}
              onSelect={onSelect}
              pinned={prefs.pinned}
              onTogglePin={onTogglePin}
              drag={dragFor(section)}
            />
          );
        })}

        <p className="rail-note">
          <Icon name="alert-triangle" size={13} />
          <span>
            Prices are catalogue labels. The amount actually settled is whatever the arena quotes
            in its 402 at request time — this console never computes one.
          </span>
        </p>
      </div>
    </Panel>
  );
}
