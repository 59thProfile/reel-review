// Runs each flow in a fresh browser context. Every step and check records a screenshot,
// the box of the element it acted on, and a pass/fail verdict.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export async function runFlows(config, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const viewport = config.viewport ?? { width: 1280, height: 800 };
  const browser = await chromium.launch(process.env.REEL_CHROMIUM ? { executablePath: process.env.REEL_CHROMIUM } : {});
  const results = [];
  for (const [fi, flow] of (config.flows ?? []).entries()) {
    const ctx = await browser.newContext({ viewport, baseURL: config.baseURL, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e.message).split('\n')[0].slice(0, 200)));
    const steps = [];
    let n = 0;
    const t0 = Date.now();
    const shot = async () => {
      const f = `f${fi}-s${n++}.png`;
      await page.screenshot({ path: path.join(outDir, f), animations: 'disabled', caret: 'hide' });
      return f;
    };
    const box = async (loc) => {
      try {
        const b = await loc.boundingBox({ timeout: 1500 });
        return b && { x: b.x, y: b.y, w: b.width, h: b.height };
      } catch {
        return null;
      }
    };
    const t = {
      page,
      /** An action. If it throws, the flow stops here and the card shows this step. */
      async step(label, fn, target) {
        const s0 = Date.now();
        const rec = { kind: 'action', label, status: 'pass' };
        try {
          if (target) rec.box = await box(target(page));
          await fn(page);
          await page.waitForTimeout(250);
        } catch (e) {
          rec.status = 'fail';
          rec.error = e.message.split('\n')[0].slice(0, 240);
        }
        rec.ms = Date.now() - s0;
        rec.shot = await shot();
        steps.push(rec);
        if (rec.status === 'fail') throw Object.assign(new Error(rec.error), { recorded: true });
      },
      /** A check. Return { ok, expected, actual } or a boolean. A failed check does not stop the flow. */
      async expect(label, fn, target) {
        const s0 = Date.now();
        const rec = { kind: 'check', label, status: 'pass' };
        try {
          const r = await fn(page);
          if (r && typeof r === 'object') {
            rec.expected = r.expected === undefined ? undefined : String(r.expected);
            rec.actual = r.actual === undefined ? undefined : String(r.actual);
            if (!r.ok) rec.status = 'fail';
          } else if (r === false) rec.status = 'fail';
        } catch (e) {
          rec.status = 'fail';
          rec.error = e.message.split('\n')[0].slice(0, 240);
        }
        if (target) rec.box = await box(target(page));
        rec.ms = Date.now() - s0;
        rec.shot = await shot();
        steps.push(rec);
      },
    };
    try {
      await flow.run(t);
    } catch (e) {
      if (!e.recorded) {
        steps.push({ kind: 'action', label: 'Unhandled error', status: 'fail', error: e.message.split('\n')[0], shot: await shot().catch(() => null) });
      }
    }
    if (consoleErrors.length && !steps.some((s) => s.status === 'fail')) {
      steps.push({ kind: 'check', label: 'No JavaScript errors', status: 'fail', expected: 'none', actual: consoleErrors[0], shot: await shot() });
    }
    const status = steps.some((s) => s.status === 'fail') ? 'fail' : 'pass';
    results.push({ id: flow.id, title: flow.title, intent: flow.intent ?? null, status, ms: Date.now() - t0, url: page.url().replace(config.baseURL, ''), consoleErrors: [...new Set(consoleErrors)].slice(0, 5), steps });
    console.log(`${status === 'pass' ? 'pass' : 'FAIL'}  ${flow.title}  (${steps.length} steps)`);
    await ctx.close();
  }
  await browser.close();
  const run = { app: config.app, baseURL: config.baseURL, startedAt: new Date().toISOString(), viewport, flows: results };
  fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(run, null, 2));
  return run;
}
