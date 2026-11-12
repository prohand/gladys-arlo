import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArloAuth, AUTH_STATES, expiryFrom, pickFactor } from '../src/arlo/auth.js';
import { ArloClient } from '../src/arlo/client.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeArlo } from './helpers/fakeArlo.js';
import { CONFIG, tempDir } from './helpers/setup.js';

async function makeAuth(t, overrides = {}) {
  const arlo = createFakeArlo(overrides);
  const client = new ArloClient({ fetch: arlo.fetch });
  const dataDir = await tempDir(t);
  return { arlo, client, dataDir, auth: new ArloAuth({ client, dataDir }) };
}

test('no credentials, no call', async (t) => {
  const { auth, arlo } = await makeAuth(t);
  assert.equal(await auth.connect(normalizeConfig()), AUTH_STATES.NO_CREDENTIALS);
  assert.equal(arlo.calls.length, 0);
});

test('a login that needs a code waits for the user', async (t) => {
  const { auth, client } = await makeAuth(t);
  assert.equal(await auth.connect(CONFIG), AUTH_STATES.CODE_REQUIRED);
  assert.equal(client.hasSession, false);
});

test('send then verify the code, the session is stored without the password', async (t) => {
  const { auth, client, dataDir } = await makeAuth(t);
  const sent = await auth.sendCode(CONFIG);
  assert.deepEqual(sent, { destination: 'me***@x.fr', sent: true });
  await assert.rejects(auth.verifyCode(CONFIG, 'abc'), /digits/);
  await auth.verifyCode(CONFIG, '123456');
  assert.equal(client.token, 'final-token');
  const stored = JSON.parse(await readFile(join(dataDir, 'arlo-session.json'), 'utf8'));
  assert.equal(stored.token, 'final-token');
  assert.equal(stored.email, 'me@x.fr');
  assert.ok(stored.deviceId);
  assert.ok(!JSON.stringify(stored).includes('secret'));
});

test('a wrong code is refused and can be retried while the code is pending', async (t) => {
  const { auth } = await makeAuth(t);
  await auth.sendCode(CONFIG);
  await assert.rejects(auth.verifyCode(CONFIG, '000000'), /Invalid code/);
  assert.ok(auth.pending);
});

test('verify without a code sent first is refused', async (t) => {
  const { auth } = await makeAuth(t);
  await assert.rejects(auth.verifyCode(CONFIG, '123456'), /ask for a new one/);
});

test('the stored session is reused at the next start', async (t) => {
  const { auth, dataDir } = await makeAuth(t);
  await auth.sendCode(CONFIG);
  await auth.verifyCode(CONFIG, '123456');

  const arlo = createFakeArlo();
  const client = new ArloClient({ fetch: arlo.fetch });
  const again = new ArloAuth({ client, dataDir });
  assert.equal(await again.connect(CONFIG), AUTH_STATES.CONNECTED);
  assert.deepEqual(
    arlo.calls.map((c) => c.path),
    ['/hmsweb/users/session/v2'],
  );
  assert.equal(client.deviceId, auth.client.deviceId);
});

test('a stored session of another account is not reused', async (t) => {
  const { auth, dataDir } = await makeAuth(t);
  await auth.sendCode(CONFIG);
  await auth.verifyCode(CONFIG, '123456');
  const client = new ArloClient({ fetch: createFakeArlo().fetch });
  const other = new ArloAuth({ client, dataDir });
  const state = await other.connect({ ...CONFIG, email: 'other@x.fr' });
  assert.equal(state, AUTH_STATES.CODE_REQUIRED);
});

test('an expired stored token falls back to a login', async (t) => {
  const { auth, dataDir } = await makeAuth(t);
  await auth.sendCode(CONFIG);
  await auth.verifyCode(CONFIG, '123456');
  const arlo = createFakeArlo({ sessionValid: false, authCompleted: true });
  const client = new ArloClient({ fetch: arlo.fetch });
  const again = new ArloAuth({ client, dataDir });
  assert.equal(await again.connect(CONFIG), AUTH_STATES.CONNECTED);
  assert.equal(client.token, 'auth-token');
});

test('pickFactor takes the configured method, the primary one first', () => {
  const factors = [
    { factorId: 'A', factorType: 'EMAIL', factorRole: 'SECONDARY' },
    { factorId: 'B', factorType: 'EMAIL', factorRole: 'PRIMARY' },
    { factorId: 'C', factorType: 'SMS' },
  ];
  assert.equal(pickFactor(factors, 'email').factorId, 'B');
  assert.equal(pickFactor(factors, 'sms').factorId, 'C');
  assert.equal(pickFactor([], 'sms'), null);
});

test('expiryFrom reads a duration or an epoch', () => {
  const now = 1_000_000;
  assert.equal(expiryFrom(60, now), now + 60_000);
  assert.equal(expiryFrom(1_800_000_000, now), 1_800_000_000_000);
  assert.equal(expiryFrom(1_800_000_000_000, now), 1_800_000_000_000);
  assert.ok(expiryFrom(undefined, now) > now);
});
