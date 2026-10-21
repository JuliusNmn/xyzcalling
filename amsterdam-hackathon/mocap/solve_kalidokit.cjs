// Offline KalidoKit pass over saved MediaPipe landmarks; no inference or uploads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function canonicalPose() {
  const world = Array.from({length: 33}, () => ({x: 0, y: -0.5, z: 0, visibility: 1}));
  const set = (i, x, y, z = 0) => { world[i] = {x, y, z, visibility: 1}; };
  set(11, .25, -.5); set(12, -.25, -.5);
  set(13, .5, -.5); set(14, -.5, -.5);
  set(15, .75, -.5); set(16, -.75, -.5);
  for (const i of [17, 19, 21]) set(i, .8, -.5);
  for (const i of [18, 20, 22]) set(i, -.8, -.5);
  set(23, .12, 0); set(24, -.12, 0);
  set(25, .12, .4); set(26, -.12, .4);
  set(27, .12, .8); set(28, -.12, .8);
  set(29, .12, .8, .02); set(30, -.12, .8, .02);
  set(31, .12, .8, -.15); set(32, -.12, .8, -.15);
  return world;
}

function solve(Pose, world, image) {
  return Pose.solve(structuredClone(world), structuredClone(image),
                    {runtime: 'mediapipe', enableLegs: true});
}

function main() {
  const [moduleDir, input, output] = process.argv.slice(2);
  if (!moduleDir || !input || !output) throw Error('Usage: node solve_kalidokit.cjs MODULE_DIR INPUT OUTPUT');
  if (fs.existsSync(output)) throw Error(`Refusing to overwrite ${output}`);
  // Package main uses legacy extensionless ESM imports; bundled UMD works in Node.
  const {Pose} = require(path.join(path.resolve(moduleDir), 'dist/kalidokit.umd.js'));
  const version = require(path.join(path.resolve(moduleDir), 'package.json')).version;
  if (version !== '1.1.5') throw Error(`Unexpected KalidoKit version: ${version}`);
  const bytes = fs.readFileSync(input);
  const data = JSON.parse(bytes);
  if (data.schema !== 'mediapipe-mixamo-v1') throw Error('Unsupported input schema');
  const rest = canonicalPose();
  const image = world => world.map(p => ({...p, x: .5 + p.x * .35, y: .5 + p.y * .5}));
  const probes = {rest};
  const raised = structuredClone(rest);
  for (const [id, dx] of [[13, .25], [15, .5], [17, .55], [19, .55], [21, .55]]) {
    raised[id].x = .25 + dx * .7071;
    raised[id].y = -.5 - dx * .7071;
  }
  probes.left_arm_raised = raised;
  const knee = structuredClone(rest);
  knee[25].z = -.2; knee[25].y = .34641;
  knee[27].z = -.2; knee[27].y = .74641;
  probes.left_knee_forward = knee;
  const reference = solve(Pose, rest, image(rest));
  const frames = data.frames.map(frame => {
    let rig = null;
    if (frame.world && frame.image) rig = solve(Pose, frame.world, frame.image);
    return {time: frame.time, rig};
  });
  const result = {
    schema: 'kalidokit-mixamo-v1', kalidokit_version: version,
    input_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    fps: data.fps, source: data.source, reference,
    probes: Object.fromEntries(Object.entries(probes).map(([name, world]) =>
      [name, {world, rig: solve(Pose, world, image(world))}])),
    frames,
  };
  // JSON.stringify silently turns NaN into null; reject that before serialization.
  function finite(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Nonfinite solver output');
    if (value && typeof value === 'object') Object.values(value).forEach(finite);
  }
  finite(result);
  fs.writeFileSync(output, JSON.stringify(result), {flag: 'wx'});
  console.log(JSON.stringify({version, frames: frames.length,
    reference, leftArmRaised: result.probes.left_arm_raised.rig,
    leftKneeForward: result.probes.left_knee_forward.rig}, null, 2));
}

if (require.main === module) main();
module.exports = {canonicalPose, solve};
