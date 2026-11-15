#!/usr/bin/env node
/**
 * Fetches a real Apollo seismometer recording and prepares it as data + sound for the app.
 *
 *   node scripts/fetch-seismic.mjs                       # fetch from EarthScope (IRIS DMC) and process
 *   node scripts/fetch-seismic.mjs --save-raw raw.csv    # ...and keep the untouched GeoCSV response
 *   node scripts/fetch-seismic.mjs --from-file raw.csv   # reprocess a saved GeoCSV response offline
 *
 * Event: the Apollo 12 lunar module ascent stage "Intrepid" was deliberately crashed into the Moon on
 * 20 November 1969 at 22:17:17.7 UT (Earth-received time; NSSDCA "Lunar Impact Sites" table), about
 * 70 km from the Apollo 12 Passive Seismic Experiment, which recorded the Moon ringing for nearly an hour.
 *
 * Data: Apollo Passive Seismic Experiments, FDSN network XA (doi:10.7914/SN/XA_1969), station S12,
 * location 00 (peaked mode), channel MHZ (mid-period vertical, nominal 6.625 samples/s), raw counts,
 * served by the EarthScope / IRIS DMC fdsnws-dataselect service as GeoCSV text (no miniSEED decoder).
 *
 * Transform (version below; same input + same version => same output, no randomness):
 *   1. Grid samples by timestamp at the nominal rate. Samples the archive marks as missing (value -1,
 *      Nunn et al. 2022) and any time gaps between records become null: no sample is invented.
 *   2. Remove the mean and linear trend (least squares over valid samples only).
 *   3. High-pass: subtract a centred 67-sample (~10.1 s) running mean of the valid samples. This removes
 *      slow drift (mostly a ~60 s instrument swing) that would be below hearing after speed-up anyway.
 *   4. Normalise by the peak absolute value so the loudest real sample is +/-1 (factor recorded).
 *   5. JSON: round to 4 decimals; gaps stay null. WAV: gaps -> 0 (silence), played 200x faster
 *      (6.625 Hz x 200 = 1,325 samples/s), interpolated with a Lanczos-3 kernel to an 8,000 Hz file
 *      so ordinary players can open it (pitch and timing unchanged), gain 0.9, 16-bit PCM mono.
 *
 * Writes public/data/seismic/apollo12-lm-impact.json and .wav, then prints a verification summary.
 * Node 24, no dependencies.
 */
import { writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'data', 'seismic');
const BASENAME = 'apollo12-lm-impact';

const TRANSFORM_VERSION = 'seismic-audification-v1';

/* ---------- what to fetch ---------- */

const NET = 'XA';
const STA = 'S12';
const LOC = '00'; // peaked mode (Nunn et al. 2022; StationXML channel comment "Peak Mode")
const CHA = 'MHZ'; // mid-period ("long-period" in older papers) vertical seismometer
const START = '1969-11-20T22:12:00'; // ~5.3 min before impact
const END = '1969-11-20T23:22:00'; // ~64.7 min after impact (stops before an unrelated 23:27 instrument swing)

const EVENT = {
  name: 'Apollo 12 lunar module ascent stage (Intrepid) deliberate impact',
  mission: 'Apollo 12',
  impactTimeUtc: '1969-11-20T22:17:17.7Z',
  impactTimeConvention:
    'Earth-received time (NSSDCA: about 1.3 s later than on the Moon), the same convention as the seismic timestamps',
  impactLatDeg: -3.94,
  impactLonDeg: -21.2,
  sourceUrl: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_impact.html',
  supportingUrls: [
    'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-099C',
    'https://www.nasa.gov/history/50-years-ago-apollo-12-the-journey-home/',
  ],
  description:
    'After Pete Conrad and Alan Bean returned to the command module Yankee Clipper, the empty ascent stage of the lunar module Intrepid was jettisoned, and controllers commanded it to fire its thrusters to drop out of orbit and crash into the Moon, giving the seismometer a known impact to study. NASA notes the seismometer recorded signals for nearly one hour after the impact.',
};

