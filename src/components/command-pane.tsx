"use client";

import { useEffect, useRef } from "react";
import ActionPicker from "./action-picker";
import CodeBlock from "./code-block";
import Icon from "./icon";
import Panel, { type PanelDrag } from "./panel";
import type { Capability, StakeRange } from "@/lib/capability";
import { fieldsFor, isCallerPriced, type Command, type Field } from "@/lib/commands";
import { money } from "@/lib/format";

/**
 * One command: the resolved route, the note verbatim, the inputs, one button.
 *
 * The button states the consequence rather than the action: "Run" when nothing
 * is at stake, and "Run — settles …" naming the live figure the arena published
 * when it does. A button reading only "Run" on a screen where half of them
 * spend money is a button that will eventually be pressed by someone who meant
 * the other kind.
 *
 * It is also the ONLY ember-glowing element on the screen. Ember is not a
 * brand colour to be sprinkled; it means "this moves money", and it stops
 * meaning that the moment a second thing wears it.
 *
 * Every amount here arrived from the server. Nothing on this screen is
 * computed, which is what lets `test/currency-literals.test.ts` run with an
 * empty allowlist.
 */

/**
 * How long the "this card just changed" highlight lasts.
 *
 * Long enough to catch an eye that was somewhere else on the page, short enough
 * that it is gone before the operator starts reading. It must stay in step with
 * the `.pane-command[data-armed]` animation in `globals.css`; a highlight that
 * outlives its attribute simply stops, which looks like a bug in the animation.
 */
const ARMED_FLASH_MS = 1400;

function stakeHint(cmd: Command, range: StakeRange): string | undefined {
  if (cmd.id !== "post_duel") return undefined;
  if (range.minStakeCents === null || range.maxStakeCents === null) return undefined;
  return `The arena currently accepts ${range.minStakeCents}–${range.maxStakeCents} cents.`;
}

/** What will actually be sent, shown before it is sent. */
function previewBody(cmd: Command, args: Record<string, string>): string | null {
  if (cmd.method === "GET") return null;
  const body: Record<string, unknown> = {};
  for (const field of fieldsFor(cmd)) {
    if (cmd.path.includes(`:${field.name}`) || field.name === "maxCents") continue;
    const raw = (args[field.name] ?? "").trim();
    if (!raw) continue;
    if (field.kind === "actions") {
      try {
        body[field.name] = JSON.parse(raw);
      } catch {
        body[field.name] = raw;
      }
    } else {
      body[field.name] =
        field.kind === "number" ? Number(raw) : field.kind === "boolean" ? raw === "true" : raw;
    }
  }
  return JSON.stringify(body, null, 2);
}

