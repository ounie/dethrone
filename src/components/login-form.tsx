"use client";

import { useState } from "react";

/**
 * The login form.
 *
 * ## It knows nothing
 *
 * It POSTs a string and reads a status code. It does not know the password's
 * length, whether the last attempt was close, or how many remain — the route
 * answers identically for every failure on purpose, and a client that displayed
 * more would be inventing it.
 *
 * ## The button is teal, not ember
 *
 * `globals.css` opens with the rule, and it is worth restating at the one call
 * site most likely to break it: **ember fill is the button that settles an
 * amount now.** A login settles nothing. `data-paid` stays off, and this is a
 * plain `.run` in the lane where nothing is at stake.
 *
 * ## The reload is deliberate
 *
 * `window.location.assign` rather than a router push: the console's root is a
 * server component that reads the cookie and renders the seat from it, so the
 * page has to be re-fetched by a browser that now has one. A client-side
 * navigation would re-run the same render tree without the new request headers.
 */
export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || password === "") return;

    setBusy(true);
    setError(null);
    try {
      // A string literal, because `test/one-fetch.test.ts` reads a variable or a
      // template as `<dynamic>` and fails — correctly, since a computed fetch
      // target is exactly what that assertion exists to catch.
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        window.location.assign("/");
        return;
      }

      const body = (await res.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      // The code is the headline and the English is the subtitle, in that order,
      // exactly as the response pane does it: English drifts and codes don't.
      setError(body?.error?.message ?? "That did not work.");
      setPassword("");
    } catch {
      setError("The console could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fields" onSubmit={submit}>
      <div className="field">
        <label htmlFor="console-password">Password</label>
        <input
          id="console-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error ? <p className="disabled-reason">{error}</p> : null}

      <button className="run" type="submit" disabled={busy || password === ""}>
        {busy ? "Checking" : "Enter"}
      </button>
    </form>
  );
}
