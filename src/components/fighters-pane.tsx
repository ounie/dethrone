"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Icon from "./icon";
import Panel from "./panel";
import SequenceBuilder, { type MenuAction } from "./sequence-builder";
import type { Capabilities } from "@/lib/capability";
import {
  applyCombo,
  comboFromPicks,
  combosSnapshot,
  removeCombo,
  serverCombosSnapshot,
  subscribeCombos,
  upsertCombo,
  writeCombos,
  type Combo,
} from "@/lib/combos";
import { stamp } from "@/lib/format";

/**
 * Your fighters, their actions, and a plan waiting for a window.
 *
 * ## What this panel is for
 *
 * Everything the arena will accept was already reachable from the rail. What
 * was not reachable was *knowing what to type*: the Stable answers in JSON, a
 * portrait was a storage key, and choosing five actions meant holding sixteen
 * indices in your head while a match id sat in another pane. This panel is the
 * roster, the portrait, the menu and the plan on one surface.
 *
 * ## It spends nothing, and that is structural
 *
 * There is no Run button here. The three "arm" buttons **seed the command
 * pane** — they select a catalogue command and fill its fields — and then stop.
 * The operator still presses the one ember button in the command pane, which is
 * the only element on this screen that settles an amount. That is not
 * decoration: `globals.css`'s first paragraph makes ember fill plus rim glow
 * mean exactly one thing, and a second place to spend would be a second answer
 * to "what is about to cost me money".
 *
 * The one request this panel makes on its own is `submit_actions`, which the
 * catalogue prices at zero and which the arena accepts on a signature.
 *
 * ## Why it holds a plan at all
 *
 * Because the arena will not take one at pay time, deliberately. `POST
 * /challenge` is `{ characterId }` and nothing else: selection was moved out of
 * payment by Amendment A, because a challenger who picks at payment is judged
 * against whoever holds the seat later, which may not be who they picked
 * against. The window opens at PAIRING and the only way to notice is to ask.
 *
 * So the plan lives here, in this component's state, for as long as the tab is
 * open. Not localStorage, not a cookie, not a server module — a plan that
 * survived a reload would be a standing sequence, and the arena has no such
 * concept precisely so that nobody can be counter-picked for a whole reign.
 *
 * ## No clock, and no automatic spend
 *
 * The panel polls a free read and renders `closesAt` exactly as the arena wrote
 * it, beside the time of the read. There is no countdown: a countdown is the
 * window rule reimplemented in a browser, and the moment the two disagree the
 * one on this screen is wrong. Submit is enabled when the last response carried
 * a `selection`, which is rendering the arena's answer rather than inferring
 * one — and it is always a human press. Console PRD §14 puts scheduling and
 * automation out of scope, and 210 seconds is long enough for a person.
 */

/** The arena's own cache window on a match read. Not a rate limit we invented. */
const POLL_MS = 5_000;

/**
 * How many quiet reads before the panel stops asking and offers to resume.
 *
 * A throne pairing lands in seconds when the queue is empty and waits behind
 * every earlier-paid challenger when it is not; a posted duel waits for a taker
 * who may never come. Neither has a bound this console could know, so it does
 * not pretend to — it stops, says when it last looked, and leaves the decision
 * to keep watching where it belongs.
 */
const QUIET_READS_BEFORE_PAUSE = 24;

interface StableFighter {
  characterId: number;
  /** The fighter's derived name. Null for the authored pre-Bloodline rows. */
  name: string | null;
  state: string;
  /** 0 = a prime, >=1 = an heir, null = authored. The arena's own field. */
  generation: number | null;
  arena: { slug: string; displayName: string } | null;
  portrait: string | null;
  /** Resolved by the arena. The console never composes an asset path. */
  portraitUrl: string | null;
  throneLegal: boolean;
  reason: string | null;
}

interface Selection {
  closesAt: string;
  submitted: { challenger: boolean; throne: boolean };
}

