export const CONTACT = .035, RELEASE = .075, COOLDOWN = .18;
export const WAVE_LIFETIME = 2.4;
const percentile = (values, fraction) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];

export function rootAt(motion, time) {
  const frame = Math.max(0, Math.min(motion.root_xz.length - 1, time * motion.fps));
  const lo = Math.floor(frame), hi = Math.min(lo + 1, motion.root_xz.length - 1), f = frame - lo;
  return [0, 1].map(axis => motion.root_xz[lo][axis] * (1 - f) + motion.root_xz[hi][axis] * f);
}

/** Offline contacts make scrubbing, looping and playback speed deterministic. */
export function analyzeFootfalls(samples, fps) {
  if (!samples.length) return { floor: [], events: [] };
  const low = samples.map(sample => Math.min(...sample.feet.map(foot => foot[1])));
  // A 3 s lower envelope rejects jumps and isolated low tracking outliers.
  const radius = Math.round(fps * 1.5);
  const envelope = low.map((_, i) => percentile(low.slice(Math.max(0, i - radius), Math.min(low.length, i + radius + 1)), .2));
  const smooth = Math.round(fps * .25);
  const floor = envelope.map((_, i) => {
    const window = envelope.slice(Math.max(0, i - smooth), Math.min(envelope.length, i + smooth + 1));
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
  const events = [];
  for (let foot = 0; foot < 2; foot++) {
    let armed = false, last = -Infinity, peakDescent = 0;
    for (let i = 1; i < samples.length; i++) {
      const sample = samples[i], p = sample.feet[foot], height = p[1] - floor[i];
      const velocity = (p[1] - samples[i - 1].feet[foot][1]) * fps;
      if (height >= RELEASE) armed = true;
      if (armed) peakDescent = Math.max(peakDescent, -velocity);
      if (armed && height <= CONTACT && velocity < .08 && sample.time - last >= COOLDOWN) {
        events.push({ time: sample.time, x: p[0] + sample.root[0], z: p[2] + sample.root[1],
          strength: Math.min(1.5, .55 + peakDescent * .65), foot });
        last = sample.time; armed = false; peakDescent = 0;
      }
    }
  }
  return { floor, events: events.sort((a, b) => a.time - b.time) };
}
