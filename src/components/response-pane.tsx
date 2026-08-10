"use client";

import { useMemo, useState } from "react";
import CodeBlock from "./code-block";
import Icon from "./icon";
import Panel, { type PanelDrag } from "./panel";
import type { Envelope } from "@/lib/envelope";
import { CONSOLE_ERROR_ENGLISH, type ConsoleErrorCode } from "@/lib/errors";
import { RETRY_SAFETY, isCanonErrorBody, isCanonErrorCode } from "@/lib/interface";
import { envelopeFilename, renderEnvelopeHtml } from "@/lib/response-html";

/**
 * The raw envelope.
 *
 * Never a summary, never an interpretation. A JSON pane is the honest rendering
 * of a system whose entire contract is a documented body: anything paraphrased
 * here would be a second opinion about what the arena said, and on the day the
 * two disagree the paraphrase is the one that is wrong.
 *
 * Exactly one thing is lifted out of the body, and it is `error.code` — because
 * a code is the thing to branch on and a message is not. English drifts; codes
 * don't.
 *
 * ## The fourth tab is a rendering, not a reading
 *
 * `HTML` shows the same envelope laid out as a page, with the arena's pictures
 * as pictures. It is allowed to exist next to the rule above because it adds
 * nothing and drops nothing: `lib/response-html.ts` walks every key that is
 * there, keeps the arena's own names, prints an image URL as the image **and**
 * the URL, and embeds the exact JSON at the foot of the document. What it buys
 * is the thing JSON is bad at — a forged portrait is a fact about a response,
 * and reading it as `"https://…/9f/3c1e….png"` is reading a checksum.
 */

function statusTone(status?: number): "ok" | "bad" | "muted" {
  if (status === undefined) return "muted";
  return status < 300 ? "ok" : "bad";
}

/**
 * Which namespace answered, and why the difference matters.
 *
 * A `CONSOLE_` code means this app stopped the request before it reached the
 * arena — nothing happened and nothing was charged. Any other code means the
 * arena answered, and one of those answers may have cost money.
 */
function extractCode(env: Envelope): { code: string; message: string; origin: string } | null {
  if (env.error) {
    const local = env.error.code.startsWith("CONSOLE_");
    return {
      code: env.error.code,
      message:
        (local && CONSOLE_ERROR_ENGLISH[env.error.code as ConsoleErrorCode]) || env.error.message,
      origin: local ? "the console — no request was made" : "the arena",
    };
  }
  if (isCanonErrorBody(env.body)) {
    const code = env.body.error.code;
    const retry = isCanonErrorCode(code) ? RETRY_SAFETY[code] : undefined;
    return {
      code,
      message: env.body.error.message,
      origin: retry ? `the arena — retry: ${retry}` : "the arena",
    };
  }
  return null;
}

const TABS = ["Body", "Envelope", "Raw", "HTML"] as const;
type Tab = (typeof TABS)[number];

/**
 * Save the document as a file.
 *
 * A blob and an anchor, which is the whole of it — no route, no server round
 * trip, no second copy of the response leaving the browser. The bytes are the
 * ones already on screen, so what lands on disk is what was being read.
 */
