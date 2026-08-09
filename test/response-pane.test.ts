import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { join } from "node:path";
import ResponsePane from "@/components/response-pane";
import type { Envelope } from "@/lib/envelope";
import { SRC, read, sourceFiles, rel } from "./graph";

/**
 * The response pane, and the one thing the HTML tab must never become.
 *
 * `lib/response-html.ts` builds a document out of arena strings, and
 * `test/response-html.test.ts` asserts that it escapes them. This file guards
 * the other half of that argument: **where** the document is allowed to render.
 * The escaping is the first line and the frame is the second, and the second is
 * the one that holds when the first has a bug nobody has found yet.
 *
 * `createElement` and `renderToStaticMarkup`, following
 * `test/catalogue-render.test.ts`: static questions about output, no DOM, no
 * transform config in the loop.
 */

const envelope: Envelope = {
  request: { method: "GET", path: "/api/stable", paid: false, signed: true, scope: "stable" },
  status: 200,
  ms: 12,
  body: { ok: true },
};

describe("the response pane offers the HTML view", () => {
  const html = renderToStaticMarkup(createElement(ResponsePane, { envelope }));

  it("renders all four tabs", () => {
    for (const tab of ["Body", "Envelope", "Raw", "HTML"]) {
      expect(html, `the ${tab} tab is missing`).toContain(`>${tab}</button>`);
    }
  });

  it("opens on Body, so nothing renders arena markup until asked", () => {
    expect(html).toContain(`aria-selected="true"`);
    expect(html).not.toContain("<iframe");
  });

  it("renders the empty state without a frame when there is no response", () => {
    const empty = renderToStaticMarkup(createElement(ResponsePane, { envelope: null }));
    expect(empty).toContain("No response yet.");
    expect(empty).not.toContain("<iframe");
  });
});

describe("arena markup renders with no script and no origin", () => {
  const source = read(join(SRC, "components/response-pane.tsx"));

  it("sandboxes the frame", () => {
    const attr = /sandbox="([^"]*)"/.exec(source);
    expect(attr, "the HTML view's iframe has no sandbox attribute").not.toBe(null);

    const tokens = (attr?.[1] ?? "").split(/\s+/).filter(Boolean);
    // These two are what turn a rendering into an execution. `allow-scripts`
    // gives an injected `<script>` a runtime; `allow-same-origin` gives it this
    // page's DOM, storage and cookies. Together they are strictly worse than no
    // sandbox, because they read as one.
    expect(tokens, "the frame allows scripts — the escaping is now the only defence").not.toContain(
      "allow-scripts",
    );
    expect(tokens, "the frame shares this origin with an arena body").not.toContain(
      "allow-same-origin",
    );
  });

  it("hands the document to srcDoc rather than to a URL the page shares an origin with", () => {
    expect(source).toMatch(/srcDoc=\{/);
    // A blob: URL is same-origin with its creator, which is the one property
    // the sandbox above exists to withhold.
    expect(source).not.toMatch(/src=\{[^}]*createObjectURL/);
  });
});

describe("no component writes markup into this origin", () => {
  /**
   * The pane is not the only place someone could render an arena body as HTML,
   * and the next person to want one will reach for `dangerouslySetInnerHTML`
   * because it is three characters shorter than an iframe. This is the assertion
   * that makes them read the comment first.
   */
  it("nothing under components/ uses dangerouslySetInnerHTML", () => {
    const offenders = sourceFiles(join(SRC, "components"))
      .filter((file) => /dangerouslySetInnerHTML\s*=/.test(read(file)))
      .map(rel);
    expect(
      offenders,
      `these components inject markup into the console's own origin: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
