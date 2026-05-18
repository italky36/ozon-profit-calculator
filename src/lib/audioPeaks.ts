/** Decode an audio resource into a fixed-size array of normalised peak
 *  amplitudes (0..1). Used by the chat audio player to render a waveform
 *  visualisation of voice messages and uploaded audio attachments.
 *
 *  Two entry points:
 *   - `extractPeaksFromUrl(url, buckets)` — fetches the bytes, decodes
 *     via shared AudioContext, downsamples. Used for attachments already
 *     uploaded to the server.
 *   - `extractPeaksFromBlob(blob, buckets)` — same path but skipping the
 *     network. Used for the recording-preview before the blob is uploaded.
 *
 *  Caveats:
 *   - decodeAudioData loads the WHOLE clip into PCM in memory. Voice
 *     messages are ≤ ~1 MB so this is fine; for arbitrary long uploads
 *     callers may want a duration cap upstream.
 *   - Some webm/opus blobs report Infinity duration on first decode in
 *     Chrome. The PCM-based peak extraction still works because we read
 *     channelData by index, not by time.
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

/** Downsample PCM to `buckets` peaks. For each bucket we take the max
 *  |sample| across the slice so quiet sections show low bars and loud
 *  ones high — same approach as Telegram/WhatsApp. */
function bucketize(channelData: Float32Array, buckets: number): number[] {
  if (channelData.length === 0 || buckets <= 0) return [];
  const out = new Array<number>(buckets).fill(0);
  const sliceLen = channelData.length / buckets;
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * sliceLen);
    const end = Math.min(channelData.length, Math.floor((i + 1) * sliceLen));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channelData[j]!);
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  // Normalise so the loudest bucket maps to 1.0 — keeps short, quiet
  // recordings visually meaningful instead of flat.
  let max = 0;
  for (const v of out) if (v > max) max = v;
  if (max > 0) {
    for (let i = 0; i < out.length; i++) out[i] = out[i] / max;
  }
  return out;
}

async function decodeArrayBuffer(buf: ArrayBuffer): Promise<AudioBuffer | null> {
  const ctx = getCtx();
  if (!ctx) return null;
  // decodeAudioData has both promise-based and callback-based signatures;
  // wrap to handle Safari which still requires callbacks.
  return new Promise((resolve) => {
    try {
      const maybe = ctx.decodeAudioData(
        buf,
        (b) => resolve(b),
        () => resolve(null),
      );
      // Modern browsers also return a Promise.
      if (maybe && typeof (maybe as Promise<AudioBuffer>).then === "function") {
        (maybe as Promise<AudioBuffer>)
          .then((b) => resolve(b))
          .catch(() => resolve(null));
      }
    } catch {
      resolve(null);
    }
  });
}

export async function extractPeaksFromUrl(
  url: string,
  buckets: number,
): Promise<number[] | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const audio = await decodeArrayBuffer(buf);
    if (!audio) return null;
    return bucketize(audio.getChannelData(0), buckets);
  } catch {
    return null;
  }
}

export async function extractPeaksFromBlob(
  blob: Blob,
  buckets: number,
): Promise<number[] | null> {
  try {
    const buf = await blob.arrayBuffer();
    const audio = await decodeArrayBuffer(buf);
    if (!audio) return null;
    return bucketize(audio.getChannelData(0), buckets);
  } catch {
    return null;
  }
}
