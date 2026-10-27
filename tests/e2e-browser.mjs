import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:3999/';
const SHOTS = process.env.SHOTS || '/tmp/shots';
import fs from 'node:fs'; fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); } };
const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await context.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Table 4' : undefined));

await page.goto(BASE);
await page.evaluate(() => localStorage.setItem('xpos_autoprint', '0'));
await page.fill('input[type=email]', 'admin@xpos.local');
await page.fill('input[type=password]', 'admin123');
await page.click('button:has-text("Sign in")');
await page.waitForSelector('text=Dashboard', { timeout: 15000 });
ok(true, 'login via UI');
await page.waitForFunction(() => document.body.innerText.includes('Synced'), null, { timeout: 20000 });
ok(await page.locator('text=Online').count() > 0, 'sync indicator shows Online + Synced');
await page.waitForTimeout(800);
await page.screenshot({ path: SHOTS + '/1-dashboard.png' });

// POS with PIN
await page.click('a:has-text("POS Counter")');
await page.waitForSelector('text=Enter PIN');
for (const d of '1234') await page.click(`button:text-is("${d}")`);
await page.waitForSelector('input[placeholder*="scan barcode"]');
ok(true, 'PIN 1234 unlocks POS');
const scan = page.locator('input[placeholder*="scan barcode"]');
await scan.fill('8901234500011'); await scan.press('Enter');
await scan.fill('8901234500011'); await scan.press('Enter');
await scan.fill('SH-BIR'); await scan.press('Enter');
await page.waitForTimeout(300);
const payBtn = page.locator('button:has-text("Pay Rs")');
const payText = await payBtn.innerText();
ok(payText.includes('730'), `barcode/SKU scans add to cart (2×290 + 150 = 730): "${payText}"`);
await page.screenshot({ path: SHOTS + '/2-pos.png' });
await payBtn.click();
await page.locator('.fixed.inset-0.z-50 input[type=number]').first().fill('1000');
await page.waitForTimeout(200);
ok((await page.locator('.fixed.inset-0.z-50').innerText()).includes('270'), 'change calculated 270');
await page.screenshot({ path: SHOTS + '/3-pay.png' });
await page.click('button:has-text("Complete sale")');
await page.waitForSelector('text=/Sale .* saved/');
ok(true, 'online sale completed');
await page.waitForFunction(() => document.body.innerText.includes('0 pending'), null, { timeout: 15000 });
await page.waitForFunction(() => /Last: INV-\d+/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
ok(/Last: INV-\d+/.test(await page.locator('body').innerText()), 'sale synced and received server invoice number');

// OFFLINE sale
await context.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.waitForTimeout(300);
ok(await page.locator('text=Offline').count() > 0, 'indicator switches to Offline');
await scan.fill('WAT-15'); await scan.press('Enter');
await page.click('button:has-text("Pay Rs")');
await page.click('button:has-text("Complete sale")');
await page.waitForSelector('text=/Sale .* saved/');
await page.waitForTimeout(500);
const bodyOff = await page.locator('body').innerText();
ok(/[1-9]\d* pending/.test(bodyOff), 'offline sale queued in outbox (pending > 0)');
ok(/Last: [0-9A-F]{4}-\d{4}/.test(bodyOff), 'offline sale uses device-prefixed number');
await page.screenshot({ path: SHOTS + '/4-offline.png' });
// hold & resume offline
await scan.fill('OIL-1L'); await scan.press('Enter');
await page.click('button:text-is("Hold")');
await page.waitForTimeout(300);
await page.click('button:has-text("Held (1)")');
await page.click('button:has-text("Resume")');
await page.waitForTimeout(300);
ok((await payBtn.innerText()).includes('637.2'), 'hold/resume sale with 18% tax (540 + 97.2 = 637.2)');
await page.click('button:text-is("Clear")');

// back online -> sync
await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.click('button:has-text("Sync now")').catch(() => {});
await page.waitForFunction(() => document.body.innerText.includes('0 pending') && document.body.innerText.includes('Online'), null, { timeout: 20000 });
ok(true, 'back online: outbox flushed to 0 pending');

// Sales list shows server numbers
await page.click('a:has-text("Sales & Returns")');
await page.waitForTimeout(1500);
const salesText = await page.locator('main').innerText();
ok((salesText.match(/INV-\d{6}/g) || []).length >= 2 && !salesText.includes('offline #'), 'sales list: offline sale now has final server invoice number');
// return one item
await page.locator('main table tbody tr').first().click();
await page.click('button:has-text("Return items")');
await page.locator('.fixed.inset-0.z-50 input[type=number]').first().fill('1');
await page.click('button:has-text("Save return")');
await page.waitForSelector('text=Return saved');
ok(true, 'sale return saved');
await page.screenshot({ path: SHOTS + '/5-sales.png' });

// visit every page and check for crashes
for (const [label, expect] of [['Dashboard', 'Dashboard'], ['Quotations', 'Quotations'], ['Products', 'Products'], ['Inventory', 'Stock by branch'], ['Purchases', 'Purchases'], ['Customers', 'Customers'], ['Suppliers', 'Suppliers'], ['Accounts', 'Chart of accounts'], ['Expenses & Income', 'Expenses'], ['Cash Register', 'Cash Register'], ['Reports', 'Reports'], ['Settings', 'Business']]) {
  await page.click(`aside a:has-text("${label}")`);
  await page.waitForTimeout(500);
  ok((await page.locator('main').innerText()).includes(expect), `page renders: ${label}`);
}
// accounts tabs
await page.click('aside a:has-text("Accounts")');
for (const t of ['Trial balance', 'Profit & loss', 'Balance sheet', 'Day book / Journal', 'Cash & bank']) {
  await page.click(`main button:has-text("${t}")`); await page.waitForTimeout(300);
  if (t === 'Trial balance' || t === 'Balance sheet') ok((await page.locator('main').innerText()).includes('Balanced'), `${t} balanced in UI`);
  if (t === 'Trial balance') await page.screenshot({ path: SHOTS + '/6-trial-balance.png' });
}
// reports: all
await page.click('aside a:has-text("Reports")');
const opts = await page.locator('main select').first().locator('option').allInnerTexts();
for (const o of opts) { await page.locator('main select').first().selectOption({ label: o }); await page.waitForTimeout(150); }
ok(true, `all ${opts.length} reports rendered`);
// inventory tabs
await page.click('aside a:has-text("Inventory")');
for (const t of ['Low stock & reorder', 'Batches & expiry', 'Adjustments', 'Branch transfers', 'IMEI / Serials', 'Movement history']) { await page.click(`main button:has-text("${t}")`); await page.waitForTimeout(200); }
ok(true, 'inventory tabs rendered');

// add product via UI
await page.click('aside a:has-text("Products")');
await page.click('button:has-text("Add product")');
await page.locator('.fixed.inset-0.z-50 input').first().fill('UI Test Biscuit');
const nums = page.locator('.fixed.inset-0.z-50 input[type=number]');
await nums.nth(0).fill('40'); await nums.nth(1).fill('60');
await page.locator('.fixed.inset-0.z-50 label:has-text("Opening stock qty") input').fill('12');
await page.click('.fixed.inset-0.z-50 button:text-is("Save")');
await page.waitForSelector('text=Product saved');
await page.waitForTimeout(300);
ok((await page.locator('main').innerText()).includes('UI Test Biscuit'), 'product created via UI with opening stock');
// purchase with IMEI
await page.click('aside a:has-text("Purchases")');
await page.click('button:has-text("New purchase")');
await page.locator('.fixed.inset-0.z-50 select').first().selectOption({ index: 1 });
await page.locator('.fixed.inset-0.z-50 select').nth(1).selectOption({ label: 'Samsung Galaxy A15 (SAM-A15)' });
await page.locator('.fixed.inset-0.z-50 input[title=Qty]').fill('2');
await page.locator('.fixed.inset-0.z-50 textarea').fill('111111111111111\n222222222222222');
await page.click('button:has-text("Save & receive stock")');
await page.waitForSelector('text=Purchase saved');
ok(true, 'purchase with IMEI serials saved');
// expense
await page.click('aside a:has-text("Expenses & Income")');
await page.click('button:has-text("Add expense")');
await page.locator('.fixed.inset-0.z-50 input').first().fill('Electricity bill');
await page.locator('.fixed.inset-0.z-50 input[type=number]').fill('2500');
await page.click('.fixed.inset-0.z-50 button:text-is("Save")');
await page.waitForSelector('text=Saved');
ok(true, 'expense saved');
// dark mode
await page.click('button[title="Dark mode"]');
await page.click('aside a:has-text("Dashboard")');
await page.waitForTimeout(600);
await page.screenshot({ path: SHOTS + '/7-dark.png' });
await page.waitForFunction(() => document.body.innerText.includes('0 pending'), null, { timeout: 20000 });
ok(true, 'all UI changes synced');

// offline login: new tab after logout while offline
await page.click('button:has-text("Logout")');
await context.setOffline(true);
await page.fill('input[type=email]', 'admin@xpos.local');
await page.fill('input[type=password]', 'admin123');
await page.click('button:has-text("Sign in")');
await page.waitForSelector('text=Dashboard', { timeout: 10000 });
ok(true, 'offline login with cached credentials');
// app shell from service worker while offline
await page.reload();
await page.waitForSelector('text=Dashboard', { timeout: 10000 }).then(() => ok(true, 'app reloads offline (service worker cache)')).catch(() => ok(false, 'app reloads offline (service worker cache)'));
await context.setOffline(false);

const real = errors.filter(e => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(e));
ok(real.length === 0, 'no JS errors in console' + (real.length ? ': ' + real.slice(0, 5).join(' | ') : ''));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
