"use client";

import CodeBlock from "./code-block";
import Icon from "./icon";
import Panel from "./panel";
import type { Capability, StakeRange } from "@/lib/capability";
import { isCallerPriced, type Command, type Field } from "@/lib/commands";
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
 * The extra field a listing-priced command needs.
 *
 * The console cannot know what a listing costs — the arena holds that, and it
 * arrives in the 402. So the operator names a ceiling instead, and a higher
 * quote is refused *before anything is signed*. That is the difference between
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
    body[field.name] =
      field.kind === "number" ? Number(raw) : field.kind === "boolean" ? raw === "true" : raw;
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
  const paid = cmd.tier === "paid";

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
      <div className="pane-body">
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

                  {field.kind === "select" || field.kind === "boolean" ? (
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
