import {
  Box3, Color, DirectionalLight, GridHelper, Group, HemisphereLight, LoadingManager,
  Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SkeletonHelper,
  SRGBColorSpace, Vector3, WebGLRenderer, type SkinnedMesh,
} from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_SETTINGS, MixamoRig, PoseRetargeter, type Landmark, type SolverKind, type SolverSettings } from './rig/solvers';

const SOLVERS: SolverKind[] = ['custom', 'kalidokit'];
const solverName = (kind: SolverKind) => kind === 'custom' ? 'Custom' : 'Kalidokit';
type PreviewRig = { character: Group; retargeter: PoseRetargeter; skeleton: SkeletonHelper };

type Frame = { worldLandmarks: Landmark[][]; landmarks: Landmark[][]; time: number };

export class CharacterView {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(34, 1, 0.01, 100);
  private readonly renderer = new WebGLRenderer({ antialias: true, alpha: false });
  private readonly orbit: OrbitControls;
  private readonly resize: ResizeObserver;
  private readonly rigs = new Map<SolverKind, PreviewRig>();
  private comparison = false;
  private frame?: Frame;
  private kind: SolverKind = 'custom';
  private settings: Record<SolverKind, SolverSettings> = structuredClone(DEFAULT_SETTINGS);
  private active = true;
  private person = 0;
  private disposed = false;

  constructor(private readonly host: HTMLElement, private readonly panel: HTMLElement) {
    host.innerHTML = `
      <div class="viewer-toolbar"><div><span class="live-dot"></span><strong id="character-heading">Character preview</strong></div><button class="text-button" id="recenter-character">Reset camera</button></div>
      <div class="character-canvas"><div class="character-loading" role="status">Loading character…</div><div class="comparison-labels" hidden><div><strong>Custom</strong><span id="custom-state">Loading character…</span></div><div><strong>Kalidokit</strong><span id="kalidokit-state">Loading character…</span></div></div></div>
      <div class="character-caption"><strong>Chicken Dance · Mixamo</strong><span id="rig-info">Parsing FBX skeleton</span><span id="rig-state" role="status">Waiting for character</span></div>`;
    panel.innerHTML = `
      <h3>CHARACTER SOLVER</h3>
      <label id="ik-solver-label" class="field-label" for="ik-solver">Inverse kinematics</label>
      <select id="ik-solver"><option value="custom">Custom · rest-aware</option><option value="kalidokit">Kalidokit · 1.1.5</option></select>
      <p id="solver-description" class="control-help"></p>
      <div class="range-label"><label for="ik-smoothing">Rotation smoothing</label><output id="ik-smoothing-value"></output></div>
      <input id="ik-smoothing" type="range" min="0" max="95" step="5" />
      <div class="range-ends"><span>Off / responsive</span><span>Smooth / delayed</span></div>
      <div class="range-label"><label for="ik-visibility">Tracking visibility</label><output id="ik-visibility-value"></output></div>
      <input id="ik-visibility" type="range" min="0" max="100" step="5" />
      <p class="control-help">Unreliable joints hold their last pose.</p>
      <label class="toggle-row"><span>Track legs</span><input id="ik-legs" type="checkbox" checked /><span class="switch"></span></label>
      <label class="toggle-row"><span>Show character skeleton</span><input id="rig-skeleton" type="checkbox" /><span class="switch"></span></label>
      <label class="field-label" for="ik-person">Detected person</label><select id="ik-person"><option value="0">Person 1</option><option value="1">Person 2</option><option value="2">Person 3</option><option value="3">Person 4</option></select>
      <p class="control-help">Detection order, not persistent identities.</p>
      <button id="reset-ik" class="secondary-button">Reset solver settings</button>
      <p class="control-help solver-limits">In place · Body only<br>No foot locking or finger capture.</p>`;
    this.scene.background = new Color('#e8ede5');
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D character. Drag to orbit; scroll to zoom.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.tabIndex = 0;
    const viewport = host.querySelector<HTMLElement>('.character-canvas')!;
    viewport.append(this.renderer.domElement);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 8;
    this.orbit.maxPolarAngle = Math.PI * 0.85;
    this.recenter();
    this.scene.add(new HemisphereLight(0xffffff, 0x809078, 2.4));
    const key = new DirectionalLight(0xfff5de, 3); key.position.set(3, 5, 4); this.scene.add(key);
    const fill = new DirectionalLight(0xd8e8ff, 1.6); fill.position.set(-3, 2, -2); this.scene.add(fill);
    const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: '#e8ede5', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.025; this.scene.add(floor);
    const grid = new GridHelper(6, 30, '#afbfaa', '#d2dbca'); grid.position.y = -0.02; this.scene.add(grid);
    this.resize = new ResizeObserver(() => this.resizeViewport());
    this.resize.observe(viewport);
    this.renderer.setAnimationLoop(() => {
      if (!this.active || this.disposed) return;
      this.orbit.update(); this.render();
    });
    host.querySelector('#recenter-character')!.addEventListener('click', () => this.recenter());
    this.input<HTMLSelectElement>('ik-solver').addEventListener('change', () => {
      this.kind = this.input<HTMLSelectElement>('ik-solver').value as SolverKind;
      this.syncControls();
      if (!this.comparison) this.reset();
    });
    for (const id of ['ik-smoothing', 'ik-visibility', 'ik-legs']) {
      this.input(id).addEventListener('input', () => {
        this.settings[this.kind] = {
          smoothing: Number(this.input<HTMLInputElement>('ik-smoothing').value) / 100,
          minVisibility: Number(this.input<HTMLInputElement>('ik-visibility').value) / 100,
          legs: this.input<HTMLInputElement>('ik-legs').checked,
        };
        this.syncControls();
        if (id === 'ik-legs') this.rigs.get(this.kind)?.retargeter.reset();
        this.solve(this.kind);
      });
    }
    this.input('rig-skeleton').addEventListener('change', () => {
      this.render();
    });
    this.input('ik-person').addEventListener('change', () => {
      this.person = Number(this.input<HTMLSelectElement>('ik-person').value); this.reset();
    });
    this.input('reset-ik').addEventListener('click', () => {
      this.settings[this.kind] = { ...DEFAULT_SETTINGS[this.kind] }; this.syncControls();
      this.rigs.get(this.kind)?.retargeter.reset(); this.solve(this.kind);
    });
    this.syncControls();
    void this.load();
  }

