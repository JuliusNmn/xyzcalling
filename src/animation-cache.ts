import type { extractAnimation } from './animation-export';
import { excerptRhythm } from './audio-analysis';

type Options = Parameters<typeof extractAnimation>[0];
type Extraction = Awaited<ReturnType<typeof extractAnimation>>;

/** One shared offline extraction, used by both animation and motion signals. */
export class ExtractionCache {
  private entry?: { key: string; data: Extraction };
  async get(options: Options, extract: typeof extractAnimation): Promise<Extraction> {
    options.signal.throwIfAborted();
    const key = JSON.stringify([options.url, options.selection, options.solver,
      { ...options.settings, smoothing: 0 }, options.person, options.numPoses, options.confidence]);
    let data: Extraction;
    if (this.entry?.key === key) {
      data = this.entry.data;
      options.progress(1, 'Reusing cached landmarks and motion…');
    } else {
      data = await extract({ ...options, offline: true });
      options.signal.throwIfAborted();
      this.entry = { key, data };
    }
    // Audio can arrive after a motion-only extraction. It is not detector input.
    return { ...data, rhythm: options.analysis ? excerptRhythm(options.analysis, options.selection) : null };
  }
}
const cache = new ExtractionCache();
export async function extractCachedAnimation(options: Options) {
  const { extractAnimation } = await import('./animation-export');
  return cache.get(options, extractAnimation);
}
