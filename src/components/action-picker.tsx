"use client";

import { useCallback, useState } from "react";
import Icon from "./icon";
import Time from "./time";
import SequenceBuilder, { type MenuAction } from "./sequence-builder";
import { stamp } from "@/lib/format";

/**
 * The sequence picker: load a fighter's legal menu, choose actions in exchange
 * order, and see the selection window as the arena last reported it.
 *
 * ## Why this is a component and not a text field
 *
 * The submission is five integers, so a text box would technically work. But
 * the integers are *indices into a menu that depends on the fighter*, and the
 * menu is only knowable by asking. A field that made the operator hold sixteen
 * indices in their head, in order, would be a field that produces the wrong
 * five whenever they are tired.
 *
 * ## Everything here goes through /api/act
 *
 * The menu load and the window read are catalogue commands (`legal_actions`,
 * `match`), issued through the one execution path like every other button. This
 * component adds no route and knows no path — it names a command id and renders
 * what came back.
 *
 * ## No clock
 *
 * `closesAt` is shown exactly as the arena wrote it, with the time of the read
 * beside it. There is no countdown, because a countdown is the vesting rule
 * reimplemented in a browser, and the moment the two disagree the one on this
 * screen is the wrong one. The operator is told when it was read and can read
 * it again.
 */

interface Selection {
  closesAt: string;
  submitted: { challenger: boolean; throne: boolean };
}

async function act(id: string, args: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, args }),
  });
  return (await res.json()) as Record<string, unknown>;
}

export default function ActionPicker({
  matchId,
  value,
  capacity,
  disabled,
  onChange,
}: {
  matchId: string;
  /** JSON array of indices, as it will be submitted. */
  value: string;
  /**
   * The canon's published sequence length, or null when it publishes none.
   * Forwarded, never interpreted — see `SequenceBuilder`.
   */
  capacity: number | null;
  disabled: boolean;
  onChange: (json: string) => void;
}) {
  const [characterId, setCharacterId] = useState("");
  const [menu, setMenu] = useState<MenuAction[] | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [window, setWindow] = useState<{ selection: Selection | null; readAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const picks: number[] = (() => {
    try {
      const parsed: unknown = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  })();

  const setPicks = useCallback(
    (next: number[]) => onChange(next.length ? JSON.stringify(next) : ""),
    [onChange],
  );

  const loadMenu = useCallback(async () => {
    if (!characterId.trim()) return;
    setBusy(true);
    setMenuError(null);
    try {
      const data = await act("legal_actions", { id: characterId.trim() });
      const body = data.body as { actions?: MenuAction[] } | undefined;
      if (Array.isArray(body?.actions)) {
        setMenu(body.actions);
      } else {
        setMenu(null);
        // The arena's own code, rendered — never a sentence invented here.
        const err = (data.body as { error?: { code?: string } } | undefined)?.error?.code;
        setMenuError(err ?? (data.error as { code?: string } | undefined)?.code ?? "NO_MENU");
      }
    } finally {
      setBusy(false);
    }
  }, [characterId]);

  const loadWindow = useCallback(async () => {
    if (!matchId.trim()) return;
    setBusy(true);
    try {
      const data = await act("match", { id: matchId.trim() });
      const body = data.body as { selection?: Selection | null } | undefined;
      setWindow({ selection: body?.selection ?? null, readAt: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  }, [matchId]);

  return (
    <div className="picker">
      {/* ── The window, as last read ─────────────────────────────────────── */}
      <div className="picker-row">
        <button
          type="button"
          className="icon-btn"
          disabled={busy || !matchId.trim()}
          onClick={() => void loadWindow()}
        >
          <Icon name="hourglass" size={13} />
          Read the window
        </button>

        {window &&
          (window.selection ? (
            <span className="window-state">
              <span className="num">closes <Time iso={window.selection.closesAt} /></span>
              <span className="muted">
                · challenger {window.selection.submitted.challenger ? "submitted" : "not yet"} ·
                throne {window.selection.submitted.throne ? "submitted" : "not yet"}
              </span>
              <span className="muted">· read <Time iso={window.readAt} zone={false} /></span>
            </span>
          ) : (
            <span className="window-state muted">
              No window open on this match as of <Time iso={window.readAt} zone={false} />.
            </span>
          ))}
      </div>

      {/* ── The menu ─────────────────────────────────────────────────────── */}
      <div className="picker-row">
        <input
          className="num picker-char"
          inputMode="numeric"
          placeholder="your character id"
          value={characterId}
          disabled={disabled}
          aria-label="Character id whose menu to load"
          onChange={(e) => setCharacterId(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          disabled={busy || disabled || !characterId.trim()}
          onClick={() => void loadMenu()}
        >
          <Icon name="book-open" size={13} />
          Load menu
        </button>
        {menuError && <span className="num window-state" data-tone="bad">{menuError}</span>}
      </div>

      {/* ── The slots and the menu ───────────────────────────────────────── */}
      <SequenceBuilder
        menu={menu}
        picks={picks}
        capacity={capacity}
        disabled={disabled}
        onPick={(index) => setPicks([...picks, index])}
        onClear={(slot) => setPicks(picks.filter((_, i) => i !== slot))}
        onReorder={(from, to) => {
          const next = [...picks];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setPicks(next);
        }}
        emptyHint="Nothing chosen. Pick from the menu below, in the order they should be attempted."
      />

      <p className="field-hint">
        {/* The arena decides how many are required and what the bounds are. This
            says what was chosen, and lets the canon refuse the rest. */}
        {picks.length} chosen. Order is exchange order. Which side you are is decided by the seat,
        never by this field — and a submission cannot be revised.
      </p>
    </div>
  );
}
