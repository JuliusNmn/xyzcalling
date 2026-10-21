import { AnimationClip, Quaternion, QuaternionKeyframeTrack, QuaternionLinearInterpolant } from 'three';

export type AnimationProcessing = {
  smoothing: 'off' | 'light' | 'balanced' | 'strong';
  preserveAccents: boolean;
  advanceMs: number;
  beatStrength: number;
};
export const DEFAULT_PROCESSING: AnimationProcessing = {
  smoothing: 'light', preserveAccents: true, advanceMs: 0, beatStrength: 0,
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export function processingSettings(value: AnimationProcessing): AnimationProcessing {
  return { smoothing: ['off', 'light', 'balanced', 'strong'].includes(value.smoothing) ? value.smoothing : 'light',
    preserveAccents: !!value.preserveAccents,
    advanceMs: clamp(Number.isFinite(value.advanceMs) ? value.advanceMs : 0, -250, 250),
    beatStrength: clamp(Number.isFinite(value.beatStrength) ? value.beatStrength : 0, 0, 1) };
}

/** Centered, hemisphere-correct quaternion averaging. No recursive filter history. */
export function smoothRotations(times: ArrayLike<number>, values: ArrayLike<number>, radius: number, accents: boolean): number[] {
  const rotations = Array.from({ length: times.length }, (_, i) => new Quaternion().fromArray(values, i * 4).normalize());
  if (!radius) return Array.from(values);
  const result: number[] = [], window = radius / 30, sigma = window / 2;
  for (let i = 0; i < rotations.length; i++) {
    const center = rotations[i];
    // Shrink the change during fast movement. The symmetric measurement treats
    // forward and reverse playback alike and does not introduce a trailing filter.
    const speed = Math.max(
      i ? center.angleTo(rotations[i - 1]) / Math.max(.001, times[i] - times[i - 1]) : 0,
      i + 1 < rotations.length ? center.angleTo(rotations[i + 1]) / Math.max(.001, times[i + 1] - times[i]) : 0);
    const blend = accents ? 1 / (1 + (speed / 4) ** 2) : 1;
    const average = new Quaternion(0, 0, 0, 0);
    for (let j = Math.max(0, i - radius - 1); j <= Math.min(rotations.length - 1, i + radius + 1); j++) {
      const dt = times[j] - times[i];
      if (Math.abs(dt) > window + 1e-6) continue;
      const q = rotations[j], weight = Math.exp(-.5 * (dt / sigma) ** 2) * (center.dot(q) < 0 ? -1 : 1);
      average.x += weight * q.x; average.y += weight * q.y; average.z += weight * q.z; average.w += weight * q.w;
    }
    result.push(...center.clone().slerp(average.normalize(), blend).normalize().toArray());
  }
  return result;
}

export type TimingAnchor = { output: number; input: number };
/** Conservative whole-body retiming: one monotonic time map for every bone. */
export function beatAnchors(times: ArrayLike<number>, energy: number[], beats: number[], duration: number, strength: number): TimingAnchor[] {
  const anchors: TimingAnchor[] = [{ output: 0, input: 0 }];
  if (strength > 0 && beats.length) {
    const sorted = [...energy].sort((a, b) => a - b);
    const threshold = Math.max(.75, (sorted[Math.floor(sorted.length / 2)] ?? 0) * 1.3);
    const candidates: { input: number; output: number; energy: number }[] = [];
    const available = beats.filter(t => Number.isFinite(t) && t > 0 && t < duration).sort((a, b) => a - b);
    let beatIndex = 0;
    for (let i = 2; i < times.length - 2; i++) {
      if (energy[i] < threshold || energy[i] <= energy[i - 1] || energy[i] < energy[i + 1] ||
          energy[i] < energy[i - 2] || energy[i] < energy[i + 2] || !available.length) continue;
      while (beatIndex + 1 < available.length && Math.abs(available[beatIndex + 1] - times[i]) < Math.abs(available[beatIndex] - times[i])) beatIndex++;
      const delta = available[beatIndex] - times[i];
      if (Math.abs(delta) > .08) continue;
      candidates.push({ input: times[i], output: times[i] + delta * strength, energy: energy[i] });
    }
    // Keep the strongest nearby accent, then enforce ordering and bounded speed.
    const selected: typeof candidates = [];
    for (const c of candidates.sort((a, b) => b.energy - a.energy)) {
      if (selected.every(other => Math.abs(c.input - other.input) >= .2)) selected.push(c);
    }
    for (const c of selected.sort((a, b) => a.input - b.input)) {
      const last = anchors.at(-1)!;
      const slope = (c.input - last.input) / (c.output - last.output);
      const tailSlope = (duration - c.input) / (duration - c.output);
      if (c.output > last.output && slope >= .75 && slope <= 1.25 && tailSlope >= .75 && tailSlope <= 1.25) anchors.push({ output: c.output, input: c.input });
    }
  }
  anchors.push({ output: duration, input: duration });
  return anchors;
}
export function mappedTime(time: number, anchors: TimingAnchor[], advanceMs: number, duration: number) {
  const t = clamp(time + advanceMs / 1000, 0, duration);
  let lo = 0, hi = anchors.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (anchors[mid].output <= t) lo = mid; else hi = mid; }
  const a = anchors[lo], b = anchors[hi];
  return a.input + (b.input - a.input) * (t - a.output) / Math.max(1e-9, b.output - a.output);
}

export function processAnimation(animation: ReturnType<typeof AnimationClip.toJSON>, options: AnimationProcessing, beats: number[] = []) {
  const settings = processingSettings(options), clip = AnimationClip.parse(animation);
  const radius = { off: 0, light: 2, balanced: 3, strong: 5 }[settings.smoothing];
  const first = clip.tracks[0];
  if (!first || !clip.tracks.every(track => track instanceof QuaternionKeyframeTrack && track.times.length === first.times.length && track.times.every((t, i) => t === first.times[i]))) {
    throw new Error('Motion processing requires matching quaternion tracks.');
  }
  const times = first.times, energy = Array.from(times, () => 0);
  // Use angular motion, not noisy acceleration; all tracks share the same warp.
  const filtered = clip.tracks.map(track => {
    const values = smoothRotations(track.times, track.values, radius, settings.preserveAccents);
    for (let i = 1; i < times.length - 1; i++) {
      const before = new Quaternion().fromArray(values, (i - 1) * 4), after = new Quaternion().fromArray(values, (i + 1) * 4);
      energy[i] += before.angleTo(after) / Math.max(.001, times[i + 1] - times[i - 1]) / clip.tracks.length;
    }
    return new QuaternionKeyframeTrack(track.name, track.times, values);
  });
  const anchors = beatAnchors(times, energy, beats, clip.duration, settings.beatStrength);
  const tracks = filtered.map(track => {
    const interpolant = new QuaternionLinearInterpolant(track.times, track.values, 4);
    const values: number[] = [];
    for (const time of times) values.push(...interpolant.evaluate(mappedTime(time, anchors, settings.advanceMs, clip.duration)));
    return new QuaternionKeyframeTrack(track.name, times, values);
  });
  return { animation: AnimationClip.toJSON(new AnimationClip(clip.name, clip.duration, tracks)),
    processing: { ...settings, method: 'centered-quaternion-average', window_frames: radius * 2 + 1,
      aligned_accents: anchors.length - 2, max_beat_shift_ms: 80 * settings.beatStrength, timing_anchors: anchors,
      note: 'Applied to bone animation only. Source landmarks and rhythm timestamps remain unchanged. Positive advance moves motion earlier; edges hold the nearest pose. Beat alignment is heuristic and changes performance timing.' } };
}
