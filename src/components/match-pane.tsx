"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Icon from "./icon";
import MatchEvidence from "./match-evidence";
import Panel, { type PanelDrag } from "./panel";
import Time from "./time";
import {
  clock,
  readMatch,
  secondsUntil,
  type MatchAction,
  type ExchangeContest,
  type MatchSide,
  type MatchView,
} from "@/lib/match-view";
import { buildTimeline, finalFrame, initialFrame, type Frame, type Side } from "@/lib/match-play";
import { createMatchSound, type MatchSound } from "@/lib/match-audio";
import { MATCH_PANE } from "@/lib/reveal";
import { crestFor, readHouses, type House } from "@/lib/houses";
import {
  MATCH_FILTERS,
  filterRows,
  page,
  readMatchRows,
  type MatchFilter,
  type MatchRow,
} from "@/lib/match-list";
import type { ArenaChoice } from "@/lib/capability";
import {
  autoplayEnabled,
  autoplaySnapshot,
  serverFalse,
  serverSound,
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
/**
 * The follow cadence, and where it gives up.
 *
 * Fast while the match is in `verdict` — the selection window is counting down
 * or the panel is sitting, and both end in something worth seeing within
 * seconds. Slow otherwise: a queued match can sit for a long time and nothing
 * about it changes minute to minute.
 *
 * `FOLLOW_READS_MAX` is `fighters-pane.tsx`'s `QUIET_READS_BEFORE_PAUSE` rule
 * with a longer leash — 120 reads is about fourteen minutes at the fast
 * cadence and an hour at the slow one, which covers a panel sitting and then
 * stops rather than polling a forgotten tab all night.
 */
const FOLLOW_FAST_MS = 7_000;
const FOLLOW_SLOW_MS = 30_000;
const FOLLOW_READS_MAX = 120;

const MEDALLION = {
  spinning: "https://dethrone.bot/brand/medallion-silver.webp",
  // The CROWN is the seat's face on every surface a coin winner shows — the
  // arena retired its `medallion-throne` art with the evidence panel.
  THRONE: "https://dethrone.bot/brand/medallion-crown.webp",
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
  baseUrl,
}: {
  side: MatchSide;
  align: Side;
  crest: "won" | "lost" | null;
  baseUrl: string;
}) {
  const face = side.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="match-portrait" src={side.imageUrl} alt={side.name ?? "Fighter"} />
  ) : (
    <div className="match-portrait match-portrait-empty" aria-hidden="true" />
  );

  return (
    <div className="match-portrait-frame" data-align={align} data-crest={crest ?? undefined}>
      {/*
        The portrait opens the fighter, when there is a fighter to open.

        Gated on `characterId` rather than rendered always: the arena answers
        `/character/{id}` for any id, so a link built without one would be a
        control that looks live and lands somewhere arbitrary. A match still
        being drawn has no ids yet, and an unlinked portrait is the honest
        rendering of that.

        New tab, `noreferrer noopener` — every outbound on this console does,
        and none of them may hand the opener a handle back into a runtime that
        holds a key.
      */}
      {side.characterId === null ? (
        face
      ) : (
        <a
          className="match-portrait-link"
          href={`${baseUrl}/character/${side.characterId}`}
          target="_blank"
          rel="noreferrer noopener"
          title={`Open ${side.name ?? "this fighter"} on the arena`}
        >
          {face}
        </a>
      )}
    </div>
  );
}

/**
 * A slug, as the arena's own display name.
 *
 * The list is `GET /api/arenas`, read on the server and handed down. Falls back
 * to the slug when the arena did not publish one, which keeps an unrecognised
 * ground visible rather than blank.
 */
function arenaName(arenas: readonly ArenaChoice[], slug: string): string {
  return arenas.find((a) => a.slug === slug)?.displayName ?? slug;
}

