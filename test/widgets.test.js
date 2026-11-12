import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createWidgets, WIDGET_ACTIONS, WIDGET_KEYS } from '../src/capabilities/widgets.js';
import { FEATURES } from '../src/devices/index.js';
import { deviceExt, setupService } from './helpers/setup.js';

test('overview: valid content with modes, batteries, recordings and buttons', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  service.handleEvent({
    resource: 'cameras',
    properties: [{ serialNumber: 'CAM1', batteryLevel: 15 }],
  });
  arlo.library.push({
    name: 'r',
    deviceId: 'CAM1',
    utcCreatedDate: Date.now(),
    objCategory: 'Person',
    presignedThumbnailUrl: 'https://arlo.test/thumb.jpg',
  });
  await service.pollLibrary();
  const widgets = createWidgets(service, gladys);
  const content = await widgets[WIDGET_KEYS.OVERVIEW].get({});
  assert.deepEqual(validateWidgetContent(content), []);
  const types = content.components.map((c) => c.type);
  assert.deepEqual(types, ['status', 'card-list', 'button', 'button']);
  const [card] = content.components[1].items;
  assert.ok(card.image, 'the thumbnail is served by key');
  const image = await service.widgetImage(card.image);
  assert.ok(Buffer.from(image, 'base64').length > 0);
});

test('overview: arm all, then disarm all', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  const widgets = createWidgets(service, gladys);
  const toast = await widgets[WIDGET_KEYS.OVERVIEW].action({ actionKey: WIDGET_ACTIONS.ARM_ALL });
  assert.match(toast.en, /^2 base\(s\) armed/, 'the Wi-Fi camera was armed already');
  assert.deepEqual(
    arlo.active.map((entry) => entry.activeModes[0]),
    ['mode1', 'mode1'],
  );
  await widgets[WIDGET_KEYS.OVERVIEW].action({ actionKey: WIDGET_ACTIONS.DISARM_ALL });
  assert.deepEqual(
    arlo.active.map((entry) => entry.activeModes[0]),
    ['mode0', 'mode0'],
  );
  await assert.rejects(widgets[WIDGET_KEYS.OVERVIEW].action({ actionKey: 'nope' }));
});

test('camera widget: valid content, live tiles bound to published features', async (t) => {
  const { gladys, service } = await setupService(t);
  const widgets = createWidgets(service, gladys);
  const content = await widgets[WIDGET_KEYS.CAMERA].get({
    settings: { camera: deviceExt(gladys, 'CAM1') },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const published = gladys.fake.discoveredDevices.flatMap((d) =>
    d.features.map((f) => f.external_id),
  );
  for (const component of content.components) {
    if (component.device_feature) {
      assert.ok(published.includes(component.device_feature), component.device_feature);
    }
  }
  assert.ok(content.components.some((c) => c.type === 'image'));
  const toggle = content.components.find((c) => c.device_feature?.endsWith(`:${FEATURES.ENABLED}`));
  assert.equal(toggle.value, 0, 'a camera on offers to turn it off');
});

test('camera widget: unknown camera and disconnected service', async (t) => {
  const { gladys, service } = await setupService(t);
  const widgets = createWidgets(service, gladys);
  const unknown = await widgets[WIDGET_KEYS.CAMERA].get({
    settings: { camera: 'ext:x:arlo:NOPE' },
  });
  assert.deepEqual(validateWidgetContent(unknown), []);
  service.authState = 'code_required';
  const off = await widgets[WIDGET_KEYS.OVERVIEW].get({});
  assert.deepEqual(validateWidgetContent(off), []);
  assert.equal(off.components[0].type, 'text');
});

test('camera widget snapshot button', async (t) => {
  const { gladys, service, arlo } = await setupService(t);
  const widgets = createWidgets(service, gladys);
  const waiting = widgets[WIDGET_KEYS.CAMERA].action({
    actionKey: WIDGET_ACTIONS.SNAPSHOT,
    params: { device: deviceExt(gladys, 'CAM1') },
  });
  await new Promise((resolve) => setImmediate(resolve));
  service.handleEvent({
    resource: 'cameras/CAM1',
    properties: { presignedFullFrameSnapshotUrl: 'https://arlo.test/snap.jpg' },
  });
  const toast = await waiting;
  assert.equal(toast.en, 'Snapshot taken.');
  assert.ok(arlo.calls.some((c) => c.path.endsWith('fullFrameSnapshot')));
});
