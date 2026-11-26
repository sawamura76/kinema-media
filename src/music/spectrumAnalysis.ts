/** Hann-windowed radix-2 FFT of the native 44.1 kHz, unsigned-byte PCM. */
function channelSpectrum(samples: readonly number[]): Float64Array {
  const n = 1024, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = ((samples[i] ?? 128) - 128) / 128 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const v = re[i]; re[i] = re[j]; re[j] = v; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size;
    for (let start = 0; start < n; start += size) for (let k = 0; k < size / 2; k++) {
      const a = start + k, b = a + size / 2, c = Math.cos(angle * k), s = Math.sin(angle * k);
      const r = re[b] * c - im[b] * s, v = re[b] * s + im[b] * c;
      re[b] = re[a] - r; im[b] = im[a] - v; re[a] += r; im[a] += v;
    }
  }
  return Float64Array.from({ length: n / 2 }, (_, i) => Math.hypot(re[i], im[i]) * 4 / n);
}

export function spectrum(left: readonly number[], right: readonly number[]): Float64Array {
  const l = channelSpectrum(left), r = channelSpectrum(right);
  // Combine channel power so out-of-phase stereo content cannot cancel out.
  return Float64Array.from(l, (v, i) => Math.hypot(v, r[i]) / Math.SQRT2);
}

/** Log-frequency bands, calibrated to a fixed -72..0 dBFS display range. */
export function spectrumBands(bins: Float64Array, count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const low = 40 * (18000 / 40) ** (i / count), high = 40 * (18000 / 40) ** ((i + 1) / count);
    const start = Math.max(1, Math.floor(low * 1024 / 44100));
    const end = Math.min(bins.length, Math.max(start + 1, Math.ceil(high * 1024 / 44100)));
    let peak = 0;
    for (let k = start; k < end; k++) peak = Math.max(peak, bins[k]);
    return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-9, peak)) + 72) / 72));
  });
}
