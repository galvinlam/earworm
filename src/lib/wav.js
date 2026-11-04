/**
 * wav.js
 * ---------------------------------------------------------------------------
 * AudioBuffer -> WAV, with no dependencies.
 *
 * 16-bit PCM, because it is the format every piece of software on earth opens
 * without complaint. A float32 WAV would be a touch cleaner and a good deal
 * less useful.
 */

/**
 * Find the last frame with any audible signal.
 *
 * An offline render reserves a tail for reverb and ringing strings, and
 * whatever the tail does not use becomes dead silence on the end of the file.
 * Trimming it is the difference between an export and a take.
 *
 * @param {AudioBuffer} buffer
 * @param {number} threshold  amplitude below which a sample counts as silence
 * @returns {number} frame index, one past the last audible sample
 */
export function lastAudibleFrame(buffer, threshold = 0.0015) {
  const channels = Math.min(2, buffer.numberOfChannels);
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    for (let c = 0; c < channels; c += 1) {
      if (Math.abs(buffer.getChannelData(c)[i]) > threshold) return i + 1;
    }
  }
  return 0;
}

/**
 * @param {AudioBuffer} buffer
 * @param {object} [opts]
 * @param {number} [opts.endFrame]  stop here instead of at the buffer's end
 * @returns {Blob} audio/wav
 */
export function audioBufferToWav(buffer, { endFrame } = {}) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const frames = Math.max(1, Math.min(buffer.length, endFrame ?? buffer.length));

  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  // RIFF container
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');

  // fmt chunk: PCM, uncompressed
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // chunk size
  view.setUint16(20, 1, true);           // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);

  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  // Interleave and convert. Clamping matters: the mix can exceed ±1 when
  // several instruments land on the same beat, and wrapping sounds like a
  // broken speaker.
  const source = [];
  for (let c = 0; c < channels; c += 1) source.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const sample = Math.max(-1, Math.min(1, source[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([out], { type: 'audio/wav' });
}
