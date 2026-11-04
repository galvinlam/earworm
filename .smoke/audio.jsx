/**
 * Scheduler tests: drives the real audio engine against a recording Tone stub,
 * so note timing, durations, swing, strum and the playhead are all checked.
 */
import * as ToneStub from './toneStub.js';
import { recorder } from './toneStub.js';
import {
  playSong,
  playSection,
  stopPlayback,
  setVolume,
  setDrumLevel,
  preloadDrumKit,
  preloadInstrument,
  preloadBass,
  isInstrumentLoaded,
  instrumentSustains,
  INSTRUMENTS,
  BASS_INSTRUMENTS,
} from '../src/lib/audioEngine.js';

const SONG = {
  key: 'G major',
  tempo: 120, // 0.5 s per beat, 2 s per bar — easy arithmetic
  sections: [
    { id: 'v1', label: 'Verse 1', chords: ['G', 'Em', 'C', 'D'], melodyContour: ['1', '3', '5', '5^'] },
    { id: 'ch', label: 'Chorus', chords: ['C', 'G'], melodyContour: ['5', '3'] },
  ],
};

export async function runAudio() {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(['PASS', name, '']); }
    catch (e) { results.push(['FAIL', name, e.message]); }
  };

  const drumsOf = () => recorder.triggers.filter(
    (t) => t.node === 'MembraneSynth' || t.node === 'NoiseSynth' || t.node === 'sample',
  );

  // ---------------------------------------------------------------- basics
  await check('engine: a song schedules notes, sets tempo and starts the transport', async () => {
    recorder.reset();
    const result = await playSong({ ...SONG, grooveId: 'rock', instrument: 'pad', drumKit: 'machine' });
    if (recorder.bpm !== 120) throw new Error('tempo not applied: ' + recorder.bpm);
    if (recorder.transportStarted !== 1) throw new Error('transport did not start exactly once');
    if (!recorder.scheduled.length) throw new Error('nothing was scheduled');
    // 6 bars at 2 s each.
    if (Math.abs(result.duration - 12) > 0.01) throw new Error('duration wrong: ' + result.duration);
  });

  await check('engine: scheduled times are finite, ordered and inside the song', async () => {
    recorder.reset();
    const { duration } = await playSong({ ...SONG, grooveId: 'pop', instrument: 'piano', drumKit: 'machine' });
    for (const item of recorder.scheduled) {
      if (!Number.isFinite(item.time) || item.time < 0) throw new Error('bad schedule time ' + item.time);
      if (item.time > duration + 1) throw new Error(`event at ${item.time} is past the end (${duration})`);
    }
  });

  await check('engine: every triggered note has a positive duration and sane velocity', async () => {
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'rock', instrument: 'piano', drumKit: 'machine', metronome: true });
    recorder.flush();
    if (!recorder.triggers.length) throw new Error('no notes were triggered');
    for (const t of recorder.triggers) {
      if (t.node === 'sample') continue; // one-shots carry no duration
      if (!Number.isFinite(t.duration) || t.duration <= 0) throw new Error(`${t.node} duration ${t.duration}`);
      if (t.velocity !== undefined && (t.velocity <= 0 || t.velocity > 1)) {
        throw new Error(`${t.node} velocity ${t.velocity} is outside 0..1`);
      }
      if (t.time !== undefined && (!Number.isFinite(t.time) || t.time < 0)) {
        throw new Error(`${t.node} time ${t.time}`);
      }
    }
  });

  // ---------------------------------------------------------------- drums
  await check('engine: drums sound with a kit and are silent when off', async () => {
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'rock', drumKit: 'machine' });
    recorder.flush();
    const hits = drumsOf().length;
    if (hits < 20) throw new Error(`expected a busy rock kit, got ${hits} hits`);

    recorder.reset();
    await playSong({ ...SONG, grooveId: 'rock', drumKit: 'off' });
    recorder.flush();
    if (drumsOf().length) throw new Error('the "off" kit still made drum sounds');
  });

  await check('engine: the kick lands on the downbeat of every bar', async () => {
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'fourfloor', drumKit: 'machine' });
    recorder.flush();
    // Four-on-the-floor: a kick on all four beats of all six bars.
    const kicks = recorder.triggers.filter((t) => t.node === 'MembraneSynth' && t.note === 'C1');
    if (kicks.length !== 24) throw new Error(`expected 24 kicks, got ${kicks.length}`);
    const downbeats = kicks.filter((k) => Math.abs(k.time % 2) < 0.001);
    if (downbeats.length !== 6) throw new Error(`expected a kick on each of 6 bar starts, got ${downbeats.length}`);
  });

  await check('engine: the sampled kit falls back to the machine when samples fail', async () => {
    recorder.reset();
    recorder.failSamples = /drum-samples/;
    try {
      const { name, fellBack } = await preloadDrumKit('acoustic');
      if (name !== 'machine' || !fellBack) throw new Error(`expected a fallback to the machine, got ${name}`);
    } finally {
      recorder.failSamples = null;
    }

    // A failed kit is not cached, so it loads once the samples are reachable.
    const { name, fellBack } = await preloadDrumKit('acoustic');
    if (name !== 'acoustic' || fellBack) throw new Error('acoustic kit should load once samples arrive');
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'pop', drumKit: 'acoustic' });
    recorder.flush();
    const samples = recorder.triggers.filter((t) => t.node === 'sample');
    if (!samples.length) throw new Error('no samples were played');
    for (const s of samples) {
      if (!['kick', 'snare', 'hihat'].includes(s.note)) throw new Error('unexpected sample ' + s.note);
    }
  });

  // ------------------------------------------------------------ metronome
  await check('engine: the metronome clicks four times a bar, and only when on', async () => {
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'none', drumKit: 'off', metronome: true, mode: 'chords' });
    recorder.flush();
    // The click is the only Synth playing C7/C6 pitches.
    const clicks = recorder.triggers.filter((t) => t.note === 'C7' || t.note === 'C6');
    if (clicks.length !== 24) throw new Error(`expected 24 clicks over 6 bars, got ${clicks.length}`);

    recorder.reset();
    await playSong({ ...SONG, grooveId: 'none', drumKit: 'off', metronome: false, mode: 'chords' });
    recorder.flush();
    if (recorder.triggers.some((t) => t.note === 'C7' || t.note === 'C6')) {
      throw new Error('clicks sounded with the metronome off');
    }
  });

  // ---------------------------------------------------------------- swing
  await check('engine: swing shifts offbeats later than a straight feel', async () => {
    const hatTimes = async (grooveId) => {
      recorder.reset();
      await playSong({ ...SONG, grooveId, drumKit: 'machine', mode: 'chords' });
      recorder.flush();
      return recorder.triggers
        .filter((t) => t.node === 'NoiseSynth' && t.duration === 0.03)
        .map((t) => t.time)
        .sort((a, b) => a - b);
    };

    const straight = await hatTimes('rock');     // swing 0
    const swung = await hatTimes('shuffle');     // swing 0.3
    if (!straight.length || !swung.length) throw new Error('no hats to compare');

    // The second hat of the bar is the offbeat eighth: straight at 0.25 s,
    // pushed later under swing.
    if (Math.abs(straight[1] - 0.25) > 0.01) throw new Error('straight offbeat moved: ' + straight[1]);
    if (!(swung[1] > straight[1] + 0.05)) throw new Error(`swing did not delay the offbeat: ${swung[1]} vs ${straight[1]}`);
  });

  // ------------------------------------------------------- instrument role
  await check('engine: a pad sustains chords where a piano comps them', async () => {
    if (!instrumentSustains('pad')) throw new Error('the pad should sustain');
    if (instrumentSustains('piano')) throw new Error('the piano should not sustain');

    const chordCount = async (instrument) => {
      recorder.reset();
      await playSong({ ...SONG, grooveId: 'rock', instrument, drumKit: 'off', mode: 'chords' });
      recorder.flush();
      return recorder.triggers.filter((t) => t.node === 'PolySynth' || t.node === 'Sampler').length;
    };
    const pad = await chordCount('pad');
    const piano = await chordCount('piano');
    if (!(piano > pad)) throw new Error(`a comping piano should play more notes than a pad: ${piano} vs ${pad}`);
  });

  await check('engine: a strumming instrument offsets the notes of a chord', async () => {
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'none', instrument: 'piano', drumKit: 'off', mode: 'chords' });
    recorder.flush();
    const firstBar = recorder.triggers
      .filter((t) => t.node === 'Sampler' && t.time < 0.1)
      .map((t) => t.time);
    const unique = new Set(firstBar.map((t) => t.toFixed(4)));
    if (unique.size < 2) throw new Error('chord notes all started at the same instant — no strum');
  });

  // ------------------------------------------------------------- playhead
  await check('engine: the playhead reports each bar, then clears at the end', async () => {
    recorder.reset();
    const positions = [];
    let ended = false;
    await playSong({
      ...SONG,
      grooveId: 'pop',
      drumKit: 'off',
      onPosition: (sectionId, bar) => positions.push([sectionId, bar]),
      onEnd: () => { ended = true; },
    });
    recorder.flush();

    const bars = positions.filter(([id]) => id !== null);
    if (bars.length !== 6) throw new Error(`expected 6 bar callbacks, got ${bars.length}`);
    if (bars[0][0] !== 'v1' || bars[0][1] !== 0) throw new Error('first bar wrong: ' + JSON.stringify(bars[0]));
    if (bars[4][0] !== 'ch' || bars[4][1] !== 0) throw new Error('section change wrong: ' + JSON.stringify(bars[4]));
    if (!positions.some(([id, bar]) => id === null && bar === -1)) throw new Error('playhead never cleared');
    if (!ended) throw new Error('onEnd never fired');
  });

  await check('engine: playing one section only plays that section', async () => {
    recorder.reset();
    const bars = [];
    const { duration } = await playSection({
      section: SONG.sections[1], // 2 bars
      key: SONG.key,
      tempo: SONG.tempo,
      grooveId: 'pop',
      drumKit: 'off',
      onBar: (bar) => bars.push(bar),
    });
    recorder.flush();
    if (Math.abs(duration - 4) > 0.01) throw new Error('two bars at 120bpm should be 4s, got ' + duration);
    if (bars.filter((b) => b >= 0).length !== 2) throw new Error('expected 2 bar callbacks');
  });

  // ---------------------------------------------------------- parts
  await check('engine: the bass instrument is independent of the chord instrument', async () => {
    const bassNodes = async (bassInstrument) => {
      recorder.reset();
      await playSong({ ...SONG, grooveId: 'rock', instrument: 'piano', drumKit: 'off', mode: 'chords', bassInstrument });
      recorder.flush();
      return new Set(recorder.triggers.map((t) => t.node));
    };

    // 'follow' means the piano plays its own left hand: one sampler for both.
    const follow = await bassNodes('follow');
    if (!follow.has('Sampler')) throw new Error('piano did not play');
    if (follow.has('MonoSynth')) throw new Error('"follow" should not add a separate bass');

    // A dedicated bass brings its own voice alongside the piano.
    const electric = await bassNodes('electric');
    if (!electric.has('Sampler')) throw new Error('piano stopped playing');
    if (!electric.has('Sampler:electric_bass_finger')) throw new Error('electric bass did not sound');
  });

  await check('engine: a guitar sounds six strings where a pad sounds a triad', async () => {
    const notesAt = async (instrument) => {
      recorder.reset();
      await playSong({ ...SONG, grooveId: 'rock', instrument, drumKit: 'off', mode: 'chords', bassInstrument: 'follow' });
      recorder.flush();
      const first = Math.min(...recorder.triggers.map((t) => t.time ?? Infinity));
      return recorder.triggers.filter((t) => Math.abs((t.time ?? -1) - first) < 0.2);
    };
    const pad = await notesAt('pad');
    const guitar = await notesAt('guitarClean');
    if (!(guitar.length > pad.length)) {
      throw new Error(`guitar should sound more notes than a pad: ${guitar.length} vs ${pad.length}`);
    }
    if (!guitar.some((t) => t.node === 'Sampler:electric_guitar_clean')) {
      throw new Error('guitar did not use the sampled guitar: ' + [...new Set(guitar.map((t) => t.node))]);
    }
  });

  await check('engine: a bass style changes what the bass plays', async () => {
    const bassCount = async (bassStyle) => {
      recorder.reset();
      await playSong({ ...SONG, grooveId: 'ballad', instrument: 'pad', drumKit: 'off', mode: 'chords', bassInstrument: 'electric', bassStyle });
      recorder.flush();
      return recorder.triggers.filter((t) => t.node === 'Sampler:electric_bass_finger').length;
    };
    const whole = await bassCount('whole');
    const eighths = await bassCount('eighths');
    if (!(eighths > whole * 3)) throw new Error(`style had little effect: ${whole} vs ${eighths}`);
  });

  // -------------------------------------------------------------- samples
  await check('engine: guitars, basses and electric piano are sampled, the synth bass is not', () => {
    for (const k of ['electric', 'guitarClean', 'guitarAcoustic', 'guitarCrunch', 'guitarPower']) {
      if (!INSTRUMENTS[k]?.needsNetwork) throw new Error(`${k} should be sampled`);
    }
    for (const k of ['electric', 'picked', 'upright']) {
      if (!BASS_INSTRUMENTS[k]?.needsNetwork) throw new Error(`bass ${k} should be sampled`);
    }
    if (BASS_INSTRUMENTS.synth.needsNetwork || INSTRUMENTS.pad.needsNetwork) {
      throw new Error('the synth bass and pad should not need the network');
    }
  });

  await check('engine: each sampled instrument plays its own soundfont', async () => {
    const expect = {
      electric: 'electric_piano_1',
      guitarAcoustic: 'acoustic_guitar_steel',
      guitarPower: 'distortion_guitar',
    };
    for (const [instrument, folder] of Object.entries(expect)) {
      recorder.reset();
      await playSong({ ...SONG, grooveId: 'rock', instrument, drumKit: 'off', mode: 'both', bassInstrument: 'upright' });
      recorder.flush();
      const nodes = new Set(recorder.triggers.map((t) => t.node));
      if (!nodes.has(`Sampler:${folder}`)) throw new Error(`${instrument} did not play ${folder}: ${[...nodes]}`);
      if (!nodes.has('Sampler:acoustic_bass')) throw new Error('upright bass did not play its samples');
    }
  });

  await check('engine: a sampled guitar without its samples keeps playing on synth strings', async () => {
    recorder.reset();
    recorder.failSamples = /overdriven_guitar/;
    let result;
    try {
      result = await preloadInstrument('guitarCrunch');
    } finally {
      recorder.failSamples = null;
    }
    // The choice is kept — it does not jump to a different instrument.
    if (result.name !== 'guitarCrunch' || result.fellBack) throw new Error('should stay on guitarCrunch: ' + JSON.stringify(result));
    if (!result.degraded) throw new Error('should report that it is using the stand-in');
    if (isInstrumentLoaded('guitarCrunch')) throw new Error('a degraded rig should not count as loaded');

    recorder.reset();
    const played = await playSong({ ...SONG, grooveId: 'rock', instrument: 'guitarCrunch', drumKit: 'off', mode: 'chords', bassInstrument: 'follow' });
    recorder.flush();
    if (!played.degraded) throw new Error('playback should report the stand-in too');
    if (!recorder.triggers.some((t) => t.node === 'PluckSynth')) throw new Error('the stand-in strings did not sound');
  });

  await check('engine: a degraded instrument retries its samples later', async () => {
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000; // past the retry window
    try {
      const again = await preloadInstrument('guitarCrunch');
      if (again.degraded) throw new Error('retry did not pick up the samples');
    } finally {
      Date.now = realNow;
    }
    if (!isInstrumentLoaded('guitarCrunch')) throw new Error('should count as loaded once sampled');
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'rock', instrument: 'guitarCrunch', drumKit: 'off', mode: 'chords', bassInstrument: 'follow' });
    recorder.flush();
    if (!recorder.triggers.some((t) => t.node === 'Sampler:overdriven_guitar')) throw new Error('samples not used after retry');
  });

  await check('engine: one instrument failing its samples does not fail another', async () => {
    // Loading side by side used to share a single "everything loaded" wait,
    // so a bad bass sample could knock the piano back to the pad.
    recorder.reset();
    recorder.failSamples = /electric_bass_pick/;
    try {
      const played = await playSong({ ...SONG, grooveId: 'rock', instrument: 'piano', drumKit: 'off', mode: 'chords', bassInstrument: 'picked' });
      if (played.instrument !== 'piano' || played.fellBack) throw new Error('piano was affected: ' + JSON.stringify(played));
      if (!played.degraded) throw new Error('the bass should report its stand-in');
    } finally {
      recorder.failSamples = null;
    }
    const bass = await preloadBass('upright');
    if (bass.degraded) throw new Error('an unrelated bass should load normally');
  });

  await check('engine: a sample is fetched once and reused', async () => {
    // Building directly, as the WAV renderer does, must not refetch what
    // playback already has — the buffers are cached by URL, not by rig.
    recorder.reset();
    const bus = new ToneStub.Gain();
    const rig = await INSTRUMENTS.guitarClean.build(ToneStub, bus);
    if (rig.degraded) throw new Error('build degraded');
    if (recorder.fetched.length) throw new Error('refetched: ' + recorder.fetched.slice(0, 3).join(', '));
  });

  // ----------------------------------------------------------- lifecycle
  await check('engine: stopping cancels pending events', async () => {
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'rock', drumKit: 'machine' });
    if (!recorder.scheduled.length) throw new Error('nothing scheduled');
    stopPlayback();
    if (recorder.scheduled.length) throw new Error('events survived the stop');
    if (!recorder.stops) throw new Error('the transport was never stopped');
  });

  await check('engine: a stale callback fires nothing after a restart', async () => {
    recorder.reset();
    await playSong({ ...SONG, grooveId: 'rock', drumKit: 'machine' });
    const stale = [...recorder.scheduled];
    // A second play invalidates the first pass's token.
    await playSong({ ...SONG, grooveId: 'pop', drumKit: 'machine' });
    const before = recorder.triggers.length;
    for (const item of stale) item.callback(item.time);
    if (recorder.triggers.length !== before) throw new Error('a cancelled pass still made sound');
  });

  await check('engine: an empty song ends cleanly without scheduling', async () => {
    recorder.reset();
    let ended = false;
    const { duration } = await playSong({
      sections: [{ id: 'x', chords: [], melodyContour: [] }],
      key: 'C major', tempo: 100, grooveId: 'pop', onEnd: () => { ended = true; },
    });
    if (duration !== 0) throw new Error('duration should be zero');
    if (!ended) throw new Error('onEnd should still fire');
    if (recorder.transportStarted) throw new Error('the transport should not have started');
  });

  await check('engine: volume and drum level are safe to set at any time', () => {
    setVolume(-12);
    setDrumLevel(-8);
    setVolume(0);
    setDrumLevel(3);
    // No assertion beyond "did not throw" — these ramp real AudioParams in a
    // browser and must tolerate being called before audio exists.
  });

  return results;
}
