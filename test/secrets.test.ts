import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { SRC, read } from "./graph";

/**
 * Every key this process holds gets redacted, not just the first one.
 *
 * ## Why this is a source-level test and not only a behavioural one
 *
 * The bug it guards is an *omission*, and an omission is invisible to a test
 * that only exercises the wallet it happened to configure. `/api/act` and
 * `/api/chat` each used to name `process.env.DETHRONE_PRIVATE_KEY` literally,
 * which was the complete list right up until a second key became configurable —
 * at which point a `DETHRONE_PRIVATE_KEY_SCRAPYARD` surfacing in a viem error
 * would have gone straight to the browser and, from the chat route, to a
 * third-party model provider. Nothing would have failed. Nothing would have
 * looked wrong.
 *
 * So this pins the *mechanism*: both routes resolve the list from
 * `walletKeyVars`, and neither one names a variable by hand. The behavioural
 * half lives beside the cases it belongs to — `act-ceiling.test.ts` and
 * `chat-route.test.ts` each redact a second key through the real handler.
 */

const REDACTING_ROUTES = ["app/api/act/route.ts", "app/api/chat/route.ts"];

describe("the redaction list is derived, never hand-written", () => {
  for (const file of REDACTING_ROUTES) {
    it(`${file} resolves its wallet secrets from walletKeyVars`, () => {
      expect(read(join(SRC, file))).toContain("walletKeyVars(");
    });

    it(`${file} does not name DETHRONE_PRIVATE_KEY literally`, () => {
      // The exact regression. A literal read is a list of one, frozen at the
      // moment somebody typed it.
      expect(read(join(SRC, file))).not.toContain("process.env.DETHRONE_PRIVATE_KEY");
    });
  }
});
