/** In-browser ring-tone generator (Web Audio API). No external audio files —
 * synthesises two patterns with OscillatorNode + GainNode envelopes:
 *
 *   - "incoming": classic 2-tone phone ring (440 + 480 Hz), 1 s on / 2 s off.
 *   - "outgoing": single-tone dial wait (425 Hz), 1 s on / 3 s off.
 *
 * Each `start*` returns a `stop` function that cancels the next cycle and
 * releases nodes. Browsers gate AudioContext behind a user gesture — calling
 * `resume()` succeeds when the user has interacted with the page (clicking
 * the call button, an accept/decline button, or simply having focused
 * anything earlier). For the *incoming* case the ring is best-effort: if the
 * tab hasn't been touched yet, it'll silently fail; the visual banner is
 * still there.
 */

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx) return sharedCtx;
  try {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext;
    sharedCtx = new Ctor();
  } catch {
    return null;
  }
  return sharedCtx;
}

interface ToneSpec {
  freq: number[];
  /** Seconds the tone is audible per cycle. */
  onSecs: number;
  /** Silence between rings, in seconds. */
  offSecs: number;
  /** Peak gain — keep moderate, ring tones at full volume are unpleasant. */
  peakGain: number;
}

function scheduleCycle(
  ctx: AudioContext,
  spec: ToneSpec,
  destinationGain: GainNode,
): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const oscNodes: OscillatorNode[] = [];

  const playOne = () => {
    if (stopped) return;
    const start = ctx.currentTime;
    const end = start + spec.onSecs;
    // Envelope: fast attack 20 ms, sustain, fast release 50 ms — keeps the
    // tone musical-sounding without clicks at the edges.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(spec.peakGain, start + 0.02);
    env.gain.setValueAtTime(spec.peakGain, end - 0.05);
    env.gain.linearRampToValueAtTime(0, end);
    env.connect(destinationGain);
    for (const freq of spec.freq) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(env);
      osc.start(start);
      osc.stop(end + 0.01);
      oscNodes.push(osc);
    }
    // Schedule next cycle.
    timer = setTimeout(
      () => {
        if (!stopped) playOne();
      },
      (spec.onSecs + spec.offSecs) * 1000,
    );
  };

  playOne();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      for (const osc of oscNodes) {
        try {
          osc.stop();
        } catch {
          /* may already have stopped */
        }
        try {
          osc.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Start a looping ring pattern. Returns a `stop` function the caller must
 * invoke on cleanup (call accepted, declined, ended, or component unmount). */
export function startRingtone(pattern: "incoming" | "outgoing"): () => void {
  const ctx = getCtx();
  if (!ctx) return () => {};
  // Autoplay policy: AudioContext starts in "suspended" state until the page
  // gets a user gesture. resume() is a no-op if it's already running, and
  // succeeds silently if a gesture has happened. We don't await it because
  // even if it fails, the next gesture will unblock audio for future calls.
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  // Master volume node so we can fade out smoothly if asked later.
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const spec: ToneSpec =
    pattern === "incoming"
      ? { freq: [440, 480], onSecs: 1.0, offSecs: 2.0, peakGain: 0.18 }
      : { freq: [425], onSecs: 0.6, offSecs: 1.4, peakGain: 0.14 };
  const handle = scheduleCycle(ctx, spec, master);
  return () => {
    handle.stop();
    try {
      master.disconnect();
    } catch {
      /* ignore */
    }
  };
}