/* ── The dice (Amendment G) ─────────────────────────────────────────────────
   A STORED record, rendered. Nothing here rolls anything: the arena rolled
   these from a per-match seed it publishes with the verdict, so every face
   below is replayable by anyone holding the seed. The tumble is theatre; the
   faces, the modifier and the advantage state are the artifact. */

/**
 * One side's throw: its raw dice — two under advantage or disadvantage, one on
 * a wash — with the kept die ringed in the side's colour, the judge-derived
 * modifier beside it, and the advantage state named underneath.
 *
 * `keptIdx` is found by VALUE rather than assumed to be an end of the array,
 * because "take high" and "take low" put it at opposite ends and a record with
 * two equal faces has no distinguishable pair at all. Indexing off the
 * advantage state would be this console re-deciding which die counted; the
 * record already says, in `roll`.
 */
function DiceCluster({
  contest,
  role,
  phase,
}: {
  contest: ExchangeContest;
  role: Side;
  phase: "tumbling" | "landed";
}) {
  const dice = contest.dice[role] ?? [];
  const keptIdx = dice.indexOf(contest.roll[role]);
  const adv = contest.advantage[role];
  const natural = contest.flourish[role] ? "NAT 20" : contest.stumble[role] ? "NAT 1" : null;

  return (
    <div className="match-dice" data-align={role}>
      <div className="match-dice-row">
        {dice.map((v, i) => (
          <span
            key={i}
            className="num match-die"
            data-phase={phase}
            data-kept={phase === "landed" && i === keptIdx ? "true" : undefined}
            data-dropped={phase === "landed" && dice.length > 1 && i !== keptIdx ? "true" : undefined}
            data-natural={phase === "landed" && i === keptIdx && natural ? "true" : undefined}
            data-role={role}
            style={phase === "tumbling" ? { animationDelay: `${i * 90}ms` } : undefined}
          >
            {phase === "tumbling" ? "·" : v}
          </span>
        ))}
        {phase === "landed" && (
          /*
            The modifier, printed as the log writes it: `+mod` then `+variety`
            where a first use earned one. Two signs rather than one summed
            number, because the second is a rule an operator can look up and a
            total would hide which coins earned it.
          */
          <span className="num match-die-mod muted">
            +{contest.mod[role]}
            {contest.variety[role] > 0 ? `+${contest.variety[role]}` : ""}
          </span>
        )}
      </div>
      {/* Reserves its line even when empty, so the board does not jump between
          a wash and an advantage. */}
      <div className="match-dice-state" data-natural={phase === "landed" && natural ? "true" : undefined}>
        {phase === "landed" && natural
          ? natural
          : adv === "advantage"
            ? "advantage"
            : adv === "disadvantage"
              ? "disadvantage"
              : "\u00a0"}
      </div>
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
  baseUrl,
}: {
  challenger: MatchSide;
  throne: MatchSide;
  houses: Map<string, House>;
  baseUrl: string;
}) {
  return (
    <div className="match-names">
      {([challenger, throne] as const).map((side, i) => {
        const house = side.houseSlug ? (houses.get(side.houseSlug) ?? null) : null;
        const crest = crestFor(side.houseSlug);
        return (
        <div className="match-name-block" key={i} data-align={i === 0 ? "CHALLENGER" : "THRONE"}>
          {/* The name opens the fighter, like the portrait above it. Unlinked
              when there is no id — a link built without one lands somewhere
              arbitrary, because the arena answers `/character/{id}` for any. */}
          {side.characterId === null ? (
            <span className="match-name display">{side.name ?? "—"}</span>
          ) : (
            <a
              className="match-name display"
              href={`${baseUrl}/character/${side.characterId}`}
              target="_blank"
              rel="noreferrer noopener"
              title={`Open ${side.name ?? "this fighter"} on the arena`}
            >
              {side.name ?? "—"}
            </a>
          )}
          {side.houseSlug && (
            /*
              The House opens its page, and the destination is `/arena/{slug}`
              rather than `/house/{slug}`.

              They are one page on the arena — `/house/{slug}` is a permanent
              redirect — and linking the canonical URL saves the reader a hop.
              It also states the relationship the arena actually holds: a House
              and its ground are one thing there, which is why the redirect
              exists rather than two pages that could drift.
            */
            <a
              className="match-house"
              href={`${baseUrl}/arena/${side.houseSlug}`}
              target="_blank"
              rel="noreferrer noopener"
              title={house?.words ?? `Open ${house?.name ?? side.houseSlug} on the arena`}
            >
              {crest && (
                // A plain <img>: these crests carry a real alpha channel and
                // Next's optimizer flattens it. Decorative, because the House is
                // named in the text beside it.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="match-crest" src={crest} alt="" aria-hidden="true" width={16} height={16} />
              )}
              <span className="muted">{house?.name ?? side.houseSlug}</span>
            </a>
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

/**
 * A fighter's portrait on a history row.
 *
 * A plain `<img>`, for `fighters-pane.tsx`'s reason and it is the important one:
 * `next/image` on a remote host routes the bytes through THIS server's
 * optimiser, which would make the console process — the one runtime holding a
 * key — fetch the arena's storage on every history render. A bare tag is the
 * browser fetching a world-readable, content-addressed, immutable object, and
 * this process never touches it.
 *
 * The URL is the arena's own, published beside the key. Composing one from a
 * storage key would put a fact about where those objects live inside a client.
 *
 * A missing portrait renders an empty frame rather than collapsing the cell:
 * the names either side must stay on one baseline down the whole list, and a
 * row that reflows because one fighter has no render reads as a broken row.
 */
function RowFace({ url }: { url: string | null }) {
  if (!url) return <span className="match-row-face empty" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="match-row-face" src={url} alt="" loading="lazy" />;
}

/**
 * What a row's result is CALLED, and it is read rather than defaulted.
 *
 * The arena had this exact bug and it is worth not repeating one directory
 * over: `/matches` rendered `Defended` as the final `else`, so a lane that
 * writes no throne outcome — a duel writes none, because "defended" says
 * nothing about a match with no seat — inherited the throne's label. The first
 * real duel ever fought published as "Defended" beside a Type column reading
 * "Duel".
 *
 * So every throne outcome is matched by name, and anything else is reported by
 * its WINNER, which is the only thing that actually happened. On a duel the
 * arena's stored `CHALLENGER` slot is the HOST — the agent that posted the
 * listing — so that is what it is called here. `lib/game/sides.ts` in the arena
 * carries the argument for the vocabulary; this is the console's copy of the
 * two words, deliberately not a second general translation layer.
 */
function outcomeLabel(r: MatchRow): string {
  if (r.outcome === "DEFENDED") return "DEFENDED";
  if (r.outcome === "SEAT_TAKEN") return "SEAT TAKEN";
  if (r.outcome === "VOIDED") return "VOIDED";
  if (r.winner === "CHALLENGER") return r.kind === "duel" ? "HOST WON" : "FIGHTER A WON";
  if (r.winner === "THRONE") return r.kind === "duel" ? "OPPONENT WON" : "FIGHTER B WON";
  return "—";
}

/**
 * The colour, and it spends no ember.
 *
 * `globals.css`'s first paragraph reserves ember fill for the one control that
 * settles an amount now, and a history row settles nothing — it reports. A
 * void is the only row that gets a distinct tone, because "no result" is the
 * one state a reader must not mistake for a result.
 */
function outcomeTone(r: MatchRow): "muted" | undefined {
  return r.outcome === "VOIDED" || outcomeLabel(r) === "—" ? "muted" : undefined;
}

export default function MatchPane({
  matchId,
  operator,
  baseUrl,
  arenas,
  drag,
  disabled,
}: {
  matchId: string | null;
  /** The address currently signing, for the `Mine` filter. Null read-only. */
  operator: string | null;
  /**
   * The arena this console points at, for the deep links on this card.
   *
   * A fighter, a House and an arena all have a page over there, and this card
   * already prints all three. Linking them is the difference between a readout
   * and a way in — and the destination is the arena's, never composed from
   * anything this console holds beyond the base URL it was configured with.
   */
  baseUrl: string;
  /**
   * The arenas the canon published, for slug → display name.
   *
   * Read on the server and handed down, the same list the command pane's arena
   * fields use. This console holds no table of eight: `the-canopy` is an
   * identifier and "The Canopy" is what the arena calls it, and only the arena
   * gets to say which is which.
   */
  arenas: readonly ArenaChoice[];
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

  /** Reads spent following the current match, and whether the follow gave up. */
  const followReads = useRef(0);
  const [followStopped, setFollowStopped] = useState(false);

  const autoplay = useSyncExternalStore(subscribeMatchPrefs, autoplaySnapshot, serverFalse);
  const sound = useSyncExternalStore(subscribeMatchPrefs, soundSnapshot, serverSound);

  /** Built on the first playback and reused. A context made off-gesture is suspended. */
  const soundRef = useRef<MatchSound | null>(null);
  /** Bumped per run, so a superseded playback can tell and abandon itself. */
  const runId = useRef(0);

  /*
    Claim the audio permission on the operator's first click, anywhere.

    Sound defaults to on now (`match-prefs.ts` carries the argument), and a
    default that cannot make a sound would be a lie: a browser suspends any
    `AudioContext` built outside a user gesture, and the one playback that
    matters most — a verdict landing while the pane follows a live match —
    starts on a timer that no gesture precedes. So the first pointer or key
    event in the console is spent building and resuming the context. It plays
    nothing; priming is permission, not sound. An operator who clicks nothing at
    all still gets a silent live playback, which is the browser's call.
  */
  useEffect(() => {
    const prime = () => {
      (soundRef.current ??= createMatchSound()).prime();
    };
    const opts = { once: true, capture: true } as const;
    window.addEventListener("pointerdown", prime, opts);
    window.addEventListener("keydown", prime, opts);
    return () => {
      window.removeEventListener("pointerdown", prime, { capture: true });
      window.removeEventListener("keydown", prime, { capture: true });
    };
  }, []);

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
      // A read the operator asked for restarts the follow — that press IS the
      // "resuming is one press" the pause below promises.
      followReads.current = 0;
      setFollowStopped(false);
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

  /**
   * Re-read a match that has not been judged yet, without disturbing the card.
   *
   * Deliberately NOT `load()`. That one is the operator's action: it clears the
   * error, resets the frame, drops the menus, switches to the Match tab and
   * flips `busy`, all of which are right for "I asked for this match" and wrong
   * for a background re-read — an operator watching a countdown would see the
   * card blink every few seconds.
   *
   * Everything it touches is a field that can actually change while a match is
   * in flight: the selection window, its two submitted bits, and the verdict.
   */
  const follow = useCallback(
    async (id: string) => {
      let view: MatchView | null = null;
      try {
        const data = await act("match", { id });
        view = readMatch(bodyOf(data) ?? null);
      } catch {
        /*
          A failed background read is not an error the operator has to dismiss.
          It leaves the card exactly as it was and the next tick tries again —
          the alternative is a transport blip painting `CONSOLE_TRANSPORT` over
          a match that is fine.
        */
        return;
      }
      if (!view) return;
      followReads.current += 1;
      if (followReads.current >= FOLLOW_READS_MAX) setFollowStopped(true);
      setMatch(view);
      setReadAt(new Date().toISOString());
      if (!view.verdict || view.exchanges.length === 0) return;
      /*
        The verdict landed while the card was watching.

        It plays — and it plays whatever the Auto toggle says, because that
        toggle governs a RECORD being opened ("a judged match runs as soon as
        it opens"), and this is not that. A verdict arriving on a match whose
        countdown you have been watching is the event itself, and following a
        live match is already the opt-in.
      */
      setFrame(finalFrame(view.exchanges, view.actionIds, view.verdict.winner));
      void loadMenus(view);
      setRunning(true);
    },
    [loadMenus],
  );

  /*
    Follow an unresolved match to its verdict.

    "Nothing on this card polls on its own" was true and is no longer: a card
    that printed a countdown and then sat still through 00:00 told the operator
    a fight was about to start and showed them none of it. Every read here is
    the same `match` command the card already runs, priced at zero by the
    catalogue, so this cannot spend — the pane's one hard rule is untouched,
    and `fighters-pane.tsx` has polled a free read on a timer since it shipped.

    Bounded four ways, because an unbounded poller in a console left open
    overnight is its own kind of bug. It runs only while a match is loaded AND
    unjudged AND the Match tab is showing; it stops the instant a verdict lands;
    it slows to 30s outside the one state where seconds matter (`verdict` — the
    selection window, and the panel sitting behind it); and it gives up after
    `FOLLOW_READS_MAX`, the fighters-pane rule stated there as "stop asking,
    rather than ask forever. Resuming is one press."
  */
  const followId = tab === "match" && match && !match.verdict ? match.matchId : null;
  const followFast = match?.queueState === "verdict";
  useEffect(() => {
    if (!followId || followStopped) return;
    const every = followFast ? FOLLOW_FAST_MS : FOLLOW_SLOW_MS;
    const timer = setInterval(() => void follow(followId), every);
    return () => clearInterval(timer);
  }, [followId, followFast, followStopped, follow]);

  const loadHistory = useCallback(async (which: MatchFilter) => {
    setBusy(true);
    setHistoryError(null);
    setLoadedHistory(true);
    try {
      /*
        ONE read, every lane.

        This used to issue two: `matches` for the throne and `pool` for duels.
        The pool is the list of OPEN duel listings — a duel leaves it the instant
        it is taken — so the Duel tab was reading a source that structurally
        cannot contain a settled duel, and showed "Nothing to show for this
        filter" for the whole life of the mode.

        `/api/matches` now takes a lane. `all` is asked for even when a narrower
        tab is showing, because the tabs are a filter over rows already loaded
        (`filterRows`) and switching tabs should not cost a round trip — and
        because `mine` spans lanes, so a per-tab fetch would make it mean
        "mine, among throne matches" without saying so.
      */
      const data = await act("matches", { mode: "all" });
      const next = readMatchRows(bodyOf(data) ?? null);
      if (next.length === 0) setHistoryError(codeOf(data, "NO_MATCHES"));
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
      const first = readMatchRows(bodyOf(data) ?? null)[0];
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
      /* The class a settled entry scrolls to — see `lib/reveal.ts`. */
      className={MATCH_PANE}
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
                {/*
                  The arena's NAME, never the slug it arrives as. "the-canopy"
                  is an identifier; "The Canopy" is what the arena calls it
                  everywhere a person reads it, and the House beside it already
                  sets that precedent two lines down.

                  Resolved off the published list rather than from a table here:
                  this console holds no copy of the eight, and a slug it does
                  not recognise falls back to itself — an unknown arena is still
                  a fact about the match, and hiding it is worse than printing
                  an identifier.
                */}
                {match.arena && (
                  <a
                    className="muted match-arena-link"
                    href={`${baseUrl}/arena/${match.arena}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`Open ${arenaName(arenas, match.arena)} on the arena`}
                  >
                    {arenaName(arenas, match.arena)}
                  </a>
                )}
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
                    until the sequences lock · by this browser&rsquo;s clock · closes{" "}
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
                  baseUrl={baseUrl}
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
                <Portrait
                  side={match.throne}
                  align="THRONE"
                  crest={view.crests.THRONE}
                  baseUrl={baseUrl}
                />
              </div>

              {/*
                The throw for the exchange on the board.

                Under the board rather than inside it: the board row is five
                columns and a die cluster in a 96px portrait column would have
                to shrink to nothing. This is the arena's own placement, and
                the two clusters sit on the same axis as the fighters they
                belong to — challenger left, throne right, matching the
                portraits above.

                Rendered from the STORED record via the exchange index the
                frame carries. A coin with no contest record — a stored v3
                verdict, judged before Amendment G — renders nothing rather
                than a zeroed throw, which is the same refusal the record table
                makes one card down.
              */}
              {view.dice && exchanges[view.dice.coin]?.contest && (
                <div className="match-dice-row-outer">
                  <DiceCluster
                    contest={exchanges[view.dice.coin]!.contest!}
                    role="CHALLENGER"
                    phase={view.dice.phase}
                  />
                  <div className="match-dice-gap" aria-hidden="true" />
                  <DiceCluster
                    contest={exchanges[view.dice.coin]!.contest!}
                    role="THRONE"
                    phase={view.dice.phase}
                  />
                </div>
              )}

              <Names
                challenger={match.challenger}
                throne={match.throne}
                houses={houses}
                baseUrl={baseUrl}
              />

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

              {/*
                The evidence panel — the arena's record table and life bars,
                revealed by default the way the arena's own match page now
                shows them: the record is public the moment the verdict is,
                and the playback above is a replay, not a gate.
              */}
              {/*
                The bars and the table follow the playback, off the SAME frame
                the board reads — `settledCount` is already the count of coins
                whose mark has landed, so there is no second answer to "how far
                has this got". At rest the frame is the finished one and the
                panel is the whole record, which is what it renders with no
                JavaScript at all.
              */}
              {judged && <MatchEvidence match={match} revealed={settledCount} />}

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
                  {followStopped ? (
                    <>
                      Not judged yet, and this card has stopped asking — re-read to follow it
                      again.
                    </>
                  ) : (
                    <>
                      Not judged yet. This card is following the match: it re-reads until the
                      arena publishes a verdict, and plays it here the moment it lands.
                    </>
                  )}{" "}
                  Every read is the free <span className="num">match</span> command; nothing
                  on this card can spend.
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
                    <span className="eyebrow match-row-kind" data-kind={r.kind}>
                      {r.kind}
                    </span>
                    <span className="num match-row-id ellipsis">{r.id}</span>
                    {/*
                      The FIGHTERS, falling back to the owning agent and then to
                      an em dash — the order the arena's own `history.ts`
                      prescribes. A name sits beside a portrait, so reading the
                      owner's name there is correct only while an agent owns
                      exactly one fighter.

                      Side ORDER follows the arena's table: challenger first,
                      then the throne. On a duel those slots are the host and
                      the opponent, which is what `sideLabels` names them.
                    */}
                    <span className="match-row-side">
                      <RowFace url={r.challengerImageUrl} />
                      <span className="ellipsis">
                        {r.challengerFighterName ?? r.challengerName ?? "—"}
                      </span>
                    </span>
                    <span className="match-row-vs muted">vs</span>
                    <span className="match-row-side">
                      <RowFace url={r.championImageUrl} />
                      <span className="ellipsis">
                        {r.championFighterName ?? r.championName ?? "—"}
                      </span>
                    </span>
                    <span className="match-row-arena ellipsis muted">{r.arenaName ?? "—"}</span>
                    {/*
                      Winner's coins first, which is how the arena prints it —
                      "5–0" reads as the winner's score and would be backwards
                      half the time otherwise. Null tally is an em dash, never a
                      zero: no verdict published is not the same as nobody
                      scoring.
                    */}
                    <span className="num match-row-tally">
                      {r.tally
                        ? r.winner === "CHALLENGER"
                          ? `${r.tally.challenger}–${r.tally.throne}`
                          : `${r.tally.throne}–${r.tally.challenger}`
                        : "—"}
                    </span>
                    <span className="num match-row-outcome" data-tone={outcomeTone(r)}>
                      {outcomeLabel(r)}
                    </span>
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
            there is no further page to request. Every lane arrives from one read now — the tabs
            filter rows already in hand, so switching between them costs nothing.
          </p>
        </div>
      )}
      </div>
    </Panel>
  );
}
