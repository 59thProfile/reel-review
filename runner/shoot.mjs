// Screenshots every screen in the config with one browser session, and notes anything that
// makes a screen broken regardless of how it looks: a JavaScript error, a 5xx response from
// your app, or a blank page.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export async function shootScreens(config, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const viewport = config.viewport ?? { width: 1280, height: 800 };
  const browser = await chromium.launch(process.env.REEL_CHROMIUM ? { executablePath: process.env.REEL_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport, baseURL: config.baseURL, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  if (config.setup) await config.setup(page);
  const origin = new URL(config.baseURL).origin;
  const contentSelector = config.contentSelector ?? 'body';
  const results = [];
  for (const screen of config.screens ?? []) {
    const errors = [];
    const serverErrors = [];
    const onErr = (e) => errors.push(String(e.message).split('\n')[0].slice(0, 200));
    const onRes = (r) => {
      if (r.status() >= 500 && r.url().startsWith(origin)) serverErrors.push(`${r.status()} ${new URL(r.url()).pathname}`);
    };
    page.on('pageerror', onErr);
    page.on('response', onRes);
    await page.goto(screen.path);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    if (screen.prepare) await screen.prepare(page);
    await page.waitForTimeout(screen.settleMs ?? 500);
    const text = (await page.locator(contentSelector).first().innerText().catch(() => '')).trim();
    await page.screenshot({ path: path.join(outDir, `${screen.id}.png`), animations: 'disabled', caret: 'hide', mask: (screen.mask ?? []).map((s) => page.locator(s)) });
    page.off('pageerror', onErr);
    page.off('response', onRes);
    results.push({ id: screen.id, name: screen.name ?? screen.id, path: screen.path, errors, serverErrors: [...new Set(serverErrors)], textChars: text.length });
    console.log(screen.id.padEnd(16), errors[0] ? `JS error: ${errors[0]}` : serverErrors[0] ? `HTTP ${serverErrors[0]}` : 'ok');
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'screens.json'), JSON.stringify({ shotAt: new Date().toISOString(), screens: results }, null, 2));
  return results;
}