  private input<T extends HTMLElement = HTMLElement>(id: string): T { return this.panel.querySelector<T>(`#${id}`)!; }

  private syncControls() {
    const settings = this.settings[this.kind];
    this.input<HTMLInputElement>('ik-smoothing').value = String(settings.smoothing * 100);
    this.input('ik-smoothing-value').textContent = `${Math.round(settings.smoothing * 100)}%`;
    this.input<HTMLInputElement>('ik-visibility').value = String(settings.minVisibility * 100);
    this.input('ik-visibility-value').textContent = `${Math.round(settings.minVisibility * 100)}%`;
    this.input<HTMLInputElement>('ik-legs').checked = settings.legs;
    this.input('solver-description').textContent = this.kind === 'custom'
      ? 'Fits torso and limb directions to the character’s rest pose. Includes feet.'
      : 'Neutral-calibrated Kalidokit rotations, adapted to the Mixamo rig. Feet follow the legs.';
  }

  private async load() {
    const message = this.host.querySelector<HTMLElement>('.character-loading')!;
    try {
      const manager = new LoadingManager();
      // Texture names inside FBX can be Windows paths. Keep all requests on this server.
      manager.setURLModifier(url => {
        if (url.startsWith('blob:') || url.startsWith('data:') || /\.fbx$/i.test(url)) return url;
        const name = decodeURIComponent(url).replaceAll('\\', '/').split('/').pop();
        return `/character/Chicken%20Dance.fbm/${encodeURIComponent(name || '')}`;
      });
      manager.onError = () => { message.textContent = 'Some character textures could not load.'; };
      const character = await new FBXLoader(manager).loadAsync('/character/Chicken%20Dance.fbx', progress => {
        if (progress.total) message.textContent = `Loading character… ${Math.round(progress.loaded / progress.total * 100)}%`;
      });
      if (this.disposed) return;
      // No AnimationMixer: the FBX's bundled dance must never drive this preview.
      character.animations = [];
      character.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(character);
      character.scale.multiplyScalar(1.8 / bounds.getSize(new Vector3()).y);
      character.updateMatrixWorld(true);
      bounds.setFromObject(character);
      const center = bounds.getCenter(new Vector3());
      character.position.sub(new Vector3(center.x, bounds.min.y, center.z));
      character.traverse(object => {
        if ((object as SkinnedMesh).isSkinnedMesh) (object as SkinnedMesh).frustumCulled = false;
      });
      // SkeletonUtils clones bones and rebinds skinning, while sharing immutable geometry/textures.
      // Clone before either solver changes the rest pose.
      const characters = [character, clone(character) as Group];
      for (const [index, kind] of SOLVERS.entries()) {
        const model = characters[index];
        this.scene.add(model);
        model.updateMatrixWorld(true);
        const retargeter = new PoseRetargeter(new MixamoRig(model));
        const skeleton = new SkeletonHelper(model);
        for (const material of Array.isArray(skeleton.material) ? skeleton.material : [skeleton.material]) material.depthTest = false;
        skeleton.renderOrder = 2;
        this.scene.add(skeleton);
        this.rigs.set(kind, { character: model, retargeter, skeleton });
      }
      this.host.querySelector('#rig-info')!.textContent = `${this.rigs.get('custom')!.retargeter.rig.bones.size} bones per character · Original animation disabled`;
      message.hidden = true;
      this.solve(); this.resizeViewport();
    } catch (reason) {
      message.textContent = `Character could not load: ${reason instanceof Error ? reason.message : String(reason)}`;
      this.host.querySelector('#rig-state')!.textContent = 'Character unavailable';
      const retry = document.createElement('button'); retry.className = 'secondary-button'; retry.textContent = 'Retry character';
      retry.addEventListener('click', () => { retry.remove(); void this.load(); }); message.append(retry);
    }
  }

