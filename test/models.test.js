import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseOf,
  findMode,
  hasBattery,
  hasSiren,
  isBase,
  isCamera,
  isDoorbell,
  isSupported,
  modeKind,
  modeLabel,
  modesOf,
} from '../src/arlo/models.js';
import { sampleDevices } from './helpers/fakeArlo.js';

const [hub, cam, wifiCam, bell, router] = sampleDevices();

test('device kinds', () => {
  assert.ok(isBase(hub) && !isCamera(hub));
  assert.ok(isCamera(cam) && !isBase(cam));
  assert.ok(isCamera(wifiCam) && isBase(wifiCam));
  assert.ok(isDoorbell(bell) && isCamera(bell) && isBase(bell));
  assert.ok(!isSupported(router));
  assert.ok(!isCamera({ deviceType: 'doorbell', modelId: 'AAD1001' }));
});

test('battery and siren', () => {
  assert.ok(hasBattery(cam) && hasBattery(bell));
  assert.ok(!hasBattery(hub));
  assert.ok(!hasBattery({ deviceType: 'arloq', deviceId: 'Q' }));
  assert.ok(hasSiren(hub));
  assert.ok(!hasSiren(cam), 'behind a hub: the hub sounds');
  assert.ok(hasSiren(wifiCam));
  assert.ok(!hasSiren({ deviceType: 'basestation', modelId: 'VMB3010' }));
  assert.ok(hasSiren({ deviceType: 'siren', deviceId: 'S' }));
});

test('baseOf finds the parent hub', () => {
  const devices = sampleDevices();
  assert.equal(baseOf(cam, devices).deviceId, 'BASE1');
  assert.equal(baseOf(wifiCam, devices).deviceId, 'CAM2');
});

test('modes: built-ins always there, names and lookup', () => {
  const modes = modesOf({ 'U-BASE1': { modes: [{ id: 'mode2', name: 'Night' }] } }, hub);
  assert.deepEqual(
    modes.map((m) => m.id),
    ['mode0', 'mode1', 'mode2'],
  );
  assert.equal(modeLabel(modes[0]), 'Disarmed');
  assert.equal(modeLabel(modes[1], 'fr'), 'Armé');
  assert.equal(modeLabel(modes[2]), 'Night');
  assert.equal(findMode(modes, 'armed').id, 'mode1');
  assert.equal(findMode(modes, 'Désarmé').id, 'mode0');
  assert.equal(findMode(modes, 'night').id, 'mode2');
  assert.equal(findMode(modes, 'MODE2').id, 'mode2');
  assert.equal(findMode(modes, 'away'), null);
  assert.equal(modeKind('mode1'), 'armed');
  assert.equal(modeKind('mode7'), 'custom');
});
