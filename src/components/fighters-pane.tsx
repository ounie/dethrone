"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Dialog from "./dialog";
import Icon from "./icon";
import Panel, { type PanelDrag } from "./panel";
import Time from "./time";
import SequenceBuilder, { type MenuAction } from "./sequence-builder";
import type { Capabilities } from "@/lib/capability";
import {
  applyCombo,
  comboFromPicks,
  combosFor,
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
 * The two requests this panel makes on its own are `submit_actions` and
 * `set_preset`, both of which the catalogue prices at zero and the arena
 * accepts on a signature.
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
  operator,
  disabled,
  sequenceLength,
  onArm,
  onSelectedFighter,
  forged,
  drag,
}: {
  capabilities: Capabilities;
  /**
   * The address currently signing, or null on a read-only deploy.
   *
   * Not rendered anywhere in this panel — it is here because **everything below
   * belongs to one wallet**, and this is how the panel learns that the wallet
   * changed. See the reset beside the state declarations.
   */
  operator: string | null;
  /** True while any other request is in flight. */
  disabled: boolean;
  /**
   * The canon's published `actions.sequenceLength`, or null if it publishes
   * none. Never a literal — see the note on `SequenceBuilder`'s `capacity`.
   */
  sequenceLength: number | null;
  /** Select a catalogue command and fill its fields. Runs nothing. */
  onArm: (commandId: string, args: Record<string, string>) => void;
  /**
   * Which fighter this panel currently has open, as it changes.
   *
   * Reported so a command selected from the RAIL can default its `characterId`
   * to the fighter already on screen — which is the prime on load, because that
   * is what this panel opens with. It is a default and never a decision: the
   * field stays editable, and nothing is sent until Run.
   */
  onSelectedFighter?: (characterId: number | null) => void;
  /**
   * A character this console just forged, with a nonce so the same id twice
   * still counts. Null until something is forged.
   */
  forged?: { characterId: number; nonce: number } | null;
  /** Handed down by the layout so this card can be moved. */
  drag?: PanelDrag;
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
  /** The portrait viewer. Memory only, and it holds no URL of its own. */
  const [viewing, setViewing] = useState(false);
  /**
   * A freshly forged fighter, watched until the arena stops calling it forging.
   *
   * `reads` is the bound. A forge that never finishes must stop asking rather
   * than poll a paid-for character forever — the same shape, and the same
   * argument, as the window watch below.
   */
  const [forging, setForging] = useState<{ id: number; state: string; reads: number } | null>(
    null,
  );
  /** Focused when the viewer opens: the safe choice, and here the only one. */
  const closeViewerRef = useRef<HTMLButtonElement>(null);
  const [presetNote, setPresetNote] = useState<string | null>(null);
  /**
   * The preset the ARENA last echoed back, for this fighter, in this session.
   *
   * Not "the fighter's preset" — the panel cannot know that. A preset is sealed:
   * the arena never publishes it on the character resource, so a fresh selection
   * has no way to read one and this stays null until a write is answered. That
   * is why every sentence rendered from it is scoped to what was set here, and
   * why null renders as *nothing said* rather than as "no preset".
   */
  const [storedPreset, setStoredPreset] = useState<number[] | null>(null);

  /*
    Combos live in `localStorage`, which is an external store, so they are read
    as one. The server snapshot is empty because the server has no browser —
    this component renders server-side too (`test/fighters-pane.test.ts` does
    exactly that), and a `useState` initialiser reading storage would produce
    markup on the client that does not match the markup from the server.
  */
  const combos = useSyncExternalStore(subscribeCombos, combosSnapshot, serverCombosSnapshot);

  /*
    A combo belongs to the fighter it was built from, and only that fighter is
    offered it. `combos.ts` carries the argument; the short version is that the
    library used to fill with entries that did not fit where they were shown,
    and a warning explaining why is not the same thing as not showing them.

    Memoized because `combosFor` filters into a fresh array. The unfiltered
    `combos` is a `useSyncExternalStore` snapshot and must keep its identity
    between writes — deriving from it per render is fine, handing a derived
    array back to the store would not be.
  */
  const fighterCombos = useMemo(() => combosFor(combos, selected), [combos, selected]);

  /*
    A Stable belongs to one wallet, and so does everything downstream of it.

    `router.refresh()` re-renders the server tree and deliberately KEEPS client
    state, so without this a wallet switch left the previous operator's roster,
    portrait, menu, plan and match watch sitting on screen under a masthead
    naming somebody else. Every one of them is wrong in a different way:

      * The ROSTER is a signed, owner-only read. It is the one thing on this
        screen that is nobody else's business, and it would be showing while the
        console could no longer produce the signature that fetched it.
      * The PLAN is the dangerous one. `combos.ts` already argues this at
        length: a plan is a list of MENU INDICES, and indices are positions in
        one fighter's menu. Carrying five of them to a fighter another wallet
        owns submits five legal integers naming five different moves — a
        submission the operator did not write and cannot tell apart from one
        they did.
      * The WATCH is a match the previous wallet is in. `submit_actions` signs
        as whoever is selected now, so the arena would refuse it — a confusing
        401 rather than a wrong move, but still a panel offering an action it
        knows cannot work.

    Adjusted during render rather than in an effect, for the reason
    `console.tsx` gives beside its own: an effect would paint the stale panel
    once and then blank it.

    Combos are deliberately NOT cleared. They live in `localStorage`, store
    stable action ids rather than indices, and are the operator's own vocabulary
    — not a fact about a wallet.
  */
  const [signedAs, setSignedAs] = useState(operator);
  if (operator !== signedAs) {
    setSignedAs(operator);
    setRoster(null);
    setRosterError(null);
    setSelected(null);
    setName(null);
    setImageUrl(null);
    setMenu(null);
    setMenuError(null);
    setPicks([]);
    setWatch(null);
    setSubmitNote(null);
    setMatchIdField("");
    setComboNote(null);
    setPresetNote(null);
    setStoredPreset(null);
    setViewing(false);
    // A forge watch belongs to the wallet that paid for it. Left running, it
    // would poll the previous operator's character under the new one's name.
    setForging(null);
  }

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
      /*
        This should be unreachable, and it is kept because of what it would mean
        if it fired. A combo is only ever offered on the fighter it was saved
        from, and a menu is a pure function of that fighter's genome — so every
        id must resolve. A miss means the arena's menu derivation has changed
        under a stored combo, which is exactly the moment an autofill must say
        so rather than quietly submit a shorter plan.
      */
      setComboNote(
        missing.length === 0
          ? null
          : `${missing.length} of ${combo.actionIds.length} no longer exist in this fighter's menu, so those slots were left empty. The arena's action list has changed since this combo was saved. Missing: ${missing.join(", ")}.`,
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

  const choose = useCallback(
    async (characterId: number) => {
    setSelected(characterId);
    onSelectedFighter?.(characterId);
    setName(null);
    setImageUrl(null);
    // A viewer left open across a change of fighter would go on showing the
    // previous portrait under the new fighter's name until the reads land.
    setViewing(false);
    setMenu(null);
    setMenuError(null);
    setPicks([]);
    // A preset note names the PREVIOUS fighter's write; carrying it across a
    // selection would read as a fact about this one. The echoed value goes with
    // it, for the same reason and with more force — it is what the "stored"
    // sentences below are rendered from.
    setPresetNote(null);
    setStoredPreset(null);
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
    },
    [onSelectedFighter],
  );

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

    Once per WALLET, via a ref rather than a state flag: a re-run for the same
    operator would re-select the prime and silently discard a plan they had
    already built.

    Per wallet and not per mount, because the panel outlives a switch — the
    reset above empties it, and this fills it again with the Stable that belongs
    to whoever is signing now. Reading it for them is the same "the read they
    would make first, made before they ask" that justifies doing it on open, and
    it costs the same nothing: `stable` is signed and free.
  */
  const openedFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!stable.enabled || openedFor.current === operator) return;
    openedFor.current = operator;
    void (async () => {
      const list = await loadRoster();
      if (!list || list.length === 0) return;
      const prime = list.find((f) => f.generation === 0) ?? list[0];
      await choose(prime.characterId);
    })();
  }, [operator, stable.enabled, loadRoster, choose]);

  /*
    A forge lands, and the panel opens what it just paid for.

    `POST /api/forge` answers 202 with a character that is still `forging`: the
    row exists and the genome is decided, but the portrait has not rendered.
    Before this, a settled forge left "No fighters" on screen beside a response
    body naming the character it had just bought — the operator had to know to
    press Read my stable, and nothing said so.

    So the roster is re-read and the new fighter selected. That is the same read
    the operator would make next, made for them, and it costs nothing: `stable`
    is signed and free.
  */
  const forgedNonce = forged?.nonce ?? 0;
  const forgedId = forged?.characterId ?? null;
  useEffect(() => {
    if (forgedId === null) return;
    // An inline async body, like the auto-open effect below and for the same
    // reason: the work is a sequence of reads, and its state writes belong in
    // the continuation rather than in the effect body.
    void (async () => {
      await loadRoster();
      await choose(forgedId);
      setForging({ id: forgedId, state: "forging", reads: 0 });
    })();
    // Keyed on the NONCE, so forging the character you already have — which the
    // arena answers at no charge — still re-opens it.
  }, [forgedNonce, forgedId, loadRoster, choose]);

  /*
    Poll while the arena still calls it forging.

    ## It reads the STABLE, and the first version read the character

    `GET /api/character/{id}` publishes no `state` field — it answers identity,
    traits, actions and a fight record, and nothing about where the row is in
    its lifecycle. So `body.state` was always `undefined`, the watch fell back
    to its own last value, and a fighter that had finished rendering sat at
    "forging" until the bound ran out and it said "Stopped asking" over a
    finished portrait.

    Worse, the bug survived a browser test because that test STUBBED the field
    that does not exist. The lesson is the one this repo keeps relearning: a
    stub proves the code reads what you told it to, never that the server sends
    it. This reads `stable`, which is where `state` actually lives, and the
    verification below asks the real endpoint.

    One read per tick does both jobs: the roster row and the watched state come
    from the same answer, so the list cannot say `forging` beside a detail that
    says `ready`.

    The stop condition is still the arena's own word — anything that is not
    `forging` ends the watch, including `void`, which is a forge that failed and
    was refunded. A character that has left the stable entirely also ends it:
    waiting for a row that is gone is waiting forever.
  */
  const readForge = useCallback(async () => {
    const current = forging;
    if (!current) return;

    const data = await act("stable", {});
    const characters = bodyOf(data)?.characters;
    if (!Array.isArray(characters)) {
      // A read that did not come back is not evidence of anything. Count it so
      // the bound still applies, and try again.
      setForging((prev) =>
        prev && prev.id === current.id ? { ...prev, reads: prev.reads + 1 } : prev,
      );
      return;
    }

    const list = characters as StableFighter[];
    setRoster(list);
    const mine = list.find((f) => f.characterId === current.id);
    const state = mine?.state;

    if (!mine || state !== "forging") {
      setForging(null);
      // Re-open it, so the detail, the portrait and the menu all catch up.
      await choose(current.id);
      return;
    }

    setForging((prev) =>
      prev && prev.id === current.id ? { ...prev, state, reads: prev.reads + 1 } : prev,
    );
  }, [forging, choose]);

  const forgeRef = useRef<() => void>(() => {});
  useEffect(() => {
    forgeRef.current = () => void readForge();
  }, [readForge]);

  const forgeWatchId = forging?.id ?? null;
  const forgeWatchStopped = forging !== null && forging.reads >= QUIET_READS_BEFORE_PAUSE;
  useEffect(() => {
    if (forgeWatchId === null || forgeWatchStopped) return;
    const timer = setInterval(() => forgeRef.current(), POLL_MS);
    return () => clearInterval(timer);
    // Keyed on the id and on whether the bound is reached — never on `forging`
    // itself, whose `reads` changes every tick and would rebuild the timer.
  }, [forgeWatchId, forgeWatchStopped]);

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

  /**
   * PATCH the plan onto the fighter as its standing preset.
   *
   * Free and signed, the `submit_actions` precedent — the second of the two
   * requests this panel is allowed to make on its own. The plan above stays
   * memory-only and dies with the tab; what this stores lives with the FIGHTER,
   * on the arena, sealed, and is what a window close commits if no live
   * submission arrives. Running it again replaces the previous preset — the
   * close reads the latest value, which is exactly the arena's revision path.
   *
   * The response is rendered as the arena's own words (`presetActionIds` echoed
   * back, or its refusal code) — never a sentence invented here.
   */
  const setPreset = useCallback(async () => {
    if (!chosen || picks.length === 0) return;
    setBusy(true);
    setPresetNote(null);
    try {
      const data = await act("set_preset", {
        id: String(chosen.characterId),
        presetActionIds: JSON.stringify(picks),
      });
      const body = bodyOf(data) as { presetActionIds?: number[] | null } | undefined;
      const echoed = Array.isArray(body?.presetActionIds) ? body.presetActionIds : null;
      // The arena's echo, not the picks that were sent. If the two ever differ,
      // the one that fights is the arena's — so that is the one this renders.
      setStoredPreset(echoed);
      setPresetNote(echoed ? `preset set · ${echoed.length} actions` : codeOf(data, "REFUSED"));
    } finally {
      setBusy(false);
    }
  }, [chosen, picks]);

  /**
   * Whether the plan on screen is the one the arena echoed back.
   *
   * Three states, and the third is the one that matters: **null means unknown,
   * not "no preset"**. A preset is sealed, so a fighter selected this session
   * may well have one that this panel has never been told about. Rendering
   * "no preset" from silence would be inventing a fact about the operator's own
   * fighter — so silence renders as the neutral sentence, which is true either
   * way: paying does not carry a plan.
   */
  const planIsStored =
    storedPreset === null
      ? null
      : storedPreset.length === picks.length && storedPreset.every((v, i) => v === picks[i]);

  const idle = busy || disabled;

  return (
    <Panel
      drag={drag}
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

        {/*
          An empty Stable is the one state this panel can answer directly, and
          until now it only described the answer. The sentence is the same; the
          button beside it saves reading the catalogue to find out that the
          command is called "Forge".

          It ARMS, exactly like the three buttons under a chosen fighter, and
          for the identical reason — forge is paid, so a button here that called
          `act("forge")` would be a second place money leaves this screen.
          `onArm` selects the catalogue command and fills its fields; the
          operator still presses Run, still earns the 428, and still confirms
          the amount the server computed. `test/fighters-pane.test.ts` fails on
          the other version, and that is the mechanism rather than this comment.

          No arguments: a forge takes none. The fighter is a pure function of
          the wallet address, which is what the sentence beside it means and why
          "your wallet already contains it" is literally true rather than
          encouraging.
        */}
        {/*
          What the panel is doing, while it is doing it.

          A pane that quietly re-reads every few seconds is a pane an operator
          cannot tell apart from a stuck one, so the watch says it is watching
          and says when it has stopped. The STATE is the arena's word rendered
          as it came — this console does not translate "forging" into a
          progress bar it would have to invent a duration for.

          Resuming is one press, exactly as the window watch offers.
        */}
        {forging && (
          <p className="forge-watch" data-done={forging.reads >= QUIET_READS_BEFORE_PAUSE}>
            <Icon name="hourglass" size={13} />
            {forging.reads >= QUIET_READS_BEFORE_PAUSE ? (
              <>
                Character {forging.id} still reads <span className="num">{forging.state}</span>.
                Stopped asking.{" "}
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setForging({ id: forging.id, state: forging.state, reads: 0 })}
                >
                  Keep watching
                </button>
              </>
            ) : (
              <>
                Character {forging.id} reads <span className="num">{forging.state}</span>. Re-reading
                until the arena says otherwise — its portrait appears when the render lands.
              </>
            )}
          </p>
        )}

        {roster?.length === 0 && (
          <div className="roster-empty">
            <p className="muted">No fighters. Forge one — your wallet already contains it.</p>
            <button
              type="button"
              className="icon-btn labelled"
              disabled={idle || !(capabilities.forge?.enabled ?? true)}
              onClick={() => onArm("forge", {})}
            >
              <Icon name="wallet" size={13} />
              Forge
            </button>
            {/* The server's sentence, never one invented here. */}
            {capabilities.forge?.enabled === false && (
              <p className="muted">{capabilities.forge.reason}</p>
            )}
          </div>
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
              {/*
                A button, not an image with an onClick.

                The portrait is the one thing on this panel worth looking at
                closely — it is the fighter — and the card renders it at
                thumbnail size. Wrapping it in a real `<button>` is what makes
                it reachable by keyboard and announced as something that can be
                pressed; a click handler on the `<img>` would look identical and
                be invisible to anybody not using a mouse.

                It opens a viewer and nothing else. No fetch, no second copy of
                the image, no download — the modal points at the same remote URL
                the thumbnail already has, so this costs one cache hit and this
                process never touches the bytes.
              */}
              {imageUrl ? (
                <button
                  type="button"
                  className="fighter-portrait-btn"
                  onClick={() => setViewing(true)}
                  aria-label={
                    name ? `View the portrait of ${name} in full` : "View this portrait in full"
                  }
                  title="View in full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="fighter-portrait"
                    src={imageUrl}
                    alt={name ? `${name}, character ${chosen.characterId}` : ""}
                  />
                  <span className="fighter-portrait-zoom" aria-hidden="true">
                    <Icon name="external-link" size={13} />
                  </span>
                </button>
              ) : null}
              <div>
                <div className="fighter-name">{name ?? `Character ${chosen.characterId}`}</div>
                {/*
                  "forged in", not a bare arena name.

                  This field is PROVENANCE — the arena the cycle was running in
                  when the portrait was rendered — and it is not the fighter's
                  allegiance. Allegiance is its House, which the masthead shows,
                  and the two are different facts about different things: a
                  House falls out of the wallet address, an arena out of the
                  clock. They routinely disagree, and neither is wrong when they
                  do.

                  Unlabelled, sitting between the state and the reason, it read
                  as "belongs to" — and an operator whose masthead said House
                  Cindermark while this line said The Gladiator Sands had no way
                  to tell which one was lying. Neither was. The arena's own
                  guide legislates the same distinction for its roster pages: a
                  roster is membership, never provenance.

                  Two words, and the ambiguity is gone. Removing the field
                  instead would delete a true fact to avoid explaining it.
                */}
                <div className="num muted fighter-sub">
                  #{chosen.characterId} · {chosen.state}
                  {chosen.arena ? ` · forged in ${chosen.arena.displayName}` : ""}
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
                  /*
                    A disabled control has to say why — the same rule
                    `catalogue-render.test.ts` enforces on the rail. This one
                    needs a length to draw TO, and the only honest source is the
                    canon: an arena that publishes no `actions.sequenceLength`
                    leaves this off rather than letting the console invent a
                    number and fill five slots on a guess.
                  */
                  title={
                    sequenceLength === null
                      ? "This arena publishes no sequence length, so there is no count to draw to. Pick from the menu instead."
                      : "Fill every slot at random. Not the arena's draw — see the note below."
                  }
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

            {/* ── The standing preset ──────────────────────────────────────── */}
            <div className="picker-row">
              <button
                type="button"
                className="icon-btn"
                disabled={
                  idle ||
                  picks.length === 0 ||
                  (sequenceLength !== null && picks.length !== sequenceLength)
                }
                /*
                  The count gate uses the canon's PUBLISHED length, the same
                  number `SequenceBuilder`'s capacity already renders — not a
                  rule invented here. With none published the button stays live
                  and the arena's refusal is the answer.
                */
                title={
                  sequenceLength !== null && picks.length !== sequenceLength
                    ? `A preset is ${sequenceLength} actions; the plan holds ${picks.length}.`
                    : "Store this plan on the fighter, arena-side. Free — a signature, no money."
                }
                onClick={() => void setPreset()}
              >
                <Icon name="shield-check" size={12} />
                Set as preset
              </button>
              {presetNote && <span className="num window-state">{presetNote}</span>}
            </div>
            {/*
              Rendered only from an echo this session produced. `planIsStored`
              is null until then, and null says nothing — see its comment.
            */}
            {planIsStored === false && picks.length > 0 && (
              <p className="field-hint" data-tone="warn">
                The plan above is not what you stored. The preset still holds the earlier actions,
                and that is what a close would commit — set it again to revise.
              </p>
            )}
            {planIsStored === true && (
              <p className="field-hint">
                This plan is stored on the fighter. If a window closes and you have not submitted
                live, these are the actions that fight.
              </p>
            )}
            <p className="field-hint">
              The plan above dies with this tab; a preset lives with the fighter, on the arena,
              sealed. If a selection window closes and you never submitted, the preset fights in
              your place — and the close reads the latest value, so setting it again mid-window is
              how you revise. A live submission still outranks it for that match.
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

                {fighterCombos.length > 0 && (
                  <ul className="combo-list" aria-label="Saved combos for this fighter">
                    {fighterCombos.map((combo) => (
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
                          onClick={() => writeCombos(removeCombo(combos, combo.fromCharacterId, combo.name))}
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
                    Two facts, and both are things an operator would otherwise
                    have to discover. The first is the scoping they can see —
                    this list is shorter than their whole library on purpose. The
                    second is what a combo IS, because the obvious reading is
                    wrong in a way that costs a fight: it stores actions, not the
                    five integers, which are positions in one fighter's menu.
                  */}
                  Combos belong to the fighter they were saved from — a menu follows the genome, so
                  the same five positions on another fighter are five different moves. This list is
                  {" "}
                  {chosen?.name ?? "this fighter"}&rsquo;s. Nothing is sent anywhere, and nothing is
                  committed until you submit.
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
            {/*
              The gap this closes, reported by an operator who hit it: build a
              plan, press "Challenge the throne", press Run, and reasonably
              assume the money bought the plan. It did not. `POST /challenge` is
              `{ characterId }` and nothing else, by Amendment A — so the panel
              has to say where the actions actually go, at the moment the
              operator is about to leave for the command pane.

              Not gated on `planIsStored === false`: it says the same thing when
              nothing has been stored (null), because the sentence is true either
              way and silence here is what caused the confusion.
            */}
            {picks.length > 0 && planIsStored !== true && (
              <p className="field-hint" data-tone="warn">
                Your plan does not travel with the payment. Entering a fighter buys the match and
                carries the fighter id alone — the actions arrive later, either as a live
                submission when the window opens at pairing, or from the standing preset above,
                which the close commits for you. Set the preset and you are covered without
                being at the keyboard.
              </p>
            )}
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
                      <span className="num">closes <Time iso={watch.selection.closesAt} /></span>
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
                  {watch.readAt && (
                    <span className="muted">
                      {" · read "}
                      <Time iso={watch.readAt} zone={false} />
                    </span>
                  )}
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
                  revised — the preset can, until the close.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/*
        The portrait, full size.

        ## It shows the image and nothing else

        No traits, no scores, no genome — those are already on the card, and a
        viewer that started summarising would be a second rendering of a
        fighter, free to disagree with the first. It is a bigger copy of one
        `<img>`, its name, and a way out.

        ## The same remote URL, not a copy

        `src` is `imageUrl`, exactly as the thumbnail has it — the arena's own
        content-addressed storage, fetched by the browser. Downloading the bytes
        through this process to re-serve them would put the runtime that holds
        the keys in front of somebody else's object store, which is the argument
        `response-pane.tsx` already makes about inlining media. The console
        never composes an asset path either: `portraitUrl` is resolved by the
        arena.

        ## Reuses `Dialog`, so the trap is not written twice

        Escape, the backdrop click and the focus trap all come from the shared
        shell. The close button takes `initialFocus` because it is the safe
        choice, which is that component's stated rule — and here it is also the
        only choice, since a viewer has nothing consequential in it at all.
      */}
      {viewing && imageUrl && chosen && (
        <Dialog
          labelledBy="portrait-view-title"
          onCancel={() => setViewing(false)}
          initialFocus={closeViewerRef}
        >
          <div className="portrait-view">
            <div className="portrait-view-head">
              <h2 id="portrait-view-title" className="display">
                {name ?? `Character ${chosen.characterId}`}
              </h2>
              <button
                type="button"
                className="icon-btn"
                ref={closeViewerRef}
                onClick={() => setViewing(false)}
              >
                <Icon name="x-mark" size={13} />
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="portrait-view-img"
              src={imageUrl}
              alt={name ? `${name}, character ${chosen.characterId}` : ""}
            />
            <p className="portrait-view-foot muted">
              <a href={imageUrl} target="_blank" rel="noreferrer noopener">
                Open the original
              </a>
              {" · "}
              {chosen.arena ? `forged in ${chosen.arena.displayName}` : "no arena recorded"}
            </p>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
