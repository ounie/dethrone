"use client";

import type { Capability, StakeRange } from "@/lib/capability";
import { isCallerPriced, type Command, type Field } from "@/lib/commands";

/**
 * One command: the resolved route, the note verbatim, the inputs, one button.
 *
 * The button's label states the consequence rather than the action: "Run" when
 * nothing is at stake, and "Run — settles …" naming the live amount when it
 * does. A button that says only "Run" on a screen where half the buttons spend
 * money is a button that will eventually be clicked by someone who meant the
 * other kind.
 *
 * Every amount rendered here arrived from the server. Nothing on this screen is
 * computed, which is what lets `test/currency-literals.test.ts` refuse a
 * currency literal anywhere under `src/components/` with no exceptions.
 */

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * The extra field a listing-priced command needs.
 *
 * The console cannot know what a listing costs — the arena holds that, and it
 * arrives in the 402. So the operator names a ceiling instead, and the offer is
 * refused above it *before anything is signed*. That is the difference between
 * a seatbelt and a receipt.
 */
const MAX_FIELD: Field = {
  name: "maxCents",
  label: "Maximum you will pay (cents)",
  kind: "number",
  hint: "The arena quotes the real price. A higher quote is refused before a signature exists.",
};

function fieldsFor(cmd: Command): readonly Field[] {
  const base = cmd.fields ?? [];
  return cmd.maxField ? [...base, MAX_FIELD] : base;
}

function stakeHint(cmd: Command, range: StakeRange): string | undefined {
  if (cmd.id !== "post_duel") return undefined;
  if (range.minStakeCents === null || range.maxStakeCents === null) return undefined;
  return `The arena currently accepts ${range.minStakeCents}–${range.maxStakeCents}¢.`;
}

export default function CommandPane({
  cmd,
  capability,
  args,
  busy,
  stakeRange,
  forgeNote,
  onArg,
  onRun,
}: {
  cmd: Command;
  capability: Capability;
  args: Record<string, string>;
  busy: boolean;
  stakeRange: StakeRange;
  forgeNote: string | null;
  onArg: (name: string, value: string) => void;
  onRun: () => void;
}) {
  const fields = fieldsFor(cmd);

  // Where the canon publishes its own sentence about a command, that sentence
  // wins. The catalogue's copy is a fallback for when the arena is unreachable.
  const note = cmd.id === "forge" && forgeNote ? forgeNote : cmd.note;

  const paid = cmd.tier === "paid";
  const label = busy
    ? "Working…"
    : !paid
      ? "Run"
      : capability.liveCents !== undefined
        ? `Run — settles ${money(capability.liveCents)}`
        : isCallerPriced(cmd)
          ? "Run — settles the quoted price"
          : `Run — settles ${cmd.price}`;

  return (
    <section className="pane" aria-label="Command">
      <div className="route">
        <span className="method">{cmd.method}</span>
        <code>{cmd.path}</code>
      </div>

      {note && <p className="note">{note}</p>}

      {fields.map((field) => {
        const hint = field.hint ?? stakeHint(cmd, stakeRange);
        return (
          <label className="field" key={field.name}>
            <span>
              {field.label}
              {field.optional ? " (optional)" : ""}
            </span>

            {field.kind === "select" ? (
              <select
                value={args[field.name] ?? ""}
                disabled={!capability.enabled}
                onChange={(e) => onArg(field.name, e.target.value)}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option === "" ? "— any —" : option}
                  </option>
                ))}
              </select>
            ) : field.kind === "boolean" ? (
              <select
                value={args[field.name] ?? ""}
                disabled={!capability.enabled}
                onChange={(e) => onArg(field.name, e.target.value)}
              >
                <option value="">— no —</option>
                <option value="true">yes</option>
              </select>
            ) : (
              <input
                value={args[field.name] ?? ""}
                placeholder={field.placeholder ?? ""}
                inputMode={field.kind === "number" ? "numeric" : "text"}
                disabled={!capability.enabled}
                onChange={(e) => onArg(field.name, e.target.value)}
              />
            )}

            {hint && <span className="field-hint">{hint}</span>}
          </label>
        );
      })}

      <button
        type="button"
        className="run"
        data-paid={paid}
        disabled={busy || !capability.enabled}
        onClick={onRun}
      >
        {label}
      </button>

      {!capability.enabled && capability.reason && (
        <p className="disabled-reason">{capability.reason}</p>
      )}
    </section>
  );
}
