#!/usr/bin/env node
// Reel Review runner.
//   node reel.mjs run              run the flows, shoot the screens, diff them against the
//                                  baseline and write .reels/cards.json
//   node reel.mjs approve <id>     make a screen's latest shot its new baseline
// Reads reels.config.mjs from this folder (or REEL_CONFIG) and writes everything under .reels/.
// Your app must already be running at the config's baseURL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runFlows } from './harness.mjs';
import { shootScreens } from './shoot.mjs';
import { diffScreens } from './diff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(HERE, '.reels');

async function loadConfig() {
  const file = path.resolve(HERE, process.env.REEL_CONFIG ?? 'reels.config.mjs');
  if (!fs.existsSync(file)) throw new Error(`No config at ${file}. Copy reels.config.mjs from the repo and point it at your app.`);
  const config = (await import(pathToFileURL(file).href)).default;
  if (process.env.REEL_BASE_URL) config.baseURL = process.env.REEL_BASE_URL;
  if (!config.baseURL) throw new Error('reels.config.mjs needs a baseURL, e.g. http://localhost:3000');
  return config;
}

async function assertUp(baseURL) {
  try {
    await fetch(baseURL, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(`Nothing answered at ${baseURL}. Start your app first.`);
  }
}

async function run() {
  const config = await loadConfig();
  await assertUp(config.baseURL);
  fs.mkdirSync(R, { recursive: true });
  const flows = await runFlows(config, path.join(R, 'run'));
  const shots = await shootScreens(config, path.join(R, 'current'));
  const screens = diffScreens(shots, path.join(R, 'baseline'), path.join(R, 'current'), path.join(R, 'changes'), config.diff);

  const cards = [];
  for (const f of flows.flows) {
    const bad = f.steps.find((s) => s.status === 'fail');
    cards.push({
      id: `flow:${f.id}`, kind: 'flow', title: f.title, intent: f.intent, url: f.url,
      verdict: f.status === 'pass' ? 'pass' : 'fail',
      step: bad ? (bad.error ? `${bad.label}: ${bad.error}` : bad.label) : null,
      expected: bad?.expected ?? null, actual: bad?.actual ?? null,
      shot: bad?.shot ? path.join(R, 'run', bad.shot) : null, diff: null,
    });
  }
  for (const s of screens) {
    const verdict = s.verdict === 'auto-fail' ? 'fail' : s.verdict === 'changed' ? 'changed' : 'pass';
    cards.push({
      id: `screen:${s.id}`, kind: 'screen', title: s.name, intent: null, url: s.path,
      verdict, step: s.reason ?? (verdict === 'changed' ? `${(s.ratio * 100).toFixed(2)}% of pixels changed` : null),
      expected: null, actual: null,
      shot: path.join(R, 'current', `${s.id}.png`),
      diff: verdict === 'changed' ? path.join(R, 'changes', `${s.id}.diff.png`) : null,
    });
  }
  fs.writeFileSync(path.join(R, 'cards.json'), JSON.stringify({ ranAt: new Date().toISOString(), app: config.app ?? 'your app', cards }, null, 2));
  const n = (v) => cards.filter((c) => c.verdict === v).length;
  console.log(`reels: ${n('fail')} failing, ${n('changed')} changed, ${n('pass')} passing`);
}

function approve(id) {
  if (!/^[\w-]+$/.test(id ?? '')) throw new Error('approve needs a screen id from reels.config.mjs, e.g. "home"');
  const from = path.join(R, 'current', `${id}.png`);
  if (!fs.existsSync(from)) throw new Error(`No current shot for "${id}". Run the reels first.`);
  fs.mkdirSync(path.join(R, 'baseline'), { recursive: true });
  fs.copyFileSync(from, path.join(R, 'baseline', `${id}.png`));
  console.log(`reels: ${id} is the new baseline`);
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === 'run') await run();
  else if (cmd === 'approve') approve(arg);
  else {
    console.error('usage: node reel.mjs run | approve <screen-id>');
    process.exit(2);
  }
} catch (e) {
  console.error(`reels: ${e.message}`);
  process.exit(1);
}
