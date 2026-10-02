// Compares each fresh screenshot with its approved baseline.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const DIFF_COLOR = [255, 40, 60];

export function diffScreens(screens, baseDir, curDir, outDir, { noise = 0.0005, minTextChars = 20 } = {}) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(baseDir, { recursive: true });
  const report = [];
  for (const s of screens) {
    const basePng = path.join(baseDir, `${s.id}.png`);
    const curPng = path.join(curDir, `${s.id}.png`);
    const broken = s.errors.length > 0 || s.serverErrors.length > 0 || s.textChars < minTextChars;
    const reason = broken
      ? s.errors[0] ? `JS error: ${s.errors[0]}` : s.serverErrors[0] ? `Server error: ${s.serverErrors[0]}` : 'Screen rendered blank'
      : null;

    // A screen with no baseline yet: its first good shot becomes the baseline.
    if (!fs.existsSync(basePng)) {
      if (!broken) fs.copyFileSync(curPng, basePng);
      report.push({ ...s, verdict: broken ? 'auto-fail' : 'new', ratio: 0, box: null, reason });
      continue;
    }

    const a = PNG.sync.read(fs.readFileSync(basePng));
    const b = PNG.sync.read(fs.readFileSync(curPng));
    if (a.width !== b.width || a.height !== b.height) {
      fs.copyFileSync(curPng, path.join(outDir, `${s.id}.diff.png`));
      report.push({ ...s, verdict: broken ? 'auto-fail' : 'changed', ratio: 1, box: null, reason: reason ?? `Size changed from ${a.width}×${a.height} to ${b.width}×${b.height}` });
      continue;
    }
    const { width, height } = a;
    const d = new PNG({ width, height });
    const n = pixelmatch(a.data, b.data, d.data, width, height, { threshold: 0.1, includeAA: false, alpha: 0.25, diffColor: DIFF_COLOR });
    const ratio = n / (width * height);
    const verdict = broken ? 'auto-fail' : ratio <= noise ? 'unchanged' : 'changed';
    if (verdict !== 'unchanged') fs.writeFileSync(path.join(outDir, `${s.id}.diff.png`), PNG.sync.write(d));
    report.push({ ...s, verdict, changedPx: n, ratio: +ratio.toFixed(5), box: verdict === 'changed' ? focusBox(d, width, height) : null, reason });
    console.log(s.id.padEnd(16), verdict, reason ?? '');
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ comparedAt: new Date().toISOString(), screens: report }, null, 2));
  return report;
}

// The first substantial cluster of changed 32px cells, in reading order: where the eye should go.
// Small scattered changes (a relative timestamp ticking over) lose to the real one.
function focusBox(d, width, height) {
  const CS = 32;
  const cells = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (d.data[i] === DIFF_COLOR[0] && d.data[i + 1] === DIFF_COLOR[1] && d.data[i + 2] === DIFF_COLOR[2]) {
        const k = `${(x / CS) | 0},${(y / CS) | 0}`;
        cells.set(k, (cells.get(k) || 0) + 1);
      }
    }
  }
  const seen = new Set();
  const clusters = [];
  for (const k of cells.keys()) {
    if (seen.has(k)) continue;
    const stack = [k];
    seen.add(k);
    let tot = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    while (stack.length) {
      const c = stack.pop();
      const [cx, cy] = c.split(',').map(Number);
      tot += cells.get(c);
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nk = `${cx + dx},${cy + dy}`;
          if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
    }
    clusters.push({ tot, x0, y0, x1, y1 });
  }
  if (!clusters.length) return null;
  const big = Math.max(...clusters.map((c) => c.tot));
  const best = clusters.filter((c) => c.tot >= big * 0.2).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)[0];
  return { x: best.x0 * CS, y: best.y0 * CS, w: (best.x1 - best.x0 + 1) * CS, h: (best.y1 - best.y0 + 1) * CS };
}
