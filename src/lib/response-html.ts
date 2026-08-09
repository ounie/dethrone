import type { Envelope } from "./envelope";

/**
 * The envelope, as one HTML file you can open, save or send.
 *
 * ## Why this is not a paraphrase
 *
 * The response pane's contract is that it never summarises the arena — a JSON
 * view is the honest rendering of a system whose entire contract is a
 * documented body. That rule is not suspended here; it is what constrains the
 * whole file:
 *
 *   - **Every field is rendered.** There is no field list, no "interesting
 *     keys", no omission of nulls or empty arrays. The walker prints whatever
 *     is there, under the arena's own key names, unrenamed and unhumanised.
 *   - **The exact JSON is embedded too**, verbatim, in the `<details>` at the
 *     bottom. If the pretty rendering ever loses something, the file still
 *     carries the bytes to prove it — so a saved page is never *less* than the
 *     Raw tab, only more.
 *   - **A picture is added, never substituted.** An image URL renders as the
 *     image *and* the URL underneath. The string is still on the page, because
 *     the string is what the arena actually said and a thumbnail is an
 *     interpretation of it.
 *
 * ## What "self-contained" means, exactly
 *
 * One file: doctype, inline `<style>`, no script, no external stylesheet, no
 * webfont. Open it from disk on a machine that has never heard of this console
 * and it renders.
 *
 * **Remote media stays remote, and that is deliberate.** Inlining pictures as
 * data URIs would mean something fetching the arena's storage to bake the bytes
 * in — either this browser, which `test/one-fetch.test.ts` forbids by making
 * every client `fetch` a string literal naming one of our own routes, or this
 * server, which is the one runtime holding a key and must not acquire a second
 * outbound for a convenience. The objects are world-readable, content-addressed
 * and immutable, so an `<img src>` is the browser fetching a permanent public
 * URL, exactly as the Fighters panel already does.
 *
 * ## The safety story
 *
 * Every string that reaches the document goes through `esc()`, and every URL
 * that lands in an attribute goes through `safeUrl()` first — `http`, `https`
 * or a `data:image/…`, and nothing else, so a body containing `javascript:` or
 * an `onerror=` payload arrives as visible text rather than as markup. The pane
 * then renders this in a `sandbox`ed iframe with no `allow-scripts` and no
 * `allow-same-origin`, so even a hole in the escaping above has no script to
 * run and no origin to run it in. Two independent reasons, because arena bodies
 * are the least trusted input this app handles and the first escaping bug in
 * anything is always in the part someone was sure of.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * A URL this document may put in `src` or `href`, or null.
 *
 * An allowlist of schemes rather than a denylist of `javascript:`, because a
 * denylist has to be right about every scheme a browser will ever navigate and
 * an allowlist only has to be right about the two we need. Anything else falls
 * through to being printed as ordinary text — which is not a failure mode, it
 * is the honest one: the operator still sees the exact string the arena sent.
 */
function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(trimmed)) return trimmed;
  return null;
}

/**
 * Media detection: the file extension first, the key name second.
 *
 * The arena's asset URLs are content-addressed and carry a real extension
 * (`…/9f/<sha256>.png`), so the extension answers for almost everything and
 * answers without needing to know a single field name. The key name is the
 * fallback for a URL that has no extension — `portraitUrl`, `posterUrl`,
 * `faceoffImageUrl` — and it is checked *after* `safeUrl`, so a field called
 * `imageKey` holding a storage key stays a string rather than becoming a broken
 * picture.
 *
 * Film URLs are real and end in `.mp4`. Rendering one as an `<img>` would give
 * you a broken-image icon where the match is, so video gets a `<video>` — still
 * no script, still just the browser and a public URL.
 */
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i;
const VIDEO_EXT = /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i;
const IMAGE_KEY = /(?:image|portrait|avatar|thumbnail|thumb|icon|picture|photo|poster|banner)(?:url|uri|src)?$/i;
const VIDEO_KEY = /(?:video|film|replay|clip)(?:url|uri|src)?$/i;

type Media = { kind: "image" | "video"; url: string };

