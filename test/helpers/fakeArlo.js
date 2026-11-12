// -----------------------------------------------------------------------------
// An in-memory Arlo cloud, served through an injected `fetch`.
//
// It answers the endpoints the integration calls, with the shapes the Arlo web
// application gets, and records every request in `calls`. Tests change its
// data (`arlo.devices`, `arlo.active`, `arlo.library`...) to play the cloud.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
    'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
    'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
    'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
    'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
    'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
    '5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCwooor8/P3E//Z',
  'base64',
);

/** A hub, a camera behind it, a Wi-Fi camera that is its own base, a doorbell. */
export function sampleDevices() {
  return [
    {
      deviceId: 'BASE1',
      deviceName: 'Hub',
      deviceType: 'basestation',
      modelId: 'VMB4540',
      uniqueId: 'U-BASE1',
      xCloudId: 'X-BASE1',
      parentId: 'BASE1',
    },
    {
      deviceId: 'CAM1',
      deviceName: 'Garden',
      deviceType: 'camera',
      modelId: 'VMC4040P',
      uniqueId: 'U-CAM1',
      xCloudId: 'X-BASE1',
      parentId: 'BASE1',
      presignedLastImageUrl: 'https://arlo.test/img/cam1-1.jpg',
      lastImageUploaded: 1000,
    },
    {
      deviceId: 'CAM2',
      deviceName: 'Garage',
      deviceType: 'camera',
      modelId: 'VMC4050P',
      uniqueId: 'U-CAM2',
      xCloudId: 'X-CAM2',
      parentId: 'CAM2',
      presignedLastImageUrl: 'https://arlo.test/img/cam2-1.jpg',
      lastImageUploaded: 2000,
    },
    {
      deviceId: 'BELL1',
      deviceName: 'Front door',
      deviceType: 'doorbell',
      modelId: 'AVD2001',
      uniqueId: 'U-BELL1',
      xCloudId: 'X-BELL1',
      parentId: 'BELL1',
    },
    {
      deviceId: 'ROUTER',
      deviceName: 'Router',
      deviceType: 'routerM1',
      modelId: 'ABC1000',
    },
  ];
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createFakeArlo(overrides = {}) {
  const arlo = {
    calls: [],
    devices: sampleDevices(),
    definitions: {
      'U-BASE1': {
        modes: [
          { id: 'mode0', name: '' },
          { id: 'mode1', name: '' },
          { id: 'mode2', name: 'Night' },
        ],
      },
    },
    active: [
      { gatewayId: 'BASE1', uniqueId: 'U-BASE1', activeModes: ['mode0'] },
      { gatewayId: 'CAM2', uniqueId: 'U-CAM2', activeModes: ['mode1'] },
    ],
    library: [],
    images: new Map(),
    // Login answers: `authCompleted: false` means a code is needed.
    authCompleted: false,
    validCode: '123456',
    sessionValid: true,
    // Set to a status to make every API call answer it.
    failWith: null,
    ...overrides,
  };

  arlo.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : undefined;
    const headers = init.headers ?? {};
    arlo.calls.push({ method: init.method ?? 'GET', url, path: url.pathname, body, headers });

    if (url.hostname === 'arlo.test') {
      const image = arlo.images.get(url.pathname) ?? TINY_JPEG;
      return new Response(image, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    if (arlo.failWith) {
      return json({ success: false, data: { message: 'failure' } }, arlo.failWith);
    }

    if (url.hostname === 'ocapi-app.arlo.com') {
      switch (url.pathname) {
        case '/api/auth':
          if (Buffer.from(body.password, 'base64').toString() !== 'secret') {
            return json({ meta: { code: 401, message: 'Invalid credentials' } });
          }
          return json({
            meta: { code: 200 },
            data: {
              token: 'auth-token',
              userId: 'USER1',
              authenticated: 1700000000,
              authCompleted: arlo.authCompleted,
              expiresIn: 1209600,
            },
          });
        case '/api/getFactors':
          return json({
            meta: { code: 200 },
            data: {
              items: [
                {
                  factorId: 'F-SMS',
                  factorType: 'SMS',
                  factorRole: 'SECONDARY',
                  displayName: '+33***12',
                },
                {
                  factorId: 'F-MAIL',
                  factorType: 'EMAIL',
                  factorRole: 'PRIMARY',
                  displayName: 'me***@x.fr',
                },
              ],
            },
          });
        case '/api/startAuth':
          return json({ meta: { code: 200 }, data: { factorAuthCode: 'FAC-1' } });
        case '/api/finishAuth':
          if (body.otp !== arlo.validCode) {
            return json({ meta: { code: 400, message: 'Invalid code' } });
          }
          return json({
            meta: { code: 200 },
            data: { token: 'final-token', userId: 'USER1', expiresIn: 1209600 },
          });
        default:
          return json({ meta: { code: 404 } }, 404);
      }
    }

    if (!arlo.sessionValid) {
      return json({ success: false, data: { error: '2015', message: 'Session expired' } }, 401);
    }
    const path = url.pathname.replace(/^\/hmsweb/, '');
    if (path === '/users/session/v2') {
      return json({ success: true, data: { userId: 'USER1' } });
    }
    if (path === '/users/devices') {
      return json({ success: true, data: arlo.devices });
    }
    if (path === '/users/automation/definitions') {
      return json({ success: true, data: arlo.definitions });
    }
    if (path === '/users/devices/automation/active') {
      if ((init.method ?? 'GET') === 'POST') {
        for (const wanted of body.activeAutomations) {
          const entry = arlo.active.find((e) => e.gatewayId === wanted.deviceId);
          if (entry) {
            entry.activeModes = wanted.activeModes;
          }
        }
        return json({ success: true, data: {} });
      }
      return json({ success: true, data: arlo.active });
    }
    if (path === '/users/library') {
      return json({ success: true, data: arlo.library });
    }
    if (path.startsWith('/users/devices/notify/') || path === '/users/devices/fullFrameSnapshot') {
      return json({ success: true, data: {} });
    }
    return json({ success: false, data: { message: `unknown ${path}` } }, 404);
  };

  return arlo;
}

/** A stream stand-in: never opens anything, the tests push events themselves. */
export class FakeEventStream {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.connected = false;
    this.started = 0;
  }

  start() {
    this.started += 1;
  }

  stop() {
    this.connected = false;
  }

  emit(message) {
    this.onMessage(message);
  }
}

/** A JPEG well over 150 KB: random pixels compress badly. */
export function bigJpeg() {
  return readFileSync(new URL('./big.jpg', import.meta.url));
}
