"use client";

import Image from "next/image";
import { useState } from "react";
import Icon from "./icon";
import { money, pct, shortAddress } from "@/lib/format";

/**
 * The masthead: who this console is pointed at, who it signs as, and what it
 * is allowed to spend.
 *
 * Three facts and a meter, and every one of them is resolved on the server.
 * The browser is told the operator's address — which is public — and is told
 * the ceiling's numbers. It is never told the key, and it never works any of
 * these out for itself.
 */

function Chip({
  icon,
  label,
  children,
  tone,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  children: React.ReactNode;
  tone?: "ok" | "bad" | "muted";
}) {
  return (
    <div className="chip">
      <span className="chip-label">{label}</span>
      <span className="chip-value" data-tone={tone}>
        <Icon name={icon} size={13} />
        {children}
      </span>
    </div>
  );
}

function CopyButton({ value, what }: { value: string; what: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={copied ? `${what} copied` : `Copy ${what}`}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      <Icon name={copied ? "shield-check" : "copy"} size={13} />
    </button>
  );
}

export interface Ceiling {
  enabled: boolean;
  spentCents: number;
  capCents: number;
  reason?: string;
}

export default function Masthead({
  baseUrl,
  operator,
  reachable,
  ceiling,
}: {
  baseUrl: string;
  operator: string | null;
  reachable: boolean;
  ceiling: Ceiling;
}) {
  const remaining = Math.max(0, ceiling.capCents - ceiling.spentCents);
  const used = pct(ceiling.spentCents, ceiling.capCents);

  return (
    <header className="masthead">
      <div className="masthead-brand">
        <div className="lockup">
          {/* Artwork, not an icon — the wordmark beside it carries the claim. */}
          <Image src="/brand/logo-crown.webp" alt="" width={512} height={452} priority />
          <h1 className="display wordmark">Dethrone Console</h1>
        </div>

        <div className="chips">
          <Chip icon="compass" label="Base URL">
            <span className="ellipsis" title={baseUrl}>
              {baseUrl}
            </span>
          </Chip>

          <Chip icon="circle" label="Seat status" tone={reachable ? "ok" : "bad"}>
            {reachable ? "reachable" : "unreachable"}
          </Chip>

          <Chip
            icon={operator ? "wallet" : "lock"}
            label="Operator address"
            tone={operator ? undefined : "muted"}
          >
            {operator ? (
              <>
                <span title={operator}>{shortAddress(operator)}</span>
                <CopyButton value={operator} what="operator address" />
              </>
            ) : (
              "no key"
            )}
          </Chip>
        </div>
      </div>

      <div className="masthead-meter">
        {ceiling.enabled ? (
          <>
            <div className="meter-head">
              <span className="eyebrow">Ceiling (this sitting)</span>
              <span className="num meter-cap">{money(ceiling.capCents)}</span>
            </div>
            <p className="meter-headline">
              <strong className="num">{money(remaining)}</strong> remaining of{" "}
              <span className="num">{money(ceiling.capCents)}</span>
            </p>
            <div
              className="meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={ceiling.capCents}
              aria-valuenow={ceiling.spentCents}
              aria-label="Spent this sitting"
            >
              <div className="meter-fill" style={{ width: `${used}%` }} />
            </div>
            <p className="meter-foot num">
              {money(ceiling.spentCents)} spent ({used.toFixed(1)}%)
            </p>
          </>
        ) : (
          <>
            <div className="meter-head">
              <span className="eyebrow">Ceiling (this sitting)</span>
              <span className="meter-cap" data-tone="warn">
                disabled
              </span>
            </div>
            {/* Never a number it cannot honour. A seatbelt that announces it is
                unbuckled is safer than one that silently resets. */}
            <p className="meter-note">{ceiling.reason}</p>
          </>
        )}
      </div>

      {!operator && (
        <aside className="notice" role="note">
          <Icon name="alert-triangle" size={17} />
          <div>
            <p className="notice-title display">Read-only mode</p>
            <p>
              No key found, so nothing here can sign or spend. Add{" "}
              <code>DETHRONE_PRIVATE_KEY</code> to <code>.env.local</code> and restart.
            </p>
          </div>
        </aside>
      )}
    </header>
  );
}
