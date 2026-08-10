import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Several keys, one selection.
 *
 * Three properties are being pinned, and the last one is the only one that
 * would be catastrophic to lose.
 *
 * **Discovery** — which variables count, in what order, under what labels.
 * Ordering matters because the first entry is what signs before anyone touches
 * the dropdown, and a `localeCompare` would make that depend on the host's
 * locale data.
 *
 * **Selection** — that it moves the account, that an unknown id changes
 * nothing, and that the test seam clears both halves of the state. The
 * selection lives on `globalThis` precisely so a hot reload cannot move it,
 * which is also how it leaks between test cases if `__resetWalletCache` ever
 * forgets its `delete`.
 *
 * **That no key ever leaves the module.** `wallets()` is the one thing this
 * file hands a browser, and the last case in it is worth more than the rest of
 * the file put together.
 */

const KEY_A = "0x" + "a".repeat(64);
const KEY_B = "0x" + "b".repeat(64);
const KEY_C = "0x" + "c".repeat(64);

/** Every variable any case here sets, so one case cannot seed the next. */
const VARS = [
  "DETHRONE_PRIVATE_KEY",
  "DETHRONE_PRIVATE_KEY_SCRAPYARD",
  "DETHRONE_PRIVATE_KEY_COLD_STORAGE",
  "DETHRONE_PRIVATE_KEY_2",
  "DETHRONE_PRIVATE_KEY_BAD",
  "DETHRONE_PRIVATE_KEY_",
];

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const name of VARS) delete process.env[name];
  Object.assign(process.env, env);
  const mod = await import("@/lib/wallet");
  mod.__resetWalletCache();
  return mod;
}

beforeEach(() => {
  for (const name of VARS) delete process.env[name];
  delete (globalThis as Record<string, unknown>).__dethrone_console_wallet__;
});

afterEach(() => {
  for (const name of VARS) delete process.env[name];
  delete (globalThis as Record<string, unknown>).__dethrone_console_wallet__;
});

describe("which variables are wallets", () => {
  it("the bare variable alone is one wallet, labelled Primary", async () => {
    const { wallets, hasWallet } = await load({ DETHRONE_PRIVATE_KEY: KEY_A });
    expect(wallets()).toHaveLength(1);
    expect(wallets()[0]).toMatchObject({
      id: "primary",
      label: "Primary",
      envVar: "DETHRONE_PRIVATE_KEY",
    });
    expect(hasWallet()).toBe(true);
  });

  it("orders primary first, then suffixes by ASCII — never by locale", async () => {
    const { wallets } = await load({
      DETHRONE_PRIVATE_KEY_SCRAPYARD: KEY_B,
      DETHRONE_PRIVATE_KEY: KEY_A,
      DETHRONE_PRIVATE_KEY_2: KEY_C,
    });
    expect(wallets().map((w) => w.label)).toEqual(["Primary", "2", "Scrapyard"]);
  });

  it("turns an underscored suffix into words", async () => {
    const { wallets } = await load({ DETHRONE_PRIVATE_KEY_COLD_STORAGE: KEY_A });
    expect(wallets()[0]).toMatchObject({ id: "cold_storage", label: "Cold Storage" });
  });

  it("works with no bare variable at all — 'primary first' is an ordering rule", async () => {
    const { wallets, hasWallet, address, selectedWalletId } = await load({
      DETHRONE_PRIVATE_KEY_SCRAPYARD: KEY_B,
      DETHRONE_PRIVATE_KEY_2: KEY_C,
    });
    expect(wallets().map((w) => w.label)).toEqual(["2", "Scrapyard"]);
    expect(hasWallet()).toBe(true);
    // The first entry signs before anyone touches the dropdown.
    expect(selectedWalletId()).toBe("2");
    expect(address()).not.toBeNull();
  });

  it("no key at all is read-only, and is not an error", async () => {
    const { wallets, hasWallet, account, address, selectedWalletId, select } = await load();
    expect(wallets()).toEqual([]);
    expect(hasWallet()).toBe(false);
    expect(account()).toBeNull();
    expect(address()).toBeNull();
    expect(selectedWalletId()).toBeNull();
    expect(select("primary")).toBe(false);
  });

  it("a variable set to the empty string is absent, not a wallet", async () => {
    // This is how `${VAR}` expansion renders an unset variable, and how several
    // tests stub one. `config().hasKey` and `hasWallet()` are computed by
    // different code paths and MUST agree about it.
    const { wallets, hasWallet } = await load({
      DETHRONE_PRIVATE_KEY: "   ",
      DETHRONE_PRIVATE_KEY_SCRAPYARD: "",
    });
    expect(wallets()).toEqual([]);
    expect(hasWallet()).toBe(false);
  });

  it("ignores a variable under the prefix with no usable suffix", async () => {
    const { wallets } = await load({
      DETHRONE_PRIVATE_KEY: KEY_A,
      DETHRONE_PRIVATE_KEY_: KEY_B,
    });
    expect(wallets().map((w) => w.envVar)).toEqual(["DETHRONE_PRIVATE_KEY"]);
  });

  it("names the offending variable when a key is malformed", async () => {
    const { wallets } = await load({
      DETHRONE_PRIVATE_KEY: KEY_A,
      DETHRONE_PRIVATE_KEY_BAD: "0xnope",
    });
    // "the key is bad" is not an actionable sentence with four configured.
    expect(() => wallets()).toThrow(/DETHRONE_PRIVATE_KEY_BAD/);
  });
});

