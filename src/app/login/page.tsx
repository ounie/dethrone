import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LoginForm from "@/components/login-form";
import { passwordRequired, sessionFrom } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * The door, as a page.
 *
 * Two redirects before anything renders, and both are about not showing a
 * control that cannot do anything:
 *
 *  - **No password configured** → there is no door here. A form that POSTs to a
 *    route which answers `CONSOLE_AUTH_DISABLED` is a dead end dressed as a
 *    prompt.
 *  - **Already logged in** → the console is what was wanted.
 *
 * `force-dynamic` for the same reason the console has it: this reads a cookie,
 * and a cached login page is a login page that tells the wrong person they are
 * logged in.
 *
 * It reads no arena data, holds no key, and renders nothing about the operator —
 * which is what makes it safe to be the one page reachable without a session.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dethrone Console",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  if (!passwordRequired()) redirect("/");

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if ((await sessionFrom(token)) === "valid") redirect("/");

  return (
    <main className="shell">
      <section className="panel panel-gilt">
        <header className="panel-head">
          <h1 className="panel-title">Dethrone Console</h1>
        </header>
        <div className="pane-body">
          <p className="eyebrow">Locked</p>
          <p className="muted">
            This console holds a wallet that can spend. Enter the operator password to open it.
          </p>
          <LoginForm />
        </div>
      </section>
      <footer className="footnote">
        One password, one operator. The session is a signed cookie with nothing in it but an
        expiry — there is no account here, and nothing is stored on the server.
      </footer>
    </main>
  );
}
