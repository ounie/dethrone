"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Icon from "./icon";
import type { PanelDrag } from "./panel";
import {
  PANE_TITLES,
  ZONES,
  ZONE_TITLES,
  layoutSnapshot,
  move,
  nudge,
  resetArrangement,
  serverLayoutSnapshot,
  subscribeLayout,
  writeArrangement,
  type PaneId,
  type ZoneId,
} from "@/lib/layout";

/**
 * The arrangement, and the gestures that change it.
 *
 * ## Native drag and drop, and no library
 *
 * `package.json` has nine runtime dependencies and every one of them earns its
 * place. A drag-and-drop library is thirty kilobytes and a lifetime of upgrades
 * to move seven boxes, so this is the platform's own `dragstart` / `dragover` /
 * `drop`. The cost is real and worth naming: HTML5 drag events are awkward,
 * `dragover` must call `preventDefault` to permit a drop at all, and the drag
 * image is the browser's. None of that is worse than an eleventh dependency.
 *
 * ## The keyboard is not an afterthought
 *
 * A drag is a mouse gesture, and a feature that exists only for a mouse is a
 * feature some operators do not have. The grip is a `<button>`: tab to it, and
 * the arrow keys move the card one step — up and down within a column, left and
 * right between the full-width row and the two columns. `lib/layout.ts#nudge`
 * is the same pure function in both directions, so the two paths cannot drift.
 *
 * ## The rail is not here
 *
 * `.pane-rail` stays a fixed grid child. It is sticky and it is sized to the
 * viewport, and anything that ends up beneath it is painted over the moment the
 * page scrolls — a bug this repo shipped once already.
 */

/** Where a dragged card would land, for the insertion line. */
interface DropTarget {
  zone: ZoneId;
  before: PaneId | null;
}

export default function ConsoleLayout({
  panes,
  rail,
}: {
  /**
   * Every movable pane, as a function of the drag props it needs.
   *
   * A function rather than a node because the handlers are per-pane and the
   * layout is what knows which pane it is rendering — passing nodes would mean
   * `console.tsx` importing the drag machinery to build them, which puts the
   * arrangement in two files.
   */
  panes: Record<PaneId, (drag: PanelDrag) => React.ReactNode>;
  /** The catalogue. Placed by CSS, never by the arrangement. */
  rail: React.ReactNode;
}) {
  const arrangement = useSyncExternalStore(
    subscribeLayout,
    layoutSnapshot,
    serverLayoutSnapshot,
  );

  const [dragging, setDragging] = useState<PaneId | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const say = useCallback((message: string) => {
    // Announced through a live region rather than a toast: the operator who
    // most needs to hear "moved to the left column" is the one who cannot see
    // the card move.
    setNote(message);
  }, []);

  const commit = useCallback(
    (pane: PaneId, zone: ZoneId, before: PaneId | null) => {
      writeArrangement(move(layoutSnapshot(), pane, zone, before));
      say(`${PANE_TITLES[pane]} moved to ${ZONE_TITLES[zone]}.`);
    },
    [say],
  );

  const onKeyDown = useCallback(
    (pane: PaneId) => (e: React.KeyboardEvent) => {
      const map: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = map[e.key];
      if (!direction) return;
      e.preventDefault();
      const next = nudge(layoutSnapshot(), pane, direction);
      // Identity, not deep equality: `nudge` returns the SAME object when the
      // move is illegal, which is what makes "nothing happened" cheap to detect
      // and what stops an announcement claiming a move that did not occur.
      if (next === layoutSnapshot()) {
        say(`${PANE_TITLES[pane]} is already at the edge.`);
        return;
      }
      writeArrangement(next);
      say(`${PANE_TITLES[pane]} moved ${direction}.`);
    },
    [say],
  );

  const dragProps = useCallback(
    (pane: PaneId) => ({
      label: `Move ${PANE_TITLES[pane]} — drag, or use the arrow keys`,
      onDragStart: (e: React.DragEvent) => {
        setDragging(pane);
        // `text/plain` because Firefox refuses to start a drag without data on
        // the transfer, and the payload is never read back — `held` is.
        e.dataTransfer.setData("text/plain", pane);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => {
        setDragging(null);
        setTarget(null);
      },
      onKeyDown: onKeyDown(pane),
    }),
    [onKeyDown],
  );

  /*
    Two handlers for the whole tree, not a factory per card.

    Which zone and which pane an element stands for live on `data-` attributes,
    so these read the event's own target rather than closing over the loop
    variables. That is what keeps them stable `useCallback`s — a factory called
    during render creates a new closure per card per frame, and `dragover` fires
    many times a second across seven of them.

    The pane being dragged is plain state and not a ref. A ref looks cheaper —
    `dragover` fires constantly and state means rebuilding these handlers — but
    it rebuilds them ONCE PER DRAG rather than once per event, because
    `dragging` changes exactly twice in a gesture. It is also the shape the
    React Compiler's lint accepts: a function called during render that reaches
    a ref is flagged, and this tree calls `dragProps` per card on every render.
  */
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
    if (!dragging) return;
    const el = e.currentTarget as HTMLElement;
    const zone = el.dataset.zone as ZoneId | undefined;
    if (!zone) return;

    e.preventDefault();
    e.stopPropagation();

    const over = el.dataset.pane as PaneId | undefined;
    if (!over) {
      // The column itself, below the last card.
      setTarget({ zone, before: null });
      return;
    }

    // Nearer edge wins, so a card can be dropped either side of another.
    const box = el.getBoundingClientRect();
    const list = layoutSnapshot()[zone];
    const index = list.indexOf(over);
    const after = e.clientY > box.top + box.height / 2;
    setTarget({ zone, before: after ? (list[index + 1] ?? null) : over });
    },
    [dragging],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      if (target) commit(dragging, target.zone, target.before);
      setDragging(null);
      setTarget(null);
    },
    [commit, dragging, target],
  );

  const rendered = (zone: ZoneId) => {
    const list = arrangement[zone];
    return (
      <div
        className={`zone zone-${zone}`}
        data-zone={zone}
        data-empty={list.length === 0}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {list.map((pane) => (
          <div
            key={pane}
            className="zone-slot"
            data-dragging={dragging === pane}
            data-drop-before={target?.zone === zone && target.before === pane}
            data-zone={zone}
            data-pane={pane}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {panes[pane](dragProps(pane))}
          </div>
        ))}
        {/* The tail marker, so a drop below the last card has something to
            highlight. Only while a drag is in flight. */}
        {dragging && target?.zone === zone && target.before === null && (
          <div className="zone-tail" aria-hidden="true" />
        )}
      </div>
    );
  };

  return (
    <div className="console" data-dragging={dragging !== null}>
      {rail}
      {ZONES.map((zone) => (
        <ConsoleZone key={zone}>{rendered(zone)}</ConsoleZone>
      ))}

      <div className="layout-tools">
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            resetArrangement();
            say("Layout reset to the default arrangement.");
          }}
          title="Put every card back where it ships"
        >
          <Icon name="rotate-cw" size={12} />
          Reset layout
        </button>
        <span className="layout-hint muted">
          Drag a card by its header, or focus its grip and use the arrow keys.
        </span>
      </div>

      {/* Polite, so it never interrupts a screen reader mid-sentence. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {note}
      </p>
    </div>
  );
}

/**
 * A pass-through.
 *
 * The zones are grid children and must stay direct children of `.console` for
 * `grid-column` to place them, so this adds no element — it exists only to give
 * the map a keyed component boundary.
 */
function ConsoleZone({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