const SPEEDUP = 200; // 70 min of data -> 21 s of sound
const SPEEDUP_OPTIONS = [100, 200, 400];
const HIGHPASS_HALF_WIDTH = 33; // running mean over 2*33+1 = 67 samples
const JSON_DECIMALS = 4;
const WAV_RATE = 8000;
const WAV_GAIN = 0.9;
const LANCZOS_A = 3;
const MOON_RADIUS_KM = 1737.4;

const SVC = 'https://service.iris.edu';
const q = (o) => new URLSearchParams(o).toString();
const DATA_URL = `${SVC}/fdsnws/dataselect/1/query?${q({ net: NET, sta: STA, loc: LOC, cha: CHA, starttime: START, endtime: END, format: 'geocsv' })}`;
const STATION_URL = `${SVC}/fdsnws/station/1/query?${q({ net: NET, sta: STA, loc: LOC, cha: CHA, level: 'channel', starttime: START, endtime: END })}`;
const AVAILABILITY_URL = `${SVC}/fdsnws/availability/1/query?${q({ net: NET, sta: STA, loc: LOC, cha: CHA, start: START, end: END })}`;

/* ---------- args ---------- */

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const fromFile = argVal('--from-file');
const saveRaw = argVal('--save-raw');

/* ---------- fetch ---------- */

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'vitruvius-loom-data-script' } });
  return { status: res.status, finalUrl: res.url, text: res.status === 200 ? await res.text() : '' };
}

let rawText;
let dataUrlResolved = null;
let retrieved;
if (fromFile) {
  rawText = readFileSync(fromFile, 'utf8');
  retrieved = statSync(fromFile).mtime.toISOString();
} else {
  const r = await get(DATA_URL);
  if (r.status !== 200) throw new Error(`dataselect HTTP ${r.status} for ${DATA_URL}`);
  rawText = r.text;
  dataUrlResolved = r.finalUrl;
  retrieved = new Date().toISOString();
  if (saveRaw) writeFileSync(saveRaw, rawText);
}

// Station metadata (sensitivity, units, mode). Optional when reprocessing offline.
let station = null;
try {
  const r = await get(STATION_URL);
  if (r.status === 200) station = parseStationXml(r.text);
} catch (e) {
  if (!fromFile) throw e;
}

// The FDSN availability service was retired by EarthScope; record what it said, find gaps from the data.
let availabilityStatus = 'not checked (offline)';
try {
  const r = await get(AVAILABILITY_URL);
  availabilityStatus = `HTTP ${r.status}`;
} catch {
  /* offline */
}

function parseStationXml(xml) {
  const pick = (re) => xml.match(re)?.[1]?.trim();
  const sens = xml.match(/<InstrumentSensitivity>([\s\S]*?)<\/InstrumentSensitivity>/)?.[1] ?? '';
  const comments = [...xml.matchAll(/<Comment>\s*<Value>([^<]*)<\/Value>/g)].map((m) => m[1].trim());
  return {
    networkDoi: pick(/<Identifier type="DOI">([^<]+)<\/Identifier>/),
    networkDescription: pick(/<Network [^>]*>\s*<Description>([^<]+)<\/Description>/),
    siteName: pick(/<Site>\s*<Name>([^<]+)<\/Name>/),
    latitudeDeg: Number(pick(/<Channel [\s\S]*?<Latitude>([^<]+)<\/Latitude>/)),
    longitudeDeg: Number(pick(/<Channel [\s\S]*?<Longitude>([^<]+)<\/Longitude>/)),
    sensor: pick(/<Sensor>\s*<Description>([^<]+)<\/Description>/),
    sampleRateHz: Number(pick(/<SampleRate>([^<]+)<\/SampleRate>/)),
    sensitivity: Number(sens.match(/<Value>([^<]+)<\/Value>/)?.[1]),
    sensitivityFrequencyHz: Number(sens.match(/<Frequency>([^<]+)<\/Frequency>/)?.[1]),
    inputUnits: sens.match(/<InputUnits>\s*<Name>([^<]+)<\/Name>\s*(?:<Description>([^<]+)<\/Description>)?/)?.slice(1, 3).filter(Boolean).join(' / '),
    outputUnits: sens.match(/<OutputUnits>\s*<Name>([^<]+)<\/Name>/)?.[1],
    comments,
  };
}

