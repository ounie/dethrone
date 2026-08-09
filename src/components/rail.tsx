"use client";

import { useId, useState } from "react";
import Panel from "./panel";
import Icon from "./icon";
import type { Capabilities } from "@/lib/capability";
import { COMMANDS, GROUPS, type Command } from "@/lib/commands";
import { money } from "@/lib/format";

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

const TIER_ORDER: { tier: Command["tier"]; label: string }[] = [
  { tier: "free", label: "Free reads" },
  { tier: "paid", label: "Paid writes" },
  { tier: "signed", label: "Signed — free, proves the wallet" },
];

function priceLabel(cmd: Command, liveCents?: number): string {
  return liveCents === undefined ? cmd.price : money(liveCents);
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
}: {
  tier: Command["tier"];
  label: string;
  cmds: Command[];
  capabilities: Capabilities;
  activeId: string;
  onSelect: (cmd: Command) => void;
}) {
  const [open, setOpen] = useState(true);
  const listId = useId();

  return (
    <section className="rail-group">
      <h3 className="rail-group-head" data-tier={tier}>
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
          {cmds.map((cmd) => {
            const cap = capabilities[cmd.id] ?? { enabled: true };
            const active = cmd.id === activeId;
            return (
              <li key={cmd.id}>
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
                {!cap.enabled && cap.reason && <p className="rail-reason">{cap.reason}</p>}
              </li>
            );
          })}
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
  return (
    <Panel icon="book-open" title="Catalogue" className="pane-rail">
      <div className="rail">
        {TIER_ORDER.map(({ tier, label }) => {
          const cmds = COMMANDS.filter((c) => c.tier === tier);
          if (cmds.length === 0) return null;
          return (
            <RailGroup
              key={tier}
              tier={tier}
              label={label}
              cmds={cmds}
              capabilities={capabilities}
              activeId={activeId}
              onSelect={onSelect}
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
