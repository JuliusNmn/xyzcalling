import type { Landmark } from './rig/solvers';

export type MotionFrame = { time_seconds: number; world_landmarks: Landmark[] | null };
export const METRICS = [
  ['body_speed', 'Body movement speed', 'm/s', 'Mean speed of tracked shoulders, elbows, wrists, hips, knees and ankles relative to the hips; requires at least six joints.'],
  ['left_hand_speed', 'Left hand speed', 'm/s', 'Wrist speed relative to the hips.'],
  ['right_hand_speed', 'Right hand speed', 'm/s', 'Wrist speed relative to the hips.'],
  ['left_foot_speed', 'Left foot speed', 'm/s', 'Ankle speed relative to the hips.'],
  ['right_foot_speed', 'Right foot speed', 'm/s', 'Ankle speed relative to the hips.'],
  ['body_acceleration', 'Movement acceleration', 'm/s²', 'Signed change in body movement speed per second.'],
  ['hand_distance', 'Distance between hands', 'm', '3D distance between wrists.'],
  ['foot_distance', 'Distance between feet', 'm', '3D distance between ankles.'],
  ['left_hand_height', 'Left hand height', 'm', 'Wrist height above the hip midpoint; positive is up.'],
  ['right_hand_height', 'Right hand height', 'm', 'Wrist height above the hip midpoint; positive is up.'],
  ['left_foot_height', 'Left foot height', 'm', 'Ankle height above the hip midpoint; usually negative.'],
  ['right_foot_height', 'Right foot height', 'm', 'Ankle height above the hip midpoint; usually negative.'],
  ['left_elbow_angle', 'Left elbow angle', 'deg', 'Shoulder–elbow–wrist interior angle; 180° is straight.'],
  ['right_elbow_angle', 'Right elbow angle', 'deg', 'Shoulder–elbow–wrist interior angle; 180° is straight.'],
  ['left_knee_angle', 'Left knee angle', 'deg', 'Hip–knee–ankle interior angle; 180° is straight.'],
  ['right_knee_angle', 'Right knee angle', 'deg', 'Hip–knee–ankle interior angle; 180° is straight.'],
  ['torso_lean', 'Torso lean', 'deg', 'Angle of hip-to-shoulder midpoint from vertical; 0° is upright.'],
  ['torso_twist', 'Torso twist', 'deg', 'Signed shoulder heading minus hip heading in the horizontal plane, −180° to 180°.'],
  ['left_arm_reach', 'Left arm reach', 'ratio', 'Shoulder-to-wrist distance divided by upper arm plus forearm length; 1 is fully extended.'],
  ['right_arm_reach', 'Right arm reach', 'ratio', 'Shoulder-to-wrist distance divided by upper arm plus forearm length; 1 is fully extended.'],
] as const;
export type MetricId = typeof METRICS[number][0];
export type MotionChannel = { name: string; label: string; unit: string; description: string; values: number[]; valid: boolean[] };
export type MotionMetrics = { sampleRate: number; times: number[]; duration: number; channels: MotionChannel[]; frames: MotionFrame[] };
const body = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const sub = (a: Landmark, b: Landmark): Landmark => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (p: Landmark) => Math.hypot(p.x, p.y, p.z);
const distance = (a: Landmark, b: Landmark) => length(sub(a, b));
const midpoint = (a: Landmark, b: Landmark): Landmark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const degrees = 180 / Math.PI;
const angle = (a: Landmark, b: Landmark) => {
  const denominator = length(a) * length(b);
  return denominator < 1e-8 ? NaN : Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / denominator))) * degrees;
};
export function usable(p: Landmark | undefined, threshold: number): p is Landmark {
  return !!p && [p.x, p.y, p.z, p.visibility ?? 1].every(Number.isFinite) && (p.visibility ?? 1) >= threshold;
}

