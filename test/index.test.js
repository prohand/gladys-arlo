import './helpers/quiet.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { setup } from '../index.js';
import { ArloAuth } from '../src/arlo/auth.js';
import { ArloClient } from '../src/arlo/client.js';
import { FEATURES } from '../src/devices/index.js';
import { MESSAGES } from '../src/messages.js';
import { createFakeArlo, FakeEventStream } from './helpers/fakeArlo.js';
import { deviceExt, feature, tempDir } from './helpers/setup.js';

async function boot(
  t,
  { config = { email: 'me@x.fr', password: 'secret' }, arlo: overrides } = {},
) {
  const arlo = createFakeArlo(overrides);
  const gladys = createFakeGladys({ config });
  const client = new ArloClient({ fetch: arlo.fetch });
  const auth = new ArloAuth({ client, dataDir: await tempDir(t) });
  const service = setup(gladys, { client, auth, EventStreamClass: FakeEventStream });
  t.after(() => service.stop());
  await gladys.connect();
  return { arlo, gladys, service };
}

test('no credentials: the status says what to do', async (t) => {
  const { gladys } = await boot(t, { config: {} });
  assert.deepEqual(gladys.fake.connectionStatus.message, MESSAGES.NO_CREDENTIALS);
  const ack = await gladys.fake.action('send_code', {});
  assert.deepEqual(ack.data.message, MESSAGES.NO_CREDENTIALS);
});

test('the whole code flow from the Configuration screen', async (t) => {
  const { gladys } = await boot(t);
  assert.deepEqual(gladys.fake.connectionStatus.message, MESSAGES.CODE_REQUIRED);

  const early = await gladys.fake.action('verify_code', { code: '123456' });
  assert.deepEqual(early.data.message, MESSAGES.NO_PENDING_CODE);

  const sent = await gladys.fake.action('send_code', {});
  assert.match(sent.data.message.en, /Code sent \(me\*\*\*@x\.fr\)/);

  const wrong = await gladys.fake.action('verify_code', { code: '999999' });
  assert.match(wrong.data.message.en, /Invalid code/);

  const ok = await gladys.fake.action('verify_code', { code: '123456' });
  assert.match(ok.data.message.en, /Connected to Arlo: 4 device/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 4);

  const tested = await gladys.fake.action('test_connection', {});
  assert.match(tested.data.message.en, /Connected to Arlo/);
});

test('commands, image and scan through the SDK handlers', async (t) => {
  const { gladys, arlo } = await boot(t, { arlo: { authCompleted: true } });
  const [hub, cam] = gladys.fake.discoveredDevices;
  const modeFeature = hub.features.find((f) => f.external_id.endsWith(':mode'));
  const ack = await gladys.fake.setValue(hub, modeFeature, 'mode1');
  assert.equal(ack.success, true);
  assert.equal(arlo.active[0].activeModes[0], 'mode1');

  const image = await gladys.fake.getImage(cam);
  assert.equal(image.success, true);
  assert.match(image.data.image, /^image\/jpg;base64,/);

  const motion = cam.features.find(
    (f) => f.external_id === feature(gladys, 'CAM1', FEATURES.MOTION),
  );
  const refused = await gladys.fake.setValue(cam, motion, 1);
  assert.equal(refused.success, false);

  const before = gladys.fake.requests.filter((r) => r.path.includes('discovered')).length;
  await gladys.fake.scanRequest();
  const after = gladys.fake.requests.filter((r) => r.path.includes('discovered')).length;
  assert.equal(after, before + 1);
});

test('scene actions and widgets are registered', async (t) => {
  const { gladys } = await boot(t, { arlo: { authCompleted: true } });
  const mode = await gladys.fake.sceneAction('set_mode', {
    device: deviceExt(gladys, 'BASE1'),
    mode: 'armed',
  });
  assert.deepEqual(mode.data.outputs, { changed: true, mode_name: 'Armed' });
  const widget = await gladys.fake.widgetGet('arlo_overview');
  assert.equal(widget.success, true);
  const camera = await gladys.fake.widgetGet('arlo_camera', {
    settings: { camera: deviceExt(gladys, 'CAM1') },
  });
  assert.equal(camera.success, true);
});

test('a new account in the configuration restarts the login', async (t) => {
  const { gladys, service } = await boot(t, { arlo: { authCompleted: true } });
  assert.equal(service.connected, true);
  await gladys.fake.configUpdated({ email: 'other@x.fr', password: 'wrong' });
  assert.equal(service.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Invalid credentials/);
});
