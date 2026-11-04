/**
 * A fake Tone.js, aliased in place of the real one for the smoke build.
 *
 * jsdom has no Web Audio, so the real Tone cannot run here. This records what
 * the engine *asks* for — which notes, at which times, with which velocities —
 * so the scheduler's arithmetic (durations, swing, strum offsets, the playhead)
 * can be checked without a sound card.
 */

export const recorder = {
  triggers: [],
  scheduled: [],
  draws: [],
  transportStarted: 0,
  stops: 0,
  bpm: null,
  // Sample URLs matching this fail to load, to exercise the fallbacks.
  failSamples: null,
  fetched: [],
  reset() {
    this.triggers = [];
    this.scheduled = [];
    this.draws = [];
    this.transportStarted = 0;
    this.stops = 0;
    this.bpm = null;
    this.fetched = [];
  },
  /**
   * Fire every scheduled callback in time order, as the transport would.
   *
   * Draw callbacks queued by a transport event are run straight after it, which
   * is what a browser does: Draw fires on the next animation frame after its
   * time, so it lands before any later transport event.
   */
  flush() {
    const queue = [...this.scheduled].sort((a, b) => a.time - b.time);
    this.scheduled = [];
    const drainDraws = () => {
      while (this.draws.length) {
        const due = this.draws;
        this.draws = [];
        for (const d of due) d.callback();
      }
    };
    for (const item of queue) {
      item.callback(item.time);
      drainDraws();
    }
    drainDraws();
  },
};

/** Base node: chainable, and records any note it is asked to play. */
class Node {
  constructor(label, options) {
    this.label = label;
    this.options = options;
    this.volume = { value: 0, rampTo() {} };
  }
  connect() { return this; }
  toDestination() { return this; }
  start() { return this; }
  stop() { return this; }
  dispose() {}
  releaseAll() {}
  triggerRelease() {}
  triggerAttackRelease(note, duration, time, velocity) {
    recorder.triggers.push({ node: this.label, note, duration, time, velocity });
  }
  // Plucked strings ring out on their own, so they attack without a release.
  triggerAttack(note, time, velocity) {
    recorder.triggers.push({ node: this.label, note, duration: null, time, velocity });
  }
}

const node = (label) => class extends Node {
  constructor(options) { super(label, options); }
};

export const Synth = node('Synth');
export const FMSynth = node('FMSynth');
export const MembraneSynth = node('MembraneSynth');
export const Filter = node('Filter');
export const Chorus = node('Chorus');
export const Tremolo = node('Tremolo');
export const Reverb = node('Reverb');
export const Gain = node('Gain');
export const Volume = node('Volume');
/**
 * A sampler labels itself by soundfont folder ("Sampler:electric_bass_finger"),
 * so tests can tell which recorded instrument actually played. The piano's
 * samples come from elsewhere and keep the plain label.
 */
export class Sampler extends Node {
  constructor(options = {}) {
    const first = Object.values(options.urls || {})[0];
    const folder = /\/([^/]+)-mp3\//.exec(first?.url || '')?.[1];
    super(folder ? `Sampler:${folder}` : 'Sampler', options);
  }
}
export const MonoSynth = node('MonoSynth');
export const PluckSynth = node('PluckSynth');
export const Distortion = node('Distortion');

export class NoiseSynth extends Node {
  constructor(options) { super('NoiseSynth', options); }
  // NoiseSynth takes (duration, time, velocity) — no pitch.
  triggerAttackRelease(duration, time, velocity) {
    recorder.triggers.push({ node: 'NoiseSynth', note: null, duration, time, velocity });
  }
}

export class PolySynth extends Node {
  constructor(voice, options) { super('PolySynth', options); }
}

export class ToneAudioBuffers {
  constructor({ urls = {} } = {}) { this.urls = urls; }
  has(name) { return Object.hasOwn(this.urls, name); }
  get(name) { return { name }; }
}

export class ToneAudioBuffer {
  static fromUrl(url) {
    recorder.fetched.push(url);
    const fail = recorder.failSamples;
    if (fail === true || (fail instanceof RegExp && fail.test(url))) {
      return Promise.reject(new Error('stubbed load failure: ' + url));
    }
    const buffer = new ToneAudioBuffer();
    buffer.url = url;
    buffer.name = url.split('/').pop().replace(/\.mp3$/, '');
    return Promise.resolve(buffer);
  }
}

export class ToneBufferSource extends Node {
  constructor(opts) { super('ToneBufferSource', opts); this.buffer = opts?.url ?? opts; }
  start(time) {
    recorder.triggers.push({ node: 'sample', note: this.buffer?.name ?? null, time, velocity: 1 });
    return this;
  }
}

const transport = {
  bpm: { get value() { return recorder.bpm; }, set value(v) { recorder.bpm = v; } },
  position: 0,
  scheduleOnce(callback, time) {
    recorder.scheduled.push({ callback, time });
    return recorder.scheduled.length;
  },
  start() { recorder.transportStarted += 1; return this; },
  stop() { recorder.stops += 1; return this; },
  cancel() { recorder.scheduled = []; return this; },
};

const draw = {
  schedule(callback, time) { recorder.draws.push({ callback, time }); },
};

const destination = { volume: { value: 0, rampTo() {} } };

export const getTransport = () => transport;
export const getDraw = () => draw;
export const getDestination = () => destination;
export const getContext = () => ({ state: 'running' });
export const start = async () => {};
export const loaded = async () => {};
export const now = () => 0;
