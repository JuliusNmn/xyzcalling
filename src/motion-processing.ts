import { mappedTime, processingSettings, type AnimationProcessing, type TimingAnchor } from './animation-processing';
import { usable, type MotionFrame } from './motion-metrics';
import type { Landmark } from './rig/solvers';

const invalid = (): Landmark => ({ x: NaN, y: NaN, z: NaN, visibility: 0 });
const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Smooth positions before computing distances, angles and derivatives. Never fill tracking gaps. */
export function processMotionFrames(input: MotionFrame[], duration: number, threshold: number,
  options: AnimationProcessing, anchors: TimingAnchor[]) {
  if (input.length < 2 || input.some((f, i) => !Number.isFinite(f.time_seconds) || (i > 0 && f.time_seconds <= input[i - 1].time_seconds))) {
    throw new Error('Motion processing requires increasing frame timestamps.');
  }
  const settings = processingSettings(options);
  const radius = { off: 0, light: 2, balanced: 3, strong: 5 }[settings.smoothing];
  const window = radius / 30, sigma = window / 2;
  const smooth: MotionFrame[] = input.map(f => ({ time_seconds: f.time_seconds, world_landmarks: Array.from({ length: 33 }, invalid) }));
  const invalidCounts: number[][] = [];
  for (let joint = 0; joint < 33; joint++) {
    const prefix = invalidCounts[joint] = [0];
    input.forEach((f, i) => prefix.push(prefix[i] + Number(!usable(f.world_landmarks?.[joint], threshold))));
    let start = 0;
    while (start < input.length) {
      if (!usable(input[start].world_landmarks?.[joint], threshold)) { start++; continue; }
      let end = start + 1;
      while (end < input.length && usable(input[end].world_landmarks?.[joint], threshold)) end++;
      for (let i = start; i < end; i++) {
        const point = input[i].world_landmarks![joint];
        if (!radius) { smooth[i].world_landmarks![joint] = { ...point }; continue; }
        const speed = Math.max(
          i > start ? distance(point, input[i - 1].world_landmarks![joint]) / (input[i].time_seconds - input[i - 1].time_seconds) : 0,
          i + 1 < end ? distance(point, input[i + 1].world_landmarks![joint]) / (input[i + 1].time_seconds - input[i].time_seconds) : 0);
        const blend = settings.preserveAccents ? 1 / (1 + (speed / 1.5) ** 2) : 1;
        let x = 0, y = 0, z = 0, total = 0;
        for (let j = Math.max(start, i - radius - 1); j < Math.min(end, i + radius + 2); j++) {
          const dt = input[j].time_seconds - input[i].time_seconds;
          if (Math.abs(dt) > window + 1e-6) continue;
          const weight = Math.exp(-.5 * (dt / sigma) ** 2), neighbor = input[j].world_landmarks![joint];
          x += weight * neighbor.x; y += weight * neighbor.y; z += weight * neighbor.z; total += weight;
        }
        smooth[i].world_landmarks![joint] = { x: point.x + (x / total - point.x) * blend,
          y: point.y + (y / total - point.y) * blend, z: point.z + (z / total - point.z) * blend,
          visibility: point.visibility ?? 1 };
      }
      start = end;
    }
  }
  const sourceTimes = input.map(f => mappedTime(f.time_seconds, anchors, settings.advanceMs, duration));
  let lower = 0, previousLower = 0;
  const frames = input.map((frame, index): MotionFrame => {
    const sourceTime = sourceTimes[index];
    while (lower + 1 < input.length && input[lower + 1].time_seconds <= sourceTime + 1e-8) lower++;
    const upper = Math.min(input.length - 1, lower + 1);
    const fraction = Math.max(0, Math.min(1, (sourceTime - input[lower].time_seconds) / Math.max(1e-9, input[upper].time_seconds - input[lower].time_seconds)));
    const points = Array.from({ length: 33 }, (_, joint) => {
      const a = smooth[lower].world_landmarks![joint], b = smooth[upper].world_landmarks![joint];
      // A compressed time interval must not jump over an unseen source gap.
      const crossedGap = index > 0 && lower > previousLower + 1 && invalidCounts[joint][lower] - invalidCounts[joint][previousLower + 1] > 0;
      if (crossedGap || !usable(a, threshold) || (fraction > 1e-7 && !usable(b, threshold))) return invalid();
      if (fraction <= 1e-7) return { ...a };
      return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction,
        z: a.z + (b.z - a.z) * fraction, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) };
    });
    previousLower = lower;
    return { time_seconds: frame.time_seconds, world_landmarks: points };
  });
  return { frames, sourceTimes };
}
