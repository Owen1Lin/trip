// Read-only integration check against the configured Supabase project.
// It verifies public project setup without creating users or changing data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('cloud-config.js', 'utf8'), context);
const { url, publishableKey } = context.window.TRIP_CLOUD_CONFIG || {};

assert.match(url || '', /^https:\/\/[a-z0-9-]+\.supabase\.co$/);
assert.ok(typeof publishableKey === 'string' && publishableKey.length > 20, 'Supabase public key is missing.');

const headers = { apikey: publishableKey };
if (publishableKey.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url'));
  assert.equal(payload.role, 'anon', 'Only a legacy anon key is allowed in browser configuration.');
  headers.Authorization = `Bearer ${publishableKey}`;
} else {
  assert.match(publishableKey, /^sb_publishable_/, 'Only a publishable key is allowed in browser configuration.');
}

async function requestJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${url}${path}`, { headers, signal: controller.signal });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  const settingsResult = await requestJson('/auth/v1/settings');
  assert.equal(settingsResult.response.status, 200, `/auth/v1/settings returned HTTP ${settingsResult.response.status}.`);
  const settings = settingsResult.body;
  assert.equal(settings?.external?.email, true, 'Supabase Email authentication is not enabled.');

  const tableResult = await requestJson('/rest/v1/trip_snapshots?select=user_id&limit=1');
  assert.notEqual(tableResult.response.status, 404, 'trip_snapshots does not exist or is not exposed through the Data API.');
  if (tableResult.response.status === 200) {
    assert.ok(Array.isArray(tableResult.body), 'trip_snapshots did not return a JSON array.');
    assert.equal(tableResult.body.length, 0, 'Anonymous access exposed a trip snapshot; check RLS policies.');
  } else {
    assert.ok([401, 403].includes(tableResult.response.status), `Anonymous table access returned unexpected HTTP ${tableResult.response.status}.`);
  }

  console.log('PASS: real Supabase auth settings, trip_snapshots schema, and anonymous RLS check.');
})().catch(error => {
  console.error(`FAIL: ${error.message}`);
  const annotation = String(error.message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.error(`::error title=Supabase setup::${annotation}`);
  process.exit(1);
});
