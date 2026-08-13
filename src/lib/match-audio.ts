/**
 * The verdict's sound, synthesised.
 *
 * ## There are no audio files, and that is the design
 *
 * Every sound here is built from oscillators and noise buffers at play time —
 * the same construction the arena's own match page uses, ported so the console
 * sounds like the web app rather than approximating it. Nothing is fetched, so
 * this adds no asset to load, no CDN to depend on, and nothing for
 * `test/one-fetch.test.ts` to object to. A `<audio src>` pointing at the arena
 * would have been the obvious alternative and it would have made the console's
 * sound break whenever the arena reorganised a bucket.
 *
 * ## It is created on a gesture, never before
 *
 * Browsers suspend an `AudioContext` created outside a user gesture, and a
 * suspended context that is never resumed is a silent failure that looks like a
 * bug in the animation. So the context is built lazily on the first play and
 * resumed if suspended — `ensure()` — and the whole engine degrades to a set of
 * no-ops where `AudioContext` does not exist at all rather than throwing into a
 * render.
 *
 * ## Muted is checked per sound, not per playback
 *
 * The same argument `chat/execute.ts` makes about re-reading the autonomy mode
 * on every tool call: a mute that waits for the current verdict to finish is not
 * a mute. Every method returns early on `muted`, so the toggle takes effect on
 * the next beat.
 */

export type ActionType = "strike" | "guard" | "bind" | "feint" | "range" | string;

export interface MatchSound {
  /** The lunge: filtered noise sweeping up. */
  swish(): void;
  /** The impact: a thud under four inharmonic partials and a bright transient. */
  clash(): void;
  /** One reel stop. */
  tick(frequency: number): void;
  /** The revealed action, voiced by its type. */
  action(type: ActionType): void;
  /** The reel itself, ticking faster then slower across `seconds`. */
  reelSpin(seconds: number): void;
  /** The medallion in the air. */
  coinSpin(seconds: number): void;
  /** The medallion landing, pitched by which side took the exchange. */
  coinLand(role: string): void;
  /** Match point. */
  drum(): void;
  /** The verdict, major for the throne and minor for a challenger. */
  finale(winner: string): void;
  setMuted(muted: boolean): void;
}

/** Everything a no-audio environment gets: a complete object that does nothing. */
function silent(): MatchSound {
  const noop = () => {};
  return {
    swish: noop,
    clash: noop,
    tick: noop,
    action: noop,
    reelSpin: noop,
    coinSpin: noop,
    coinLand: noop,
    drum: noop,
    finale: noop,
    setMuted: noop,
  };
}

