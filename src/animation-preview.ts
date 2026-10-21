import { AnimationClip, Box3, Color, DirectionalLight, GridHelper, HemisphereLight, LoadingManager,
  Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Group, type SkinnedMesh } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnimationPlayback } from './animation-playback';
import type { extractAnimation } from './animation-export';

export type DanceAnimation = Awaited<ReturnType<typeof extractAnimation>>;

export class AnimationPreview {
  private scene = new Scene();
  private camera = new PerspectiveCamera(34, 1, .01, 100);
  private renderer = new WebGLRenderer({ antialias: true });
  private orbit: OrbitControls;
  private resize: ResizeObserver;
  private character?: Group;
  private playback?: AnimationPlayback;
  private disposed = false;
  private lastTime?: number;
  private viewport: HTMLElement;
  private target = new Vector3();
  private distance = 4;

  constructor(private host: HTMLElement) {
    host.innerHTML = `
      <div class="viewer-toolbar"><strong>Animation loop preview</strong><button class="text-button" data-preview="camera">Reset camera</button></div>
      <div class="animation-preview-canvas"></div>
      <div class="animation-preview-controls">
        <button class="secondary-button" data-preview="play">Pause loop</button>
        <button class="text-button" data-preview="restart">Restart</button>
        <label>Speed <select data-preview="speed" aria-label="Animation preview speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>
        <output data-preview="time">0.00 / 0.00s</output>
      </div>
      <label class="animation-scrubber">Animation position<input data-preview="seek" type="range" min="0" max="1" step="0.001" value="0" /></label>
      <p class="audio-status" data-preview="details"></p>
      <p class="audio-footnote">Loops the extracted animation. The end jumps directly to the start so you can inspect the seam. Download contains one cycle, at its original speed.</p>`;
    this.viewport = host.querySelector('.animation-preview-canvas')!;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'Extracted animation preview. Drag to orbit; scroll to zoom.');
    this.viewport.append(this.renderer.domElement);
    this.scene.background = new Color('#e8ede5');
    this.scene.add(new HemisphereLight(0xffffff, 0x809078, 2.4));
    const key = new DirectionalLight(0xfff5de, 3); key.position.set(3, 5, 4); this.scene.add(key);
    const fill = new DirectionalLight(0xd8e8ff, 1.6); fill.position.set(-3, 2, -2); this.scene.add(fill);
    const grid = new GridHelper(6, 30, '#afbfaa', '#d2dbca'); grid.position.y = -.02; this.scene.add(grid);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true; this.orbit.minDistance = 1; this.orbit.maxDistance = 8;
    this.resetCamera();
    this.resize = new ResizeObserver(() => this.resizeViewport()); this.resize.observe(this.viewport);
    this.el('play').addEventListener('click', () => {
      if (this.playback) this.playback.playing = !this.playback.playing;
      this.sync();
    });
    this.el('restart').addEventListener('click', () => { this.playback?.seek(0); this.sync(); });
    this.el('camera').addEventListener('click', () => this.resetCamera());
    this.el('speed').addEventListener('change', () => {
      if (this.playback) this.playback.speed = Number(this.el<HTMLSelectElement>('speed').value);
    });
    this.el('seek').addEventListener('input', () => {
      if (!this.playback) return;
      this.playback.playing = false;
      this.playback.seek(Number(this.el<HTMLInputElement>('seek').value)); this.sync();
    });
    this.renderer.setAnimationLoop(time => {
      if (this.disposed) return;
      const delta = this.lastTime === undefined ? 0 : Math.min(.1, (time - this.lastTime) / 1000);
      this.lastTime = time;
      this.playback?.update(delta); this.sync();
      this.orbit.update(); this.renderer.render(this.scene, this.camera);
    });
  }
  private el<T extends HTMLElement = HTMLElement>(name: string) { return this.host.querySelector<T>(`[data-preview="${name}"]`)!; }
  async load(data: DanceAnimation, signal: AbortSignal) {
    const response = await fetch('/character/Chicken%20Dance.fbx', { signal });
    if (!response.ok) throw new Error('The animation preview character could not be loaded.');
    const bytes = await response.arrayBuffer(); signal.throwIfAborted();
    if (this.disposed) return;
    const manager = new LoadingManager();
    manager.setURLModifier(url => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;
      const name = decodeURIComponent(url).replaceAll('\\', '/').split('/').pop();
      return `/character/Chicken%20Dance.fbm/${encodeURIComponent(name || '')}`;
    });
    const character = this.character = new FBXLoader(manager).parse(bytes, '');
    character.animations = [];
    const root = data.rig.root_transform;
    character.position.fromArray(root.position); character.quaternion.fromArray(root.quaternion); character.scale.fromArray(root.scale);
    for (const entry of data.rig.bones) {
      const bone = character.getObjectByName(entry.name);
      if (!bone) throw new Error(`Preview character is missing ${entry.name}.`);
      bone.position.fromArray(entry.position); bone.quaternion.fromArray(entry.quaternion); bone.scale.fromArray(entry.scale);
    }
    character.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) object.frustumCulled = false; });
    character.updateMatrixWorld(true);
    this.scene.add(character);
    const bounds = new Box3().setFromObject(character);
    bounds.getCenter(this.target); this.distance = Math.max(3, bounds.getSize(new Vector3()).y * 2.3);
    this.resetCamera(); this.resizeViewport();
    this.playback = new AnimationPlayback(character, AnimationClip.parse(data.animation));
    this.el<HTMLInputElement>('seek').max = String(this.playback.clip.duration);
    this.el('details').textContent = `${data.solver.name === 'custom' ? 'Custom' : 'Kalidokit'} · ${data.duration_seconds.toFixed(2)}s · ${data.quality.tracked_frames}/${data.quality.frames} frames tracked · Person ${data.solver.person_index + 1}`;
    this.sync();
  }
  private sync() {
    if (!this.playback) return;
    this.el('play').textContent = this.playback.playing ? 'Pause loop' : 'Play loop';
    this.el<HTMLInputElement>('seek').value = String(this.playback.time);
    this.el('time').textContent = `${this.playback.time.toFixed(2)} / ${this.playback.clip.duration.toFixed(2)}s`;
  }
  private resetCamera() {
    this.camera.position.copy(this.target).add(new Vector3(0, .2, this.distance));
    this.orbit.target.copy(this.target); this.orbit.update();
  }
  private resizeViewport() {
    const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height;
    this.camera.zoom = Math.min(1, this.camera.aspect / .85); this.camera.updateProjectionMatrix();
  }
  dispose() {
    this.disposed = true; this.renderer.setAnimationLoop(null); this.resize.disconnect(); this.orbit.dispose(); this.playback?.dispose();
    // Include a parsed character even if loading failed before adding it to the scene.
    if (this.character && !this.character.parent) this.scene.add(this.character);
    const disposed = new Set<object>();
    const once = (item: { dispose(): void }) => { if (!disposed.has(item)) { item.dispose(); disposed.add(item); } };
    this.scene.traverse(object => {
      const mesh = object as Mesh;
      if ((object as SkinnedMesh).isSkinnedMesh) once((object as SkinnedMesh).skeleton);
      if (mesh.geometry) once(mesh.geometry);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value && typeof value === 'object' && 'isTexture' in value) once(value);
        once(material);
      }
    });
    this.renderer.dispose(); this.host.replaceChildren();
  }
}