/* ---------- parse GeoCSV (one header block per contiguous record segment) ---------- */

const segments = [];
for (const line of rawText.split('\n')) {
  if (!line.trim()) continue;
  if (line.startsWith('#')) {
    const m = line.match(/^# ([\w]+): ?(.*)$/);
    if (!m) continue;
    if (m[1] === 'dataset') segments.push({ head: {}, rows: [] });
    segments.at(-1).head[m[1]] = m[2].trim();
    continue;
  }
  if (line.startsWith('Time')) continue;
  const [ts, vs] = line.split(',');
  segments.at(-1).rows.push([ts.trim(), Number(vs)]);
}
if (!segments.length) throw new Error('No GeoCSV segments in response');
const fs = Number(segments[0].head.sample_rate_hz);
for (const s of segments) {
  if (Number(s.head.sample_rate_hz) !== fs) throw new Error('Mixed sample rates in response');
  if (s.head.SID !== `${NET}_${STA}_${LOC}_${CHA}`) throw new Error(`Unexpected SID ${s.head.SID}`);
}
const csvHead = segments[0].head;

/* ---------- grid by timestamp; gaps stay null ---------- */

const MISSING_FILL = -1; // Nunn et al. 2022: "We substitute a value of -1 for each of these missing values"
const t0 = Date.parse(segments[0].rows[0][0]);
const startIso = segments[0].rows[0][0];
const lastRow = segments.at(-1).rows.at(-1);
const n = Math.round(((Date.parse(lastRow[0]) - t0) / 1000) * fs) + 1;
const counts = new Array(n).fill(null);
const reason = new Uint8Array(n).fill(2); // 0 = valid, 1 = archive fill value -1, 2 = no record for this time
let overlaps = 0;
let maxTimingDevMs = 0;
const rowsHash = createHash('sha256');
for (const s of segments) {
  for (const [ts, v] of s.rows) {
    rowsHash.update(`${ts},${v}\n`);
    const t = Date.parse(ts);
    const i = Math.round(((t - t0) / 1000) * fs);
    maxTimingDevMs = Math.max(maxTimingDevMs, Math.abs(t - (t0 + (i / fs) * 1000)));
    if (reason[i] !== 2) {
      overlaps++;
      continue;
    }
    if (v === MISSING_FILL) reason[i] = 1;
    else {
      reason[i] = 0;
      counts[i] = v;
    }
  }
}
if (maxTimingDevMs > (0.5 / fs) * 1000) throw new Error(`Timestamps drift ${maxTimingDevMs} ms from the nominal grid`);
const timeAt = (i) => new Date(t0 + (i / fs) * 1000).toISOString();

const gaps = [];
for (let i = 0; i < n; ) {
  if (reason[i] === 0) {
    i++;
    continue;
  }
  const r = reason[i];
  let j = i;
  while (j + 1 < n && reason[j + 1] === r) j++;
  gaps.push({
    start: timeAt(i),
    end: timeAt(j),
    startIndex: i,
    count: j - i + 1,
    durationSec: +((j - i + 1) / fs).toFixed(3),
    reason: r === 1 ? 'sample not recovered from tape (archive fill value -1)' : 'no data record for this time',
  });
  i = j + 1;
}
const nValid = counts.filter((v) => v !== null).length;

/* ---------- 2. remove mean + linear trend (valid samples only) ---------- */

let sx = 0, sy = 0, sxx = 0, sxy = 0;
for (let i = 0; i < n; i++) {
  const y = counts[i];
  if (y === null) continue;
  sx += i; sy += y; sxx += i * i; sxy += i * y;
}
const slope = (nValid * sxy - sx * sy) / (nValid * sxx - sx * sx);
const intercept = (sy - slope * sx) / nValid;
const rawMean = sy / nValid;
const detrended = counts.map((y, i) => (y === null ? null : y - (intercept + slope * i)));

/* ---------- 3. high-pass: subtract centred running mean of valid samples ---------- */

const hp = new Array(n).fill(null);
{
  let sum = 0, cnt = 0;
  const add = (k, sign) => {
    if (k < 0 || k >= n || detrended[k] === null) return;
    sum += sign * detrended[k];
    cnt += sign;
  };
  for (let k = 0; k <= HIGHPASS_HALF_WIDTH; k++) add(k, 1);
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      add(i + HIGHPASS_HALF_WIDTH, 1);
      add(i - HIGHPASS_HALF_WIDTH - 1, -1);
    }
    if (detrended[i] !== null) hp[i] = detrended[i] - sum / cnt;
  }
}

