"use client";

import { useEffect, useRef } from "react";

/**
 * The modal shell: a backdrop, a focus trap, and Escape.
 *
 * Extracted from `confirm-dialog.tsx` when the autonomy toggle needed the same
 * anatomy, and shared rather than copied for a reason that is about behaviour
 * and not tidiness. The focus trap is the part worth keeping in one place:
 * while a question about spending money — or about letting a machine spend it —
 * is open, nothing behind it should be reachable by keyboard. A second
 * implementation is a second chance to get that subtly wrong, and the way it
 * goes wrong is silent.
 */
export default function Dialog({
  labelledBy,
  onCancel,
  children,
  initialFocus,
}: {
  labelledBy: string;
  onCancel: () => void;
  children: React.ReactNode;
  /** Focused on open. Give it the SAFE choice, never the consequential one. */
  initialFocus?: React.RefObject<HTMLElement | null>;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initialFocus?.current?.focus();
  }, [initialFocus]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = backdropRef.current?.querySelectorAll<HTMLElement>("button");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="confirm-backdrop"
      ref={backdropRef}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}