function mediaOf(value: string, key: string | null): Media | null {
  const url = safeUrl(value);
  if (!url) return null;
  if (/^data:image\//i.test(url)) return { kind: "image", url };
  if (IMAGE_EXT.test(url)) return { kind: "image", url };
  if (VIDEO_EXT.test(url)) return { kind: "video", url };
  if (key && IMAGE_KEY.test(key)) return { kind: "image", url };
  if (key && VIDEO_KEY.test(key)) return { kind: "video", url };
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The depth at which the walker stops descending and prints the remainder as
 * JSON instead.
 *
 * Not a truncation — the subtree is still there, in full, as text. It is a
 * guard against a pathological body turning one response into a page of
 * thousands of nested definition lists, and against the recursion itself if a
 * future body ever arrives from somewhere other than `JSON.parse`.
 */
const MAX_DEPTH = 10;

/** `[{a,b},{a,b}]` reads as a table; anything less regular reads as a list. */
function tabular(items: unknown[]): string[] | null {
  if (items.length < 2 || !items.every(isRecord)) return null;
  const columns: string[] = [];
  for (const item of items as Record<string, unknown>[]) {
    for (const key of Object.keys(item)) {
      if (!columns.includes(key)) columns.push(key);
    }
    // A cell has to be something a table cell can hold. The moment a record
    // carries a nested object, the honest rendering is the nested one — a
    // table that flattens it would be hiding structure to look tidy.
    for (const value of Object.values(item)) {
      if (isRecord(value) || Array.isArray(value)) return null;
    }
  }
  return columns.length > 0 && columns.length <= 10 ? columns : null;
}

function renderString(value: string, key: string | null): string {
  const media = mediaOf(value, key);
  if (media) {
    const tag =
      media.kind === "image"
        ? `<img src="${esc(media.url)}" alt="${esc(key ?? "")}" loading="lazy">`
        : `<video src="${esc(media.url)}" controls preload="metadata"></video>`;
    // The URL stays under the picture, and it stays a link: the string is the
    // datum, the frame is the courtesy.
    return `<figure class="media">${tag}<figcaption><a href="${esc(media.url)}" target="_blank" rel="noreferrer noopener">${esc(value)}</a></figcaption></figure>`;
  }

  const url = safeUrl(value);
  if (url) {
    return `<a class="url" href="${esc(url)}" target="_blank" rel="noreferrer noopener">${esc(value)}</a>`;
  }
  if (value === "") return `<span class="nil">""</span>`;
  if (value.includes("\n")) return `<pre class="text">${esc(value)}</pre>`;
  return `<span class="str">${esc(value)}</span>`;
}

function renderValue(value: unknown, key: string | null, depth: number): string {
  if (value === null || value === undefined) return `<span class="nil">null</span>`;
  if (typeof value === "boolean") {
    return `<span class="bool" data-v="${value}">${value}</span>`;
  }
  if (typeof value === "number") return `<span class="num">${esc(String(value))}</span>`;
  if (typeof value === "string") return renderString(value, key);

  if (depth >= MAX_DEPTH) {
    return `<pre class="text">${esc(JSON.stringify(value, null, 2) ?? "")}</pre>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return `<span class="nil">[] &mdash; empty</span>`;

    const columns = tabular(value);
    if (columns) {
      const head = columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("");
      const rows = (value as Record<string, unknown>[])
        .map((item) => {
          const cells = columns
            .map((c) => `<td>${renderValue(item[c], c, depth + 1)}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table class="rows"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    const items = value
      .map(
        (item, i) =>
          `<li><span class="idx">${i}</span><div class="cell">${renderValue(item, key, depth + 1)}</div></li>`,
      )
      .join("");
    return `<ol class="items">${items}</ol>`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return `<span class="nil">{} &mdash; empty</span>`;
    const pairs = keys
      .map(
        (k) =>
          `<dt>${esc(k)}</dt><dd>${renderValue((value as Record<string, unknown>)[k], k, depth + 1)}</dd>`,
      )
      .join("");
    return `<dl class="kv">${pairs}</dl>`;
  }

  // Nothing that came out of `JSON.parse` reaches here. If something ever does,
  // saying so is better than rendering an empty box that looks like a null.
  return `<span class="nil">${esc(String(value))}</span>`;
}

function chip(label: string, value: string, tone?: string): string {
  return `<span class="chip"${tone ? ` data-tone="${esc(tone)}"` : ""}>${
    label ? `${esc(label)} ` : ""
  }<b>${esc(value)}</b></span>`;
}

function chips(env: Envelope): string {
  const out: string[] = [];
  if (env.status !== undefined) {
    out.push(chip("", String(env.status), env.status < 300 ? "ok" : "bad"));
  }
  if (env.ms !== undefined) out.push(chip("", `${env.ms} ms`));
  out.push(chip("settled:", env.settled ? "true" : "false", env.settled ? "ember" : undefined));
  if (env.ceiling?.enabled) {
    const spent = env.ceiling.spentCents ?? 0;
    const cap = env.ceiling.cap ?? 0;
    out.push(chip("spent:", `${spent}/${cap}¢`));
  }
  if (env.interface && !env.interface.match) {
    out.push(chip("interface:", env.interface.got ?? "absent", "bad"));
  }
  return out.join("");
}

/**
 * The banner, and the one distinction it exists to draw.
 *
 * A `CONSOLE_` code means this app refused before anything left the process —
 * nothing happened and nothing was charged. Anything else means the arena
 * answered, and one of those answers may have cost money. The pane makes that
 * call from the code's namespace; so does this, from the same rule, because a
 * saved page that blurred the two would be worse than one with no banner.
 */
function banner(env: Envelope): string {
  if (!env.error) return "";
  const local = env.error.code.startsWith("CONSOLE_");
  const origin = local ? "the console — no request was made" : "the arena";
  return `<div class="banner" data-local="${local}"><p class="banner-code">${esc(
    env.error.code,
  )}</p><p>${esc(env.error.message)}</p><p class="from">From ${esc(origin)}</p></div>`;
}

/** `POST /api/duel/challenge`, or the honest absence of one. */
function heading(env: Envelope): string {
  if (!env.request) return "Response";
  return `${env.request.method} ${env.request.path}`;
}

/**
 * The palette, copied rather than imported, because a file that reads
 * `globals.css` is not self-contained.
 *
 * The values are the console's own tokens (`src/app/globals.css`) and the
 * meanings travel with them: gilt for keys because a label is a material, teal
 * for strings because teal is the lane where nothing is at stake, ember for
 * numbers because this is a money screen, verdict green and red for the
 * booleans because `settled: true` is the most consequential token that ever
 * appears here. A saved response should look like the instrument it came out
 * of; a drifted copy is a cosmetic bug, not a lie.
 */
const STYLE = `
:root {
  color-scheme: dark;
  --ink: #0b0808; --inset: #050303; --slab: #100c0b;
  --hairline: #221a16; --panel: #2c221c;
  --body: #e2d8c8; --muted: #9d9387; --faint: #7b7268;
  --gilt: #e0c07a; --teal: #55a89d; --ember: #f0a05f;
  --win: #4ea373; --loss: #e0796d; --frozen: #5f8fa8;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 22px;
  background: var(--ink); color: var(--body);
  font: 13px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 900px; margin: 0 auto; }
h1 {
  margin: 0 0 10px; font-size: 15px; font-weight: 600; letter-spacing: 0.02em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #f3ece0;
}
h2 {
  margin: 26px 0 10px; padding-bottom: 6px; font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--faint);
  border-bottom: 1px solid var(--hairline);
}
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.chip {
  display: inline-flex; gap: 5px; padding: 3px 9px; border-radius: 3px;
  border: 1px solid var(--hairline); background: var(--inset);
  font-size: 11px; color: var(--muted);
}
.chip b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 500; }
.chip[data-tone="ok"] { color: var(--win); border-color: rgba(78,163,115,0.4); }
.chip[data-tone="bad"] { color: var(--loss); border-color: rgba(184,52,42,0.45); }
.chip[data-tone="ember"] { color: #f6c294; border-color: rgba(221,106,28,0.55); }
.banner {
  margin: 0 0 16px; padding: 12px; border-radius: 3px; background: var(--inset);
  border: 1px solid var(--hairline); border-left: 2px solid #b8342a;
}
.banner[data-local="true"] { border-left-color: var(--frozen); }
.banner p { margin: 0 0 4px; font-size: 12px; color: var(--muted); max-width: 66ch; }
.banner-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px !important; font-weight: 700; color: var(--loss) !important;
}
.banner[data-local="true"] .banner-code { color: var(--frozen) !important; }
.from { font-size: 10.5px !important; letter-spacing: 0.1em; text-transform: uppercase; }
dl.kv { margin: 0; display: grid; grid-template-columns: minmax(120px, max-content) minmax(0, 1fr); }
dl.kv > dt {
  padding: 5px 14px 5px 0; color: var(--gilt); font-weight: 500;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  border-top: 1px solid var(--hairline); word-break: break-word;
}
dl.kv > dd {
  margin: 0; padding: 5px 0; min-width: 0;
  border-top: 1px solid var(--hairline); word-break: break-word;
}
dl.kv > dt:first-of-type, dl.kv > dt:first-of-type + dd { border-top: 0; }
dl.kv dl.kv { margin: 2px 0 2px 10px; border-left: 1px solid var(--hairline); padding-left: 10px; }
ol.items { margin: 0; padding: 0; list-style: none; }
ol.items > li { display: flex; gap: 10px; padding: 5px 0; border-top: 1px solid var(--hairline); }
ol.items > li:first-child { border-top: 0; }
.idx {
  flex: none; min-width: 22px; color: var(--faint); font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cell { min-width: 0; flex: 1; }
table.rows { width: 100%; border-collapse: collapse; font-size: 12px; display: block; overflow-x: auto; }
table.rows th, table.rows td {
  padding: 6px 10px 6px 0; text-align: left; vertical-align: top;
  border-bottom: 1px solid var(--hairline);
}
table.rows th {
  color: var(--faint); font-weight: 600; font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; white-space: nowrap;
}
.str { color: var(--teal); }
.num { color: var(--ember); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.bool { color: var(--win); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.bool[data-v="false"] { color: var(--loss); }
.nil { color: var(--faint); font-style: italic; }
.url { color: var(--teal); word-break: break-all; }
pre.text, pre.raw {
  margin: 0; padding: 10px; border-radius: 3px; background: var(--inset);
  border: 1px solid var(--hairline); color: #c6bcab; overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
  line-height: 1.65; white-space: pre-wrap; word-break: break-word;
}
figure.media { margin: 4px 0; }
figure.media img, figure.media video {
  display: block; max-width: 320px; width: 100%; height: auto; border-radius: 3px;
  border: 1px solid var(--panel); background: var(--inset);
}
figure.media figcaption { margin-top: 4px; font-size: 10.5px; }
figure.media figcaption a { color: var(--faint); word-break: break-all; }
/* A roster is a table of rows, and a row is unreadable if every portrait is
   320px tall. Thumbnailed in a cell, full size everywhere else — the caption
   stays either way, because the URL is the datum. */
table.rows figure.media { max-width: 150px; }
table.rows figure.media img, table.rows figure.media video { max-width: 150px; }
details { margin-top: 10px; }
summary { cursor: pointer; color: var(--faint); font-size: 11.5px; }
footer {
  margin-top: 26px; padding-top: 10px; border-top: 1px solid var(--hairline);
  color: var(--faint); font-size: 10.5px; max-width: 66ch;
}
`.trim();

/**
 * The envelope as a complete HTML document.
 *
 * Pure and synchronous: same envelope in, same bytes out. That is what lets the
 * pane show the file rather than a preview of it — the iframe and the download
 * are handed the identical string, so there is no rendering that exists only on
 * screen and no file that exists only on disk.
 */
export function renderEnvelopeHtml(envelope: Envelope): string {
  const shown = envelope.body ?? envelope.error ?? null;
  const meta: Record<string, unknown> = { ...envelope };
  delete meta.body;

  let raw: string;
  try {
    raw = JSON.stringify(envelope, null, 2) ?? "null";
  } catch {
    // A body that will not serialise cannot have come from the arena, but the
    // page still has to render something rather than throwing inside a pane.
    raw = "// this envelope could not be serialised";
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(heading(envelope))}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(heading(envelope))}</h1>
<div class="chips">${chips(envelope)}</div>
${banner(envelope)}
<h2>Body</h2>
${renderValue(shown, null, 0)}
<h2>Envelope</h2>
${renderValue(meta, null, 0)}
<h2>Raw</h2>
<details><summary>The exact JSON this page was rendered from</summary>
<pre class="raw">${esc(raw)}</pre>
</details>
<footer>Saved from the Dethrone console. Pictures and films are linked from the
arena's public, content-addressed storage, so they load when that storage is
reachable; the JSON above is the whole of what the arena said and needs
nothing.</footer>
</main>
</body>
</html>`;
}

/**
 * A filename that sorts and says what it is.
 *
 * No timestamp, on purpose: this function is pure and the same response saved
 * twice should not produce two files that differ only in a clock read the
 * arena never sent. The browser adds `(1)` on its own, which is the correct
 * authority for "you already have this one".
 */
export function envelopeFilename(envelope: Envelope): string {
  const path = (envelope.request?.path ?? "response").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const method = (envelope.request?.method ?? "").toLowerCase();
  const status = envelope.status !== undefined ? `-${envelope.status}` : "";
  return `dethrone-${[method, path].filter(Boolean).join("-")}${status}.html`;
}
