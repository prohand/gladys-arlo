import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_STATES } from '../src/arlo/auth.js';
import { FEATURES } from '../src/devices/index.js';
import { MESSAGES } from '../src/messages.js';
import { bigJpeg } from './helpers/fakeArlo.js';
import { CONFIG, deviceExt, feature, setupService } from './helpers/setup.js';

const lastEvent = (gladys) => gladys.fake.sceneEvents.at(-1);

test('start: devices, modes, transports, pictures and status reach Gladys', async (t) => {
  const { gladys, service } = await setupService(t);
  assert.equal(service.authState, AUTH_STATES.CONNECTED);
  assert.equal(gladys.fake.discoveredDevices.length, 4);
  assert.equal(gladys.fake.lastState(feature(gladys, 'BASE1', FEATURES.MODE)), 'mode0');
  assert.equal(gladys.fake.lastState(feature(gladys, 'CAM2', FEATURES.MODE)), 'mode1');
  assert.equal(gladys.fake.cameraImages.length, 2, 'one picture per camera with a last image');
  assert.deepEqual(
    gladys.fake.transports.map((entry) => entry.transport),
    ['cloud', 'cloud', 'cloud', 'cloud'],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first reading is not an event');
});

test('without code the status asks for one, and no device is published', async (t) => {
  const { gladys, service } = await setupService(t, { arlo: { authCompleted: false } });
  assert.equal(service.authState, AUTH_STATES.CODE_REQUIRED);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.deepEqual(gladys.fake.connectionStatus.message, MESSAGES.CODE_REQUIRED);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
});

test('the code flow connects the service', async (t) => {
  const { gladys, service } = await setupService(t, { arlo: { authCompleted: false } });
  const sent = await service.sendCode(CONFIG);
  assert.equal(sent.sent, true);
  await service.verifyCode(CONFIG, '123456');
  assert.equal(service.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 4);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('motion from the stream: state, one scene event per transition, then 0', async (t) => {
  const { gladys, service } = await setupService(t);
  const motion = feature(gladys, 'CAM1', FEATURES.MOTION);
  service.handleEvent({ resource: 'cameras/CAM1', properties: { motionDetected: true } });
  service.handleEvent({ resource: 'cameras/CAM1', properties: { motionDetected: true } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(motion), 1);
  const events = gladys.fake.sceneEvents.filter((e) => e.key === 'motion_detected');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { device: deviceExt(gladys, 'CAM1') });
  service.handleEvent({ resource: 'cameras/CAM1', properties: { motionDetected: false } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(motion), 0);
});

test('battery, privacy and siren properties are published', async (t) => {
  const { gladys, service } = await setupService(t);
  service.handleEvent({
    resource: 'cameras',
    from: 'BASE1',
    properties: [{ serialNumber: 'CAM1', batteryLevel: 57, privacyActive: true }],
  });
  service.handleEvent({ resource: 'siren', from: 'BASE1', properties: { sirenState: 'on' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(feature(gladys, 'CAM1', FEATURES.BATTERY)), 57);
  assert.equal(gladys.fake.lastState(feature(gladys, 'CAM1', FEATURES.ENABLED)), 0);
  assert.equal(gladys.fake.lastState(feature(gladys, 'BASE1', FEATURES.SIREN)), 1);
});

test('doorbell press: ring pulse and one scene event', async (t) => {
  const { gladys, service } = await setupService(t);
  service.handleEvent({ resource: 'doorbells/BELL1', properties: { buttonPressed: true } });
  service.handleEvent({ resource: 'doorbells/BELL1', properties: { buttonPressed: true } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(feature(gladys, 'BELL1', FEATURES.RING)), 1);
  const events = gladys.fake.sceneEvents.filter((e) => e.key === 'doorbell_pressed');
  assert.equal(events.length, 1);
});

test('a mode changed in the Arlo app fires mode_changed', async (t) => {
  const { gladys, service } = await setupService(t);
  service.handleEvent({ resource: 'activeAutomations', BASE1: { activeModes: ['mode2'] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(feature(gladys, 'BASE1', FEATURES.MODE)), 'mode2');
  assert.deepEqual(lastEvent(gladys), {
    key: 'mode_changed',
    data: { device: deviceExt(gladys, 'BASE1'), mode: 'custom', mode_name: 'Night' },
  });
});

test('a mode set from Gladys fires no event (no scene loop)', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  const result = await service.setModeByExternalId(deviceExt(gladys, 'BASE1'), 'armed');
  assert.deepEqual(result, { changed: true, modeName: 'Armed' });
  assert.equal(arlo.active[0].activeModes[0], 'mode1');
  assert.equal(gladys.fake.lastState(feature(gladys, 'BASE1', FEATURES.MODE)), 'mode1');
  await service.refreshModes();
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.deepEqual(await service.setModeByExternalId(deviceExt(gladys, 'BASE1'), 'mode1'), {
    changed: false,
    modeName: 'Armed',
  });
  await assert.rejects(service.setModeByExternalId(deviceExt(gladys, 'BASE1'), 'away'), /Unknown/);
});

test('a mode changed between two refreshes is seen by polling', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  arlo.active[0].activeModes = ['mode1'];
  await service.refreshModes();
  assert.equal(lastEvent(gladys).data.mode, 'armed');
});

test('onSetValue: mode select, camera on/off, siren', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  const device = (id) => ({ external_id: deviceExt(gladys, id) });
  const feat = (id, key) => ({ external_id: feature(gladys, id, key) });

  await service.setValue(device('BASE1'), feat('BASE1', FEATURES.MODE), 'mode2');
  assert.equal(arlo.active[0].activeModes[0], 'mode2');

  await service.setValue(device('CAM1'), feat('CAM1', FEATURES.ENABLED), 0);
  const privacy = arlo.calls.at(-1);
  assert.equal(privacy.path, '/hmsweb/users/devices/notify/BASE1');
  assert.deepEqual(privacy.body.properties, { privacyActive: true });
  assert.equal(gladys.fake.lastState(feature(gladys, 'CAM1', FEATURES.ENABLED)), 0);

  await service.setValue(device('CAM2'), feat('CAM2', FEATURES.SIREN), 1);
  const siren = arlo.calls.at(-1);
  assert.equal(siren.body.resource, 'siren');
  assert.equal(siren.body.properties.sirenState, 'on');
  await service.setValue(device('CAM2'), feat('CAM2', FEATURES.SIREN), 0);
  assert.equal(arlo.calls.at(-1).body.properties.sirenState, 'off');

  await assert.rejects(
    service.setValue(device('CAM1'), feat('CAM1', FEATURES.MOTION), 1),
    /Read-only/,
  );
});

test('new recordings: smart detection and motion fallback, old ones stay quiet', async (t) => {
  const now = Date.now();
  const { gladys, service, arlo } = await setupService(t, {
    arlo: {
      library: [
        { name: 'old', deviceId: 'CAM1', utcCreatedDate: now - 3600_000, objCategory: 'Person' },
      ],
    },
  });
  assert.equal(gladys.fake.sceneEvents.length, 0, 'recordings seen at start raise nothing');
  arlo.library.push({
    name: 'new',
    deviceId: 'CAM1',
    utcCreatedDate: now,
    objCategory: 'Vehicle',
    reason: 'motionRecord',
    presignedThumbnailUrl: 'https://arlo.test/thumb.jpg',
  });
  await service.pollLibrary();
  const keys = gladys.fake.sceneEvents.map((e) => e.key);
  assert.deepEqual(keys, ['motion_detected', 'object_detected']);
  assert.deepEqual(lastEvent(gladys).data, {
    device: deviceExt(gladys, 'CAM1'),
    object: 'vehicle',
  });
  assert.equal(gladys.fake.lastState(feature(gladys, 'CAM1', FEATURES.MOTION)), 1);
  assert.equal(service.detections[0].id, 'new');
  await service.pollLibrary();
  assert.equal(gladys.fake.sceneEvents.length, 2, 'a recording is handled once');
});

test('a recording of a motion the stream already reported raises no second motion event', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  service.handleEvent({ resource: 'cameras/CAM1', properties: { motionDetected: true } });
  await new Promise((resolve) => setImmediate(resolve));
  arlo.library.push({
    name: 'r1',
    deviceId: 'CAM1',
    utcCreatedDate: Date.now(),
    objCategory: 'Other',
  });
  await service.pollLibrary();
  assert.equal(gladys.fake.sceneEvents.filter((e) => e.key === 'motion_detected').length, 1);
  assert.equal(gladys.fake.sceneEvents.filter((e) => e.key === 'object_detected').length, 0);
});

test('a new last picture is published, a large one is made to fit', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  const before = gladys.fake.cameraImages.length;
  await service.refreshDevices();
  assert.equal(gladys.fake.cameraImages.length, before, 'same picture, nothing sent');
  arlo.images.set('/img/cam1-2.jpg', bigJpeg());
  Object.assign(arlo.devices[1], {
    presignedLastImageUrl: 'https://arlo.test/img/cam1-2.jpg',
    lastImageUploaded: 1001,
  });
  await service.refreshDevices();
  const last = gladys.fake.cameraImages.at(-1);
  assert.ok(last);
  const base64 = last.image.replace(/^image\/jpg;base64,/, '');
  assert.ok(Buffer.from(base64, 'base64').length <= 150 * 1024);
});

test('getImage serves the latest picture, or a snapshot when asked to', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  const image = await service.getImage({ external_id: deviceExt(gladys, 'CAM1') });
  assert.match(image, /^image\/jpg;base64,/);
  assert.ok(!arlo.calls.some((c) => c.path.endsWith('fullFrameSnapshot')));

  service.config = { ...service.config, live_snapshot: true };
  const waiting = service.getImage({ external_id: deviceExt(gladys, 'CAM1') });
  await new Promise((resolve) => setImmediate(resolve));
  service.handleEvent({
    resource: 'cameras/CAM1',
    properties: { presignedFullFrameSnapshotUrl: 'https://arlo.test/img/snap.jpg' },
  });
  assert.match(await waiting, /^image\/jpg;base64,/);
  const request = arlo.calls.find((c) => c.path.endsWith('fullFrameSnapshot'));
  assert.equal(request.body.resource, 'cameras/CAM1');
  assert.equal(request.headers.xcloudId, 'X-BASE1');
});

test('a refused session during a refresh asks for a new code', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  arlo.sessionValid = false;
  arlo.authCompleted = false;
  await service.tick();
  assert.equal(service.authState, AUTH_STATES.CODE_REQUIRED);
  assert.deepEqual(gladys.fake.connectionStatus.message, MESSAGES.CODE_REQUIRED);
});

test('a cloud failure is reported, then cleared at the next good refresh', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  arlo.failWith = 503;
  await service.tick();
  assert.equal(service.connected, true, 'still logged in: it is not an auth error');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  arlo.failWith = null;
  await service.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('wrong password: error status, nothing published', async (t) => {
  const { gladys, service } = await setupService(t, { config: { password: 'wrong' } });
  assert.equal(service.authState, 'error');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Invalid credentials/);
});
