import { describe, expect, it } from "vitest";
import type { Envelope } from "@/lib/envelope";
import { envelopeFilename, renderEnvelopeHtml } from "@/lib/response-html";

/**
 * The HTML view is a rendering, and these are the assertions that keep it one.
 *
 * A pane that turns a documented body into a page acquires two ways to lie that
 * a JSON pane does not have, and both are silent:
 *
 *   1. **It can drop something.** A layout is a set of decisions about what to
 *      show, and every one of them is an opportunity to omit a field nobody
 *      looked for. The console's whole argument is that it never summarises the
 *      arena, so the losslessness cases below are the load-bearing ones.
 *   2. **It renders untrusted strings as markup.** Fighter names are typed by
 *      people. `test/redact.test.ts` guards what leaves; this guards what comes
 *      back and gets built into a document.
 *
 * The pane also sandboxes the frame, and that is deliberately not tested here:
 * an escaping suite that passes because a sandbox exists is a suite that will
 * still pass on the day someone adds `allow-scripts` for a reason that sounded
 * good. These assert the escaping on its own terms.
 */

const envelope = (over: Partial<Envelope> = {}): Envelope => ({
  request: { method: "GET", path: "/api/stable", paid: false, signed: true, scope: "stable" },
  status: 200,
  ms: 41,
  settled: false,
  ...over,
});

