"use client";

import { useEffect, useRef } from "react";
import ActionPicker from "./action-picker";
import CodeBlock from "./code-block";
import Icon from "./icon";
import Panel, { type PanelDrag } from "./panel";
import type { ArenaChoice, Capability, StakeRange } from "@/lib/capability";
import {
  DUEL_STAKE_PRESET_CENTS,
  fieldsFor,
  isCallerPriced,
  type Command,
  type Field,
} from "@/lib/commands";
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

/**
 * The live stake range, for the field that carries the stake.
 *
 * ⚠️ **Gated on the field, not just the command.** It used to take only the
 * command, and the caller applied it to every field lacking a hint of its own —
 * so on `post_duel` the character id and the arena were both captioned with the
 * stake's accepted range, which is a sentence about the stake printed under two
 * fields that are not the stake. It read as a real constraint on a character
 * id. (Note the range itself may not be written here: `currency-literals`
 * scans comments too, and it caught this paragraph quoting one.)
 */
/**
 * One-tap stake amounts, bounded by the canon.
 *
 * The list is `DUEL_STAKE_PRESET_CENTS` in `commands.ts` — the only file under
 * `src/` allowed to hold a currency literal, which is why they are declared
 * there and merely rendered here.
 *
 * Filtered against the live range so a button can never offer an amount the
 * arena would refuse. A deploy that narrows its band simply shows fewer, and
 * one that publishes no band at all shows them all rather than none: an
 * unreachable rules read should not silently remove an affordance.
 */
function stakePresets(range: StakeRange): number[] {
  const min = range.minStakeCents;
  const max = range.maxStakeCents;
  return DUEL_STAKE_PRESET_CENTS.filter(
    (cents) => (min === null || cents >= min) && (max === null || cents <= max),
  );
}

function stakeHint(cmd: Command, field: Field, range: StakeRange): string | undefined {
  if (cmd.id !== "post_duel" || field.name !== cmd.amountField) return undefined;
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
  arenas,
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
  /** Every arena the canon publishes. Empty means the read did not come back. */
  arenas: readonly ArenaChoice[];
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
              const hint = field.hint ?? stakeHint(cmd, field, stakeRange);
              const id = `f-${cmd.id}-${field.name}`;
              return (
                <div className="field" key={field.name}>
                  <label htmlFor={id}>
                    {field.label}
                    {field.optional && <span className="optional"> optional</span>}
                  </label>

                  {/*
                    An arena field, when the canon told us which arenas exist.

                    Falls back to the plain text input below when the list is
                    empty — an unreachable `/api/arenas`, or duels open on a
                    deploy whose arena read failed. `model-picker.tsx` makes the
                    same choice for the same reason: never a silent empty
                    dropdown, because a select with nothing in it is a field the
                    operator cannot fill and cannot see why.

                    No default is selected. Which arena to post a duel in is the
                    operator's decision and there is no obvious answer — the
                    running one is where the crowd is, an older one is where a
                    grudge lives — so the placeholder asks rather than choosing.
                  */}
                  {/*
                    The stake, with the published amounts as one-tap buttons.

                    They set the field and nothing else — no request, no
                    confirmation, no change to what Run will do. The amount
                    stays typeable, because the arena takes any value in range
                    and a preset that became a constraint would be this console
                    narrowing a rule it does not own.
                  */}
                  {field.name === cmd.amountField && stakePresets(stakeRange).length > 0 && (
                    <div className="stake-presets">
                      {stakePresets(stakeRange).map((cents) => (
                        <button
                          key={cents}
                          type="button"
                          className="stake-preset"
                          data-chosen={args[field.name] === String(cents)}
                          disabled={!capability.enabled}
                          onClick={() => onArg(field.name, String(cents))}
                        >
                          {money(cents)}
                        </button>
                      ))}
                    </div>
                  )}

                  {field.kind === "arena" && arenas.length > 0 ? (
                    <select
                      id={id}
                      className="arena-select"
                      value={args[field.name] ?? ""}
                      disabled={!capability.enabled}
                      aria-describedby={hint ? `${id}-hint` : undefined}
                      onChange={(e) => onArg(field.name, e.target.value)}
                    >
                      <option value="">Choose an arena…</option>
                      {arenas.map((a) => (
                        <option key={a.slug} value={a.slug}>
                          {a.displayName}
                          {/* The canon's own flag, rendered. Not a filter: a
                              duel may be posted in any arena that is not
                              retired, and deciding otherwise here would be this
                              console holding a rule. */}
                          {a.running ? " — running now" : ""}
                        </option>
                      ))}
                    </select>
                  ) : field.kind === "actions" ? (
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

                  {/*
                    The arena's own sentence about the rake, under the field
                    that sets it.

                    A SEPARATE line rather than the hint fallback: the stake
                    field already carries its own hint from the catalogue, so a
                    fallback would never have been reached — which it was not,
                    until this was moved out of it.

                    Rendered verbatim, and it is the whole answer to "where does
                    my stake go". The arena's own duels page draws a live
                    breakdown — pot, rake, purse, jackpot — by reimplementing
                    `splitDuelSettlement` in the browser, and calls itself a
                    mirror for doing it. This console will not hold that second
                    implementation: rule two is that a UI which computes money
                    will one day compute it wrong, and a preview that disagreed
                    with the settlement would disagree on the one screen where
                    somebody is deciding how much to risk. The canon's sentence
                    is the honest version of the same disclosure.
                  */}
                  {field.name === cmd.amountField && stakeRange.note && (
                    <p className="field-hint">{stakeRange.note}</p>
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
