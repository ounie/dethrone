"use client";

/**
 * A line-numbered JSON view with syntax colour.
 *
 * ## Why this is hand-rolled and not a highlighter library
 *
 * The response pane's whole job is to show the arena's body *unaltered*. A
 * tokeniser that can rewrite, re-indent or fail closed on unexpected input is a
 * component that can lie about what came back. So this does one pass over
 * already-serialised text, wraps spans, and touches nothing else: if the regex
 * matches nothing, you get plain monospace text — never a blank pane, never a
 * "failed to parse".
 *
 * Colour follows the palette's own semantics rather than an editor theme:
 * gilt for keys (the labels, a material), teal for strings (inert), ember for
 * numbers (the amounts — this is a money screen), sage/crimson for the
 * booleans, because `settled: true` is the single most consequential token that
 * ever appears here.
 */

type Token = { text: string; kind?: "key" | "string" | "number" | "boolean" | "null" | "punct" };

const TOKEN_RE =
  /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b/g;

function tokenize(line: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: line.slice(last, at) });
    if (m[1] !== undefined) {
      out.push({ text: m[1], kind: "key" });
      out.push({ text: line.slice(at + m[1].length, at + m[0].length) });
    } else if (m[2] !== undefined) out.push({ text: m[2], kind: "string" });
    else if (m[3] !== undefined) out.push({ text: m[3], kind: "number" });
    else if (m[4] !== undefined) out.push({ text: m[4], kind: "boolean" });
    else if (m[5] !== undefined) out.push({ text: m[5], kind: "null" });
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

export default function CodeBlock({
  text,
  maxHeight,
  ariaLabel,
}: {
  text: string;
  maxHeight?: string;
  ariaLabel?: string;
}) {
  const lines = text.split("\n");

  return (
    <div className="code" style={maxHeight ? { maxHeight } : undefined} aria-label={ariaLabel}>
      {/* One grid, two columns: the gutter cannot drift out of step with the
          code because they are rows of the same grid, not two scrolling panes. */}
      <pre className="code-grid">
        {lines.map((line, i) => (
          <span className="code-row" key={i}>
            <span className="code-gutter num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="code-line">
              {tokenize(line).map((t, j) =>
                t.kind ? (
                  <span key={j} data-tok={t.kind}>
                    {t.text}
                  </span>
                ) : (
                  <span key={j}>{t.text}</span>
                ),
              )}
            </span>
          </span>
        ))}
      </pre>
    </div>
  );
}
