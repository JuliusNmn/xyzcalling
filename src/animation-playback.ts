import { AnimationClip, AnimationMixer, LoopRepeat, type Object3D } from 'three';

/** Plays only the supplied bake. Looping exposes the original seam without blending it. */
export class AnimationPlayback {
  readonly mixer: AnimationMixer;
  readonly action;
  playing = true;
  speed = 1;
  constructor(private root: Object3D, readonly clip: AnimationClip) {
    this.mixer = new AnimationMixer(root);
    this.action = this.mixer.clipAction(clip);
    this.action.setLoop(LoopRepeat, Infinity).play();
    this.mixer.update(0);
  }
  get time() { return this.action.time; }
  update(delta: number) {
    if (this.playing) this.mixer.update(Math.max(0, delta) * this.speed);
  }
  seek(time: number) {
    // Evaluate the exact closing key too, so scrubbing can inspect the loop seam.
    this.action.time = Math.max(0, Math.min(this.clip.duration, time));
    this.action.paused = true;
    this.mixer.update(0);
    this.action.paused = false;
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}