  update(worldLandmarks: Landmark[][], landmarks: Landmark[][], time: number) {
    this.frame = { worldLandmarks, landmarks, time }; if (this.active) this.solve();
  }
  exportSettings() {
    return { solver: this.kind, settings: { ...this.settings[this.kind] }, person: this.person };
  }
  reset(clearFrame = false) {
    if (clearFrame) this.frame = undefined;
    for (const rig of this.rigs.values()) rig.retargeter.reset();
    this.solve();
  }
  setVisible(active: boolean) {
    this.active = active;
    if (active) { this.resizeViewport(); this.reset(); }
  }
  setComparison(comparison: boolean) {
    if (this.comparison === comparison) return;
    this.comparison = comparison;
    this.host.classList.toggle('comparing', comparison);
    this.host.querySelector<HTMLElement>('.comparison-labels')!.hidden = !comparison;
    this.host.querySelector('#character-heading')!.textContent = comparison ? 'Custom + Kalidokit' : 'Character preview';
    this.input('ik-solver-label').textContent = comparison ? 'Configure / export solver' : 'Inverse kinematics';
    this.resizeViewport(); this.reset();
  }
  private solve(only?: SolverKind) {
    if (!this.rigs.size) return;
    for (const kind of only ? [only] : this.comparison ? SOLVERS : [this.kind]) {
      const rig = this.rigs.get(kind)!;
      let message = 'Rest pose · Play a video to animate';
      if (this.frame) {
        try {
          const count = rig.retargeter.update(kind, this.frame.worldLandmarks[this.person], this.frame.landmarks[this.person], this.frame.time, this.settings[kind]);
          message = count ? `${count} bones updated · ${this.frame.time.toFixed(2)}s` : 'Low confidence · Holding pose';
        } catch (reason) {
          message = `Solver error: ${reason instanceof Error ? reason.message : String(reason)}`;
        }
      }
      this.host.querySelector(`#${kind}-state`)!.textContent = message;
      if (!this.comparison) this.host.querySelector('#rig-state')!.textContent = `${solverName(kind)} · ${message}`;
    }
    if (this.comparison) this.host.querySelector('#rig-state')!.textContent = 'Same video frame and person · Linked cameras · Independent smoothing';
  }
  private render() {
    const viewport = this.host.querySelector<HTMLElement>('.character-canvas')!;
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    const kinds = this.comparison ? SOLVERS : [this.kind];
    const half = Math.floor(width / kinds.length);
    this.renderer.setScissorTest(true);
    for (const [index, kind] of kinds.entries()) {
      const x = index * half, w = index === kinds.length - 1 ? width - x : half;
      for (const [name, rig] of this.rigs) {
        rig.character.visible = name === kind;
        rig.skeleton.visible = name === kind && this.input<HTMLInputElement>('rig-skeleton').checked;
      }
      this.camera.aspect = w / height;
      this.camera.zoom = Math.min(1, this.camera.aspect / 0.85);
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(x, 0, w, height);
      this.renderer.setScissor(x, 0, w, height);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setScissorTest(false);
  }
  private recenter() { this.camera.position.set(2.5, 1.5, 3.8); this.orbit.target.set(0, 0.95, 0); this.orbit.update(); }
  private resizeViewport() {
    const viewport = this.host.querySelector<HTMLElement>('.character-canvas')!;
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  dispose() {
    this.disposed = true; this.renderer.setAnimationLoop(null); this.resize.disconnect(); this.orbit.dispose();
    for (const rig of this.rigs.values()) {
      rig.skeleton.dispose(); this.scene.remove(rig.skeleton);
      rig.character.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) (object as SkinnedMesh).skeleton.dispose(); });
    }
    const disposed = new Set<object>();
    const disposeOnce = (resource: { dispose(): void }) => { if (!disposed.has(resource)) { resource.dispose(); disposed.add(resource); } };
    this.scene.traverse(object => {
      const mesh = object as Mesh;
      if (mesh.geometry) disposeOnce(mesh.geometry);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value && typeof value === 'object' && 'isTexture' in value) disposeOnce(value);
        disposeOnce(material);
      }
    });
    this.renderer.dispose();
  }
}
