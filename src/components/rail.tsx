"use client";

import type { Capabilities } from "@/lib/capability";
import { COMMANDS, GROUPS, type Command } from "@/lib/commands";

/**
 * The catalogue, grouped by cost.
 *
 * Grouping by price is not decoration. Cost is the only access control in this
 * system — there are no roles, no scopes, no permissions — so it is the one
 * true statement the UI can make about the arena without importing a rule.
 * Teal means nothing is at stake. Ember means this settles USDC the moment the
 * handler succeeds. That is the entire access model, rendered.
 *
 * The price text comes from the server: `liveCents` where the canon publishes a
 * number, the catalogue's label otherwise. This component formats it and does
 * not compute it — `test/currency-literals.test.ts` fails on a currency literal
 * anywhere under `src/components/`.
 */

function priceLabel(cmd: Command, liveCents?: number): string {
  if (liveCents === undefined) return cmd.price;
  // Formatting, not arithmetic: the number came from GET /api/rules.
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    liveCents / 100,
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
  return (
    <nav className="rail" aria-label="Commands">
      {GROUPS.map((group) => {
        const cmds = COMMANDS.filter((c) => c.group === group);
        if (cmds.length === 0) return null;
        return (
          <section className="rail-group" key={group}>
            <h2>{group}</h2>
            {cmds.map((cmd) => {
              const cap = capabilities[cmd.id] ?? { enabled: true };
              return (
                <div key={cmd.id}>
                  <button
                    type="button"
                    className="cmd"
                    aria-current={cmd.id === activeId}
                    data-paid={cmd.tier === "paid"}
                    data-enabled={cap.enabled}
                    data-reason={cap.reason}
                    disabled={!cap.enabled}
                    onClick={() => onSelect(cmd)}
                  >
                    <span className="tag" data-tier={cmd.tier}>
                      {priceLabel(cmd, cap.liveCents)}
                    </span>
                    <span className="cmd-label">{cmd.label}</span>
                  </button>
                  {!cap.enabled && cap.reason && <p className="rail-reason">{cap.reason}</p>}
                </div>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}