describe("the document is self-contained", () => {
  const html = renderEnvelopeHtml(envelope({ body: { ok: true } }));

  it("is a whole document, not a fragment", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("carries its own styles and pulls in no stylesheet or font", () => {
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import\b/i);
  });

  it("contains no script of any kind", () => {
    expect(html).not.toMatch(/<script\b/i);
    // Inline handlers are the other way a document executes. There is no code
    // path that emits one; this fails if a future edit adds the first.
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe("nothing is dropped", () => {
  /**
   * A body with one of every JSON shape, including the ones a renderer is
   * tempted to skip: a null, a false, a zero, an empty string, an empty array
   * and an empty object.
   */
  const body = {
    name: "Ash of the Ninth",
    characterId: 293,
    ready: false,
    retiredAt: null,
    epitaph: "",
    ledger: [],
    meta: {},
    genome: { armament: "reach", bearing: 2 },
    actions: [
      { index: 0, id: "reach:0", type: "strike" },
      { index: 1, id: "bearing:1", type: "guard" },
    ],
  };

  const html = renderEnvelopeHtml(envelope({ body }));

  it("prints every key under the arena's own name", () => {
    for (const key of ["name", "characterId", "ready", "retiredAt", "epitaph", "ledger", "meta", "genome", "armament", "bearing"]) {
      expect(html, `the key ${key} is missing from the document`).toContain(`>${key}<`);
    }
  });

  it("prints the falsy values rather than hiding them", () => {
    expect(html).toContain("293");
    expect(html).toContain(">false<");
    expect(html).toContain(">null<");
    expect(html).toContain("empty");
  });

  it("embeds the exact JSON the page was rendered from", () => {
    // The strongest form of "lossless": whatever the layout does, the bytes are
    // in the file. They arrive HTML-escaped, so the comparison escapes too —
    // the same five characters the renderer does, spelled out here rather than
    // imported, so a change to the renderer's escaping has to be justified
    // twice.
    const raw = JSON.stringify(envelope({ body }), null, 2);
    const escaped = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    expect(html).toContain(escaped);
  });

  it("renders a uniform record array as a table with every column", () => {
    expect(html).toContain("<table");
    for (const column of ["index", "id", "type"]) {
      expect(html).toContain(`<th scope="col">${column}</th>`);
    }
  });

  it("keeps the envelope's own metadata, not only the body", () => {
    expect(html).toContain("/api/stable");
    expect(html).toContain("200");
    expect(html).toContain("41 ms");
  });
});

describe("untrusted strings arrive as text", () => {
  it("escapes markup in a value", () => {
    const html = renderEnvelopeHtml(envelope({ body: { name: `<img src=x onerror="alert(1)">` } }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes markup in a key", () => {
    const html = renderEnvelopeHtml(envelope({ body: { "<script>": 1 } }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an error message and an error code", () => {
    const html = renderEnvelopeHtml(
      envelope({ error: { code: "<b>NOPE</b>", message: "<i>go away</i>" } }),
    );
    expect(html).not.toContain("<b>NOPE</b>");
    expect(html).not.toContain("<i>go away</i>");
  });

  it("refuses a javascript: URL an attribute would have run", () => {
    const html = renderEnvelopeHtml(
      envelope({ body: { portraitUrl: "javascript:alert(1)", link: "javascript:alert(2)" } }),
    );
    expect(html).not.toMatch(/(?:src|href)="javascript:/i);
    // Still visible as the string the arena sent — refusing to link is not
    // refusing to show.
    expect(html).toContain("javascript:alert(1)");
  });

  it("does not turn an escaped quote into an attribute boundary", () => {
    const html = renderEnvelopeHtml(
      envelope({ body: { portraitUrl: `https://arena.example/a.png" onload="alert(1)` } }),
    );
    expect(html).not.toContain(`onload="alert(1)"`);
  });
});

describe("pictures are pictures", () => {
  const portrait = "https://bucket.s3.eu-west-2.amazonaws.com/duel/characters/9f/9fab.png";

  it("renders an image URL as an image", () => {
    const html = renderEnvelopeHtml(envelope({ body: { portraitUrl: portrait } }));
    expect(html).toContain(`<img src="${portrait}"`);
  });

  it("keeps the URL beside the picture rather than replacing it", () => {
    const html = renderEnvelopeHtml(envelope({ body: { portraitUrl: portrait } }));
    expect(html).toContain(`>${portrait}</a>`);
  });

  it("recognises a picture by its key when the URL has no extension", () => {
    const html = renderEnvelopeHtml(envelope({ body: { imageUrl: "https://arena.example/asset/9fab" } }));
    expect(html).toContain("<img src=");
  });

  it("does not make a picture out of a storage key that merely sounds like one", () => {
    // `imageKey` holds `duel/characters/9f/9fab.png` — a key, not a URL. An
    // `<img>` here would be a broken picture where a string belongs.
    const html = renderEnvelopeHtml(
      envelope({ body: { imageKey: "duel/characters/9f/9fab.png" } }),
    );
    expect(html).not.toContain("<img src=");
    expect(html).toContain("duel/characters/9f/9fab.png");
  });

  it("gives a film a video element instead of a broken image", () => {
    const film = "https://bucket.s3.eu-west-2.amazonaws.com/duel/films/aa/aabb.mp4";
    const html = renderEnvelopeHtml(envelope({ body: { filmUrl: film } }));
    expect(html).toContain(`<video src="${film}"`);
    expect(html).not.toContain(`<img src="${film}"`);
  });

  it("links an ordinary URL without pretending it is media", () => {
    const html = renderEnvelopeHtml(envelope({ body: { transaction: "https://basescan.org/tx/0xabc" } }));
    expect(html).toContain(`href="https://basescan.org/tx/0xabc"`);
    expect(html).not.toContain("<img");
  });
});

describe("the document survives what a body can throw at it", () => {
  it("renders an envelope with no body at all", () => {
    expect(() => renderEnvelopeHtml({})).not.toThrow();
    expect(renderEnvelopeHtml({})).toContain("<!doctype html>");
  });

  it("renders a primitive body", () => {
    expect(renderEnvelopeHtml(envelope({ body: 7 }))).toContain(">7<");
    expect(renderEnvelopeHtml(envelope({ body: "plain" }))).toContain(">plain<");
  });

  it("stops descending at a bounded depth without losing the subtree", () => {
    let deep: unknown = { leaf: "bottom" };
    for (let i = 0; i < 40; i++) deep = { down: deep };
    const html = renderEnvelopeHtml(envelope({ body: deep }));
    expect(html).toContain("bottom");
  });

  it("is pure — the same envelope renders the same bytes", () => {
    const once = renderEnvelopeHtml(envelope({ body: { a: 1 } }));
    const twice = renderEnvelopeHtml(envelope({ body: { a: 1 } }));
    expect(once).toBe(twice);
  });
});

describe("the filename says what the file is", () => {
  it("names the method, the path and the status", () => {
    expect(envelopeFilename(envelope())).toBe("dethrone-get-api-stable-200.html");
  });

  it("holds no separator a filesystem would argue with", () => {
    const name = envelopeFilename(
      envelope({ request: { method: "POST", path: "/api/duel/293/actions", paid: true, signed: true, scope: null } }),
    );
    expect(name).toBe("dethrone-post-api-duel-293-actions-200.html");
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  it("still produces a name when there was no request", () => {
    expect(envelopeFilename({})).toBe("dethrone-response.html");
  });
});
