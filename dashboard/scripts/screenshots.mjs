import { chromium } from 'playwright';
const html = process.argv[2];
const outDir = process.argv[3];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PE: ' + e.message));
await p.goto('file://' + html, { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
async function shot(name) { await p.screenshot({ path: `${outDir}/${name}.png`, fullPage: true }); }
async function nav(label) { await p.getByText(label, { exact: true }).first().click(); await p.waitForTimeout(300); }
await nav('Hotspots'); await shot('hotspots');
// open a dossier by clicking a file row in hotspots table
try { await p.getByText('…/src/indexer.ts', { exact: true }).first().click(); await p.waitForTimeout(300); await shot('dossier'); } catch(e){ console.log('dossier click failed:', e.message); }
await nav('Fitness'); await shot('fitness');
await nav('Ownership'); await shot('ownership');
console.log('errors:', errs.length ? JSON.stringify(errs.slice(0,6)) : 'none');
await b.close();