/* ---------- 4. normalise to +/-1 by peak ---------- */

let peak = 0, peakIndex = 0;
for (let i = 0; i < n; i++) if (hp[i] !== null && Math.abs(hp[i]) > peak) { peak = Math.abs(hp[i]); peakIndex = i; }
const scale = 10 ** JSON_DECIMALS;
const samples = hp.map((v) => (v === null ? null : Math.round((v / peak) * scale) / scale));

/* ---------- 5. WAV (shares the resampler used by src/seismic.ts makeAudioBuffer) ---------- */

// Lanczos kernel table; keep identical to src/seismic.ts.
const LANCZOS_RES = 1024;
const lanczosTable = (() => {
  const t = new Float32Array(LANCZOS_A * LANCZOS_RES + 1);
  for (let k = 0; k < t.length; k++) {
    const x = k / LANCZOS_RES;
    t[k] = x === 0 ? 1 : (LANCZOS_A * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / LANCZOS_A)) / (Math.PI * Math.PI * x * x);
  }
  return t;
})();
function resample(src, srcRate, dstRate) {
  const ratio = dstRate / srcRate;
  const out = new Float32Array(Math.ceil(src.length * ratio));
  const k = Math.min(1, ratio); // widen the kernel when shrinking (anti-alias)
  const support = LANCZOS_A / k;
  for (let j = 0; j < out.length; j++) {
    const x = j / ratio;
    const lo = Math.max(0, Math.ceil(x - support));
    const hi = Math.min(src.length - 1, Math.floor(x + support));
    let acc = 0, wsum = 0;
    for (let i = lo; i <= hi; i++) {
      const d = Math.abs(x - i) * k;
      if (d >= LANCZOS_A) continue;
      const w = lanczosTable[Math.round(d * LANCZOS_RES)];
      acc += src[i] * w;
      wsum += w;
    }
    out[j] = wsum !== 0 ? acc / wsum : 0;
  }
  return out;
}

const effectiveRate = fs * SPEEDUP;
const audio = resample(Float32Array.from(samples, (v) => v ?? 0), effectiveRate, WAV_RATE);
const pcm = Buffer.alloc(44 + audio.length * 2);
pcm.write('RIFF', 0, 'ascii');
pcm.writeUInt32LE(36 + audio.length * 2, 4);
pcm.write('WAVE', 8, 'ascii');
pcm.write('fmt ', 12, 'ascii');
pcm.writeUInt32LE(16, 16); // PCM fmt chunk size
pcm.writeUInt16LE(1, 20); // PCM
pcm.writeUInt16LE(1, 22); // mono
pcm.writeUInt32LE(WAV_RATE, 24);
pcm.writeUInt32LE(WAV_RATE * 2, 28); // byte rate
pcm.writeUInt16LE(2, 32); // block align
pcm.writeUInt16LE(16, 34); // bits per sample
pcm.write('data', 36, 'ascii');
pcm.writeUInt32LE(audio.length * 2, 40);
let clipped = 0;
for (let j = 0; j < audio.length; j++) {
  let s = Math.round(audio[j] * WAV_GAIN * 32767);
  if (s > 32767 || s < -32768) { clipped++; s = Math.max(-32768, Math.min(32767, s)); }
  pcm.writeInt16LE(s, 44 + j * 2);
}

