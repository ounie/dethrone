"use client";

import { useState } from "react";
import Icon from "./icon";

/**
 * The slots and the menu to fill them from.
 *
 * ## Why this is its own component
 *
 * Two screens now build a sequence — `action-picker.tsx`, which is the
 * `kind: "actions"` field on `submit_actions`, and `fighters-pane.tsx`, which
 * plans one before a match exists to submit it to. They must agree on one thing
 * absolutely: **the printed number beside an action is the integer that gets
 * submitted, and the order of the menu is the wire contract.** Two renderers
 * would be two chances to print `i` from a map index while submitting
 * `action.index` from the payload, or to sort the menu for looks. Either bug
 * produces a request the arena accepts and a fight the operator did not plan.
 *
 * So there is one, it is pure, and it holds no state but a drag cursor: the
 * picks live with whoever owns the plan.
 *
 * ## The cap is read, never typed
 *
 * `capacity` is the canon's published `actions.sequenceLength`, threaded down
 * from `GET /api/rules`. **Null means the canon published none, and then there
 * is no cap at all** — not a fallback of five. A guessed cap is the same
 * mistake as a typed one wearing a friendlier face: it is a game rule living in
 * a browser, correct until the day the rule versions, and then wrong in the
 * direction of silently refusing a legal plan.
 *
 * With a number, the builder stops accepting picks past it and says so. That is
 * not the console deciding a rule — it is the console rendering one the arena
 * published, which is the same thing it does with a price.
 */

export interface MenuAction {
  /** The integer that is submitted. Never a map index. */
  index: number;
  id: string;
  text: string;
  type: string;
}

export default function SequenceBuilder({
  menu,
  picks,
  capacity,
  disabled,
  onPick,
  onClear,
  onReorder,
  emptyHint,
}: {
  /** Null until a menu has been loaded. The grid is hidden, the slots are not. */
  menu: MenuAction[] | null;
  picks: number[];
  /** The canon's published sequence length. Null → no cap is imposed. */
  capacity: number | null;
  disabled: boolean;
  onPick: (index: number) => void;
  onClear: (slot: number) => void;
  /** Move the pick at `from` to `to`, both slot positions. */
  onReorder: (from: number, to: number) => void;
  emptyHint: string;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const full = capacity !== null && picks.length >= capacity;

  function move(from: number, to: number) {
    if (to < 0 || to >= picks.length || to === from) return;
    onReorder(from, to);
  }

  return (
    <>
      <ol className="slots" aria-label="Your sequence, in exchange order">
        {picks.map((index, slot) => {
          // Resolved for DISPLAY only. A pick survives a menu that has not
          // loaded yet: the integer is the submission, and the text beside it
          // is a courtesy.
          const action = menu?.find((a) => a.index === index);
          return (
            <li
              key={`${slot}-${index}`}
              className="slot"
              data-dragging={dragging === slot}
              data-over={over === slot && dragging !== slot}
              /*
                HTML5 drag, not a library. The list is at most a handful of rows
                and never scrolls, which is the case native drag handles well —
                and a pointer-events reimplementation would be a dependency and
                a touch-scroll bug for a feature that is already a convenience.
                The keyboard buttons below are the accessible path, not a
                fallback: `dragstart` fires for no keyboard user at all.
              */
              draggable={!disabled}
              onDragStart={(e) => {
                setDragging(slot);
                e.dataTransfer.effectAllowed = "move";
                // Firefox refuses to start a drag without payload.
                e.dataTransfer.setData("text/plain", String(slot));
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(slot);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null) move(dragging, slot);
                setDragging(null);
                setOver(null);
              }}
            >
              <span className="slot-n num">{slot + 1}</span>
              <span className="slot-body">
                <span className="num slot-index">#{index}</span>
                {action && <span className="slot-text">{action.text}</span>}
                {action && (
                  <span className="type-tag" data-type={action.type}>
                    {action.type}
                  </span>
                )}
              </span>
              <span className="slot-controls">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move position ${slot + 1} earlier`}
                  disabled={disabled || slot === 0}
                  onClick={() => move(slot, slot - 1)}
                >
                  <Icon name="chevron-up" size={12} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move position ${slot + 1} later`}
                  disabled={disabled || slot === picks.length - 1}
                  onClick={() => move(slot, slot + 1)}
                >
                  <Icon name="chevron-down" size={12} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove position ${slot + 1}`}
                  disabled={disabled}
                  onClick={() => onClear(slot)}
                >
                  <Icon name="x-mark" size={12} />
                </button>
              </span>
            </li>
          );
        })}
        {picks.length === 0 && <li className="slot empty muted">{emptyHint}</li>}
      </ol>

      {menu && (
        <div className="menu-grid">
          {menu.map((action) => (
            <button
              key={action.index}
              type="button"
              className="menu-item"
              // Full is the published length reached, never a count this file
              // decided. With no published length `full` is false forever and
              // the arena does the refusing, as it did before.
              disabled={disabled || full}
              title={
                full
                  ? "The plan is full — remove one first."
                  : action.text
              }
              onClick={() => onPick(action.index)}
            >
              <span className="num menu-index">#{action.index}</span>
              <span className="menu-text ellipsis">{action.text}</span>
              <span className="type-tag" data-type={action.type}>
                {action.type}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
