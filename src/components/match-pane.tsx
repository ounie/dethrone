"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Icon from "./icon";
import Panel, { type PanelDrag } from "./panel";
import Time from "./time";
import {
  clock,
  readMatch,
  secondsUntil,
  type MatchAction,
  type MatchSide,
  type MatchView,
} from "@/lib/match-view";
import { buildTimeline, finalFrame, initialFrame, type Frame, type Side } from "@/lib/match-play";
import { createMatchSound, type MatchSound } from "@/lib/match-audio";
import { crestFor, readHouses, type House } from "@/lib/houses";
import {
  MATCH_FILTERS,
  filterRows,
  page,
  readMatchRows,
  type MatchFilter,
  type MatchRow,
} from "@/lib/match-list";
import {
  autoplayEnabled,
  autoplaySnapshot,
  serverFalse,
  soundSnapshot,
  subscribeMatchPrefs,
  writeAutoplay,
  writeSound,
} from "@/lib/match-prefs";

/**
 * The match, played back — the judge panel the arena's own match page shows,
 * with the same choreography and the same synthesised sound.
 *
 * ## It renders an answer. It never computes one.
 *
 * Everything here is a field the arena published: the two sequences, the
 * per-coin `winnerRole`, the `tally`, the verdict's own sentence. The playback
 * reveals them in order; it does not decide them. `match-view.ts` carries that
 * argument, and `match-play.ts` holds the choreography as a LIST OF STEPS rather
 * than a function full of awaits — so the ordering can be asserted in a test
 * instead of watched for nine seconds.
 *
 * ## The reels need the menu, and the menu is a second read
 *
 * A reel spins through the fighter's whole menu and stops on the entry that was
 * played, so it needs `legal_actions` per side — free, and a pure function of a
 * public genome. Without it the reel still lands on the right action; it just
 * cannot show the moves that were NOT chosen, which is most of the drama. A
 * failed menu read therefore degrades the animation and never blocks it.
 *
 * ## The countdown
 *
 * `fighters-pane.tsx` refuses one because a countdown is the window rule
 * reimplemented in a browser. That objection stands and this does not breach it:
 * the arena publishes `closesAt`, this prints the difference from the local
 * clock, it says which clock that is, **and nothing is gated on the result.**
 *
 * ## It cannot spend
 *
 * Four reads — `match`, `matches`, `pool`, `legal_actions` — every one priced at
 * zero by the catalogue. No arm button, no path to a paid command.
 */

async function act(id: string, args: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, args }),
  });
  return (await res.json()) as Record<string, unknown>;
}

function codeOf(data: Record<string, unknown>, fallback: string): string {
  const body = data.body as { error?: { code?: string } } | undefined;
  const err = data.error as { code?: string } | undefined;
  return body?.error?.code ?? err?.code ?? fallback;
}

function bodyOf(data: Record<string, unknown>): Record<string, unknown> | undefined {
  return data.body as Record<string, unknown> | undefined;
}

/**
 * The medallion, from the arena's own brand assets — three of them.
 *
 * Silver while it is in the air, and the winner's face once it lands, which is
 * how the arena's own page does it: the coin does not merely stop, it *becomes*
 * whose it is. Rendering one image for all three states would drop the single
 * most legible signal in the whole animation.
 *
 * `<img>` against a public path on the arena, exactly as the fighter portraits
 * already are. The console never composes an asset path of its own.
 */
const MEDALLION = {
  spinning: "https://dethrone.bot/brand/medallion-silver.webp",
  THRONE: "https://dethrone.bot/brand/medallion-throne.webp",
  CHALLENGER: "https://dethrone.bot/brand/medallion-challenger.webp",
} as const;

/** The face to show: the winner's once landed, silver in every other state. */
function medallionFor(kind: string, role: string | null | undefined): string {
  if (kind === "landed" && (role === "THRONE" || role === "CHALLENGER")) return MEDALLION[role];
  return MEDALLION.spinning;
}

type Tab = "match" | "history";