/* ---------- write ---------- */

const impactMs = Date.parse(EVENT.impactTimeUtc);
const impactIndex = +(((impactMs - t0) / 1000) * fs).toFixed(2);
const lat = station?.latitudeDeg ?? Number(csvHead.latitude_deg);
const lon = station?.longitudeDeg ?? Number(csvHead.longitude_deg);
const rad = Math.PI / 180;
const distKm =
  MOON_RADIUS_KM *
  Math.acos(
    Math.sin(lat * rad) * Math.sin(EVENT.impactLatDeg * rad) +
      Math.cos(lat * rad) * Math.cos(EVENT.impactLatDeg * rad) * Math.cos((lon - EVENT.impactLonDeg) * rad),
  );
const durationSec = n / fs;
const sensitivity = station?.sensitivity ?? Number(csvHead.scale_factor);
const sensFreq = station?.sensitivityFrequencyHz ?? Number(csvHead.scale_frequency_hz);

// RMS envelope (30 s bins) and a simple threshold estimate of when the shaking arrives.
const BIN = 30 * fs; // fractional samples per 30 s bin, so bin labels don't drift
const binOf = (i) => Math.floor(i / BIN);
const acc = [];
for (let i = 0; i < n; i++) {
  const b = (acc[binOf(i)] ??= { ss: 0, c: 0 });
  if (samples[i] !== null) { b.ss += samples[i] ** 2; b.c++; }
}
const env = acc.map((b) => (b.c ? Math.sqrt(b.ss / b.c) : 0));
const preBins = env.slice(0, binOf(impactIndex));
const noise = [...preBins].sort((a, b) => a - b)[Math.floor(preBins.length / 2)];
const W = Math.round(5 * fs);
let onset = null;
for (let i = Math.floor(impactIndex) - W; i + W < n && onset === null; i += 1) {
  let ss = 0, c = 0;
  for (let k = i; k < i + W; k++) if (samples[k] !== null) { ss += samples[k] ** 2; c++; }
  if (c && Math.sqrt(ss / c) > 4 * noise) onset = i;
}
const onsetSec = onset === null ? null : +((onset - impactIndex) / fs).toFixed(1);
const peakSecAfterImpact = +((t0 + (peakIndex / fs) * 1000 - impactMs) / 1000).toFixed(1);

