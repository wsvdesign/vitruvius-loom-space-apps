#!/usr/bin/env node
/**
 * Builds 3D Manny with Meshy from Natalie's cut-out drawings (public/characters/cutouts/).
 *
 *   node --env-file=.env scripts/meshy-manny.mjs model        # A: multi-view model + B: arms-out model
 *   node --env-file=.env scripts/meshy-manny.mjs rig <taskId> <multi|single>   # rig a finished model (walking included)
 *
 * Images are sent as base64 data URIs (no public hosting needed). Results (GLB files) are saved to
 * public/models/manny/, and task ids (no keys) are logged to public/models/manny/meshy-tasks.json.
 * The API key comes from MESHY_API_KEY in .env and is never printed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cut = join(root, 'public', 'characters', 'cutouts');
const out = join(root, 'public', 'models', 'manny');
mkdirSync(out, { recursive: true });
const logPath = join(out, 'meshy-tasks.json');
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : { tasks: [] };
const save = () => writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');

const KEY = process.env.MESHY_API_KEY;
if (!KEY) { console.error('MESHY_API_KEY missing in .env'); process.exit(1); }
const API = 'https://api.meshy.ai/openapi';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

/** downscale to ≤1024 px (keeps alpha) and return a data URI */
function dataUri(file) {
  const tmp = join(tmpdir(), `meshy-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  execFileSync('sips', ['-Z', '1024', join(cut, file), '--out', tmp], { stdio: 'ignore' });
  return `data:image/png;base64,${readFileSync(tmp).toString('base64')}`;
}

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.result;
}
async function poll(path, id, label) {
  for (;;) {
    const r = await fetch(`${API}${path}/${id}`, { headers: H });
    const j = await r.json();
    if (j.status === 'SUCCEEDED') { console.log(`${label}: done`); return j; }
    if (j.status === 'FAILED' || j.status === 'CANCELED') throw new Error(`${label}: ${j.status} ${JSON.stringify(j.task_error || {})}`);
    console.log(`${label}: ${j.status} ${j.progress ?? 0}%`);
    await new Promise((res) => setTimeout(res, 15000));
  }
}
async function download(url, name) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${name}: HTTP ${r.status}`);
  writeFileSync(join(out, name), Buffer.from(await r.arrayBuffer()));
  console.log(`saved public/models/manny/${name}`);
}

const common = { ai_model: 'latest', should_texture: true, enable_pbr: false, should_remesh: true, topology: 'triangle', target_polycount: 30000, symmetry_mode: 'auto' };
const mode = process.argv[2];

if (mode === 'model') {
  const views = ['02_manny_front_view.png', '04_manny_side_view.png', '06_manny_back_view.png', '07_manny_opposite_side_view.png'];
  const [a, b] = await Promise.all([
    post('/v1/multi-image-to-3d', { image_urls: views.map(dataUri), ...common }),
    post('/v1/image-to-3d', { image_url: dataUri('11_manny_arms_out.png'), ...common }),
  ]);
  log.tasks.push({ kind: 'multi-image-to-3d', id: a, inputs: views, at: new Date().toISOString() }, { kind: 'image-to-3d', id: b, inputs: ['11_manny_arms_out.png'], at: new Date().toISOString() });
  save();
  console.log(`submitted A (multi-view) ${a} and B (arms out) ${b}`);
  const [ja, jb] = await Promise.all([poll('/v1/multi-image-to-3d', a, 'A multi-view'), poll('/v1/image-to-3d', b, 'B arms-out')]);
  await download(ja.model_urls.glb, 'manny-multiview.glb');
  await download(jb.model_urls.glb, 'manny-armsout.glb');
  if (ja.thumbnail_url) await download(ja.thumbnail_url, 'manny-multiview-thumb.png');
  if (jb.thumbnail_url) await download(jb.thumbnail_url, 'manny-armsout-thumb.png');
} else if (mode === 'rig') {
  const [, , , taskId, which = 'single'] = process.argv;
  const id = await post('/v1/rigging', { input_task_id: taskId, height_meters: 1.45 });
  log.tasks.push({ kind: 'rigging', id, input: taskId, at: new Date().toISOString() });
  save();
  const j = await poll('/v1/rigging', id, 'rigging');
  const r = j.result || {};
  if (r.rigged_character_glb_url) await download(r.rigged_character_glb_url, `manny-${which}-rigged.glb`);
  const anim = r.basic_animations || {};
  if (anim.walking_glb_url) await download(anim.walking_glb_url, `manny-${which}-walking.glb`);
  if (anim.running_glb_url) await download(anim.running_glb_url, `manny-${which}-running.glb`);
} else {
  console.log('usage: model | rig <taskId> <multi|single>');
}
