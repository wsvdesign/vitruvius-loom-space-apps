#!/usr/bin/env node
/**
 * Records Ginny's scripted lines in the voice chosen in src/content/ginny.json.
 *
 *   node --env-file-if-exists=.env scripts/make-voice.mjs          # dry run: lists lines and character count
 *   node --env-file-if-exists=.env scripts/make-voice.mjs --yes    # records anything not recorded yet
 *
 * Providers:
 *   - Kokoro (open source, Apache-2.0): runs on this machine, no key. Current choice: "Heart" (af_heart).
 *   - ElevenLabs: needs ELEVENLABS_API_KEY in .env (never printed).
 *
 * Writes public/voice/<hash>.<ext> and public/voice/lines.json ({ "<exact line text>": "./voice/<file>" }),
 * which src/audio.ts reads. A line is only re-recorded when its text, voice or model changes.
 * On macOS the WAV output is converted to AAC (.m4a) with afconvert to keep files small.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'voice');
const manifestPath = join(outDir, 'lines.json');
const content = JSON.parse(readFileSync(join(root, 'src', 'content', 'ginny.json'), 'utf8'));
const { provider, voiceId, model, name } = content.voice;

const lines = [
  ...content.beats,
  ...Object.values(content.answers).map((a) => a.body),
  content.quake,
].filter((t) => typeof t === 'string' && t.trim());

const hasAfconvert = (() => { try { execFileSync('which', ['afconvert'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ext = provider === 'ElevenLabs' ? 'mp3' : hasAfconvert ? 'm4a' : 'wav';
const base = (text) => createHash('sha256').update(`${provider}|${voiceId}|${model}|${text}`).digest('hex').slice(0, 16);
const fileFor = (text) => `${base(text)}.${ext}`;

mkdirSync(outDir, { recursive: true });
const todo = lines.filter((t) => !existsSync(join(outDir, fileFor(t))));
console.log(`Voice: ${provider} · ${name} (${voiceId})`);
console.log(`${lines.length} lines, ${todo.length} to record, ${todo.reduce((n, t) => n + t.length, 0)} characters.`);
for (const t of todo) console.log(`  · ${t.slice(0, 90)}${t.length > 90 ? '…' : ''}`);

function writeManifest() {
  // only the current lines, so retired recordings drop out of the app
  const manifest = {};
  for (const t of lines) if (existsSync(join(outDir, fileFor(t)))) manifest[t] = `./voice/${fileFor(t)}`;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  // remove audio files no current line uses
  const keep = new Set(Object.values(manifest).map((p) => p.replace('./voice/', '')));
  for (const f of readdirSync(outDir)) if (/\.(mp3|m4a|wav)$/.test(f) && !keep.has(f)) unlinkSync(join(outDir, f));
  return manifest;
}

if (!process.argv.includes('--yes')) {
  writeManifest();
  console.log('\nDry run. Add --yes to record.');
  process.exit(0);
}

if (provider === 'Kokoro') {
  const { KokoroTTS } = await import('kokoro-js');
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
  for (const text of todo) {
    const audio = await tts.generate(text, { voice: voiceId });
    const wav = join(outDir, `${base(text)}.wav`);
    writeFileSync(wav, Buffer.from(audio.toWav()));
    if (ext === 'm4a') {
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', wav, join(outDir, fileFor(text))]);
      unlinkSync(wav);
    }
    console.log(`recorded ${fileFor(text)}`);
  }
} else if (provider === 'ElevenLabs') {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { console.error('ELEVENLABS_API_KEY is not set in .env'); process.exit(1); }
  for (const text of todo) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true } }),
    });
    if (!res.ok) { console.error(`ElevenLabs HTTP ${res.status}`); if (res.status === 401 || res.status === 403) process.exit(1); continue; }
    writeFileSync(join(outDir, fileFor(text)), Buffer.from(await res.arrayBuffer()));
    console.log(`recorded ${fileFor(text)}`);
  }
} else {
  console.error(`Unknown voice provider: ${provider}`);
  process.exit(1);
}

const m = writeManifest();
console.log(`Done. ${Object.keys(m).length} lines in public/voice/lines.json`);
