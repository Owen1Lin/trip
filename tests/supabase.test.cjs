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
  assert.equal(settings?.external?.google, true, 'Supabase Google OAuth is not enabled.');
  const otherProviders = Object.entries(settings.external || {}).filter(([provider, enabled]) =>
    enabled === true && !['google', 'email', 'phone', 'anonymous'].includes(provider));
  assert.equal(otherProviders.length, 0, 'Keep OAuth providers other than Google disabled for this private space.');

  for (const table of ['private_trip_members', 'shared_trip_snapshots']) {
    const tableResult = await requestJson(`/rest/v1/${table}?select=*&limit=1`);
    assert.notEqual(tableResult.response.status, 404, `${table} does not exist or is not exposed through the Data API.`);
    if (tableResult.response.status === 200) {
      assert.ok(Array.isArray(tableResult.body), `${table} did not return a JSON array.`);
      assert.equal(tableResult.body.length, 0, `Anonymous access exposed ${table} rows; check RLS policies.`);
    } else {
      assert.ok([401, 403].includes(tableResult.response.status), `Anonymous ${table} access returned unexpected HTTP ${tableResult.response.status}.`);
      assert.equal(tableResult.body?.code, '42501', 'Expected SQL permission denial; authentication errors do not prove the table is protected.');
    }
  }

  console.log('PASS: real Supabase Google OAuth setting and anonymous private-table denial. Member isolation and shared writes are not verified.');
})().catch(error => {
  console.error(`FAIL: ${error.message}`);
  const annotation = String(error.message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.error(`::error title=Supabase setup::${annotation}`);
  process.exit(1);
});
