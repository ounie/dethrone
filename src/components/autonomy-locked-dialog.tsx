"use client";

import { useRef } from "react";
import Dialog from "./dialog";

/**
 * Why the autonomy chip will not turn on, and what to do about it.
 *
 * ## Why this is a dialog and not a line of text
 *
 * It used to be a paragraph pinned under the model picker, permanently, on
 * every deploy that had not opted in — which is every deploy by default. A
 * sentence about an environment variable does not need to be on screen while
 * you are reading a transcript, and a card that always carries a paragraph of
 * setup instructions reads as a card with something wrong with it.
 *
 * The chip is the honest surface: it already states the mode, and a mode that
 * cannot be changed should say why when you reach for it rather than shouting
 * it continuously. So the chip stays clickable when autonomy is unavailable,
 * and clicking opens this.
 *
 * ## The refusal is the server's sentence, rendered
 *
 * `reason` comes from `autonomyStore(...)` on the server. It is printed
 * verbatim and never paraphrased: whether this deploy may offer autonomy is a
 * fact about its configuration and its runtime, and a browser that composed its
 * own explanation would eventually explain a rule that had changed.
 *
 * Everything after it is instruction, not diagnosis, which is why it is safe to
 * be written here.
 */
export default function AutonomyLockedDialog({
  reason,
  onClose,
}: {
  /** The server's own words. Rendered as given. */
  reason: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog labelledBy="autonomy-locked-title" onCancel={onClose} initialFocus={closeRef}>
      <>
        <h2 className="display" id="autonomy-locked-title">
          The agent is asking before it acts
        </h2>

        <p className="note">{reason}</p>

        <p className="note">
          Until that changes, the agent may run <strong>free reads</strong> on its own. Anything
          that signs or spends comes back to you as a proposal, and nothing leaves this process
          until you press Run.
        </p>

        <p className="note">
          {/* Named rather than described: an operator following this should be
              able to copy the line, not guess at its spelling. */}
          To offer it, set <code>CONSOLE_ALLOW_FULL_AUTONOMY=true</code> in{" "}
          <code>.env.local</code> and restart. That only makes the chip
          <em> offerable</em> — turning it on is still a dialog you have to read and confirm, and
          one click turns it off again.
        </p>

        <p className="note">
          It is worth reading that file first. Full autonomy means a language model signing and
          paying with no click from you, bounded only by the per-action cap and this sitting&rsquo;s
          ceiling — both of which are seatbelts in this process, not escrow.
        </p>

        <div className="confirm-actions">
          <button type="button" className="btn-quiet" ref={closeRef} onClick={onClose}>
            Close
          </button>
        </div>
      </>
    </Dialog>
  );
}