/**
 * A portrait, and only a portrait.
 *
 * The name lives outside the board row on purpose: the row is five columns
 * across — portrait, action, medallion, action, portrait — and a name inside a
 * 96px column has to be truncated or wrapped to three lines. Below the row it
 * gets the width of the whole half and can be set at display size, which is
 * where the arena's own page puts it too.
 */
function Portrait({
  side,
  align,
  crest,
}: {
  side: MatchSide;
  align: Side;
  crest: "won" | "lost" | null;
}) {
  return (
    <div className="match-portrait-frame" data-align={align} data-crest={crest ?? undefined}>
      {side.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="match-portrait" src={side.imageUrl} alt={side.name ?? "Fighter"} />
      ) : (
        <div className="match-portrait match-portrait-empty" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * The name band under the board: challenger left, throne right.
 *
 * The House is rendered as its NAME and its crest, never as the slug it arrives
 * as. "ash-stadium" is an identifier; "House Cindermark" is what the arena calls
 * it everywhere a person reads it, and the masthead already sets that precedent
 * one card up.
 *
 * A slug with no House known falls back to the slug itself rather than to
 * nothing — an unrecognised House is still a fact about the fighter, and hiding
 * it would be worse than printing an identifier.
 */
function Names({
  challenger,
  throne,
  houses,
}: {
  challenger: MatchSide;
  throne: MatchSide;
  houses: Map<string, House>;
}) {
  return (
    <div className="match-names">
      {([challenger, throne] as const).map((side, i) => {
        const house = side.houseSlug ? (houses.get(side.houseSlug) ?? null) : null;
        const crest = crestFor(side.houseSlug);
        return (
        <div className="match-name-block" key={i} data-align={i === 0 ? "CHALLENGER" : "THRONE"}>
          <span className="match-name display">{side.name ?? "—"}</span>
          {side.houseSlug && (
            <span className="match-house" title={house?.words ?? undefined}>
              {crest && (
                // A plain <img>: these crests carry a real alpha channel and
                // Next's optimizer flattens it. Decorative, because the House is
                // named in the text beside it.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="match-crest" src={crest} alt="" aria-hidden="true" width={16} height={16} />
              )}
              <span className="muted">{house?.name ?? side.houseSlug}</span>
            </span>
          )}
          {side.dq && (
            <span className="match-dq" data-tone="warn">
              DQ{side.dqReason ? ` · ${side.dqReason}` : ""}
            </span>
          )}
        </div>
        );
      })}
    </div>
  );
}

/**
 * One reel.
 *
 * Spinning, it cycles the fighter's menu; locked, it shows the entry that was
 * played. The `key` on the strip restarts the CSS animation for a fresh spin —
 * without it React reuses the element and the second exchange never moves.
 */
function Reel({
  menu,
  state,
  fallback,
}: {
  menu: readonly MatchAction[];
  state: Frame["reels"][Side];
  fallback: MatchAction | null;
}) {
  const landed = menu[state.target] ?? fallback;

  if (state.spinning && menu.length > 1) {
    return (
      <div className="match-action match-reel" data-spinning="true">
        <div
          key={state.key}
          className="match-reel-strip"
          style={{ animationDuration: `${state.seconds}s` }}
        >
          {/* Doubled so the strip can travel a whole cycle and still look seamless. */}
          {[...menu, ...menu].map((a, i) => (
            <span className="match-reel-cell" key={`${a.id}-${i}`}>
              {a.text}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (!landed) return <div className="match-action match-action-empty" aria-hidden="true" />;

  return (
    <div
      className="match-action"
      data-lit={state.fate === "won" ? "true" : undefined}
      data-fate={state.fate ?? undefined}
    >
      <span className="match-action-text">{landed.text}</span>
      <span className="type-tag" data-type={landed.type}>
        {landed.type}
      </span>
    </div>
  );
}

export default function MatchPane({
  matchId,
  operator,
  drag,
  disabled,
}: {
  matchId: string | null;
  /** The address currently signing, for the `Mine` filter. Null read-only. */
  operator: string | null;
  drag?: PanelDrag;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("match");
  const [field, setField] = useState("");
  const [match, setMatch] = useState<MatchView | null>(null);
  const [menus, setMenus] = useState<Record<Side, MatchAction[]>>({ CHALLENGER: [], THRONE: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  /** Slug → House. Eight rows, read once, so a slug never reaches the screen. */
  const [houses, setHouses] = useState<Map<string, House>>(() => new Map());

  const [rows, setRows] = useState<MatchRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadedHistory, setLoadedHistory] = useState(false);
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [pageIndex, setPageIndex] = useState(0);

  const [frame, setFrame] = useState<Frame | null>(null);
  const [running, setRunning] = useState(false);

  const autoplay = useSyncExternalStore(subscribeMatchPrefs, autoplaySnapshot, serverFalse);
  const sound = useSyncExternalStore(subscribeMatchPrefs, soundSnapshot, serverFalse);

  /** Built on the first playback and reused. A context made off-gesture is suspended. */
  const soundRef = useRef<MatchSound | null>(null);
  /** Bumped per run, so a superseded playback can tell and abandon itself. */
  const runId = useRef(0);

  const loadMenus = useCallback(async (view: MatchView) => {
    const sides: [Side, number | null][] = [
      ["CHALLENGER", view.challenger.characterId],
      ["THRONE", view.throne.characterId],
    ];
    const next: Record<Side, MatchAction[]> = { CHALLENGER: [], THRONE: [] };
    await Promise.all(
      sides.map(async ([role, id]) => {
        if (id === null) return;
        try {
          const data = await act("legal_actions", { id: String(id) });
          const body = bodyOf(data) as { actions?: unknown } | undefined;
          const list = Array.isArray(body?.actions) ? body.actions : [];
          next[role] = list
            .map((a) => (a ?? {}) as Record<string, unknown>)
            .filter((a) => typeof a.text === "string")
            .map((a) => ({
              id: typeof a.id === "string" ? a.id : "",
              text: a.text as string,
              type: typeof a.type === "string" ? a.type : "",
            }));
        } catch {
          // A menu that will not load costs the reel its depth and nothing else.
        }
      }),
    );
    setMenus(next);
  }, []);

  const load = useCallback(
    async (id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      setBusy(true);
      setError(null);
      runId.current += 1;
      setRunning(false);
      try {
        const data = await act("match", { id: trimmed });
        const view = readMatch(bodyOf(data) ?? null);
        if (!view) {
          setMatch(null);
          setFrame(null);
          setError(codeOf(data, "NO_MATCH"));
          return;
        }
        setMatch(view);
        setField(view.matchId ?? trimmed);
        setReadAt(new Date().toISOString());
        setMenus({ CHALLENGER: [], THRONE: [] });
        setTab("match");
        /*
          Rest on the FINISHED frame, exactly as the arena's own page does: the
          result is visible immediately and the playback is a replay, not a gate
          on seeing it. Auto-play decides only whether that replay starts by
          itself — never whether the operator can see who won.
        */
        setFrame(
          view.verdict
            ? finalFrame(view.exchanges, view.actionIds, view.verdict.winner)
            : initialFrame(view.exchanges),
        );
        void loadMenus(view);
        // Eight rows, and only once: the names do not change while a card is open.
        if (houses.size === 0) {
          void act("houses", {}).then((h) => setHouses(readHouses(bodyOf(h) ?? null))).catch(() => {});
        }
        if (view.verdict && view.exchanges.length > 0 && autoplayEnabled()) setRunning(true);
      } catch {
        setError("CONSOLE_TRANSPORT");
      } finally {
        setBusy(false);
      }
    },
    [loadMenus, houses.size],
  );

  const loadHistory = useCallback(async (which: MatchFilter) => {
    setBusy(true);
    setHistoryError(null);
    setLoadedHistory(true);
    try {
      // Two sources, because throne matches and duels are two routes. `mine` is
      // a predicate over whichever rows are loaded, not a third endpoint.
      const [throne, duels] = await Promise.all([
        which !== "duel" ? act("matches", {}) : Promise.resolve(null),
        which !== "throne" ? act("pool", {}) : Promise.resolve(null),
      ]);
      const next: MatchRow[] = [];
      if (throne) next.push(...readMatchRows(bodyOf(throne) ?? null, "throne"));
      if (duels) next.push(...readMatchRows(bodyOf(duels) ?? null, "duel"));
      if (next.length === 0 && throne) setHistoryError(codeOf(throne, "NO_MATCHES"));
      setRows(next);
    } catch {
      setHistoryError("CONSOLE_TRANSPORT");
    } finally {
      setBusy(false);
    }
  }, []);

  /*
    Open what the console already knows about, and otherwise the latest match.

    `matchId` is the seat's live match or the one just read. With neither, the
    card asks the arena for its newest rather than rendering an empty prompt —
    which is the "show the latest match" behaviour, done by reading the list the
    arena publishes instead of guessing at an id.
  */
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    if (matchId && matchId !== lastOpened.current) {
      lastOpened.current = matchId;
      void load(matchId);
      return;
    }
    if (matchId || lastOpened.current !== null) return;
    lastOpened.current = "";
    void (async () => {
      const data = await act("matches", {});
      const first = readMatchRows(bodyOf(data) ?? null, "throne")[0];
      if (first) void load(first.id);
    })();
  }, [matchId, load]);

  /*
    The playback.

    One effect owns a whole run: it walks the step list, applies each frame and
    fires each cue, and checks its own run id between steps — so a reload, a
    skip, or a second press abandons it rather than interleaving two verdicts.
  */
  useEffect(() => {
    if (!running || !match?.verdict) return;
    const id = ++runId.current;
    const steps = buildTimeline(match.exchanges, match.actionIds, match.verdict.winner);
    soundRef.current ??= createMatchSound();
    const engine = soundRef.current;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    void (async () => {
      // Yield once before the first frame. Setting state synchronously inside an
      // effect is the cascading render `react-hooks/set-state-in-effect` catches,
      // and the whole run is a sequence of timed frames anyway — one more tick
      // before the first costs nothing.
      await new Promise<void>((resolve) => {
        timers.push(setTimeout(resolve, 0));
      });
      if (cancelled || runId.current !== id) return;
      let current = initialFrame(match.exchanges);
      setFrame(current);
      for (const step of steps) {
        if (cancelled || runId.current !== id) return;
        current = step.apply(current);
        setFrame(current);
        if (step.cue) {
          // Re-read per cue: a mute that waits for the verdict to end is not a mute.
          engine.setMuted(!soundSnapshot());
          const cue = step.cue;
          if (cue.sound === "tick") engine.tick(cue.frequency);
          else if (cue.sound === "action") engine.action(cue.type);
          else if (cue.sound === "reelSpin") engine.reelSpin(cue.seconds);
          else if (cue.sound === "coinSpin") engine.coinSpin(cue.seconds);
          else if (cue.sound === "coinLand") engine.coinLand(cue.role);
          else if (cue.sound === "finale") engine.finale(cue.winner);
          else engine[cue.sound]();
        }
        if (step.hold > 0) {
          await new Promise<void>((resolve) => {
            timers.push(setTimeout(resolve, step.hold));
          });
        }
      }
      if (!cancelled && runId.current === id) setRunning(false);
    })();

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [running, match]);

  const closesAt = match?.selection?.closesAt ?? null;
  useEffect(() => {
    if (!closesAt) return;
    // Both asynchronous: setting state synchronously inside an effect is the
    // cascading render `react-hooks/set-state-in-effect` exists to catch.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [closesAt]);

  const remaining = now === null || !closesAt ? null : secondsUntil(closesAt, now);
  const judged = !!match?.verdict;
  const exchanges = match?.exchanges ?? [];
  const view = frame ?? initialFrame(exchanges);
  const idle = busy || disabled;
  const visible = filterRows(rows, filter, operator);
  const paged = page(visible, pageIndex);

  /*
    Which exchange the board is showing.

    The active one while a verdict is running; otherwise the last one that has
    landed, which is what a finished match rests on. `pips` is the single source
    for this — it is already the frame's record of what has been revealed, and a
    second index tracked alongside it would be a second answer to the same
    question.
  */
  const activeIndex = view.pips.findIndex((p) => p === "active");
  const settledCount = view.pips.filter((p) => p !== null && p !== "active").length;
  const shownIndex = activeIndex >= 0 ? activeIndex : Math.max(0, settledCount - 1);
  const shown = exchanges[shownIndex] ?? null;
  const mark = view.pips[shownIndex] ?? null;
  const live = mark === "active";
  const decided = mark !== null && mark !== "active";
  const medallionKind = live ? view.medallion.kind : decided ? "landed" : "idle";
  const medallionRole = decided ? (mark as string) : view.medallion.role;

  const skip = useCallback(() => {
    runId.current += 1;
    setRunning(false);
    if (match?.verdict) setFrame(finalFrame(match.exchanges, match.actionIds, match.verdict.winner));
  }, [match]);

  return (
    <Panel
      drag={drag}
      icon="swords"
      title="Match"
      actions={
        <>
          <button
            type="button"
            className="icon-btn"
            aria-pressed={sound}
            title={sound ? "Sound is on." : "Sound is off."}
            onClick={() => writeSound(!sound)}
          >
            <Icon name={sound ? "message-square" : "lock"} size={12} />
            Sound {sound ? "on" : "off"}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-pressed={autoplay}
            title={
              autoplay
                ? "Auto-play is on: a judged match runs as soon as it opens."
                : "Auto-play is off: a match opens on its result and waits."
            }
            onClick={() => writeAutoplay(!autoplay)}
          >
            <Icon name="hourglass" size={12} />
            Auto {autoplay ? "on" : "off"}
          </button>
        </>
      }
    >
      <div className="match-body">
      <div className="match-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="match-tab"
          aria-selected={tab === "match"}
          data-active={tab === "match" ? "true" : undefined}
          onClick={() => setTab("match")}
        >
          Match
        </button>
        <button
          type="button"
          role="tab"
          className="match-tab"
          aria-selected={tab === "history"}
          data-active={tab === "history" ? "true" : undefined}
          onClick={() => {
            // Fetched on the press rather than in an effect watching the tab: a
            // click is a gesture, and an effect that fires a read would be the
            // cascading render the lint rule exists to catch.
            setTab("history");
            if (!loadedHistory) void loadHistory(filter);
          }}
        >
          Match history
        </button>
      </div>

      {tab === "match" && (
        <>
          <div className="picker-row match-open">
            <input
              className="num match-id-input"
              placeholder="match id"
              value={field}
              disabled={idle}
              aria-label="Match id"
              onChange={(e) => setField(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load(field);
              }}
            />
            <button
              type="button"
              className="icon-btn"
              disabled={idle || !field.trim()}
              onClick={() => void load(field)}
            >
              <Icon name="compass" size={12} />
              Open
            </button>
            {match && (
              <button
                type="button"
                className="icon-btn"
                disabled={idle}
                title="Ask the arena again."
                onClick={() => void load(match.matchId ?? field)}
              >
                <Icon name="rotate-cw" size={12} />
                Re-read
              </button>
            )}
          </div>

          {error && (
            <p className="field-hint" data-tone="warn">
              {error}
            </p>
          )}

          {!match && !error && <p className="pane-body empty small">Opening the latest match…</p>}

          {match && (
            <div className="match" data-entered={view.entered ? "true" : undefined}>
              <div className="match-meta">
                {match.mode && <span className="eyebrow">{match.mode}</span>}
                {match.arena && <span className="muted">{match.arena}</span>}
                {match.verdict?.rubricVersion && (
                  <span className="num muted">{match.verdict.rubricVersion}</span>
                )}
                {exchanges.length > 0 && (
                  <span className="num muted">best of {exchanges.length}</span>
                )}
                {view.label && (
                  <span
                    className="num match-label"
                    data-point={view.matchPoint ? "true" : undefined}
                  >
                    {view.label}
                  </span>
                )}
              </div>

              {match.selection && (
                <div className="match-window">
                  <span className="eyebrow" data-tone="warn">
                    Selection window
                  </span>
                  {remaining !== null && (
                    <span
                      className="num match-clock"
                      data-tone={remaining === 0 ? "warn" : undefined}
                    >
                      {clock(remaining)}
                    </span>
                  )}
                  <span className="muted match-clock-note">
                    by this browser&rsquo;s clock · closes{" "}
                    {match.selection.closesAt ? <Time iso={match.selection.closesAt} /> : "—"}
                  </span>
                  <span className="muted">
                    challenger {match.selection.submittedChallenger ? "submitted" : "not yet"} ·
                    throne {match.selection.submittedThrone ? "submitted" : "not yet"}
                  </span>
                </div>
              )}

              {/*
                ONE exchange on screen, never five.

                The five are represented by the coins below; the board shows the
                exchange being fought. Stacking all five turns a fight into a
                table — the arena's own page shows a single pair facing each
                other and lets the medallion carry the beat, and the whole point
                of the reels is that you watch one land.

                At rest it holds the LAST exchange, which is what a finished
                match looks like on the arena's page: the final blow, with the
                verdict under it.
              */}
              <div className="match-board" data-lunge={view.lunge ? "true" : undefined}>
                <Portrait
                  side={match.challenger}
                  align="CHALLENGER"
                  crest={view.crests.CHALLENGER}
                />
                <Reel
                  menu={live ? menus.CHALLENGER : []}
                  state={
                    live
                      ? view.reels.CHALLENGER
                      : {
                          ...view.reels.CHALLENGER,
                          spinning: false,
                          fate: decided ? (mark === "CHALLENGER" ? "won" : "lost") : null,
                        }
                  }
                  fallback={shown?.challenger ?? null}
                />
                <div
                  className="match-medallion"
                  data-kind={medallionKind}
                  data-role={medallionRole ?? undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={medallionFor(medallionKind, medallionRole)} alt="" width={64} height={64} />
                </div>
                <Reel
                  menu={live ? menus.THRONE : []}
                  state={
                    live
                      ? view.reels.THRONE
                      : {
                          ...view.reels.THRONE,
                          spinning: false,
                          fate: decided ? (mark === "THRONE" ? "won" : "lost") : null,
                        }
                  }
                  fallback={shown?.throne ?? null}
                />
                <Portrait side={match.throne} align="THRONE" crest={view.crests.THRONE} />
              </div>

              <Names challenger={match.challenger} throne={match.throne} houses={houses} />

              {exchanges.length === 0 && (
                <p className="pane-body empty small">
                  No sequences published for this match yet.
                </p>
              )}

              {exchanges.length > 0 && (
                <div className="match-coins" aria-label="Coins">
                  {exchanges.map((e) => {
                    const pip = view.pips[e.index];
                    return (
                      <span
                        key={e.index}
                        className="match-pip"
                        data-state={pip ?? undefined}
                        data-won={pip && pip !== "active" ? pip : undefined}
                        title={e.oneLine ?? ""}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={medallionFor(
                            pip && pip !== "active" ? "landed" : "idle",
                            pip && pip !== "active" ? pip : null,
                          )}
                          alt=""
                          width={26}
                          height={26}
                        />
                      </span>
                    );
                  })}
                </div>
              )}

              {exchanges.length > 0 && (
                <p className="num match-score">
                  <span data-lead={view.score.CHALLENGER > view.score.THRONE ? "true" : undefined}>
                    challenger {view.score.CHALLENGER}
                  </span>
                  {" — "}
                  <span data-lead={view.score.THRONE > view.score.CHALLENGER ? "true" : undefined}>
                    {view.score.THRONE} throne
                  </span>
                </p>
              )}

              {view.banner && match.verdict && (
                <div className="match-verdict">
                  <p className="display match-verdict-line">
                    {match.verdict.winner === "THRONE"
                      ? "The throne holds"
                      : match.verdict.winner === "CHALLENGER"
                        ? "The throne falls"
                        : (match.verdict.winner ?? "—")}
                  </p>
                  {match.verdict.oneLine && <p className="muted">{match.verdict.oneLine}</p>}
                  <p className="num match-sealed">
                    {exchanges.length} coins · {match.verdict.rubricVersion ?? "—"} · sealed until
                    this verdict
                  </p>
                  <p className="field-hint">
                    {match.verdict.judgeModel && <>judge {match.verdict.judgeModel} · </>}
                    sequences {match.source.challenger ?? "—"} / {match.source.throne ?? "—"}
                    {match.endedAt && (
                      <>
                        {" · ended "}
                        <Time iso={match.endedAt} />
                      </>
                    )}
                  </p>
                </div>
              )}

              <div className="picker-row">
                <button
                  type="button"
                  className="run"
                  disabled={idle || !judged || exchanges.length === 0 || running}
                  title={
                    judged
                      ? "Reveal the exchanges in order, as the judges took them."
                      : "The arena has not judged this match yet."
                  }
                  onClick={() => setRunning(true)}
                >
                  <Icon name="swords" size={13} />
                  {running ? "Running" : "Run the verdict"}
                </button>
                {running && (
                  <button type="button" className="icon-btn" onClick={skip}>
                    <Icon name="chevron-down" size={12} />
                    Skip
                  </button>
                )}
              </div>

              {!judged && (
                <p className="field-hint">
                  Not judged yet. The exchanges appear when the arena publishes them — re-read to
                  ask again. Nothing on this card polls on its own.
                </p>
              )}

              {readAt && (
                <p className="field-hint">
                  read <Time iso={readAt} />
                </p>
              )}
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <div className="match-history">
          <div className="match-filters" role="group" aria-label="Filter matches">
            {MATCH_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="match-filter"
                data-active={filter === f.id ? "true" : undefined}
                aria-pressed={filter === f.id}
                disabled={idle}
                title={
                  f.id === "mine" && !operator
                    ? "This deploy holds no key, so no match is yours."
                    : undefined
                }
                onClick={() => {
                  setFilter(f.id);
                  setPageIndex(0);
                  void loadHistory(f.id);
                }}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              className="icon-btn"
              disabled={idle}
              onClick={() => void loadHistory(filter)}
            >
              <Icon name="rotate-cw" size={12} />
              Re-read
            </button>
          </div>

          {historyError && (
            <p className="field-hint" data-tone="warn">
              {historyError}
            </p>
          )}

          {paged.rows.length === 0 && !historyError && (
            <p className="pane-body empty small">
              {filter === "mine" && !operator
                ? "This deploy holds no key, so no match is yours."
                : "Nothing to show for this filter."}
            </p>
          )}

          {paged.rows.length > 0 && (
            <ul className="match-rows">
              {paged.rows.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    className="match-row"
                    disabled={idle}
                    onClick={() => {
                      setTab("match");
                      void load(r.id);
                    }}
                  >
                    <span className="eyebrow match-row-kind">{r.kind}</span>
                    <span className="num match-row-id ellipsis">{r.id}</span>
                    <span className="match-row-parties ellipsis muted">
                      {r.challengerName ?? "—"} vs {r.championName ?? "—"}
                    </span>
                    {r.outcome && <span className="num match-row-outcome">{r.outcome}</span>}
                    {r.endedAt && (
                      <span className="num muted match-row-when">
                        <Time iso={r.endedAt} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {visible.length > 0 && (
            <div className="match-pager">
              <button
                type="button"
                className="icon-btn"
                disabled={idle || paged.index === 0}
                onClick={() => setPageIndex(paged.index - 1)}
              >
                <Icon name="chevron-up" size={12} />
                Newer
              </button>
              <span className="num muted">
                {paged.index + 1} / {paged.count} · {visible.length} shown
              </span>
              <button
                type="button"
                className="icon-btn"
                disabled={idle || paged.index >= paged.count - 1}
                onClick={() => setPageIndex(paged.index + 1)}
              >
                <Icon name="chevron-down" size={12} />
                Older
              </button>
            </div>
          )}

          {/*
            Said plainly, because a pager usually implies a server with more
            behind it. The arena's list route takes no limit, offset or cursor —
            measured, not assumed — so these pages are over the rows it already
            sent and there is no page two to ask for.
          */}
          <p className="field-hint">
            These pages are over the rows the arena returned; its list route takes no cursor, so
            there is no further page to request. Throne matches and duels are two different reads.
          </p>
        </div>
      )}
      </div>
    </Panel>
  );
}
