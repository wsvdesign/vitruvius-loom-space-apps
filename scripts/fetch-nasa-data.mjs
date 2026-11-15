#!/usr/bin/env node
/**
 * Fetches the real sky used by the telescope and writes it to public/data/.
 *
 *   node scripts/fetch-nasa-data.mjs [startDate] [stopDate]
 *
 * Sources (both NASA, no keys needed):
 *   - NASA JPL Horizons API — geocentric astrometric RA/Dec (ICRF), angular diameter, illuminated
 *     fraction and distance for the Moon (301), Mars (499) and the Sun (10).
 *   - NASA HEASARC — Yale Bright Star Catalogue, 5th revised ed. (BSC5P): every star to about magnitude 6.5.
 *
 * Output files carry their own provenance block (source URL, query, retrieval time) so the app's
 * credits can cite them exactly and the data can be regenerated.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'data');
mkdirSync(outDir, { recursive: true });

const START = process.argv[2] ?? '2026-11-13';
const STOP = process.argv[3] ?? '2026-11-23';
const STEP = '1 h';
const retrieved = new Date().toISOString();

/* ---------- JPL Horizons ---------- */

const HORIZONS = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const BODIES = { moon: '301', mars: '499', sun: '10' };

async function horizons(id) {
  const params = {
    format: 'text',
    COMMAND: `'${id}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'", // geocentre
    START_TIME: `'${START}'`,
    STOP_TIME: `'${STOP}'`,
    STEP_SIZE: `'${STEP}'`,
    QUANTITIES: "'1,10,13,20'",
    ANG_FORMAT: "'DEG'",
    CSV_FORMAT: "'YES'",
  };
  const url = `${HORIZONS}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Horizons ${id}: HTTP ${res.status}`);
  const text = await res.text();
  const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) throw new Error(`Horizons ${id}: no ephemeris block\n${text.slice(0, 600)}`);
  const rows = body.trim().split('\n').map((line) => {
    const c = line.split(',').map((s) => s.trim());
    // Date__(UT)__HR:MN, , , R.A._(ICRF), DEC_(ICRF), Illu%, Ang-diam, delta, deldot
    const t = Date.parse(c[0].replace(/^(\d{4})-(\w{3})-(\d{2}) (\d{2}:\d{2})$/, '$2 $3 $1 $4 UTC'));
    return [t / 1000, +c[3], +c[4], +c[5], +c[6], +c[7]].map((v, i) => (i === 0 ? v : +v.toFixed(i === 5 ? 9 : 5)));
  });
  return { url, rows };
}

const eph = {
  provenance: {
    source: 'NASA JPL Horizons System (ssd.jpl.nasa.gov/horizons)',
    api: HORIZONS,
    observer: 'Geocentre (500@399)',
    frame: 'Astrometric RA/Dec, ICRF',
    start: START,
    stop: STOP,
    step: STEP,
    retrieved,
  },
  columns: ['unixSeconds', 'raDeg', 'decDeg', 'illuminatedPercent', 'angularDiameterArcsec', 'distanceAU'],
  bodies: {},
};
for (const [name, id] of Object.entries(BODIES)) {
  const { url, rows } = await horizons(id);
  eph.bodies[name] = { horizonsId: id, query: url, rows };
  console.log(`horizons ${name}: ${rows.length} rows`);
}
writeFileSync(join(outDir, 'ephemeris.json'), JSON.stringify(eph));

/* ---------- HEASARC Yale Bright Star Catalogue ---------- */

const BSC = 'https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_bsc5p.tdat.gz';
const gz = Buffer.from(await (await fetch(BSC)).arrayBuffer());
const tdat = gunzipSync(gz).toString('latin1');
const header = tdat.match(/^line\[1\] = (.+)$/m)[1].trim().split(/\s+/);
const col = (n) => header.indexOf(n);
const [iRa, iDec, iV, iBv, iName, iAlt] = ['ra', 'dec', 'vmag', 'bv_color', 'name', 'alt_name'].map(col);
const data = tdat.split('<DATA>')[1].split('<END>')[0].trim().split('\n');

const stars = [];
const named = [];
for (const line of data) {
  const f = line.split('|');
  const ra = parseFloat(f[iRa]);
  const dec = parseFloat(f[iDec]);
  const v = parseFloat(f[iV]);
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(v)) continue;
  const bv = parseFloat(f[iBv]);
  stars.push(+ra.toFixed(4), +dec.toFixed(4), +v.toFixed(2), Number.isFinite(bv) ? +bv.toFixed(2) : 0.6);
  if (v < 1.6) named.push({ name: (f[iAlt] || f[iName] || '').trim(), ra: +ra.toFixed(4), dec: +dec.toFixed(4), vmag: v });
}
writeFileSync(
  join(outDir, 'stars.json'),
  JSON.stringify({
    provenance: {
      source: 'Yale Bright Star Catalogue, 5th Revised Ed. (BSC5P), hosted by NASA HEASARC',
      url: BSC,
      frame: 'J2000 RA/Dec',
      retrieved,
    },
    columns: ['raDeg', 'decDeg', 'vmag', 'bv'],
    count: stars.length / 4,
    stars,
    brightest: named.sort((a, b) => a.vmag - b.vmag),
  }),
);
console.log(`bsc5p: ${stars.length / 4} stars`);
