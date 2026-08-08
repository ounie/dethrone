"use client";

import Image from "next/image";
import { useState } from "react";
import Icon from "./icon";
import { money, pct } from "@/lib/format";

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

export interface Wallet {
  /** The address `DETHRONE_PRIVATE_KEY` derives to. Public; the key is not. */
  address: string;
  /** Formatted USDC, or null when the RPC could not be reached. */
  usdc: string | null;
  network: string;
  explorerUrl: string;
}

/**
 * The operator's wallet.
 *
 * Shown in full rather than truncated, because the question this answers is
 * "is the console signing as the wallet I think it is?" — and a middle-elided
 * address cannot answer that. The three things beside it are the three things
 * an operator actually needs: whether it can pay, where to go and look, and a
 * way to copy it without selecting text.
 *
 * The address is derived from the key at boot and is public. **The key itself
 * never crosses this boundary** — this component receives a string somebody
 * else computed and has no way to ask for anything more.
 */
function WalletCard({ wallet }: { wallet: Wallet }) {
  return (
    <div className="wallet">
      <div className="wallet-head">
        <span className="chip-label">Operator wallet</span>
        <span className="wallet-derived">derived from DETHRONE_PRIVATE_KEY</span>
      </div>

      <div className="wallet-address">
        <span className="num" title={wallet.address}>
          {wallet.address}
        </span>
        <CopyButton value={wallet.address} what="operator address" />
        <a
          className="icon-btn"
          href={wallet.explorerUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="View this wallet on the block explorer"
          title="View on the block explorer"
        >
          <Icon name="external-link" size={13} />
        </a>
      </div>

      <p className="wallet-balance">
        {wallet.usdc === null ? (
          <span className="muted">Balance unavailable — the RPC could not be reached.</span>
        ) : (
          <>
            <strong className="num">{wallet.usdc}</strong>
            <span className="wallet-unit">USDC on {wallet.network}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Lower the ceiling for this sitting.
 *
 * One-way on purpose, and the button says so. A control that could raise the
 * cap at the moment the cap stopped you would defeat the thing entirely — the
 * failure mode is specific and it is one click long. Raising lives in
 * `.env.local` behind a restart, which is an act you have to mean, and the hint
 * beneath names the variable so nobody has to go looking.
 */
function TightenControl({
  capCents,
  onTightened,
}: {
  capCents: number;
  onTightened: (cap: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className="icon-btn" onClick={() => setOpen(true)}>
        <Icon name="lock" size={12} />
        Lower
      </button>
    );
  }

  return (
    <form
      className="tighten"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = Number(value);
        if (!Number.isInteger(cents) || cents <= 0) return;
        setBusy(true);
        void fetch("/api/ceiling", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ capCents: cents }),
        })
          .then((r) => r.json())
          .then((d: { ceiling?: { cap?: number } }) => {
            if (typeof d.ceiling?.cap === "number") onTightened(d.ceiling.cap);
            setOpen(false);
            setValue("");
          })
          .finally(() => setBusy(false));
      }}
    >
      <label htmlFor="tighten-cap" className="visually-hidden">
        New ceiling in cents, lower than {capCents}
      </label>
      <input
        id="tighten-cap"
        className="num"
        inputMode="numeric"
        placeholder={`< ${capCents}`}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="icon-btn" disabled={busy}>
        {busy ? "…" : "Set"}
      </button>
      <button type="button" className="icon-btn" onClick={() => setOpen(false)}>
        <Icon name="x-mark" size={12} />
      </button>
    </form>
  );
}

export default function Masthead({
  baseUrl,
  operator,
  reachable,
  ceiling,
  wallet,
  onTightened,
}: {
  baseUrl: string;
  operator: string | null;
  reachable: boolean;
  ceiling: Ceiling;
  wallet: Wallet | null;
  onTightened: (cap: number) => void;
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

          {!operator && (
            <Chip icon="lock" label="Operator wallet" tone="muted">
              no key set
            </Chip>
          )}
        </div>

        {wallet && <WalletCard wallet={wallet} />}
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
            <div className="meter-foot">
              <span className="num">
                {money(ceiling.spentCents)} spent ({used.toFixed(1)}%)
              </span>
              <TightenControl capCents={ceiling.capCents} onTightened={onTightened} />
            </div>
            <p className="meter-hint">
              Lowering applies to this sitting only. To raise it, set{" "}
              <code>CONSOLE_MAX_SPEND_CENTS</code> in <code>.env.local</code> and restart.
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
