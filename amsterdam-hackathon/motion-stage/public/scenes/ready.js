// READY / ACID RUBBER — a kinetic sculpture stretched by the dancer.
// Low: character opacity (renderer). Mid: rubber distortion. High: shard frenzy.
// Absolute track time keeps pauses, cue jumps and loops free of accumulated drift.
const TAU = Math.PI * 2;
const valid = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const unit = (v, fallback) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
export default function createScene({THREE, group, camera, getModel = () => null}) {
  const palette = ['#e4ff3f', '#ff3d9a', '#42edec', '#9c6bff'];
  const segments = 144, ribbons = [];
  for (let layer = 0; layer < 7; layer++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segments + 1) * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const indices = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: palette[layer % 4], side: THREE.DoubleSide, toneMapped: false}));
    mesh.name = `Ready rubber ribbon ${layer + 1}`;
    mesh.frustumCulled = false;
    group.add(mesh); ribbons.push(mesh);
  }
  const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({toneMapped: false}), 96);
  shards.name = 'Ready limb confetti'; shards.frustumCulled = false;
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < 96; i++) shards.setColorAt(i, new THREE.Color(palette[i % 4]));
  group.add(shards);
  const footRings = ['leftFoot', 'rightFoot'].map((name, i) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(.22, .012, 6, 64), new THREE.MeshBasicMaterial({color: palette[i ? 1 : 2], toneMapped: false}));
    mesh.name = `Ready ${name} orbit`; group.add(mesh); return mesh;
  });
  const root = new THREE.Vector3(), head = new THREE.Vector3(), left = new THREE.Vector3(), right = new THREE.Vector3();
  const point = new THREE.Vector3(), axis = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const dummy = new THREE.Object3D(), look = new THREE.Vector3();
  const anchors = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'];
  const boneNames = {head:'Head', leftHand:'LeftHand', rightHand:'RightHand', leftFoot:'LeftFoot', rightFoot:'RightFoot'};
  let model = null, bones = new Map(), savedCamera = null;
  function anchor(name, positions, target) {
    if (!valid(positions[name])) return false;
    const bone = bones.get(boneNames[name]);
    if (bone) bone.getWorldPosition(target); else target.fromArray(positions[name]);
    return Number.isFinite(target.x + target.y + target.z);
  }
  return {
    color: '#eedbff', background: '#090513', environment: false, wireframe: false,
    update(deck) {
      const positions = deck.pose?.worldPositions;
      group.visible = !!positions && !!deck.animation && valid(positions.head);
      if (!group.visible) return;
      const nextModel = getModel();
      if (nextModel !== model) {
        model = nextModel; bones = new Map();
        model?.traverse(n => { if (n.isBone) bones.set(n.name.replace(/^.*:/, '').replace(/^mixamorig\d*/i, ''), n); });
      }
      anchor('head', positions, head);
      if (bones.has('Hips')) bones.get('Hips').getWorldPosition(root);
      else root.copy(head).addScaledVector(new THREE.Vector3(0, 1, 0), -.72);
      const hasLeft = anchor('leftHand', positions, left), hasRight = anchor('rightHand', positions, right);
      if (!hasLeft) left.copy(root).add(new THREE.Vector3(-.55, .15, 0));
      if (!hasRight) right.copy(root).add(new THREE.Vector3(.55, .15, 0));
      const rubber = unit(deck.params?.rubberWarp, .55), frenzy = unit(deck.params?.shardFrenzy, .5);
      const time = Number.isFinite(deck.animation.time) ? deck.animation.time : (Number.isFinite(deck.time) ? deck.time : 0);
      const beat = Number.isFinite(deck.beat) ? deck.beat : time * (Number.isFinite(deck.bpm) ? deck.bpm : 126) / 60;
      const phase = beat * TAU / 8;
      const span = Math.min(2.4, left.distanceTo(right));
      const lean = Math.max(-.6, Math.min(.6, head.x - root.x));
      const tilt = Math.atan2(right.y - left.y, Math.max(.3, Math.abs(right.x - left.x))) * .5;
      if (!savedCamera) savedCamera = {position: camera.position.clone(), quaternion: camera.quaternion.clone()};
      // Follow translation, but keep the sculpture framed with a steady front view.
      camera.position.copy(root).add(new THREE.Vector3(.25, .35, 6.5));
      camera.lookAt(look.copy(root).add(new THREE.Vector3(0, .12, 0))); camera.updateMatrixWorld(true);
      for (let layer = 0; layer < ribbons.length; layer++) {
        const mesh = ribbons[layer], data = mesh.geometry.attributes.position;
        const radius = .83 + layer * .125 + span * .12;
        const width = (layer % 3 === 0 ? .052 : .021) * (1 + rubber * .8);
        for (let i = 0; i <= segments; i++) {
          const a = i / segments * TAU;
          // Opposite hand heights pull opposite sides; the head bends the top.
          const blend = .5 + .5 * Math.cos(a);
          const pull = (left.y - root.y) * (1 - blend) + (right.y - root.y) * blend;
          const wave = Math.sin(a * 3 + phase + layer * .6) * .12 + Math.cos(a * 5 - phase * .6) * .06;
          const r = radius + rubber * wave + Math.sin(a) * lean * .22;
          for (let edge = 0; edge < 2; edge++) {
            const re = r + (edge ? width : -width);
            const x = Math.cos(a) * re * (1 + rubber * span * .15);
            const y = Math.sin(a) * re * .78 + pull * .23 * rubber;
            data.setXYZ(i * 2 + edge,
              root.x + x * Math.cos(tilt) - y * Math.sin(tilt),
              root.y + .15 + x * Math.sin(tilt) + y * Math.cos(tilt),
              root.z - .45 + Math.sin(a * 2 + phase + layer * .4) * (.12 + rubber * .38));
          }
        }
        data.needsUpdate = true;
      }
      let count = 0;
      for (let limb = 0; limb < anchors.length; limb++) {
        if (!anchor(anchors[limb], positions, point)) continue;
        axis.copy(point).sub(root);
        if (axis.lengthSq() < .0001) axis.set(limb % 2 ? 1 : -1, 0, 0);
        axis.normalize(); side.set(0, 0, 1).cross(axis).normalize();
        if (side.lengthSq() < .001) side.set(1, 0, 0);
        up.crossVectors(axis, side).normalize();
        for (let j = 0; j < 24; j++) {
          const f = j / 24, angle = f * TAU * 2 + phase * (limb % 2 ? -1 : 1) + limb;
          const radius = (.045 + f * (.13 + frenzy * .48)) * (1 + .15 * Math.sin(phase + limb));
          dummy.position.copy(point).addScaledVector(axis, f * (.25 + frenzy * .8))
            .addScaledVector(side, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius);
          dummy.rotation.set(angle, phase + f * 5, angle * .5);
          const size = (.012 + frenzy * .043) * (1 - f * .65);
          dummy.scale.set(size, size * (2 + frenzy * 2), size);
          dummy.updateMatrix(); shards.setMatrixAt(count++, dummy.matrix);
        }
      }
      shards.count = count; shards.instanceMatrix.needsUpdate = true;
      footRings.forEach((mesh, i) => {
        mesh.visible = anchor(anchors[i + 2], positions, point);
        if (!mesh.visible) return;
        mesh.position.copy(point); mesh.rotation.set(Math.PI / 2 + .25 * Math.sin(phase + i), 0, phase * .3);
        mesh.scale.setScalar(.8 + rubber * .8 + Math.max(0, point.y) * .25);
      });
    },
    dispose() {
      if (savedCamera) { camera.position.copy(savedCamera.position); camera.quaternion.copy(savedCamera.quaternion); camera.updateMatrixWorld(true); }
      // Attached meshes and materials are owned and disposed by the renderer.
    },
  };
}
