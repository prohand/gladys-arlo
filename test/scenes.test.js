import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_ACTION_HANDLERS } from '../src/capabilities/scenes.js';
import { deviceExt, setupService } from './helpers/setup.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declared = (list, key) => list.find((entry) => entry.key === key);

/** The outputs a handler returns are exactly the declared ones. */
function assertOutputs(key, outputs) {
  const action = declared(manifest.scene_actions, key);
  assert.deepEqual(Object.keys(outputs).sort(), action.outputs.map((o) => o.key).sort());
}

test('set_mode switches the base and returns the declared outputs', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  const outputs = await SCENE_ACTION_HANDLERS.set_mode(service, {
    device: deviceExt(gladys, 'BASE1'),
    mode: 'Night',
  });
  assert.deepEqual(outputs, { changed: true, mode_name: 'Night' });
  assert.equal(arlo.active[0].activeModes[0], 'mode2');
  assertOutputs('set_mode', outputs);
});

test('take_snapshot on a device that is not a camera is a false output', async (t) => {
  const { gladys, service } = await setupService(t);
  const outputs = await SCENE_ACTION_HANDLERS.take_snapshot(service, {
    device: deviceExt(gladys, 'BASE1'),
  });
  assert.deepEqual(outputs, { taken: false });
  assertOutputs('take_snapshot', outputs);
});

test('sound_siren bounds the duration and the volume', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  const outputs = await SCENE_ACTION_HANDLERS.sound_siren(service, {
    device: deviceExt(gladys, 'BASE1'),
    duration: 9999,
    volume: 0,
  });
  assert.deepEqual(outputs, { started: true });
  assertOutputs('sound_siren', outputs);
  const { properties } = arlo.calls.at(-1).body;
  assert.equal(properties.duration, 300);
  assert.equal(properties.volume, 1);
  const none = await SCENE_ACTION_HANDLERS.sound_siren(service, {
    device: deviceExt(gladys, 'CAM1'),
  });
  assert.deepEqual(none, { started: false });
});

test('scene event data only carries the declared keys', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  service.handleEvent({ resource: 'cameras/CAM1', properties: { motionDetected: true } });
  service.handleEvent({ resource: 'doorbells/BELL1', properties: { buttonPressed: true } });
  service.handleEvent({ resource: 'activeAutomations', BASE1: { activeModes: ['mode1'] } });
  arlo.library.push({
    name: 'n',
    deviceId: 'CAM2',
    utcCreatedDate: Date.now(),
    objCategory: 'Animal',
  });
  await service.pollLibrary();
  await new Promise((resolve) => setImmediate(resolve));
  const seen = new Set();
  for (const { key, data } of gladys.fake.sceneEvents) {
    seen.add(key);
    const trigger = declared(manifest.scene_triggers, key);
    assert.ok(trigger, `undeclared trigger ${key}`);
    const allowed = [...(trigger.fields ?? []), ...(trigger.variables ?? [])].map((f) => f.key);
    for (const dataKey of Object.keys(data)) {
      assert.ok(allowed.includes(dataKey), `${key}.${dataKey} is not declared`);
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    'every declared trigger is fired by the code',
  );
});