function download(name: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick rather than immediately: Safari has cancelled the
  // download when the object URL disappears in the same frame as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ResponsePane({
  envelope,
  drag,
}: {
  envelope: Envelope | null;
  /** Handed down by the layout so this card can be moved. */
  drag?: PanelDrag;
}) {
  const [tab, setTab] = useState<Tab>("Body");
  const [copied, setCopied] = useState(false);

  // Built only for the tab that shows it. Every response would otherwise
  // serialise a whole document nobody asked to look at, and a Stable read is
  // not a small object.
  const html = useMemo(
    () => (envelope && tab === "HTML" ? renderEnvelopeHtml(envelope) : ""),
    [envelope, tab],
  );

  if (!envelope) {
    return (
      <Panel
      drag={drag} icon="shield-check" title="Response" className="pane-response">
        <div className="pane-body empty">
          <Icon name="shield-check" size={26} />
          <p>No response yet.</p>
          <p className="muted">Reads are free and need no wallet — start with the seat.</p>
        </div>
      </Panel>
    );
  }

  const code = extractCode(envelope);
  const raw = JSON.stringify(envelope, null, 2);
  const shown =
    tab === "Body"
      ? JSON.stringify(envelope.body ?? envelope.error ?? null, null, 2)
      : tab === "Envelope"
        ? JSON.stringify({ ...envelope, body: undefined }, null, 2)
        : raw;

  return (
    <Panel
      icon="shield-check"
      title="Response"
      className="pane-response"
      actions={
        <>
          {/* Only on the tab that has a file to save. The other three are JSON,
              and Copy already puts the whole envelope on the clipboard. */}
          {tab === "HTML" && (
            <button
              type="button"
              className="icon-btn labelled"
              title="Save this response as a single HTML file"
              onClick={() => download(envelopeFilename(envelope), html)}
            >
              <Icon name="download" size={13} />
              Save
            </button>
          )}
          <button
            type="button"
            className="icon-btn labelled"
            onClick={() => {
              void navigator.clipboard.writeText(raw);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            <Icon name={copied ? "shield-check" : "copy"} size={13} />
            {copied ? "Copied" : "Copy"}
          </button>
        </>
      }
    >
      <div className="pane-body">
        <div className="status-chips">
          <span className="status-chip" data-tone={statusTone(envelope.status)}>
            <span className="num">{envelope.status ?? "—"}</span>
          </span>
          <span className="status-chip">
            <span className="num">{envelope.ms !== undefined ? `${envelope.ms} ms` : "—"}</span>
          </span>
          <span className="status-chip" data-tone={envelope.settled ? "ember" : undefined}>
            settled: <span className="num">{envelope.settled ? "true" : "false"}</span>
          </span>
          {envelope.ceiling?.enabled && (
            <span className="status-chip">
              spent:{" "}
              <span className="num">
                {envelope.ceiling.spentCents ?? 0}/{envelope.ceiling.cap ?? 0}¢
              </span>
            </span>
          )}
          {envelope.interface && !envelope.interface.match && (
            <span className="status-chip" data-tone="bad">
              interface: {envelope.interface.got ?? "absent"}
            </span>
          )}
        </div>

        {code && (
          <div className="code-banner" data-local={code.code.startsWith("CONSOLE_")}>
            <p className="banner-code num">{code.code}</p>
            <p>{code.message}</p>
            <p className="eyebrow">From {code.origin}</p>
            {envelope.featureDisabled && (
              <p>
                The route exists and the arena is refusing it — a feature is switched off on this
                server. That is a different thing from a route that is not there.
              </p>
            )}
          </div>
        )}

        <div className="tabs" role="tablist" aria-label="Response view">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className="tab"
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "HTML" ? (
          /*
            An iframe, and the `sandbox` on it is the point rather than a
            precaution bolted on afterwards.

            This is the one surface in the console that renders an arena body as
            MARKUP instead of as text, and arena bodies carry operator-supplied
            strings — a fighter's name is whatever somebody typed. The document
            escapes all of it and allows two URL schemes (see
            `lib/response-html.ts`), and that argument is only as good as the
            escaping. So the frame gets no `allow-scripts` and no
            `allow-same-origin`: a hole in the escaping produces markup with no
            script to run and no origin to run it in, and it cannot read this
            page, its storage, or the DOM that holds the ceiling readout.

            `allow-popups` is the one thing granted, so the URL under a picture
            still opens when clicked. It cannot be reached without a human
            click, because there is nothing in there to click for you.

            `srcDoc` rather than a blob URL because a blob is same-origin with
            this page, which is exactly the property being withheld.
          */
          <iframe
            className="html-view"
            title={`Response as HTML — ${envelope.request?.path ?? "response"}`}
            sandbox="allow-popups"
            referrerPolicy="no-referrer"
            srcDoc={html}
          />
        ) : (
          <CodeBlock text={shown} maxHeight="46vh" ariaLabel={`Response ${tab}`} />
        )}
      </div>
    </Panel>
  );
}
