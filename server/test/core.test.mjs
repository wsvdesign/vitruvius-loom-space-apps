// Tests for the pure ask/tiles logic. Run: npm run test:api
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateAsk,
  normalizeFacts,
  factsFromGinny,
  pickFacts,
  retrieve,
  buildGeminiRequest,
  extractGeminiText,
  checkReply,
  createRateLimiter,
  pickIonEndpoint,
  clientIp,
  MAX_QUESTION,
} from '../core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));
const FACTS = normalizeFacts(fixture('facts.json'));
const byId = (id) => FACTS.find((f) => f.id === id);

/* ---------- request validation ---------- */

test('case 1: a question that is not a string is rejected', () => {
  for (const body of [null, 'x', 42, {}, { question: 7 }, { question: ['a'] }]) {
    assert.equal(validateAsk(body).ok, false);
  }
});

test('case 2: the question is trimmed and must be 1 to 300 characters', () => {
  assert.equal(validateAsk({ question: '   ' }).ok, false);
  assert.equal(validateAsk({ question: 'x'.repeat(MAX_QUESTION + 1) }).ok, false);
  const ok = validateAsk({ question: '  Why is the dust sharp?  ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.question, 'Why is the dust sharp?');
  assert.equal(validateAsk({ question: 'x'.repeat(MAX_QUESTION) }).ok, true);
});

test('case 3: world is optional, but only moon or mars is accepted', () => {
  assert.equal(validateAsk({ question: 'hi' }).world, null);
  assert.equal(validateAsk({ question: 'hi', world: 'mars' }).world, 'mars');
  assert.equal(validateAsk({ question: 'hi', world: 'venus' }).ok, false);
  assert.equal(validateAsk({ question: 'hi', world: 3 }).ok, false);
});

/* ---------- facts and retrieval ---------- */

test('case 4: malformed facts are dropped when the facts file is read', () => {
  assert.equal(FACTS.length, 6);
  assert.ok(FACTS.every((f) => f.id && f.claim && f.source_title));
  assert.deepEqual(normalizeFacts(null), []);
  assert.deepEqual(normalizeFacts({ facts: 'nope' }), []);
});

test('case 5: without a facts file, Ginny falls back to her written answers and their source labels', () => {
  const g = factsFromGinny(fixture('ginny.json'));
  assert.equal(g.length, 2);
  assert.equal(g[0].id, 'ginny-gold');
  assert.equal(g[0].source_title, 'FIXTURE · insulation source');
  assert.equal(g[0].source_url, null);
  assert.equal(g[0].world, 'moon');
  assert.equal(pickFacts([], g), g);
  assert.equal(pickFacts(FACTS, g), FACTS);
});

test('case 6: facts that share words with the question rank first, at most 8', () => {
  const hits = retrieve(FACTS, 'Why is the moon dust so sharp?', 'moon');
  assert.equal(hits[0].id, 'fx-moon-dust');
  assert.ok(hits.length <= 8);
  const many = Array.from({ length: 20 }, (_, i) => ({ ...FACTS[0], id: `dup-${i}` }));
  assert.equal(retrieve(many, 'dust', 'moon').length, 8);
});

test('case 7: on a tie, facts from the world you are on come first', () => {
  const onMars = retrieve(FACTS, 'tell me about dust', 'mars');
  assert.equal(onMars[0].id, 'fx-mars-dust');
  const onMoon = retrieve(FACTS, 'tell me about dust', 'moon');
  assert.equal(onMoon[0].id, 'fx-moon-dust');
});

test('case 8: a question that matches nothing still gets a few facts from this world so Ginny can suggest one', () => {
  const hits = retrieve(FACTS, 'what is your favourite colour', 'mars');
  assert.ok(hits.length >= 1 && hits.length <= 3);
  assert.ok(hits.every((f) => f.world !== 'moon'));
});

test('case 9: simple plurals and endings still match (quakes / quake, storms / storm)', () => {
  assert.equal(retrieve(FACTS, 'is there a quake?', 'moon')[0].id, 'fx-moon-quake');
  assert.equal(retrieve(FACTS, 'how big is a storm', 'mars')[0].id, 'fx-mars-dust');
});

/* ---------- model request and reply ---------- */

test('case 10: the model request carries the rules, the facts with ids, and asks for JSON', () => {
  const facts = retrieve(FACTS, 'dust', 'moon');
  const req = buildGeminiRequest({ question: 'Why is dust sharp?', world: 'moon', facts, model: 'gemini-2.5-flash' });
  const sys = req.systemInstruction.parts[0].text;
  assert.match(sys, /Ginny/);
  assert.match(sys, /Ingenuity/);
  assert.match(sys, /ONLY/);
  assert.match(sys, /Lakota/);
  const user = req.contents[0].parts[0].text;
  assert.match(user, /fx-moon-dust/);
  assert.match(user, /Why is dust sharp\?/);
  assert.equal(req.generationConfig.responseMimeType, 'application/json');
  assert.equal(req.generationConfig.thinkingConfig.thinkingBudget, 0);
  const pro = buildGeminiRequest({ question: 'q', world: null, facts, model: 'gemini-2.5-pro' });
  assert.equal(pro.generationConfig.thinkingConfig, undefined);
});

test('case 11: reply text is read from the model response; a blocked response is reported as blocked', () => {
  const ok = { candidates: [{ content: { parts: [{ text: '{"answer":' }, { text: '"hi","used_fact_ids":[]}' }] }, finishReason: 'STOP' }] };
  assert.deepEqual(extractGeminiText(ok), { text: '{"answer":"hi","used_fact_ids":[]}' });
  assert.deepEqual(extractGeminiText({ promptFeedback: { blockReason: 'SAFETY' } }), { blocked: true });
  assert.deepEqual(extractGeminiText({ candidates: [{ finishReason: 'SAFETY' }] }), { blocked: true });
  assert.deepEqual(extractGeminiText({}), { text: null });
});

test('case 12: sources come only from used fact ids that were actually given to the model', () => {
  const given = [byId('fx-moon-dust'), byId('fx-moon-quake')];
  const out = checkReply(JSON.stringify({ answer: 'The dust is jagged because there is no wind.', used_fact_ids: ['fx-moon-dust', 'made-up-id', 'fx-mars-heli'] }), given);
  assert.equal(out.grounded, true);
  assert.deepEqual(out.sources, [{ title: 'Fixture Source Dust', url: 'https://example.test/dust' }]);
  assert.equal(out.answer, 'The dust is jagged because there is no wind.');
});

test('case 13: a reply that uses no facts is not grounded and has no sources', () => {
  const out = checkReply(JSON.stringify({ answer: "I don't know that one yet. Ask me about moon dust!", used_fact_ids: [] }), [byId('fx-moon-dust')]);
  assert.equal(out.grounded, false);
  assert.deepEqual(out.sources, []);
  assert.match(out.answer, /know that one yet/);
});

test('case 14: a reply that is not valid JSON or has no answer is refused', () => {
  assert.equal(checkReply('not json', FACTS), null);
  assert.equal(checkReply('{"used_fact_ids":[]}', FACTS), null);
  assert.equal(checkReply('{"answer":"   "}', FACTS), null);
  assert.equal(checkReply(null, FACTS), null);
});

test('case 15: a number that is not in the facts it used is never shown to the child', () => {
  const given = [byId('fx-moon-temp')];
  const good = checkReply(JSON.stringify({ answer: 'In sunlight it reaches 250 degrees, in shadow -208.', used_fact_ids: ['fx-moon-temp'] }), given);
  assert.equal(good.grounded, true);
  assert.match(good.answer, /250/);
  const bad = checkReply(JSON.stringify({ answer: 'It gets to 260 degrees!', used_fact_ids: ['fx-moon-temp'] }), given);
  assert.equal(bad.grounded, false);
  assert.deepEqual(bad.sources, []);
  assert.doesNotMatch(bad.answer, /260/);
  assert.match(bad.answer, /know that one yet/);
});

test('case 16: anything about Lakota or a culture\'s beliefs is replaced with the safe answer', () => {
  const given = [byId('fx-moon-dust')];
  for (const answer of ['The Lakota say the dust is sharp.', 'In one teaching a wanagi travels the sky.']) {
    const out = checkReply(JSON.stringify({ answer, used_fact_ids: ['fx-moon-dust'] }), given);
    assert.equal(out.grounded, false);
    assert.doesNotMatch(out.answer, /lakota|wanagi/i);
  }
});

test('case 17: fact ids the model wrote into the answer text are removed', () => {
  const given = [byId('fx-moon-dust')];
  const out = checkReply(JSON.stringify({ answer: 'The dust is jagged [fx-moon-dust].', used_fact_ids: ['fx-moon-dust'] }), given);
  assert.equal(out.answer, 'The dust is jagged.');
});

test('case 18: two used facts with the same source link give one source', () => {
  const a = byId('fx-moon-dust');
  const b = { ...a, id: 'fx-moon-dust-2' };
  const out = checkReply(JSON.stringify({ answer: 'Jagged dust.', used_fact_ids: [a.id, b.id] }), [a, b]);
  assert.equal(out.sources.length, 1);
});

/* ---------- rate limit, tiles, client address ---------- */

test('case 19: ten questions a minute per address are allowed, the eleventh waits', () => {
  let now = 0;
  const limit = createRateLimiter({ limit: 10, windowMs: 60_000, now: () => now });
  for (let i = 0; i < 10; i++) assert.equal(limit('1.2.3.4').ok, true);
  const blocked = limit('1.2.3.4');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60);
  assert.equal(limit('5.6.7.8').ok, true);
  now = 60_001;
  assert.equal(limit('1.2.3.4').ok, true);
});

test('case 20: the map endpoint fields are passed through unchanged, and nothing else', () => {
  const attributions = [{ html: '<span>Data <a href="https://x.test">NASA</a></span>', collapsible: false }];
  const ion = { type: '3DTILES', url: 'https://assets.example.test/1/tileset.json?v=1', accessToken: 'short-lived', attributions, extra: 'drop me' };
  assert.deepEqual(pickIonEndpoint(ion), { type: '3DTILES', url: ion.url, accessToken: 'short-lived', attributions });
  assert.deepEqual(pickIonEndpoint({ ...ion, attributions: undefined }).attributions, []);
  assert.equal(pickIonEndpoint({ type: '3DTILES', url: ion.url }), null);
  assert.equal(pickIonEndpoint({ accessToken: 'x' }), null);
  assert.equal(pickIonEndpoint({ url: 'http://insecure.test/t.json', accessToken: 'x' }), null);
  assert.equal(pickIonEndpoint(null), null);
});

test('case 21: the forwarded client address is trusted only from a local proxy, and only its last hop', () => {
  assert.equal(clientIp('127.0.0.1', 'evil, 9.9.9.9', false), '9.9.9.9');
  assert.equal(clientIp('::ffff:127.0.0.1', '9.9.9.9', false), '9.9.9.9');
  assert.equal(clientIp('8.8.8.8', '9.9.9.9', false), '8.8.8.8');
  assert.equal(clientIp('10.0.0.2', 'a, 9.9.9.9', true), '9.9.9.9');
  assert.equal(clientIp('127.0.0.1', undefined, false), '127.0.0.1');
});

test('personal details never reach the AI provider', () => {
  for (const q of ['my email is kid123@example.com', 'call me at 917 555 0123', 'I live at 42 Wallaby Way', 'My name is Sam, is there water?', 'my address is 12 Main Street']) {
    const v = validateAsk({ question: q });
    assert.equal(v.ok, false, q);
    assert.equal(v.reason, 'personal-info', q);
  }
  for (const q of ['Is there water on the Moon?', 'How far is Mars, about 200 million km?', 'What happened in 1969?']) {
    assert.equal(validateAsk({ question: q }).ok, true, q);
  }
});