describe("the selection", () => {
  const TWO = { DETHRONE_PRIVATE_KEY: KEY_A, DETHRONE_PRIVATE_KEY_SCRAPYARD: KEY_B };

  it("moves the account, the address and the fingerprint together", async () => {
    const { select, account, address, keyFingerprint, selectedWalletId } = await load(TWO);
    const before = { addr: address(), print: keyFingerprint() };

    expect(select("scrapyard")).toBe(true);
    expect(selectedWalletId()).toBe("scrapyard");
    expect(address()).not.toBe(before.addr);
    expect(account()?.address).toBe(address());
    expect(keyFingerprint()).not.toBe(before.print);
  });

  it("refuses an id that is not configured, and changes nothing", async () => {
    const { select, address } = await load(TWO);
    const before = address();
    expect(select("nope")).toBe(false);
    expect(select("SCRAPYARD")).toBe(false); // ids are compared, not normalised
    expect(select("scrap")).toBe(false); // and never prefix-matched
    expect(address()).toBe(before);
  });

  it("survives a module reload, because it lives on globalThis", async () => {
    const first = await load(TWO);
    first.select("scrapyard");
    const switched = first.address();

    // A hot reload drops the memo and keeps the selection. A payer that changes
    // every time someone saves a file is not a payer.
    vi.resetModules();
    const again = await import("@/lib/wallet");
    expect(again.selectedWalletId()).toBe("scrapyard");
    expect(again.address()).toBe(switched);
  });

  it("__resetWalletCache clears the selection as well as the memo", async () => {
    const mod = await load(TWO);
    mod.select("scrapyard");
    mod.__resetWalletCache();
    // Without the `delete`, one case's selection leaks into the next and the
    // failure reads as a bug in wallet.ts rather than in test isolation.
    expect(mod.selectedWalletId()).toBe("primary");
  });

  it("falls back to the first wallet when the stored id no longer exists", async () => {
    const mod = await load(TWO);
    mod.select("scrapyard");

    // .env.local changed underneath a selection that outlived the memo.
    vi.resetModules();
    delete process.env.DETHRONE_PRIVATE_KEY_SCRAPYARD;
    const again = await import("@/lib/wallet");
    // Signing as the primary beats signing as nothing until someone clicks.
    expect(again.selectedWalletId()).toBe("primary");
    expect(again.hasWallet()).toBe(true);
  });
});

describe("nothing a browser receives contains a key", () => {
  it("wallets() carries addresses, labels and variable names — never key material", async () => {
    const { wallets } = await load({
      DETHRONE_PRIVATE_KEY: KEY_A,
      DETHRONE_PRIVATE_KEY_SCRAPYARD: KEY_B,
    });
    const wire = JSON.stringify(wallets());

    expect(wire).not.toContain(KEY_A);
    expect(wire).not.toContain(KEY_B);
    // The shape check, not just the two literals: a slice, a re-encoding or a
    // third key added later is caught by this and not by the lines above.
    expect(wire).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(wire).toContain("DETHRONE_PRIVATE_KEY_SCRAPYARD");
  });

  it("exports nothing shaped like a key accessor", async () => {
    const mod = await load({ DETHRONE_PRIVATE_KEY: KEY_A });
    const names = Object.keys(mod);
    expect(names.some((n) => /private|secret|^key$|getKey/i.test(n))).toBe(false);
  });
});
