import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The door.
 *
 * Two properties carry the whole route, and both are easy to lose to a helpful
 * refactor: **it answers identically for every failure**, and **it never echoes
 * what was submitted**. A route that distinguishes "no password sent" from
 * "wrong password" tells a caller their request shape was right; one that quotes
 * the attempt in an error body puts a password in a browser's network log.
 */

const PASSWORD = "correct horse battery staple";

async function post(body: unknown, init: RequestInit = {}) {
  const { POST } = await import("@/app/api/session/route");
  const res = await POST(
    new Request("http://127.0.0.1:3939/api/session", {
      method: "POST",
      headers: { host: "127.0.0.1:3939", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
  );
  return { status: res.status, headers: res.headers, body: await res.json() };
}

beforeEach(async () => {
  vi.resetModules();
  process.env.CONSOLE_PASSWORD = PASSWORD;
  // The throttle only. Clearing the derived key too would re-run PBKDF2 for
  // every case in this file — see the seam's comment in `auth.ts`.
  const { __resetThrottle } = await import("@/lib/auth");
  __resetThrottle();
});

afterEach(() => {
  delete process.env.CONSOLE_PASSWORD;
});

describe("logging in", () => {
  it("accepts the configured password and sets a hardened cookie", async () => {
    const res = await post({ password: PASSWORD });
    expect(res.status).toBe(200);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("dethrone_console_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    // Not Secure: this request is plain http on loopback, and a Secure cookie
    // there is silently discarded — which reads as a broken server rather than
    // as the configuration choice it is.
    expect(cookie).not.toContain("Secure");
  });

  it("issues a cookie that the gate then accepts", async () => {
    const res = await post({ password: PASSWORD });
    const token = (res.headers.get("set-cookie") ?? "").split(";")[0].split("=")[1];

    const { sessionFrom } = await import("@/lib/auth");
    expect(await sessionFrom(token)).toBe("valid");
  });
});

describe("it is not an oracle", () => {
  /**
   * Every one of these is a different mistake, and the route must not say so.
   * The shapes are listed together rather than in separate cases precisely so
   * that a change making one of them distinguishable fails here.
   */
  const wrong: [string, unknown][] = [
    ["a wrong password", { password: "not the password" }],
    ["a near miss", { password: PASSWORD.slice(0, -1) }],
    ["an absent field", {}],
    ["a wrong type", { password: 42 }],
    ["an empty password", { password: "" }],
    ["a non-object body", "[]"],
    ["unparseable JSON", "{"],
  ];

  for (const [name, body] of wrong) {
    it(`answers identically for ${name}`, async () => {
      const res = await post(body);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: "CONSOLE_UNAUTHENTICATED",
          message: expect.any(String),
        },
      });
      // No `detail` at all — not even an empty one. A detail key is where a
      // reason would be added later without anyone thinking about this file.
      expect(Object.keys((res.body as { error: object }).error)).toEqual(["code", "message"]);
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  }

  it("never echoes what was submitted", async () => {
    const secretish = "hunter2-and-a-distinctive-suffix";
    const res = await post({ password: secretish });
    expect(JSON.stringify(res.body)).not.toContain(secretish);
  });

  it("does not reveal the configured password in any response", async () => {
    for (const body of [{ password: PASSWORD }, { password: "wrong" }, {}]) {
      const res = await post(body);
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
      expect(res.headers.get("set-cookie") ?? "").not.toContain(PASSWORD);
    }
  });
});

describe("the throttle", () => {
  it("delays after repeated failures, and says how long", async () => {
    // Three free, then a delay. The fourth failure arms it; the fifth request is
    // refused without the password ever being compared.
    for (let i = 0; i < 4; i++) {
      expect((await post({ password: "wrong" })).status).toBe(401);
    }

    const res = await post({ password: "wrong" });
    expect(res.status).toBe(429);
    expect((res.body as { error: { code: string } }).error.code).toBe("CONSOLE_TOO_MANY_ATTEMPTS");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(0);
  });

  it("refuses even the correct password while armed", async () => {
    // The property that makes it a throttle rather than a hint: it does not open
    // early for someone who guessed right on the attempt after it engaged.
    for (let i = 0; i < 4; i++) await post({ password: "wrong" });
    expect((await post({ password: PASSWORD })).status).toBe(429);
  });

  it("counts a malformed body, so nonsense between guesses does not reset it", async () => {
    for (let i = 0; i < 4; i++) await post("{");
    expect((await post({ password: "wrong" })).status).toBe(429);
  });

  it("clears on a success", async () => {
    for (let i = 0; i < 3; i++) await post({ password: "wrong" });
    expect((await post({ password: PASSWORD })).status).toBe(200);
    expect((await post({ password: "wrong" })).status).toBe(401);
  });
});

describe("a deploy with no password", () => {
  it("says there is no door rather than pretending to guard one", async () => {
    delete process.env.CONSOLE_PASSWORD;
    vi.resetModules();
    const res = await post({ password: "anything" });
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe("CONSOLE_AUTH_DISABLED");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("logging out", () => {
  it("clears the cookie with matching attributes", async () => {
    const { DELETE } = await import("@/app/api/session/route");
    const res = await DELETE(
      new Request("http://127.0.0.1:3939/api/session", { method: "DELETE" }),
    );
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(res.status).toBe(200);
    expect(cookie).toContain("Max-Age=0");
    // The same Path and SameSite as the one it replaces, or the browser treats
    // it as a different cookie and keeps the live one.
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("does not require a session, so a stale browser can still tidy up", async () => {
    const { DELETE } = await import("@/app/api/session/route");
    const res = await DELETE(
      new Request("http://127.0.0.1:3939/api/session", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
  });
});