interface Watch {
  matchId: string;
  selection: Selection | null;
  readAt: string | null;
  /** Consecutive reads with no window. Reset by a window appearing. */
  quiet: number;
  polling: boolean;
}

/** The single destination. `test/one-fetch.test.ts` wants a string literal. */
async function act(id: string, args: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, args }),
  });
  return (await res.json()) as Record<string, unknown>;
}

/** The arena's own code, or the console's. Never a sentence invented here. */
function codeOf(data: Record<string, unknown>, fallback: string): string {
  const body = data.body as { error?: { code?: string } } | undefined;
  const err = data.error as { code?: string } | undefined;
  return body?.error?.code ?? err?.code ?? fallback;
}

function bodyOf(data: Record<string, unknown>): Record<string, unknown> | undefined {
  return data.body as Record<string, unknown> | undefined;
}

export default function FightersPane({
  capabilities,
  disabled,
  sequenceLength,
  onArm,
}: {
  capabilities: Capabilities;
  /** True while any other request is in flight. */
  disabled: boolean;
  /**
   * The canon's published `actions.sequenceLength`, or null if it publishes
   * none. Never a literal — see the note on `SequenceBuilder`'s `capacity`.
   */
  sequenceLength: number | null;
  /** Select a catalogue command and fill its fields. Runs nothing. */
  onArm: (commandId: string, args: Record<string, string>) => void;
}) {
  const [roster, setRoster] = useState<StableFighter[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAction[] | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [watch, setWatch] = useState<Watch | null>(null);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [matchIdField, setMatchIdField] = useState("");
  const [legendOpen, setLegendOpen] = useState(false);
  const [comboName, setComboName] = useState("");
  const [comboNote, setComboNote] = useState<string | null>(null);

  /*
    Combos live in `localStorage`, which is an external store, so they are read
    as one. The server snapshot is empty because the server has no browser —
    this component renders server-side too (`test/fighters-pane.test.ts` does
    exactly that), and a `useState` initialiser reading storage would produce
    markup on the client that does not match the markup from the server.
  */
  const combos = useSyncExternalStore(subscribeCombos, combosSnapshot, serverCombosSnapshot);

  const stable = capabilities.stable ?? { enabled: true };
  const chosen = roster?.find((f) => f.characterId === selected) ?? null;

  /**
   * Fill the plan at random, up to the published length.
   *
   * ⚠️ **This is not the arena's draw, and must never be described as one.**
   * The arena fills an unsubmitted slot deterministically from the match id, and
   * records the derivation so a disputed loss can be recounted. This is
   * `crypto.getRandomValues` in a browser, before any match exists — a way to
   * see a full plan quickly, with no predictive relationship to what the arena
   * would deal you. Labelling it "draw" without that distinction would invite an
   * operator to think they had previewed their fill.
   */
  const drawRandom = useCallback(() => {
    if (!menu || menu.length === 0 || sequenceLength === null) return;
    const bytes = new Uint32Array(sequenceLength);
    crypto.getRandomValues(bytes);
    setPicks([...bytes].map((b) => menu[b % menu.length].index));
  }, [menu, sequenceLength]);

  const saveCurrentAsCombo = useCallback(() => {
    if (!menu || picks.length === 0 || !comboName.trim()) return;
    writeCombos(
      upsertCombo(combos, {
        name: comboName,
        actionIds: comboFromPicks(picks, menu),
        fromCharacterId: selected,
        savedAt: new Date().toISOString(),
      }),
    );
    setComboName("");
    setComboNote(null);
  }, [menu, picks, comboName, combos, selected]);

  /**
   * Fill the plan from a saved combo, and say what did not fit.
   *
   * A combo names ACTIONS, not positions, so applying one to a fighter that
   * lacks an action drops that slot and reports it rather than substituting.
   * Substituting would be the panel choosing a move — an autofill that writes a
   * plan the operator did not, and cannot tell apart from one they did.
   */
  const applySavedCombo = useCallback(
    (combo: Combo) => {
      if (!menu) return;
      const { picks: next, missing } = applyCombo(combo, menu);
      setPicks(sequenceLength === null ? next : next.slice(0, sequenceLength));
      setComboNote(
        missing.length === 0
          ? null
          : `${missing.length} of ${combo.actionIds.length} not in this fighter's menu — a menu follows the genome, so a combo does not carry across every fighter. Missing: ${missing.join(", ")}.`,
      );
    },
    [menu, sequenceLength],
  );

  /** Type counts over a set of picks, or over the whole menu. Pure counting. */
  const tally = useCallback((types: string[]): [string, number][] => {
    const counts = new Map<string, number>();
    for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const loadRoster = useCallback(async (): Promise<StableFighter[] | null> => {
    setBusy(true);
    setRosterError(null);
    try {
      const data = await act("stable", {});
      const characters = bodyOf(data)?.characters;
      if (Array.isArray(characters)) {
        const list = characters as StableFighter[];
        setRoster(list);
        return list;
      }
      setRoster(null);
      setRosterError(codeOf(data, "NO_STABLE"));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const choose = useCallback(async (characterId: number) => {
    setSelected(characterId);
    setName(null);
    setImageUrl(null);
    setMenu(null);
    setMenuError(null);
    setPicks([]);
    setBusy(true);
    const id = String(characterId);
    try {
      // Two free reads, together. The menu is the ARENA's answer, not a
      // derivation: the legal sixteen are a pure function of a genome, and a
      // console that computed them from its own copy of the tables would be a
      // second implementation of `actions-v1` — wrong on exactly the day the
      // tables version, and wrong in the direction of submitting the wrong five.
      const [detail, actions] = await Promise.all([
        act("character", { id }),
        act("legal_actions", { id }),
      ]);

      const person = bodyOf(detail) as { name?: string; imageUrl?: string | null } | undefined;
      setName(person?.name ?? null);
      setImageUrl(person?.imageUrl ?? null);

      const list = (bodyOf(actions) as { actions?: MenuAction[] } | undefined)?.actions;
      if (Array.isArray(list)) setMenu(list);
      else setMenuError(codeOf(actions, "NO_MENU"));
    } finally {
      setBusy(false);
    }
  }, []);

  /*
    Open with the roster already read and the prime already chosen.

    Safe to do without being asked, and the two halves of that are worth
    separating. It COSTS NOTHING: `stable` is signed and free, `character` and
    `legal_actions` are free and unauthenticated, and none of the three can
    settle an amount — the panel is structurally incapable of issuing a paid
    command (`test/fighters-pane.test.ts` pins that). And it is not automation
    in the sense Console §14 rules out: nothing is scheduled, nothing is
    retried, and nothing acts on what comes back. It is the same read the
    operator would make first, made before they ask.

    Gated on the capability, so a keyless deploy issues nothing at all rather
    than firing a signed request it knows will be refused.

    THE PRIME, specifically, because it is the only defensible default. A wallet
    has at most one — one prime per forger, forever — and it is the fighter that
    wallet's own address derives to. Everything else in a Stable was bought or
    inherited, so "first by id" or "most recent" would put a stranger's heir in
    front of you as soon as you claimed one. `list[0]` is the fallback only when
    the arena reports no prime at all.

    Once per mount, via a ref rather than a state flag: a re-run would re-select
    the prime and silently discard a plan the operator had already built.
  */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !stable.enabled) return;
    autoOpened.current = true;
    void (async () => {
      const list = await loadRoster();
      if (!list || list.length === 0) return;
      const prime = list.find((f) => f.generation === 0) ?? list[0];
      await choose(prime.characterId);
    })();
  }, [stable.enabled, loadRoster, choose]);

  // ── The window watch ──────────────────────────────────────────────────────
  //
  // `pollRef` holds the latest read function so the interval never closes over
  // a stale `watch`. Restarting the interval on every tick instead would reset
  // the delay each time and turn a 5-second poll into something faster.
  const pollRef = useRef<() => void>(() => {});

  const readWindow = useCallback(async () => {
    const current = watch;
    if (!current) return;
    const data = await act("match", { id: current.matchId });
    const selection = (bodyOf(data) as { selection?: Selection | null } | undefined)?.selection ?? null;
    setWatch((prev) => {
      if (!prev || prev.matchId !== current.matchId) return prev;
      const quiet = selection ? 0 : prev.quiet + 1;
      return {
        ...prev,
        selection,
        readAt: new Date().toISOString(),
        quiet,
        // Stop asking, rather than ask forever. Resuming is one press.
        polling: prev.polling && quiet < QUIET_READS_BEFORE_PAUSE,
      };
    });
  }, [watch]);

  useEffect(() => {
    pollRef.current = () => void readWindow();
  }, [readWindow]);

  useEffect(() => {
    if (!watch?.polling) return;
    // Read once immediately so the panel is never blank for a full interval,
    // then settle into the arena's own cache window.
    pollRef.current();
    const timer = setInterval(() => pollRef.current(), POLL_MS);
    return () => clearInterval(timer);
    // Keyed by the match and by whether we are watching it — NOT by `watch`
    // itself, whose `readAt` changes on every tick and would rebuild the timer.
  }, [watch?.matchId, watch?.polling]);

  const submit = useCallback(async () => {
    if (!watch) return;
    setBusy(true);
    setSubmitNote(null);
    try {
      const data = await act("submit_actions", {
        id: watch.matchId,
        actions: JSON.stringify(picks),
      });
      const body = bodyOf(data) as { submitted?: boolean; source?: string } | undefined;
      setSubmitNote(
        body?.submitted ? `sealed · ${body.source ?? "chosen"}` : codeOf(data, "REFUSED"),
      );
      void readWindow();
    } finally {
      setBusy(false);
    }
  }, [watch, picks, readWindow]);

  const idle = busy || disabled;

  return (
    <Panel
      icon="swords"
      title="Fighters"
      className="pane-fighters"
      actions={
        <button
          type="button"
          className="icon-btn labelled"
          disabled={idle || !stable.enabled}
          onClick={() => void loadRoster()}
        >
          <Icon name="rotate-cw" size={13} />
          Read my stable
        </button>
      }
    >
      <div className="pane-body fighters">
        {/* The server decided this, and it says why. Never re-derived here. */}
        {!stable.enabled && <p className="muted">{stable.reason}</p>}

        {stable.enabled && !roster && !rosterError && (
          <p className="muted">
            Nothing read yet. The Stable is owner-only, so it costs a signature and no money.
          </p>
        )}

        {rosterError && (
          <p className="num window-state" data-tone="bad">
            {rosterError}
          </p>
        )}

        {roster?.length === 0 && (
          <p className="muted">No fighters. Forge one — your wallet already contains it.</p>
        )}

        {roster && roster.length > 0 && (
          <ul className="roster" aria-label="Your fighters">
            {roster.map((f) => (
              <li key={f.characterId}>
                <button
                  type="button"
                  className="roster-item"
                  data-selected={f.characterId === selected}
                  disabled={idle}
                  onClick={() => void choose(f.characterId)}
                >
                  {f.portraitUrl ? (
                    /*
                      A plain `<img>`, deliberately, and the alternative is worse
                      in a way that matters here. `next/image` on a remote host
                      routes the bytes through this server's optimiser, which
                      makes the CONSOLE PROCESS fetch the arena's storage — a
                      second outbound from the one runtime that holds a key. A
                      bare tag is the browser fetching a world-readable,
                      content-addressed, immutable object, and this process
                      never touches it.

                      The URL is the arena's, from `portraitUrl`. Composing one
                      from a storage key would put a fact about where our
                      objects live inside a transport.
                    */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="roster-face" src={f.portraitUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="roster-face empty" aria-hidden="true" />
                  )}
                  <span className="roster-text">
                    {/*
                      The NAME leads, and the id sits under it. A roster is read
                      to answer "which of mine is this", and "#293" answers that
                      only for someone who has already memorised their own ids.

                      The arena is deliberately absent. Every fighter a wallet
                      holds is forged into the cycle's arena, so the column
                      repeated one string down the whole list and earned none of
                      its width. It is still on the detail card below, which is
                      where it becomes worth reading — if arena rotation ever
                      makes a Stable span two, that is the line that will show
                      it.
                    */}
                    <span className="roster-name ellipsis">
                      {f.name ?? `Character ${f.characterId}`}
                    </span>
                    {/*
                      No "throne-legal" badge, and its absence is deliberate.

                      The arena computes that field as `state === "ready"` and
                      nothing else, so printing it beside `state` was the same
                      fact twice. Worse, the NAME promises a verdict the field
                      does not reach: under Amendment B a ticket is per REIGN,
                      checked at the door by `assertTicketUnspent`, so a `ready`
                      fighter that already challenged during this reign is
                      refused with `throneLegal` still true. A badge reading
                      "throne-legal" over a fighter about to be turned away is
                      the console inventing an eligibility answer — exactly the
                      thing it is not allowed to do.

                      `state` is the honest half, and it is right there.
                    */}
                    <span className="roster-meta muted">
                      <span className="num">#{f.characterId}</span> · {f.state}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {chosen && (
          <div className="fighter-detail">
            <div className="fighter-head">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="fighter-portrait"
                  src={imageUrl}
                  alt={name ? `${name}, character ${chosen.characterId}` : ""}
                />
              ) : null}
              <div>
                <div className="fighter-name">{name ?? `Character ${chosen.characterId}`}</div>
                <div className="num muted fighter-sub">
                  #{chosen.characterId} · {chosen.state}
                  {chosen.arena ? ` · ${chosen.arena.displayName}` : ""}
                  {chosen.reason ? ` · ${chosen.reason}` : ""}
                </div>
              </div>
            </div>

            {menuError && (
              <p className="num window-state" data-tone="bad">
                {menuError}
              </p>
            )}

            <div className="plan-head">
              <span className="arm-label muted">
                The plan
                {/* The count comes from the canon. With nothing published there
                    is no denominator to print, so none is printed. */}
                {sequenceLength !== null ? ` — ${picks.length} of ${sequenceLength}` : ""}
              </span>
              <span className="plan-head-actions">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={idle || !menu || sequenceLength === null}
                  title="Fill every slot at random. Not the arena's draw — see the note below."
                  onClick={drawRandom}
                >
                  <Icon name="rotate-cw" size={12} />
                  Draw at random
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={idle || picks.length === 0}
                  onClick={() => setPicks([])}
                >
                  <Icon name="x-mark" size={12} />
                  Clear
                </button>
              </span>
            </div>

            <SequenceBuilder
              menu={menu}
              picks={picks}
              capacity={sequenceLength}
              disabled={idle}
              onPick={(index) => setPicks([...picks, index])}
              onClear={(slot) => setPicks(picks.filter((_, i) => i !== slot))}
              onReorder={(from, to) =>
                setPicks((prev) => {
                  const next = [...prev];
                  const [moved] = next.splice(from, 1);
                  next.splice(to, 0, moved);
                  return next;
                })
              }
              emptyHint="No plan yet. Pick from the menu below, in the order they should be attempted. Drag a row to reorder it."
            />

            <p className="field-hint">
              Order is exchange order — drag a row, or use its arrows.{" "}
              {sequenceLength === null
                ? "The arena decides how many a sequence takes and refuses the rest."
                : "“Draw at random” is a shortcut in your browser, not the arena's fill: a slot you leave empty is dealt from the match id and recorded, and nothing here can predict it."}
            </p>

            {/* ── Saved combos ─────────────────────────────────────────────── */}
            {menu && (
              <div className="combos">
                <div className="picker-row">
                  <input
                    className="num picker-char combo-name"
                    placeholder="name this combo"
                    value={comboName}
                    disabled={idle || picks.length === 0}
                    aria-label="Name for the current plan"
                    maxLength={60}
                    onChange={(e) => setComboName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={idle || picks.length === 0 || !comboName.trim()}
                    onClick={saveCurrentAsCombo}
                  >
                    <Icon name="download" size={12} />
                    Save combo
                  </button>
                </div>

                {combos.length > 0 && (
                  <ul className="combo-list" aria-label="Saved combos">
                    {combos.map((combo) => (
                      <li key={combo.name} className="combo">
                        <button
                          type="button"
                          className="combo-use"
                          disabled={idle}
                          title={`Fill the plan with ${combo.actionIds.length} saved actions`}
                          onClick={() => applySavedCombo(combo)}
                        >
                          <span className="combo-title ellipsis">{combo.name}</span>
                          <span className="num combo-count muted">{combo.actionIds.length}</span>
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Delete combo ${combo.name}`}
                          disabled={idle}
                          onClick={() => writeCombos(removeCombo(combos, combo.name))}
                        >
                          <Icon name="x-mark" size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {comboNote && <p className="field-hint" data-tone="warn">{comboNote}</p>}

                <p className="field-hint">
                  {/*
                    Saying what a combo IS, because the obvious reading is wrong
                    in a way that costs a fight. It stores actions, not the five
                    integers — those are positions in one fighter's menu, and the
                    same five integers on another fighter are five different
                    moves, submitted successfully, with no sign of trouble until
                    the verdict.
                  */}
                  Combos are stored in this browser as actions, not as positions — a menu follows
                  the genome, so applying one to a different fighter fills only what that fighter
                  can actually do. Nothing is sent anywhere, and nothing is committed until you
                  submit.
                </p>
              </div>
            )}

            {/* ── The types, counted ───────────────────────────────────────── */}
            {menu && (
              <div className="legend">
                <button
                  type="button"
                  className="icon-btn"
                  aria-expanded={legendOpen}
                  onClick={() => setLegendOpen((prev) => !prev)}
                >
                  <Icon name={legendOpen ? "chevron-up" : "chevron-down"} size={12} />
                  Type mix
                </button>

                {legendOpen && (
                  <div className="legend-body">
                    <div className="legend-row">
                      <span className="legend-label muted">This menu</span>
                      {tally(menu.map((a) => a.type)).map(([type, n]) => (
                        <span key={type} className="type-tag" data-type={type}>
                          {n}× {type}
                        </span>
                      ))}
                    </div>
                    {picks.length > 0 && (
                      <div className="legend-row">
                        <span className="legend-label muted">Your plan</span>
                        {tally(
                          picks
                            .map((i) => menu.find((a) => a.index === i)?.type)
                            .filter((t): t is string => Boolean(t)),
                        ).map(([type, n]) => (
                          <span key={type} className="type-tag" data-type={type}>
                            {n}× {type}
                          </span>
                        ))}
                      </div>
                    )}
                    {/*
                      Counts, and nothing else.

                      There is no matchup table here and there must not be one.
                      A "strike answers bind for +6" chart exists on
                      dethrone.bot/simulator, where it is fenced by a test, kept
                      out of `lib/game/` and labelled DEMONSTRATION ONLY in the
                      page's own words — because the arena has no counter wheel,
                      scores no type against another, and sells the panel's
                      opinion rather than previewing it. Printing invented
                      arithmetic on the surface that spends USDC is how an
                      operator comes to believe they saw a verdict coming.

                      What is true and useful is the shape of what you hold: a
                      genome fixes the mix, so a menu heavy in one type is a fact
                      about this fighter worth reading before you plan — and
                      worth reading about your OPPONENT, which is what
                      `legal_actions` on their character id is for.
                    */}
                    <p className="field-hint">
                      A genome fixes the mix, so this is a fact about the fighter rather than a
                      strategy. The arena scores no type against another and publishes no matchup
                      table — nothing here previews a verdict.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Arming: fills the command pane, settles nothing ─────────── */}
            <div className="arm-row">
              <span className="arm-label muted">Enter this fighter:</span>
              <button
                type="button"
                className="icon-btn"
                disabled={idle || !(capabilities.challenge?.enabled ?? true)}
                onClick={() => onArm("challenge", { characterId: String(chosen.characterId) })}
              >
                <Icon name="crown" size={13} />
                Challenge the throne
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={idle || !(capabilities.post_duel?.enabled ?? true)}
                onClick={() =>
                  onArm("post_duel", {
                    characterId: String(chosen.characterId),
                    arenaSlug: chosen.arena?.slug ?? "",
                  })
                }
              >
                <Icon name="swords" size={13} />
                Post a duel
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={idle || !(capabilities.take_duel?.enabled ?? true)}
                onClick={() => onArm("take_duel", { characterId: String(chosen.characterId) })}
              >
                <Icon name="coins" size={13} />
                Take a duel
              </button>
            </div>
            <p className="field-hint">
              These fill the command pane and stop. Nothing here settles an amount — the Run
              button does, and it is the only one that can.
            </p>
          </div>
        )}

        {/* ── The window ──────────────────────────────────────────────────── */}
        {chosen && (
          <div className="watch-box">
            <div className="picker-row">
              <input
                className="num picker-char"
                placeholder="match id"
                value={matchIdField}
                disabled={idle}
                aria-label="Match id to watch for a selection window"
                onChange={(e) => setMatchIdField(e.target.value)}
              />
              <button
                type="button"
                className="icon-btn"
                disabled={idle || !matchIdField.trim()}
                onClick={() => {
                  setSubmitNote(null);
                  setWatch({
                    matchId: matchIdField.trim(),
                    selection: null,
                    readAt: null,
                    quiet: 0,
                    polling: true,
                  });
                }}
              >
                <Icon name="hourglass" size={13} />
                Watch for the window
              </button>
            </div>

            {watch && (
              <>
                <div className="window-state">
                  {watch.selection ? (
                    <>
                      <span className="num">closes {stamp(watch.selection.closesAt)}</span>
                      <span className="muted">
                        {" "}
                        · challenger{" "}
                        {watch.selection.submitted.challenger ? "submitted" : "not yet"} · throne{" "}
                        {watch.selection.submitted.throne ? "submitted" : "not yet"}
                      </span>
                    </>
                  ) : (
                    <span className="muted">
                      {watch.polling
                        ? "No window open on this match yet."
                        : "Stopped asking. Nothing had opened by the last read."}
                    </span>
                  )}
                  {watch.readAt && <span className="muted"> · read {stamp(watch.readAt)}</span>}
                </div>

                <div className="picker-row">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={idle || !watch.selection || picks.length === 0}
                    onClick={() => void submit()}
                  >
                    <Icon name="shield-check" size={13} />
                    Submit the plan
                  </button>
                  {!watch.polling && (
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={idle}
                      onClick={() =>
                        setWatch((prev) => (prev ? { ...prev, quiet: 0, polling: true } : prev))
                      }
                    >
                      <Icon name="rotate-cw" size={13} />
                      Keep watching
                    </button>
                  )}
                  {submitNote && <span className="num window-state">{submitNote}</span>}
                </div>

                <p className="field-hint">
                  A challenge that finds the throne empty seats you instead, and answers with no
                  match id — there is no window to wait for, and nothing to submit. Which side you
                  are is decided by the seat, never by this panel, and a submission cannot be
                  revised.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