export function createMatchSound(): MatchSound {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return silent();

  let ctx: AudioContext | null = null;
  let muted = false;

  /** Built on first use, and resumed — a context made off-gesture starts suspended. */
  const ensure = (): AudioContext => {
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  /**
   * The one envelope every voice uses: silence, a linear attack to `peak`, then
   * an exponential decay. Exponential on the way down because a linear fade to
   * zero is audible as a click, and `exponentialRampToValueAtTime` cannot reach
   * zero at all — hence 1e-4 rather than 0.
   */
  const env = (
    gain: GainNode,
    t: number,
    attack: number,
    decay: number,
    peak: number,
  ): void => {
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(1e-4, t + attack + decay);
  };

  /** Decaying white noise, the raw material for every transient here. */
  const noise = (c: AudioContext, seconds: number, fade: boolean): AudioBuffer => {
    const buffer = c.createBuffer(1, Math.floor(seconds * c.sampleRate), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (2 * Math.random() - 1) * (fade ? 1 - i / data.length : 1);
    }
    return buffer;
  };

  const thud = (): void => {
    const c = ensure();
    const t = c.currentTime;

    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    env(gain, t, 0.005, 0.28, 0.6);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.32);

    const src = c.createBufferSource();
    src.buffer = noise(c, 0.08, true);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    const g = c.createGain();
    env(g, t, 0.002, 0.09, 0.35);
    src.connect(lp).connect(g).connect(c.destination);
    src.start(t);
  };

  const blip = (t: number, frequency: number, peak: number): void => {
    const c = ensure();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.value = frequency;
    env(gain, t, 0.001, 0.07, peak);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  };

  /** Two detuned triangles — the bell under `coinLand`. */
  const chime = (t: number, base: number, detune: number, peak: number): void => {
    const c = ensure();
    [base, base * detune * 1.5].forEach((frequency, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "triangle";
      osc.frequency.value = frequency;
      env(gain, t, 0.004, i ? 0.45 : 0.6, i ? 0.4 * peak : peak);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
  };

  /** A stack of sines, each fractionally sharper and shorter than the last. */
  const chord = (t: number, freqs: number[], peaks: number[], seconds: number): void => {
    const c = ensure();
    freqs.forEach((frequency, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency * 1.002 ** i;
      env(gain, t, 0.005, seconds - 0.45 * i, peaks[i]);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + seconds + 1);
    });
  };

  return {
    swish() {
      if (muted) return;
      const c = ensure();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noise(c, 0.3, false);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(350, t);
      bp.frequency.exponentialRampToValueAtTime(1900, t + 0.26);
      const gain = c.createGain();
      env(gain, t, 0.03, 0.24, 0.14);
      src.connect(bp).connect(gain).connect(c.destination);
      src.start(t);
    },

    clash() {
      if (muted) return;
      const c = ensure();
      const t = c.currentTime;
      thud();
      // Inharmonic on purpose: an evenly spaced stack rings like a note, and a
      // clash is not a note.
      [860, 1277, 2140, 3444].forEach((frequency, i) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = i % 2 ? "square" : "triangle";
        osc.frequency.value = frequency * (1 + 0.003 * i);
        env(gain, t, 0.002, 0.3 - 0.05 * i, [0.14, 0.1, 0.07, 0.045][i]);
        osc.connect(gain).connect(c.destination);
        osc.start(t);
        osc.stop(t + 0.45);
      });
      const src = c.createBufferSource();
      src.buffer = noise(c, 0.06, true);
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2600;
      const gain = c.createGain();
      env(gain, t, 0.001, 0.08, 0.18);
      src.connect(hp).connect(gain).connect(c.destination);
      src.start(t);
    },

    tick(frequency) {
      if (muted) return;
      blip(ensure().currentTime, frequency, 0.16);
    },

    action(type) {
      if (muted) return;
      const c = ensure();
      const t = c.currentTime;

      if (type === "strike") {
        [1800, 2712].forEach((frequency, i) => {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = "triangle";
          osc.frequency.value = frequency;
          env(gain, t, 0.001, 0.2 - 0.06 * i, [0.13, 0.07][i]);
          osc.connect(gain).connect(c.destination);
          osc.start(t);
          osc.stop(t + 0.3);
        });
        const src = c.createBufferSource();
        src.buffer = noise(c, 0.03, true);
        const hp = c.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 3200;
        const gain = c.createGain();
        env(gain, t, 0.001, 0.04, 0.1);
        src.connect(hp).connect(gain).connect(c.destination);
        src.start(t);
        return;
      }

      if (type === "guard") {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(95, t + 0.12);
        env(gain, t, 0.002, 0.16, 0.3);
        osc.connect(gain).connect(c.destination);
        osc.start(t);
        osc.stop(t + 0.2);
        const src = c.createBufferSource();
        src.buffer = noise(c, 0.05, true);
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 350;
        const g = c.createGain();
        env(g, t, 0.002, 0.07, 0.16);
        src.connect(lp).connect(g).connect(c.destination);
        src.start(t);
        return;
      }

      if (type === "bind") {
        [132, 130].forEach((frequency) => {
          const osc = c.createOscillator();
          const gain = c.createGain();
          const bp = c.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = 260;
          bp.Q.value = 2;
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(frequency, t);
          osc.frequency.linearRampToValueAtTime(0.8 * frequency, t + 0.24);
          env(gain, t, 0.02, 0.24, 0.12);
          osc.connect(bp).connect(gain).connect(c.destination);
          osc.start(t);
          osc.stop(t + 0.35);
        });
        return;
      }

      if (type === "feint") {
        const src = c.createBufferSource();
        src.buffer = noise(c, 0.2, false);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(1400, t);
        bp.frequency.exponentialRampToValueAtTime(500, t + 0.16);
        const gain = c.createGain();
        env(gain, t, 0.01, 0.15, 0.1);
        src.connect(bp).connect(gain).connect(c.destination);
        src.start(t);
        return;
      }

      if (type === "range") {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(700, t);
        osc.frequency.exponentialRampToValueAtTime(1500, t + 0.18);
        env(gain, t, 0.005, 0.16, 0.09);
        osc.connect(gain).connect(c.destination);
        osc.start(t);
        osc.stop(t + 0.25);
        return;
      }

      // A type this console has not heard of still makes a sound. The arena may
      // add one, and silence would read as a broken playback.
      blip(t, 1000, 0.1);
    },

    reelSpin(seconds) {
      if (muted) return;
      const t = ensure().currentTime;
      // Ticks that thin out quadratically: the reel is slowing, and a constant
      // interval reads as a machine rather than as something coming to rest.
      let at = 0;
      while (at < seconds - 0.08) {
        const progress = at / seconds;
        blip(t + at, 1500 - 700 * progress, 0.04);
        at += 0.055 + 0.16 * progress * progress;
      }
    },

    coinSpin(seconds) {
      if (muted) return;
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1720, t);
      osc.frequency.linearRampToValueAtTime(1540, t + seconds);
      gain.gain.setValueAtTime(0, t);
      // One pulse per rotation, which is what makes it read as spinning rather
      // than as a held tone.
      for (let at = 0; at < seconds - 0.07; at += 0.07) {
        gain.gain.linearRampToValueAtTime(0.045, t + at + 0.021);
        gain.gain.linearRampToValueAtTime(0.01, t + at + 0.07);
      }
      gain.gain.linearRampToValueAtTime(1e-4, t + seconds);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + seconds + 0.05);
    },

    coinLand(role) {
      if (muted) return;
      const t = ensure().currentTime;
      if (role === "THRONE") {
        chime(t, 520, 1.007, 0.26);
        chime(t + 0.13, 693, 1.007, 0.2);
      } else {
        chime(t, 392, 1.004, 0.26);
        chime(t + 0.13, 294, 1.004, 0.22);
      }
    },

    drum() {
      if (muted) return;
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(64, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
      env(gain, t, 0.006, 0.6, 0.7);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.7);
    },

    finale(winner) {
      if (muted) return;
      const t = ensure().currentTime;
      if (winner === "THRONE") {
        chord(t, [660, 990, 1320, 1980], [0.4, 0.22, 0.12, 0.06], 2.6);
      } else {
        chord(t, [196, 294, 392, 588], [0.5, 0.28, 0.14, 0.07], 3.2);
        chord(t + 0.7, [196, 294, 392, 588], [0.3, 0.17, 0.08, 0.04], 2.4);
      }
    },

    setMuted(next) {
      muted = next;
    },
  };
}