const json = {
  provenance: {
    event: EVENT.name,
    mission: EVENT.mission,
    eventSourceUrl: EVENT.sourceUrl,
    eventSupportingUrls: EVENT.supportingUrls,
    eventDescription: EVENT.description,
    impact: {
      timeUtc: EVENT.impactTimeUtc,
      timeConvention: EVENT.impactTimeConvention,
      latitudeDeg: EVENT.impactLatDeg,
      longitudeDeg: EVENT.impactLonDeg,
      sampleIndex: impactIndex,
      distanceFromStationKm: +distKm.toFixed(1),
      distanceNote:
        'Great-circle distance computed by this script from the NSSDCA impact coordinates and the IRIS station coordinates (Moon radius 1737.4 km). NASA pages round it differently (NSSDCA spacecraft page: about 60 km; NASA History: about 40 miles).',
    },
    instrument: 'Apollo 12 Passive Seismic Experiment (PSE), part of ALSEP',
    network: NET,
    networkName: station?.networkDescription ?? 'Apollo Passive Seismic Experiments',
    networkDoi: station?.networkDoi ?? '10.7914/SN/XA_1969',
    station: STA,
    site: station?.siteName ?? 'ALSEP 12, Oceanus Procellarum, Moon',
    stationLatitudeDeg: lat,
    stationLongitudeDeg: lon,
    location: LOC,
    locationMeaning: 'peaked-mode response (location 00 = peaked mode, 01 = flat mode)',
    channel: CHA,
    channelMeaning: 'mid-period vertical seismometer (called "long-period" in older papers)',
    requestedStart: START + 'Z',
    requestedEnd: END + 'Z',
    start: startIso,
    end: lastRow[0],
    timeConvention:
      'Earth-received UTC: the time the signal reached the ground station; the ~1.2-1.4 s Moon-to-Earth light time is not removed (Nunn et al. 2022).',
    sampleRateHz: fs,
    sampleRateNote: 'Nominal rate (sample interval 0.1509434 s). The archive notes the true rate varies slightly.',
    sampleCount: n,
    validSampleCount: nValid,
    durationSec: +durationSec.toFixed(3),
    units: 'counts (raw digital units of the 10-bit PSE digitiser; not converted to ground motion)',
    nominalSensitivity: {
      value: sensitivity,
      units: `counts per metre of ground displacement at ${sensFreq} Hz`,
      note: 'Nominal value from IRIS/EarthScope StationXML ("Sensor responses contain nominal values"); not applied to the samples.',
    },
    rawMeanCounts: +rawMean.toFixed(3),
    dataUrl: DATA_URL,
    dataUrlResolved,
    dataFormat: 'GeoCSV 2.0 text from fdsnws-dataselect',
    dataRowsSha256: rowsHash.digest('hex'),
    stationUrl: STATION_URL,
    availabilityUrl: null,
    availabilityNote: `The FDSN availability service (${AVAILABILITY_URL}) answered ${availabilityStatus} ("This service has been retired"), so gaps were found from the data itself: timestamp jumps between records and the archive's -1 fill value.`,
    retrieved,
    gaps,
    gapSummary: {
      count: gaps.length,
      missingSamples: n - nValid,
      missingSec: +((n - nValid) / fs).toFixed(3),
      handling: 'Not filled. Missing samples are null in "samples" and play as silence.',
    },
    citations: [
      'Apollo Passive Seismic Experiments, FDSN network XA, doi:10.7914/SN/XA_1969, data from the EarthScope (IRIS) Data Management Center.',
      "Nunn, C. et al. (2022), A New Archive of Apollo's Lunar Seismic Data, Planetary Science Journal 3, 219, doi:10.3847/PSJ/ac87af.",
      'NASA NSSDCA, Lunar Impact Sites (Impact Sites of Apollo LM Ascent and SIVB Stages), impact data from Toksoz et al. 1974.',
    ],
    notes: [
      'These are the actual measured samples from the Apollo 12 seismometer, not synthesized sound.',
      'A seismometer measures ground vibration, not sound in air (the Moon has no air). Speeding the vibration up is a chosen transformation that makes it audible.',
      `In this recording the shaking rises above the background about ${Math.round(onsetSec)} s after the impact time (first 5 s window over 4x the pre-impact RMS), is strongest about ${Math.round(peakSecAfterImpact / 60)} minutes after impact, then fades slowly over most of an hour.`,
      `${overlaps} overlapping duplicate samples were dropped while gridding.`,
      'Window ends at 23:22 UTC; an unrelated large slow swing on this channel starts at about 23:27 UTC.',
    ],
  },
  transform: {
    version: TRANSFORM_VERSION,
    method: 'audification',
    script: 'scripts/fetch-seismic.mjs',
    calibration: 'none (uncalibrated counts)',
    gapHandling: 'Missing samples left as null (JSON) / 0 = silence (audio); never interpolated across.',
    detrend: {
      method: 'least-squares mean and linear trend removed, valid samples only',
      interceptCounts: +intercept.toFixed(4),
      slopeCountsPerSample: +slope.toExponential(6),
    },
    filter: {
      method: 'high-pass by subtracting a centred running mean of valid samples',
      windowSamples: 2 * HIGHPASS_HALF_WIDTH + 1,
      windowSec: +((2 * HIGHPASS_HALF_WIDTH + 1) / fs).toFixed(3),
      firstNullHz: +(fs / (2 * HIGHPASS_HALF_WIDTH + 1)).toFixed(4),
      why: 'Removes slow drift (mainly a ~60 s instrument swing) that is below hearing after speed-up but would otherwise use up the loudness range.',
    },
    normalization: {
      method: 'divide by peak absolute value after filtering',
      countsPerUnit: +peak.toFixed(4),
      peakIndex,
      peakTime: timeAt(peakIndex),
      peakSecondsAfterImpact: peakSecAfterImpact,
    },
    quantization: `JSON samples rounded to ${JSON_DECIMALS} decimals; multiply by countsPerUnit to get filtered counts`,
    defaultSpeedup: SPEEDUP,
    speedupOptions: SPEEDUP_OPTIONS,
    audioSampleRateHz: effectiveRate,
    audioSampleRateNote: `Each measured sample becomes one audio sample at ${effectiveRate} samples/s (${fs} x ${SPEEDUP}). Players need a standard rate, so makeAudioBuffer() and the WAV interpolate to the device/file rate with a Lanczos-3 kernel; pitch and timing are unchanged.`,
    audioDurationSec: +(durationSec / SPEEDUP).toFixed(3),
    wav: {
      file: `${BASENAME}.wav`,
      speedup: SPEEDUP,
      sampleRateHz: WAV_RATE,
      bitsPerSample: 16,
      channels: 1,
      gain: WAV_GAIN,
      interpolation: `Lanczos a=${LANCZOS_A}`,
      clippedSamples: clipped,
      durationSec: +(audio.length / WAV_RATE).toFixed(3),
    },
  },
  samples,
};

mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, `${BASENAME}.json`);
const wavPath = join(outDir, `${BASENAME}.wav`);
const jsonText = JSON.stringify(json);
writeFileSync(jsonPath, jsonText);
writeFileSync(wavPath, pcm);

/* ---------- verify ---------- */

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
console.log(`Fetched  ${dataUrlResolved ?? fromFile}`);
console.log(`Channel  ${NET}.${STA}.${LOC}.${CHA}  ${fs} Hz  ${csvHead.field_unit}  (${segments.length} records)`);
console.log(`Window   ${startIso} -> ${lastRow[0]}  (${n} samples, ${(durationSec / 60).toFixed(2)} min)`);
console.log(`Gaps     ${gaps.length} (${n - nValid} samples, ${((n - nValid) / fs).toFixed(1)} s); overlaps dropped ${overlaps}; max timing deviation ${maxTimingDevMs.toFixed(1)} ms`);
console.log(`Detrend  mean ${rawMean.toFixed(2)} counts, slope ${slope.toExponential(3)} counts/sample; peak |filtered| ${peak.toFixed(2)} counts`);
console.log(`Impact   ${EVENT.impactTimeUtc} (sample ${impactIndex}); peak at ${timeAt(peakIndex)} (+${json.transform.normalization.peakSecondsAfterImpact} s); distance ${distKm.toFixed(1)} km`);

console.log(`Noise    pre-impact RMS ${noise.toFixed(4)}; first 5 s window above 4x noise starts ${onset === null ? 'n/a' : `${timeAt(onset)} (+${((onset - impactIndex) / fs).toFixed(1)} s after impact)`}`);
const maxEnv = Math.max(...env);
console.log('\nRMS envelope, 30 s bins (| = impact):');
env.forEach((e, b) => {
  const tStart = timeAt(Math.ceil(b * BIN)).slice(11, 19);
  const mark = binOf(impactIndex) === b ? '|' : ' ';
  console.log(`${tStart} ${mark} ${'#'.repeat(Math.round((e / maxEnv) * 60))}`);
});
console.log(`\nWrote ${jsonPath} (${kb(jsonText.length)})`);
console.log(`Wrote ${wavPath} (${kb(pcm.length)}, ${(audio.length / WAV_RATE).toFixed(2)} s at ${WAV_RATE} Hz, ${SPEEDUP}x, clipped ${clipped})`);
