import "server-only";
import { createPublicClient, formatUnits, http, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { config } from "./config";

/**
 * A read of the chain. Not a read of the canon.
 *
 * ## Why this is a second outbound path, and why that is not the thing the
 * one-fetch invariant was protecting
 *
 * `arena.ts` is the only module that may talk to `DETHRONE_BASE_URL`, because
 * that is the path where a payment can be attached, a signature minted, or a
 * spend go uncounted. This module talks to a public RPC instead, and it is
 * structurally incapable of any of those things: it makes one `eth_call` to a
 * `view` function, it never signs, it never sends a transaction, and it needs
 * no key — the address it reads is public and so is the answer.
 *
 * `test/chain.test.ts` holds that line: no signing, no writing, one contract.
 *
 * ## Why show a balance at all
 *
 * PRD §14 bars bookkeeping — no P&L, no portfolio, no history — and this sits
 * near that line, so it is worth saying where it falls. A balance is not
 * accounting; it is the answer to the one operational question the operator
 * cannot get anywhere else on this screen: *can this wallet actually pay for
 * the next thing I press?* The ceiling says what the console will allow, the
 * catalogue says what the arena charges, and neither of them knows whether the
 * money is there.
 *
 * It is deliberately **not** authoritative. A balance is a snapshot from one
 * RPC at one moment; a settlement can still fail for a dozen reasons this
 * number cannot see. The UI labels it as a reading, never as a guarantee.
 */

const USDC: Record<"base" | "base-sepolia", Address> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const EXPLORER: Record<"base" | "base-sepolia", string> = {
  base: "https://basescan.org",
  "base-sepolia": "https://sepolia.basescan.org",
};

/** USDC is 6 decimals on both networks. */
const DECIMALS = 6;

const BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** `DETHRONE_NETWORK` is loose by design; normalise it once, here. */
export function networkKey(): "base" | "base-sepolia" {
  const raw = config().network.toLowerCase();
  return raw === "mainnet" || raw === "base" ? "base" : "base-sepolia";
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER[networkKey()]}/address/${address}`;
}

export interface Balance {
  /** Already formatted for display, e.g. "12.34". */
  usdc: string;
  network: "base" | "base-sepolia";
}

/**
 * The operator's USDC balance, or `null` when it could not be read.
 *
 * `null` is a supported answer and not an error. A public RPC can rate-limit,
 * time out, or simply be down, and none of that should take the console with
 * it — the balance is a convenience on a screen whose actual job is to reach
 * the arena. The UI renders "unavailable" and everything else keeps working.
 */
export async function usdcBalance(address: string): Promise<Balance | null> {
  const network = networkKey();
  const chain = network === "base" ? base : baseSepolia;

  try {
    const client = createPublicClient({
      chain,
      transport: http(process.env.DETHRONE_RPC_URL || undefined, { timeout: 4_000, retryCount: 1 }),
    });

    const raw = await client.readContract({
      address: USDC[network],
      abi: BALANCE_OF,
      functionName: "balanceOf",
      args: [address as Address],
    });

    // Two decimal places, and **truncated rather than rounded** — 3.125 shows
    // as 3.12, never 3.13. Rounding a balance up tells the operator they hold
    // money they do not, which on the one screen that decides whether a payment
    // can go through is the wrong direction to be wrong in.
    const exact = formatUnits(raw, DECIMALS);
    const [whole, frac = ""] = exact.split(".");
    return { usdc: `${whole}.${frac.padEnd(2, "0").slice(0, 2)}`, network };
  } catch {
    return null;
  }
}
