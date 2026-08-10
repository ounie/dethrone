"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { WalletChoice } from "@/lib/operator";

/**
 * Which of the configured wallets signs.
 *
 * ## The browser picks, it does not decide
 *
 * This component is handed a list somebody else computed and a single POST that
 * moves a pointer on the server. It cannot create a wallet, cannot read a key,
 * and cannot make `/api/act` pay from anything — that route reads the selection
 * from process memory rather than from a request, which is the whole reason
 * `/api/wallet` exists as a separate door.
 *
 * ## The one optimistic value in this console, and why it is safe
 *
 * The `<select>` shows the new label before the server has confirmed it, and
 * rolls back if the POST fails. That is a thing this console otherwise refuses
 * to do — but the optimistic value is a *label*, not a verdict. The address
 * rendered below it, the balance, the House and every capability come from the
 * server render that `router.refresh()` triggers, and none of them moves until
 * it lands. Nothing here is ever the source of truth for who signed.
 *
 * `useTransition` is what makes the busy state honest: it ends when the server
 * render actually arrives, rather than when the POST resolved, and a switch
 * costs a `/api/derive` read and an RPC balance read on the way. Guessing would
 * mean showing a settled dropdown above a stale address.
 *
 * ## One wallet renders nothing
 *
 * Not a disabled select — a control that cannot do anything is the same lie as
 * a ceiling meter that cannot bind. The card already prints the address in full
 * and names the variable it came from.
 */
export default function WalletPicker({
  choices,
  selectedId,
}: {
  choices: readonly WalletChoice[];
  selectedId: string;
}) {
  const router = useRouter();
  const [id, setId] = useState(selectedId);
  const [reason, setReason] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (choices.length < 2) return null;

  const switchTo = (next: string) => {
    const previous = id;
    setId(next);
    setReason(null);

    void fetch("/api/wallet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: next }),
    })
      .then((r) => r.json())
      .then((d: { error?: { message?: string } }) => {
        if (d.error) {
          // The server's own sentence, verbatim. A refusal explained in words
          // this component invented would be a second opinion about a rule it
          // does not hold — the same reason `provider-reason` renders what it
          // was given.
          setId(previous);
          setReason(d.error.message ?? "The console refused to switch wallet.");
          return;
        }
        startTransition(() => router.refresh());
      })
      .catch(() => {
        setId(previous);
        setReason("The console could not be reached. Nothing was switched.");
      });
  };

  return (
    <>
      <div className="wallet-picker">
        <label htmlFor="wallet-select" className="visually-hidden">
          Which configured wallet signs
        </label>
        <select
          id="wallet-select"
          className="wallet-select"
          value={id}
          disabled={pending}
          onChange={(e) => switchTo(e.target.value)}
        >
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {reason && <p className="wallet-picker-reason">{reason}</p>}
    </>
  );
}
