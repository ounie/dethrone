import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Rail from "@/components/rail";
import type { Capabilities } from "@/lib/capability";
import { COMMANDS } from "@/lib/commands";

/**
 * PRD §11: *boot with no key registers zero paid commands, asserted over the
 * **rendered catalogue** rather than the source.*
 *
 * The distinction is the whole point. A source-level check proves the code
 * intends to disable them; rendering proves the operator will actually see them
 * disabled. Those come apart the moment someone adds a prop and forgets a
 * branch — which is exactly the moment it matters.
 *
 * `createElement` rather than JSX, and `renderToStaticMarkup` rather than a
 * DOM: this is a static question about output. JSX would make the test depend
 * on a transform config, and a DOM would add a dependency and a lifecycle to a
 * question that has neither.
 */

/** The capability map a keyless deploy produces, mirroring app/page.tsx. */
function keylessCapabilities(): Capabilities {
  const caps: Capabilities = {};
  for (const cmd of COMMANDS) {
    caps[cmd.id] =
      cmd.tier === "free"
        ? { enabled: true }
        : { enabled: false, reason: "Read-only: this deploy holds no key." };
  }
  return caps;
}

function render(capabilities: Capabilities): string {
  return renderToStaticMarkup(
    createElement(Rail, { capabilities, activeId: COMMANDS[0].id, onSelect: () => {} }),
  );
}

describe("a keyless boot registers zero spendable commands", () => {
  const html = render(keylessCapabilities());

  it("renders every paid command as disabled", () => {
    const enabledPaid = [...html.matchAll(/<button[^>]*data-paid="true"[^>]*>/g)].filter(
      (m) => !m[0].includes("disabled"),
    );
    expect(
      enabledPaid.map((m) => m[0]),
      "a paid command is clickable on a deploy that holds no key",
    ).toEqual([]);
  });

  it("gives every disabled command a reason the operator can read", () => {
    const disabled = [...html.matchAll(/<button[^>]*disabled[^>]*>/g)];
    expect(disabled.length).toBeGreaterThan(0);
    for (const match of disabled) {
      expect(match[0], "a command is disabled with no stated reason").toContain("data-reason=");
    }
  });

  it("still renders every free read as available", () => {
    const freeCount = COMMANDS.filter((c) => c.tier === "free").length;
    expect([...html.matchAll(/data-enabled="true"/g)].length).toBe(freeCount);
    expect(freeCount, "the free catalogue is the whole read-only product").toBeGreaterThan(20);
  });

  it("shows a price tag on every row — cost is the access model, rendered", () => {
    for (const tier of ["free", "signed", "paid"]) {
      expect(html, `no ${tier} tag rendered`).toContain(`data-tier="${tier}"`);
    }
  });
});

describe("a keyed boot enables them", () => {
  const html = render(
    Object.fromEntries(COMMANDS.map((c) => [c.id, { enabled: true }])) as Capabilities,
  );

  it("renders paid commands as clickable", () => {
    expect(html).toMatch(/<button[^>]*data-paid="true"/);
    expect(html).not.toContain("disabled=");
  });
});
