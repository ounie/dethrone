/**
 * The redactor's corpus.
 *
 * Half of it is things that must vanish. The other half is things that must
 * **survive**, and that half is the one that catches an over-eager pattern —
 * a redactor that eats the transaction hash has destroyed the operator's only
 * link to the chain, and a redactor that eats a genome has destroyed the asset.
 *
 * Every secret here is invented. `FIXTURE_KEY` has never held a cent.
 */

export const FIXTURE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

/** A genome is 64 hex characters — byte-identical in shape to a private key, and public. */
export const FIXTURE_GENOME =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

export const FIXTURE_SIGNATURE =
  "0x" + "ab".repeat(65); // 65 bytes: r, s, v

export const FIXTURE_TX = "0x" + "9".repeat(64);
export const FIXTURE_ADDRESS = "0xAbC0000000000000000000000000000000000001";

/** A plausible x402 payload: base64 JSON naming an authorization. */
export const FIXTURE_X402 = Buffer.from(
  JSON.stringify({
    x402Version: 2,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      authorization: {
        from: FIXTURE_ADDRESS,
        to: "0xBbC0000000000000000000000000000000000002",
        value: "1000000",
        nonce: "0x" + "cd".repeat(32),
      },
      signature: FIXTURE_SIGNATURE,
    },
  }),
).toString("base64");

export interface Specimen {
  name: string;
  input: unknown;
  mustNotContain: string[];
  mustContain: string[];
}

export const CORPUS: Specimen[] = [
  {
    name: "a payment-signature request header",
    input: { headers: { "payment-signature": FIXTURE_X402, accept: "application/json" } },
    mustNotContain: [FIXTURE_X402],
    mustContain: ["application/json"],
  },
  {
    name: "the v1 x-payment header name",
    input: { "x-payment": FIXTURE_X402 },
    mustNotContain: [FIXTURE_X402],
    mustContain: [],
  },
  {
    name: "a decoded EIP-3009 authorization",
    input: {
      authorization: { from: FIXTURE_ADDRESS, value: "1000000" },
      signature: FIXTURE_SIGNATURE,
    },
    mustNotContain: [FIXTURE_SIGNATURE],
    mustContain: [FIXTURE_ADDRESS],
  },
  {
    name: "a bare 65-byte signature in a value",
    input: { proof: FIXTURE_SIGNATURE },
    mustNotContain: [FIXTURE_SIGNATURE],
    mustContain: [],
  },
  {
    name: "a signature embedded in a sentence",
    input: `verification failed for ${FIXTURE_SIGNATURE} at index 3`,
    mustNotContain: [FIXTURE_SIGNATURE],
    mustContain: ["verification failed"],
  },
  {
    name: "the key inside an Error message",
    input: new Error(`invalid key ${FIXTURE_KEY} rejected by facilitator`),
    mustNotContain: [FIXTURE_KEY],
    mustContain: ["rejected by facilitator"],
  },
  {
    name: "the key twice in one string",
    input: { detail: `${FIXTURE_KEY} and again ${FIXTURE_KEY}` },
    mustNotContain: [FIXTURE_KEY],
    mustContain: ["and again"],
  },
  {
    name: "the key nested three levels deep",
    input: { error: { detail: { context: { key: FIXTURE_KEY } } } },
    mustNotContain: [FIXTURE_KEY],
    mustContain: [],
  },
  {
    name: "an array of mixed specimens",
    input: [{ signature: FIXTURE_SIGNATURE }, { txHash: FIXTURE_TX }],
    mustNotContain: [FIXTURE_SIGNATURE],
    mustContain: [FIXTURE_TX],
  },
  {
    name: "a participantToken, which this console does not hold but must never echo",
    input: { participantToken: "d2FsbGV0OmhtYWM", matchId: "mat_abc" },
    mustNotContain: ["d2FsbGV0OmhtYWM"],
    mustContain: ["mat_abc"],
  },
  {
    name: "an authorization header",
    input: { authorization: "Bearer sk_live_totally_real" },
    mustNotContain: ["sk_live_totally_real"],
    mustContain: [],
  },
  {
    name: "a Headers instance",
    input: new Headers({ "payment-signature": FIXTURE_X402, "x-dethrone-interface": "interface-v2" }),
    mustNotContain: [FIXTURE_X402],
    mustContain: ["interface-v2"],
  },

  // ── The survivors. This half is why the patterns are bounded at 130 hex. ──
  {
    name: "SURVIVOR: a transaction hash — the operator's only link to the chain",
    input: { settlement: { success: true, transaction: FIXTURE_TX } },
    mustNotContain: [],
    mustContain: [FIXTURE_TX],
  },
  {
    name: "SURVIVOR: an address — already public",
    input: { payer: FIXTURE_ADDRESS },
    mustNotContain: [],
    mustContain: [FIXTURE_ADDRESS],
  },
  {
    name: "SURVIVOR: a genome — 64 hex, shaped exactly like a key, and it IS the asset",
    input: { character: { id: 12, genome: FIXTURE_GENOME } },
    mustNotContain: [],
    mustContain: [FIXTURE_GENOME],
  },
  {
    name: "SURVIVOR: the interface version and an error code",
    input: { interface: "interface-v2", error: { code: "SEAT_VESTING" } },
    mustNotContain: [],
    mustContain: ["interface-v2", "SEAT_VESTING"],
  },

  // ── Two recorded envelopes, in the shape /api/act actually returns. ───────
  {
    name: "RECORDED: a settled forge",
    input: {
      request: { method: "POST", path: "/api/forge", paid: true, signed: false, scope: null },
      status: 202,
      ms: 1840,
      settled: true,
      settlement: { success: true, payer: FIXTURE_ADDRESS, transaction: FIXTURE_TX },
      ceiling: { enabled: true, spentCents: 10, cap: 500 },
      headers: { "payment-signature": FIXTURE_X402 },
      body: { characterId: 12, state: "forging", genome: FIXTURE_GENOME },
    },
    mustNotContain: [FIXTURE_X402],
    mustContain: [FIXTURE_TX, FIXTURE_GENOME, "forging"],
  },
  {
    name: "RECORDED: a SEAT_VESTING refusal, which cost nothing",
    input: {
      request: { method: "POST", path: "/api/challenge", paid: true, signed: false, scope: null },
      status: 409,
      settled: false,
      settlement: null,
      ceiling: { enabled: true, spentCents: 10, cap: 500 },
      body: {
        error: {
          code: "SEAT_VESTING",
          message: "the seat is vesting",
          detail: { vestsAt: "2026-08-08T00:00:00.000Z" },
        },
      },
    },
    mustNotContain: [],
    mustContain: ["SEAT_VESTING", "vestsAt"],
  },
];
