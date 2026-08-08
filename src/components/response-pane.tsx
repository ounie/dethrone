"use client";

import { useState } from "react";
import CodeBlock from "./code-block";
import Icon from "./icon";
import Panel from "./panel";
import { CONSOLE_ERROR_ENGLISH, type ConsoleErrorCode } from "@/lib/errors";
import { RETRY_SAFETY, isCanonErrorBody, isCanonErrorCode } from "@/lib/interface";

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
 */

export interface Envelope {
  request?: { method: string; path: string; paid: boolean; signed: boolean; scope: string | null };
  status?: number;
  ms?: number;
  interface?: { expected: string; got: string | null; match: boolean };
  featureDisabled?: boolean;
  settled?: boolean;
  settlement?: { success: boolean; payer?: string; transaction?: string } | null;
  ceiling?: { enabled: boolean; spentCents?: number; cap?: number; reason?: string };
  body?: unknown;
  error?: { code: string; message: string; detail?: Record<string, unknown> };
}

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

const TABS = ["Body", "Envelope", "Raw"] as const;
type Tab = (typeof TABS)[number];

export default function ResponsePane({ envelope }: { envelope: Envelope | null }) {
  const [tab, setTab] = useState<Tab>("Body");
  const [copied, setCopied] = useState(false);

  if (!envelope) {
    return (
      <Panel icon="shield-check" title="Response" className="pane-response">
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

        <CodeBlock text={shown} maxHeight="46vh" ariaLabel={`Response ${tab}`} />
      </div>
    </Panel>
  );
}
