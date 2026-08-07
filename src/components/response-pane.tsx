"use client";

import { CONSOLE_ERROR_ENGLISH, type ConsoleErrorCode } from "@/lib/errors";
import { RETRY_SAFETY, isCanonErrorBody, isCanonErrorCode } from "@/lib/interface";

/**
 * The raw envelope.
 *
 * Never a summary, never an interpretation. A JSON pane is the honest rendering
 * of a system whose entire contract is a documented body: anything this pane
 * paraphrased would be a second opinion about what the arena said, and on the
 * day the two disagree the paraphrase is the one that is wrong.
 *
 * The only thing lifted out of the body is `error.code`, promoted to a headline
 * — because a code is the thing to branch on and a message is not. English
 * drifts; codes don't.
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

function statusTone(status?: number): string {
  if (status === undefined) return "muted";
  if (status < 300) return "ok";
  if (status < 500) return "bad";
  return "bad";
}

/**
 * The code to show, and where it came from.
 *
 * Two disjoint namespaces meet here and the difference matters: a `CONSOLE_`
 * code means this app stopped the request before it reached the arena, so
 * nothing happened and nothing was charged. Any other code means the arena
 * answered — and one of those answers may have cost money.
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

export default function ResponsePane({ envelope, log }: { envelope: Envelope | null; log: string[] }) {
  if (!envelope) {
    return (
      <section className="pane pane-response" aria-label="Response">
        <pre className="out">
          {"No response yet.\n\nReads are free and need no wallet — start with “The seat”."}
        </pre>
      </section>
    );
  }

  const code = extractCode(envelope);

  return (
    <section className="pane pane-response" aria-label="Response">
      <div className="meta">
        <div>
          <span className="k">Status</span>
          <span className="v" data-tone={statusTone(envelope.status)}>
            {envelope.status ?? "—"}
          </span>
        </div>
        <div>
          <span className="k">Latency</span>
          <span className="v">{envelope.ms !== undefined ? `${envelope.ms}ms` : "—"}</span>
        </div>
        <div>
          <span className="k">Settled</span>
          <span className="v" data-tone={envelope.settled ? "ember" : "muted"}>
            {envelope.settled ? "true" : "false"}
          </span>
        </div>
        <div>
          <span className="k">Spent this sitting</span>
          <span className="v" data-tone={envelope.ceiling?.enabled ? undefined : "muted"}>
            {envelope.ceiling?.enabled
              ? `${envelope.ceiling.spentCents ?? 0} / ${envelope.ceiling.cap ?? 0}¢`
              : "not counted"}
          </span>
        </div>
        {envelope.interface && !envelope.interface.match && (
          <div>
            <span className="k">Interface</span>
            <span className="v" data-tone="bad">
              {envelope.interface.got ?? "absent"}
            </span>
          </div>
        )}
      </div>

      {code && (
        <div className="code-banner">
          <span className="code">{code.code}</span>
          <p>{code.message}</p>
          <p>
            <span className="eyebrow">From {code.origin}</span>
          </p>
          {envelope.featureDisabled && (
            <p>
              This route exists and the arena is refusing it — a feature is switched off on this
              server. That is different from a route that is not there at all.
            </p>
          )}
        </div>
      )}

      <pre className="out">{JSON.stringify(envelope, null, 2)}</pre>

      {log.length > 0 && <pre className="log">{log.join("\n")}</pre>}
    </section>
  );
}
