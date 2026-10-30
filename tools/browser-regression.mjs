import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

// Real WebGL regression: pause must stop geometry, and seeking must be history independent.
const root = resolve('dist');
const output = resolve('output/browser-regression');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const http = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!path.startsWith(`${root}/`)) throw new Error('Outside build');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${http.address().port}`;
const report = { session: 'infra-mechanism-browser-regression', controllerPid: process.pid, scenes: [], errors: [] };
let server, browser, profile;
const processes = () => execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n');
const processParts = line => {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
  return match ? { pid: Number(match[1]), parent: Number(match[2]), command: match[3] } : null;
};
try {
  server = await chromium.launchServer({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined, args: ['--enable-unsafe-swiftshader'] });
  report.browserPid = server.process().pid;
  const command = execFileSync('ps', ['-p', String(report.browserPid), '-o', 'args='], { encoding: 'utf8' });
  profile = command.match(/--user-data-dir=(.*?)(?= --|$)/)?.[1]?.trim();
  report.profile = profile;
  await writeFile(`${output}/lifecycle.json`, JSON.stringify(report, null, 2));
  browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.imv-stage canvas').first().waitFor();
  const scenes = await page.evaluate(() => window.demoViewer.pack.scenes.map(scene => ({ id: scene.id, animated: scene.scenarios[0].steps.length > 1 })));
  const snapshot = () => page.evaluate(() => {
    const viewer = window.demoViewer;
    return { playback: viewer.getPlayback(), objects: [...viewer.stageViews.values()].flatMap(stage => {
      const objects = [];
      stage.handle.scene.traverse(object => {
        if (object.isMesh || object.isLine || object.isSprite) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          objects.push([object.id, object.visible, ...object.position.toArray(), ...object.scale.toArray(), ...object.quaternion.toArray(), ...materials.flatMap(material => [material?.opacity, material?.color?.getHex()])]);
        }
      });
      return objects;
    }) };
  });
  for (const { id, animated } of scenes) {
    await page.evaluate(id => { const v = window.demoViewer; v.setScene(id); v.seek(v.getPlayback().duration * 0.43); }, id);
    await page.locator('.imv-stage canvas').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(160);
    const start = await snapshot();
    await page.evaluate(() => window.demoViewer.play());
    await page.waitForTimeout(180);
    await page.evaluate(() => window.demoViewer.pause());
    const paused = await snapshot();
    if (animated) assert.ok(paused.playback.time > start.playback.time, `${id}: playback did not advance`);
    await page.screenshot({ path: `${output}/${id}.png` });
    await page.waitForTimeout(220);
    assert.deepEqual(await snapshot(), paused, `${id}: geometry changed while paused`);
    const time = paused.playback.time;
    await page.evaluate(time => { const v = window.demoViewer; v.seek(v.getPlayback().duration); v.seek(time); }, time);
    assert.deepEqual(await snapshot(), paused, `${id}: reverse seek did not restore the same state`);
    await page.screenshot({ path: `${output}/${id}.png` });
    report.scenes.push({ id, pauseFrozen: true, reverseExact: true });
  }
  await page.evaluate(() => {
    const viewer = window.demoViewer;
    viewer.setScene('mechanism'); viewer.seek(30); viewer.selectModule('cache');
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => window.demoViewer.play());
  await page.waitForTimeout(120);
  await page.evaluate(() => { const v = window.demoViewer; v.pause(); v.seek(34); v.setStep(18); });
  assert.equal(await page.evaluate(() => window.demoViewer.getState().moduleId), 'cache', 'Playback or seek closed module details');
  report.detailPreserved = true;
  const discontinuities = await page.evaluate(() => {
    const viewer = window.demoViewer;
    const scene = [...viewer.stageViews.values()][0].handle;
    const read = () => [...scene.requestCards].map(([id, card]) => ({ id, visible: card.group.visible, point: card.group.position.toArray() }));
    const issues = [];
    let boundary = 0;
    for (const event of scene.trace.events.slice(0, -1)) {
      boundary += event.duration;
      viewer.seek(boundary - 0.00001); const before = read();
      viewer.seek(boundary + 0.00001); const after = read();
      for (const card of before) {
        const next = after.find(item => item.id === card.id);
        if (card.visible && next?.visible) {
          const distance = Math.hypot(...card.point.map((v, i) => v - next.point[i]));
          if (distance > 0.02) issues.push({ after: event.id, request: card.id, distance });
        }
      }
    }
    return issues;
  });
  assert.deepEqual(discontinuities, [], 'Request identity teleported between events');
  report.continuousRequestIdentity = true;
  report.conditions = [];
  for (const prefix of ['shared', 'distinct']) {
    await page.evaluate(prefix => window.demoViewer.setOption('prefix', prefix), prefix);
    await page.waitForTimeout(160);
    await page.evaluate(() => window.demoViewer.seek(window.demoViewer.getPlayback().duration));
    const stats = await page.locator('.imv-readout__stat').allTextContents();
    assert.ok(stats.includes(prefix === 'shared' ? '池槽10 / 12' : '池槽12 / 12'));
    assert.ok(stats.includes(prefix === 'shared' ? '复用位置2' : '复用位置0'));
    report.conditions.push({ prefix, stats });
  }
  report.viewports = [];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.imv-visual').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(160);
    const boxes = await page.evaluate(() => {
      const root = document.querySelector('.imv-host').shadowRoot;
      return { canvas: root.querySelector('.imv-stage canvas').getBoundingClientRect().toJSON(),
        controls: root.querySelector('.imv-playback').getBoundingClientRect().toJSON(), width: document.documentElement.scrollWidth };
    });
    assert.ok(boxes.canvas.top >= -1 && boxes.canvas.bottom <= viewport.height + 1, 'Canvas cannot fit with controls');
    assert.ok(boxes.controls.top >= -1 && boxes.controls.bottom <= viewport.height + 1, 'Playback controls are outside the viewport');
    assert.ok(boxes.width <= viewport.width + 1, 'Horizontal page overflow');
    report.viewports.push({ viewport, boxes });
  }
  // The production library must work without a bundler or a Node process global.
  await page.goto(`${base}/embed.html`, { waitUntil: 'networkidle' });
  const cycles = await page.evaluate(async () => {
    const { mountSglangViewer } = await import('/embed/sglang-viewer.js');
    const host = document.createElement('div'); document.body.append(host);
    const count = [];
    for (let n = 0; n < 3; n++) {
      const viewer = mountSglangViewer(host, { syncHash: false });
      viewer.seek(3.2);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      count.push(host.firstElementChild?.shadowRoot?.querySelectorAll('canvas').length ?? 0);
      viewer.destroy(); viewer.destroy();
      if (host.childElementCount !== 0) throw new Error('destroy left DOM children');
    }
    host.remove(); return count;
  });
  assert.deepEqual(cycles, [1, 1, 1], 'Static library mount/destroy failed');
  report.embedCycles = cycles;
  assert.deepEqual(report.errors, [], 'Browser raised JavaScript errors');
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  const beforeClose = processes().map(processParts).filter(Boolean);
  const family = new Set([report.browserPid]);
  let oldSize;
  do { oldSize = family.size; for (const item of beforeClose) if (family.has(item.parent)) family.add(item.pid); } while (family.size !== oldSize);
  report.browserProcesses = beforeClose.filter(item => family.has(item.pid));
  const recorded = new Map(report.browserProcesses.map(item => [item.pid, item.command]));
  const remainingOwned = () => processes().filter(line => {
    const item = processParts(line);
    return item && ((profile && item.command.includes(profile)) || recorded.get(item.pid) === item.command);
  });
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await new Promise(resolve => http.close(resolve));
  await new Promise(resolve => setTimeout(resolve, 300));
  let remaining = remainingOwned();
  // Only this freshly launched, uniquely identified browser profile is eligible.
  for (const line of remaining) { try { process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGTERM'); } catch {} }
  if (remaining.length) await new Promise(resolve => setTimeout(resolve, 500));
  remaining = remainingOwned();
  for (const line of remaining) { try { process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGKILL'); } catch {} }
  if (remaining.length) await new Promise(resolve => setTimeout(resolve, 300));
  report.remaining = remainingOwned();
  if (report.remaining.length) process.exitCode = 1;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ scenes: report.scenes, detailPreserved: report.detailPreserved,
    continuousRequestIdentity: report.continuousRequestIdentity,
    conditions: report.conditions?.map(item => item.prefix), viewports: report.viewports?.map(item => item.viewport),
    embedCycles: report.embedCycles, errors: report.errors, failure: report.failure,
    remaining: report.remaining, report: `${output}/report.json` }, null, 2));
}
