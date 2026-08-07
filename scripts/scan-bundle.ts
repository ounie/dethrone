/**
 * PRD §13: *a production build's client bundle, searched for the operator's key
 * and for the substring `participantToken`, yields no match.*
 *
 * Run after `next build`. Reads `.next/static` — everything the browser is
 * actually sent.
 *
 * ## Names are fine. Values are not.
 *
 * The literal string `DETHRONE_PRIVATE_KEY` legitimately appears in the client
 * bundle, inside the sentence *"Read-only mode. Set DETHRONE_PRIVATE_KEY in
 * .env.local and restart to sign or pay."* — a help message that has to name
 * the variable to be useful. Failing on that would train whoever hits it to
 * add an exception, and the next exception would be a real one.
 *
 * So this scans for **shapes that can only be secrets**: 32-byte hex values, 65-
 * byte signatures, and the bearer-credential names this product refuses to
 * have. If the key were ever inlined, it would match the first pattern.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const STATIC = resolve(process.cwd(), ".next/static");

const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "a 32-byte hex value (a private key)", re: /0x[0-9a-fA-F]{64}\b/ },
  { name: "a 65-byte signature", re: /0x[0-9a-fA-F]{130,}/ },
  { name: "a participant token", re: /participantToken/ },
  { name: "an x402 payload header value", re: /["'](?:payment-signature|x-payment)["']\s*[:=]\s*["'][A-Za-z0-9+/=]{40,}/ },
];

function files(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    console.error(`[scan] ${dir} does not exist — run \`next build\` first.`);
    process.exit(1);
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(js|mjs|css|json|txt)$/.test(entry)) out.push(full);
  }
  return out;
}

const scanned = files(STATIC);
const hits: string[] = [];

for (const file of scanned) {
  const source = readFileSync(file, "utf8");
  for (const { name, re } of FORBIDDEN) {
    const match = re.exec(source);
    if (match) {
      hits.push(`  ${file.slice(STATIC.length + 1)}\n    ${name}\n    ${match[0].slice(0, 80)}`);
    }
  }
}

if (hits.length > 0) {
  console.error(`\nThe client bundle contains something it must not:\n\n${hits.join("\n\n")}\n`);
  process.exit(1);
}

console.log(`[scan] ${scanned.length} client files, no secret-shaped value found`);