export default function CommandPane({
  cmd,
  capability,
  args,
  busy,
  stakeRange,
  forgeNote,
  sequenceLength,
  armedAt,
  onArg,
  onRun,
  drag,
}: {
  cmd: Command;
  capability: Capability;
  args: Record<string, string>;
  busy: boolean;
  stakeRange: StakeRange;
  forgeNote: string | null;
  /** The canon's published sequence length, or null. Passed straight to the picker. */
  sequenceLength: number | null;
  /**
   * Bumped every time something elsewhere filled this pane — the Fighters
   * panel's arm buttons, or an agent proposal loaded for editing. Zero until
   * the first one, so a fresh page scrolls nowhere.
   */
  armedAt: number;
  onArg: (name: string, value: string) => void;
  onRun: () => void;
  /** Handed down by the layout so this card can be moved. */
  drag?: PanelDrag;
}) {
  const fields = fieldsFor(cmd);
  const paid = cmd.tier === "paid";

  /*
    Arming happens HERE, so it has to be visible here.

    Three buttons in the Fighters panel and one in the chat pane fill this card
    without touching it, and on a wide screen the card may not even be the part
    of the page the operator is looking at. Reported from the chair: pressing
    Forge appeared to do nothing, because the thing it did was rewrite a
    different card. So the pane comes to the operator and says it changed.

    ## It scrolls, and it does NOT press anything

    Deliberately no auto-focus on Run. A focused ember button is one Space or
    Enter away from settling an amount, and an operator whose hands are on the
    keyboard because they were just typing a stake is exactly the person that
    would catch out. `globals.css`'s first paragraph spends ember on one
    meaning; nothing here may make that button easier to hit by accident.

    The first EMPTY field is focused instead, when there is one. That is the
    thing the operator has to do next anyway — a challenge wants a stake — and
    a text input cannot spend. A command with no fields (forge is the one that
    prompted this) focuses nothing and simply arrives, highlighted.

    ## Imperative on purpose

    Scroll position and a transient highlight are the browser's state, not
    React's, which is what an effect is for. Holding "is it flashing" in
    `useState` would mean setting state synchronously inside an effect — the
    thing `console.tsx`'s own operator reset is written to avoid — to describe
    something no other render depends on.
  */
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (armedAt === 0) return;
    const body = bodyRef.current;
    const panel = body?.closest(".pane-command");
    if (!(panel instanceof HTMLElement) || !body) return;

    // `nearest`, so a pane already in view does not jump. The highlight below
    // is what carries the message in that case, and it is the common one on a
    // desktop layout where this card is always on screen.
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    const field = body.querySelector("input:not([disabled]), textarea:not([disabled])");
    if (field instanceof HTMLElement && "value" in field && field.value === "") {
      field.focus({ preventScroll: true });
    }

    panel.dataset.armed = "true";
    const clear = setTimeout(() => delete panel.dataset.armed, ARMED_FLASH_MS);
    return () => clearTimeout(clear);
  }, [armedAt]);

  // Where the canon publishes its own sentence about a command, that sentence
  // wins. The catalogue's copy is the fallback for an unreachable arena.
  const note = cmd.id === "forge" && forgeNote ? forgeNote : cmd.note;

  const priceText =
    capability.liveCents !== undefined
      ? money(capability.liveCents)
      : isCallerPriced(cmd)
        ? "quoted"
        : cmd.price;

  const label = busy
    ? "Working…"
    : !paid
      ? "Run"
      : isCallerPriced(cmd) && capability.liveCents === undefined
        ? "Run — settles the quoted price"
        : `Run — settles ${priceText}`;

  const body = previewBody(cmd, args);

  return (
    <Panel
      drag={drag}
      icon="swords"
      title="Command"
      className="pane-command"
      actions={
        <span className="price-badge" data-tier={cmd.tier}>
          <span className="eyebrow">Price</span>
          <span className="num">{priceText}</span>
        </span>
      }
    >
      <div className="pane-body" ref={bodyRef}>
        <p className="route">
          <span className="route-method" data-method={cmd.method}>
            {cmd.method}
          </span>{" "}
          <span className="route-path">{cmd.path}</span>
        </p>

        {note && <p className="note">{note}</p>}

        {fields.length > 0 && (
          <div className="fields">
            {fields.map((field) => {
              const hint = field.hint ?? stakeHint(cmd, stakeRange);
              const id = `f-${cmd.id}-${field.name}`;
              return (
                <div className="field" key={field.name}>
                  <label htmlFor={id}>
                    {field.label}
                    {field.optional && <span className="optional"> optional</span>}
                  </label>

                  {field.kind === "actions" ? (
                    <ActionPicker
                      capacity={sequenceLength}
                      matchId={args.id ?? ""}
                      value={args[field.name] ?? ""}
                      disabled={!capability.enabled}
                      onChange={(json) => onArg(field.name, json)}
                    />
                  ) : field.kind === "select" || field.kind === "boolean" ? (
                    <select
                      id={id}
                      value={args[field.name] ?? ""}
                      disabled={!capability.enabled}
                      aria-describedby={hint ? `${id}-hint` : undefined}
                      onChange={(e) => onArg(field.name, e.target.value)}
                    >
                      {field.kind === "boolean" ? (
                        <>
                          <option value="">no</option>
                          <option value="true">yes</option>
                        </>
                      ) : (
                        (field.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option === "" ? "— any —" : option}
                          </option>
                        ))
                      )}
                    </select>
                  ) : (
                    <input
                      id={id}
                      value={args[field.name] ?? ""}
                      placeholder={field.placeholder ?? ""}
                      inputMode={field.kind === "number" ? "numeric" : "text"}
                      disabled={!capability.enabled}
                      aria-describedby={hint ? `${id}-hint` : undefined}
                      onChange={(e) => onArg(field.name, e.target.value)}
                    />
                  )}

                  {hint && (
                    <p className="field-hint" id={`${id}-hint`}>
                      {hint}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {body && body !== "{}" && (
          <div className="sub-panel">
            <div className="sub-head">
              <span className="eyebrow">
                <Icon name="file-text" size={12} /> JSON body
              </span>
            </div>
            <CodeBlock text={body} ariaLabel="Request body" />
          </div>
        )}

        <button
          type="button"
          className="run"
          data-paid={paid}
          disabled={busy || !capability.enabled}
          onClick={onRun}
        >
          <Icon name={paid ? "coins" : "terminal"} size={16} />
          {label}
        </button>

        {paid && capability.enabled && (
          <p className="run-foot">This requests a USDC payment over x402 and settles on success.</p>
        )}

        {!capability.enabled && capability.reason && (
          <p className="disabled-reason">
            <Icon name="lock" size={13} />
            <span>{capability.reason}</span>
          </p>
        )}
      </div>
    </Panel>
  );
}
