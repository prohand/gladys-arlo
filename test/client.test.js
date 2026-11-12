import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArloApiError, ArloClient, libraryDate } from '../src/arlo/client.js';
import { createFakeArlo } from './helpers/fakeArlo.js';

test('login sends the password in base64 with the web application headers', async () => {
  const arlo = createFakeArlo();
  const client = new ArloClient({ fetch: arlo.fetch, deviceId: 'DEV-1' });
  const login = await client.login('me@x.fr', 'secret');
  assert.equal(login.token, 'auth-token');
  const [call] = arlo.calls;
  assert.equal(call.url.href, 'https://ocapi-app.arlo.com/api/auth');
  assert.equal(call.body.password, Buffer.from('secret').toString('base64'));
  assert.equal(call.headers['Auth-Version'], '2');
  assert.equal(call.headers.Origin, 'https://my.arlo.com');
  assert.equal(call.headers['x-user-device-id'], 'DEV-1');
});

test('a wrong password is an ArloApiError', async () => {
  const client = new ArloClient({ fetch: createFakeArlo().fetch });
  await assert.rejects(client.login('me@x.fr', 'wrong'), (err) => {
    assert.ok(err instanceof ArloApiError);
    assert.match(err.message, /Invalid credentials/);
    return true;
  });
});

test('the verification steps carry the login token in base64', async () => {
  const arlo = createFakeArlo();
  const client = new ArloClient({ fetch: arlo.fetch });
  const factors = await client.getFactors('auth-token', 1700000000);
  assert.equal(factors.length, 2);
  const code = await client.startAuth('auth-token', { factorId: 'F-MAIL', userId: 'USER1' });
  assert.equal(code, 'FAC-1');
  const done = await client.finishAuth('auth-token', { factorAuthCode: code, otp: ' 123456 ' });
  assert.equal(done.token, 'final-token');
  for (const call of arlo.calls) {
    assert.equal(call.headers.Authorization, Buffer.from('auth-token').toString('base64'));
  }
  assert.equal(arlo.calls[0].url.searchParams.get('data'), '1700000000');
  assert.equal(arlo.calls[2].body.otp, '123456');
});

test('API calls need a session and carry the raw token', async () => {
  const arlo = createFakeArlo();
  const client = new ArloClient({ fetch: arlo.fetch });
  await assert.rejects(client.getDevices(), (err) => err.isAuthError);
  client.setSession({ token: 'tok', userId: 'USER1' });
  const devices = await client.getDevices();
  assert.equal(devices.length, 5);
  assert.equal(arlo.calls[0].headers.Authorization, 'tok');
  assert.equal(arlo.calls[0].url.host, 'myapi.arlo.com');
});

test('an expired session is an auth error', async () => {
  const arlo = createFakeArlo({ sessionValid: false });
  const client = new ArloClient({ fetch: arlo.fetch });
  client.setSession({ token: 'tok', userId: 'USER1' });
  await assert.rejects(client.getSession(), (err) => err.isAuthError);
});

test('notify addresses the base with its xCloudId', async () => {
  const arlo = createFakeArlo();
  const client = new ArloClient({ fetch: arlo.fetch });
  client.setSession({ token: 'tok', userId: 'USER1' });
  await client.notify(
    { deviceId: 'BASE1', xCloudId: 'X-BASE1' },
    { action: 'set', resource: 'cameras/CAM1', properties: { privacyActive: true } },
  );
  const [call] = arlo.calls;
  assert.equal(call.path, '/hmsweb/users/devices/notify/BASE1');
  assert.equal(call.headers.xcloudId, 'X-BASE1');
  assert.equal(call.body.from, 'USER1_web');
  assert.equal(call.body.to, 'BASE1');
  assert.deepEqual(call.body.properties, { privacyActive: true });
  assert.match(call.body.transId, /^web!/);
});

test('setActiveMode posts the wanted mode of the base', async () => {
  const arlo = createFakeArlo();
  const client = new ArloClient({ fetch: arlo.fetch });
  client.setSession({ token: 'tok', userId: 'USER1' });
  await client.setActiveMode({ deviceId: 'BASE1' }, 'mode1');
  assert.deepEqual(arlo.calls[0].body.activeAutomations[0].activeModes, ['mode1']);
  assert.equal(arlo.active[0].activeModes[0], 'mode1');
});

test('libraryDate is YYYYMMDD', () => {
  assert.equal(libraryDate(new Date(2026, 0, 5)), '20260105');
});

test('downloadImage refuses anything but https', async () => {
  const client = new ArloClient({ fetch: createFakeArlo().fetch });
  await assert.rejects(client.downloadImage('http://arlo.test/x.jpg'));
  const image = await client.downloadImage('https://arlo.test/x.jpg');
  assert.equal(image[0], 0xff);
});
