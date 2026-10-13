// Run against a running static server: node tests/planner.test.cjs
// Requires Playwright and Chromium; no application dependency is added.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // External inspiration images are unrelated to planner behavior.
  await context.route('https://images.unsplash.com/**', route => route.abort());
  const url = process.env.TEST_URL || 'http://127.0.0.1:3000';
  const upload = async (name, value) => page.locator('#import-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(value) });
  const createTrip = async (name = '京都驗收旅程') => {
    await page.locator('#trip-name').fill(name);
    await page.locator('#trip-destination').fill('京都');
    await page.locator('#trip-start').fill('2026-11-01');
    await page.locator('#trip-days').fill('3');
    await page.locator('#trip-form button[type="submit"]').click();
  };
  const addActivity = async (time, place, notes = '') => {
    await page.locator('#activity-time').fill(time);
    await page.locator('#activity-place').fill(place);
    await page.locator('#activity-notes').fill(notes);
    await page.locator('#activity-form button[type="submit"]').click();
  };
  try {
    await page.goto(url);
    await createTrip();
    assert.equal(await page.locator('#active-trip-name').textContent(), '京都驗收旅程');
    assert.equal(await page.locator('#day-tabs button').count(), 3);
    await addActivity('14:30', '下午咖啡', '保留彈性');
    const payload = '<img src=x onerror="window.__xss=1">';
    await addActivity('09:00', payload, '<script>window.__xss=2</script>');
    assert.match(await page.locator('#activity-list').innerText(), /09:00[\s\S]*14:30/);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('#activity-list img, #activity-list script').count(), 0);
    await page.getByRole('button', { name: '編輯活動：下午咖啡', exact: true }).click();
    assert.equal(await page.locator('#activity-place').inputValue(), '下午咖啡');
    await page.locator('#activity-place').fill('下午美術館');
    await page.locator('#activity-submit').click();
    await page.getByRole('button', { name: '編輯活動：下午美術館', exact: true }).click();
    await page.locator('#activity-place').fill('不應儲存的修改');
    await page.locator('#activity-cancel').click();
    assert.doesNotMatch(await page.locator('#activity-list').innerText(), /不應儲存的修改/);
    assert.doesNotMatch(await page.locator('#activity-list').innerText(), /下午咖啡/);
    await page.getByRole('button', { name: '刪除活動：' + payload, exact: true }).click();
    assert.equal(await page.locator('#activity-list .activity-card').count(), 1);
    await page.reload();
    assert.match(await page.locator('#activity-list').innerText(), /下午美術館/);
    assert.equal(await page.locator('#day-tabs button').count(), 3);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-trips').click();
    const download = await downloadPromise;
    const fs = require('node:fs');
    const backup = fs.readFileSync(await download.path(), 'utf8');
    const parsed = JSON.parse(backup);
    assert.ok(parsed);
    const beforeInvalid = await page.locator('#trip-list').innerText();
    await upload('broken.json', '{broken');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#trip-list').innerText(), beforeInvalid);
    await upload('bad-shape.json', JSON.stringify({ trips: [{ name: payload, days: 999999 }] }));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#trip-list').innerText(), beforeInvalid);
    const malicious = JSON.parse(backup);
    malicious.trips[0].name = payload;
    malicious.trips[0].days[0][0].place = payload;
    await upload('oversized.json', ' '.repeat(5 * 1024 * 1024 + 1));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#trip-list').innerText(), beforeInvalid);
    const badDays = JSON.parse(backup); badDays.trips[0].dayCount = 31;
    await upload('bad-days.json', JSON.stringify(badDays));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#trip-list').innerText(), beforeInvalid);
    const apiRejects = await page.evaluate(() => {
      const before = JSON.stringify(window.TripPlanner.getTrips());
      try { window.TripPlanner.replaceTrips([{ bad: true }]); }
      catch { return before === JSON.stringify(window.TripPlanner.getTrips()); }
      return false;
    });
    assert.equal(apiRejects, true);
    await upload('backup.json', JSON.stringify(malicious));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#trip-list button').count(), 2);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('#trip-list img, #activity-list img').count(), 0);
    await page.locator('#day-tabs button').nth(1).click();
    await addActivity('10:00', '第二天散步');
    assert.match(await page.locator('#activity-list').innerText(), /第二天散步/);
    await page.locator('#day-tabs button').first().click();
    assert.doesNotMatch(await page.locator('#activity-list').innerText(), /第二天散步/);
    await createTrip('第二個旅程');
    assert.equal(await page.locator('#trip-list button').count(), 3);
    page.once('dialog', d => d.accept());
    await page.locator('#delete-trip').click();
    assert.equal(await page.locator('#trip-list button').count(), 2);
    await page.locator('[data-destination="kyoto"]').click();
    assert.ok(await page.locator('#detail-dialog').evaluate(d => d.open));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detail-dialog').evaluate(d => d.open), false);
    await page.locator('#trip-name').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trip-destination');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
      await page.locator('#planner').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#trip-form button[type="submit"]').isVisible());
    }
    assert.deepEqual(errors, []);
    console.log('PASS: create, day isolation, automatic time sorting, activity editing/deletion, persistence, export/import, malformed import preservation, XSS protection, deletion, keyboard, mobile layout.');
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } }); });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(url);
    assert.match(await blockedPage.locator('#storage-status').innerText(), /無法|不可|未|失敗/);
    console.log('PASS: localStorage unavailable produces explicit warning.');
    await blocked.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