/** Excludes the irregular closing animation key: CHOPs use uniformly spaced samples in [0, duration). */
export function buildMotionMetrics(input: MotionFrame[], duration: number, threshold = .5, sampleRate = 30): MotionMetrics {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0 || duration * sampleRate > 100000) throw new Error('Invalid motion duration or sample rate.');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Invalid visibility threshold.');
  const count = Math.max(1, Math.ceil(duration * sampleRate - 1e-8));
  const frames = input.slice(0, count);
  if (frames.length !== count || frames.some((f, i) => !Number.isFinite(f.time_seconds) || Math.abs(f.time_seconds - i / sampleRate) > 1e-6)) throw new Error('Motion frames must be uniformly sampled from clip time zero.');
  const channels: MotionChannel[] = METRICS.map(([name, label, unit, description]) => ({ name, label, unit, description, values: [], valid: [] }));
  const byName = new Map(channels.map(c => [c.name, c]));
  const put = (id: MetricId, value: number) => {
    const c = byName.get(id)!; c.values.push(Number.isFinite(value) ? value : 0); c.valid.push(Number.isFinite(value));
  };
  let previousBodyMask = 0;
  frames.forEach((frame, i) => {
    const points = frame.world_landmarks;
    const has = (...ids: number[]) => ids.every(id => usable(points?.[id], threshold));
    const hip = has(23, 24) ? midpoint(points![23], points![24]) : undefined;
    const previous = frames[i - 1]?.world_landmarks;
    const previousHip = usable(previous?.[23], threshold) && usable(previous?.[24], threshold) ? midpoint(previous[23], previous[24]) : undefined;
    const speed = (id: number) => hip && previousHip && has(id) && usable(previous?.[id], threshold)
      ? distance(sub(points![id], hip), sub(previous[id], previousHip)) * sampleRate : NaN;
    const bodySpeeds = body.map(speed);
    const trackedSpeeds = bodySpeeds.filter(Number.isFinite);
    const bodyMask = bodySpeeds.reduce((mask, value, index) => Number.isFinite(value) ? mask | (1 << index) : mask, 0);
    put('body_speed', trackedSpeeds.length >= 6 ? trackedSpeeds.reduce((sum, value) => sum + value, 0) / trackedSpeeds.length : NaN);
    for (const [side, wrist, ankle] of [['left', 15, 27], ['right', 16, 28]] as const) {
      put(`${side}_hand_speed`, speed(wrist)); put(`${side}_foot_speed`, speed(ankle));
      put(`${side}_hand_height`, hip && has(wrist) ? hip.y - points![wrist].y : NaN);
      put(`${side}_foot_height`, hip && has(ankle) ? hip.y - points![ankle].y : NaN);
    }
    const movement = byName.get('body_speed')!;
    put('body_acceleration', i > 0 && movement.valid[i] && movement.valid[i - 1] && bodyMask === previousBodyMask ? (movement.values[i] - movement.values[i - 1]) * sampleRate : NaN);
    previousBodyMask = bodyMask;
    put('hand_distance', has(15, 16) ? distance(points![15], points![16]) : NaN);
    put('foot_distance', has(27, 28) ? distance(points![27], points![28]) : NaN);
    for (const [side, shoulder, elbow, wrist, hipId, knee, ankle] of [['left', 11, 13, 15, 23, 25, 27], ['right', 12, 14, 16, 24, 26, 28]] as const) {
      put(`${side}_elbow_angle`, has(shoulder, elbow, wrist) ? angle(sub(points![shoulder], points![elbow]), sub(points![wrist], points![elbow])) : NaN);
      put(`${side}_knee_angle`, has(hipId, knee, ankle) ? angle(sub(points![hipId], points![knee]), sub(points![ankle], points![knee])) : NaN);
      const armLength = has(shoulder, elbow, wrist) ? distance(points![shoulder], points![elbow]) + distance(points![elbow], points![wrist]) : NaN;
      put(`${side}_arm_reach`, armLength > 1e-8 ? distance(points![shoulder], points![wrist]) / armLength : NaN);
    }
    put('torso_lean', hip && has(11, 12) ? angle(sub(midpoint(points![11], points![12]), hip), { x: 0, y: -1, z: 0 }) : NaN);
    let twist = NaN;
    if (has(11, 12, 23, 24)) {
      const shoulders = sub(points![12], points![11]), hips = sub(points![24], points![23]);
      if (Math.hypot(shoulders.x, shoulders.z) > 1e-8 && Math.hypot(hips.x, hips.z) > 1e-8) {
        twist = (Math.atan2(shoulders.z, shoulders.x) - Math.atan2(hips.z, hips.x)) * degrees;
        twist = ((twist + 180) % 360 + 360) % 360 - 180;
      }
    }
    put('torso_twist', twist);
  });
  return { sampleRate, duration, times: frames.map(f => f.time_seconds), frames, channels };
}

export function motionExportChannels(data: MotionMetrics, includeJoints = false, threshold = .5) {
  const channels = data.channels.flatMap(c => [
    { name: c.name, values: c.values }, { name: `${c.name}_valid`, values: c.valid.map(v => v ? 1 : 0) },
  ]);
  channels.push({ name: 'clip_time', values: data.times });
  if (includeJoints) for (let joint = 0; joint < 33; joint++) {
    for (const axis of ['x', 'y', 'z'] as const) channels.push({ name: `joint_${joint}_${axis}`, values: data.frames.map(f => usable(f.world_landmarks?.[joint], threshold) ? f.world_landmarks![joint][axis] : 0) });
    channels.push({ name: `joint_${joint}_valid`, values: data.frames.map(f => usable(f.world_landmarks?.[joint], threshold) ? 1 : 0) });
  }
  return channels;
}
