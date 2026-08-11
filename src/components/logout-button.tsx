"use client";

/**
 * Log out.
 *
 * Rendered from the page's footer rather than threaded through `Console`, which
 * keeps this feature out of `console.tsx` and `masthead.tsx` entirely. Without
 * it the route's `DELETE` is a door nobody can reach.
 *
 * `.btn-quiet` and not `.run`: this is a footnote-weight control, and giving it
 * the weight of the console's primary button would put it in competition with
 * the one that actually does something.
 */
export default function LogoutButton() {
  async function logout() {
    // A string literal target, for `test/one-fetch.test.ts`. Same route as the
    // login, different method — one address, so one entry in `OWN_ROUTES`.
    await fetch("/api/session", { method: "DELETE" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <button className="btn-quiet" type="button" onClick={logout}>
      Log out
    </button>
  );
}
