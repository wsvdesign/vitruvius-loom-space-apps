/* Real Apollo 12 seismometer recording of the Intrepid lunar module impact (20 Nov 1969), prepared by
   scripts/fetch-seismic.mjs into public/data/seismic/. Every value is a measured sample (XA.S12.00.MHZ,
   6.625 samples/s, raw counts) that was detrended, high-passed and normalised; the full provenance and
   transform record travel with the data in `meta`. Audification = playing those samples faster.
   Missing samples (gaps) are 0 in `samples` (silence) and listed in meta.provenance.gaps. */

export const SEISMIC_JSON_URL = './data/seismic/apollo12-lm-impact.json';
export const SEISMIC_WAV_URL = './data/seismic/apollo12-lm-impact.wav';

/** Nominal sample rate of the Apollo PSE mid-period channels (interval 0.1509434 s). */
export const APOLLO_MP_RATE_HZ = 6.625;

export interface SeismicGap {
  start: string;
  end: string;
  startIndex: number;
  count: number;
  durationSec: number;
  reason: string;
}

export interface SeismicProvenance {
  event: string;
  mission: string;
  eventSourceUrl: string;
  eventSupportingUrls: string[];
  eventDescription: string;
  impact: {
    timeUtc: string;
    timeConvention: string;
    latitudeDeg: number;
    longitudeDeg: number;
    /** Fractional sample index of the impact time within `samples`. */
    sampleIndex: number;
    distanceFromStationKm: number;
    distanceNote: string;
  };
  instrument: string;
  network: string;
  networkName: string;
  networkDoi: string;
  station: string;
  site: string;
  stationLatitudeDeg: number;
  stationLongitudeDeg: number;
  location: string;
  locationMeaning: string;
  channel: string;
  channelMeaning: string;
  requestedStart: string;
  requestedEnd: string;
  /** UTC time of samples[0] (Earth-received). */
  start: string;
  end: string;
  timeConvention: string;
  sampleRateHz: number;
  sampleRateNote: string;
  sampleCount: number;
  validSampleCount: number;
  durationSec: number;
  units: string;
  nominalSensitivity: { value: number; units: string; note: string };
  rawMeanCounts: number;
  dataUrl: string;
  dataUrlResolved: string | null;
  dataFormat: string;
  dataRowsSha256: string;
  stationUrl: string;
  availabilityUrl: string | null;
  availabilityNote: string;
  retrieved: string;
  gaps: SeismicGap[];
  gapSummary: { count: number; missingSamples: number; missingSec: number; handling: string };
  citations: string[];
  notes: string[];
}

export interface SeismicTransform {
  version: string;
  method: 'audification';
  script: string;
  calibration: string;
  gapHandling: string;
  detrend: { method: string; interceptCounts: number; slopeCountsPerSample: number };
  filter: { method: string; windowSamples: number; windowSec: number; firstNullHz: number; why: string };
  normalization: {
    method: string;
    /** Multiply a sample by this to get filtered counts. */
    countsPerUnit: number;
    peakIndex: number;
    peakTime: string;
    peakSecondsAfterImpact: number;
  };
  quantization: string;
  defaultSpeedup: number;
  speedupOptions: number[];
  /** Effective audification rate at the default speed-up (sampleRateHz x defaultSpeedup). */
  audioSampleRateHz: number;
  audioSampleRateNote: string;
  audioDurationSec: number;
  wav: {
    file: string;
    speedup: number;
    sampleRateHz: number;
    bitsPerSample: number;
    channels: number;
    gain: number;
    interpolation: string;
    clippedSamples: number;
    durationSec: number;
  };
}

export interface SeismicMeta {
  provenance: SeismicProvenance;
  transform: SeismicTransform;
}

export interface SeismicData {
  samples: Float32Array;
  meta: SeismicMeta;
}

const cache = new Map<string, Promise<SeismicData>>();

/** Loads the prepared recording. Gaps (null in the JSON) become 0 = silence. */
export function loadSeismic(url: string = SEISMIC_JSON_URL): Promise<SeismicData> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Seismic data: HTTP ${res.status}`);
        return res.json() as Promise<SeismicMeta & { samples: (number | null)[] }>;
      })
      .then(({ samples, ...meta }) => ({ samples: Float32Array.from(samples, (v) => v ?? 0), meta }));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/* Lanczos-3 interpolation; identical to the resampler in scripts/fetch-seismic.mjs so the in-app
   buffer and the shipped WAV are the same transform. */
const LANCZOS_A = 3;
const LANCZOS_RES = 1024;
let lanczosTable: Float32Array | null = null;
function kernel(): Float32Array {
  if (!lanczosTable) {
    lanczosTable = new Float32Array(LANCZOS_A * LANCZOS_RES + 1);
    for (let k = 0; k < lanczosTable.length; k++) {
      const x = k / LANCZOS_RES;
      lanczosTable[k] =
        x === 0 ? 1 : (LANCZOS_A * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / LANCZOS_A)) / (Math.PI * Math.PI * x * x);
    }
  }
  return lanczosTable;
}

function resample(src: Float32Array, srcRate: number, dstRate: number): Float32Array<ArrayBuffer> {
  const table = kernel();
  const ratio = dstRate / srcRate;
  const out = new Float32Array(Math.max(1, Math.ceil(src.length * ratio)));
  const k = Math.min(1, ratio); // widen the kernel when shrinking (anti-alias)
  const support = LANCZOS_A / k;
  for (let j = 0; j < out.length; j++) {
    const x = j / ratio;
    const lo = Math.max(0, Math.ceil(x - support));
    const hi = Math.min(src.length - 1, Math.floor(x + support));
    let acc = 0;
    let wsum = 0;
    for (let i = lo; i <= hi; i++) {
      const d = Math.abs(x - i) * k;
      if (d >= LANCZOS_A) continue;
      const w = table[Math.round(d * LANCZOS_RES)];
      acc += src[i] * w;
      wsum += w;
    }
    out[j] = wsum !== 0 ? acc / wsum : 0;
  }
  return out;
}

/**
 * Audification: the measured samples played `speedup` times faster (each sample lasts
 * 1 / (sourceRateHz x speedup) s). The result is interpolated to the context's sample rate so it plays
 * at playbackRate 1 with the right pitch and length. Samples peak at +/-1 but the interpolated curve
 * can overshoot to about 1.09 between them, so play it through a gain of 0.9 or less (the WAV uses 0.9).
 */
export function makeAudioBuffer(
  ctx: BaseAudioContext,
  samples: Float32Array,
  speedup: number,
  sourceRateHz: number = APOLLO_MP_RATE_HZ,
): AudioBuffer {
  const data = resample(samples, sourceRateHz * speedup, ctx.sampleRate);
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

/** Length of the sound in seconds at this speed-up. */
export function audioDuration(meta: SeismicMeta, speedup: number): number {
  return meta.provenance.sampleCount / meta.provenance.sampleRateHz / speedup;
}

/** Original (1969, Earth-received UTC) time at a playback position, for a cursor on the real time axis. */
export function originalTimeAt(meta: SeismicMeta, playbackSec: number, speedup: number): Date {
  return new Date(Date.parse(meta.provenance.start) + playbackSec * speedup * 1000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. "Real recording · Apollo 12 seismometer · 20 Nov 1969 · played 200× faster" */
export function describeTransform(meta: SeismicMeta, speedup: number = meta.transform.defaultSpeedup): string {
  const d = new Date(meta.provenance.start);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `Real recording · ${meta.provenance.mission} seismometer · ${date} · played ${Math.round(speedup).toLocaleString('en-US')}× faster`;
}
