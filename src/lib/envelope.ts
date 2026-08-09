/**
 * The shape `/api/act` hands back, and the one thing the browser is allowed to
 * believe about a request.
 *
 * It lives in `src/lib/` rather than beside the pane that renders it because it
 * now has two renderers — the JSON view and the HTML view — and a type owned by
 * one of them would make the other import a component to describe its own
 * input. Client-safe: an interface, no values, no imports.
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
