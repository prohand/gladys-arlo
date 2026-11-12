import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { modesOf } from '../src/arlo/models.js';
import { arloIdOf, buildDiscoveredDevices, featureKeyOf, FEATURES } from '../src/devices/index.js';
import { sampleDevices } from './helpers/fakeArlo.js';

const keysOf = (device) => device.features.map((f) => featureKeyOf(f.external_id));

test('each Arlo device gets the features it can serve', () => {
  const gladys = createFakeGladys();
  const devices = sampleDevices();
  const modes = new Map([['BASE1', modesOf({}, devices[0])]]);
  const discovered = buildDiscoveredDevices(gladys, devices, modes);
  assert.equal(discovered.length, 4, 'the router is left out');
  const [hub, cam, wifiCam, bell] = discovered;
  assert.deepEqual(keysOf(hub), [FEATURES.MODE, FEATURES.SIREN]);
  assert.deepEqual(keysOf(cam), [
    FEATURES.IMAGE,
    FEATURES.ENABLED,
    FEATURES.MOTION,
    FEATURES.BATTERY,
  ]);
  assert.deepEqual(keysOf(wifiCam), [
    FEATURES.IMAGE,
    FEATURES.ENABLED,
    FEATURES.MOTION,
    FEATURES.BATTERY,
    FEATURES.MODE,
    FEATURES.SIREN,
  ]);
  assert.ok(keysOf(bell).includes(FEATURES.RING));
  assert.deepEqual(
    hub.features[0].supported_options.map((o) => o.value),
    ['mode0', 'mode1'],
  );
});

test('every feature declares min and max (NOT NULL in Gladys)', () => {
  const gladys = createFakeGladys();
  for (const device of buildDiscoveredDevices(gladys, sampleDevices())) {
    for (const feature of device.features) {
      assert.equal(typeof feature.min, 'number', feature.external_id);
      assert.equal(typeof feature.max, 'number', feature.external_id);
    }
  }
});

test('external ids are built from the Arlo serial and read back', () => {
  const gladys = createFakeGladys();
  const [, cam] = buildDiscoveredDevices(gladys, sampleDevices());
  assert.equal(cam.external_id, 'ext:test-integration:arlo:CAM1');
  assert.equal(arloIdOf(gladys, cam.external_id), 'CAM1');
  assert.equal(arloIdOf(gladys, `${cam.external_id}:motion`), 'CAM1');
  assert.equal(arloIdOf(gladys, 'ext:other:arlo:CAM1'), null);
});

test('the fake Gladys accepts the discovery payload', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, sampleDevices()));
  assert.equal(gladys.fake.discoveredDevices.length, 4);
});
