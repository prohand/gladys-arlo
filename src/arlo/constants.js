// -----------------------------------------------------------------------------
// Arlo cloud endpoints.
//
// Arlo publishes no public API: these are the endpoints of the my.arlo.com web
// application, the same ones the community libraries use (pyaarlo, node-arlo).
// They are grouped here so a change on Arlo's side is fixed in one place.
// -----------------------------------------------------------------------------

/** Authentication server (login, verification code). */
export const AUTH_URL = 'https://ocapi-app.arlo.com/api';

/** Main API (devices, modes, library, commands, event stream). */
export const API_URL = 'https://myapi.arlo.com/hmsweb';

export const PATHS = {
  AUTH: '/auth',
  GET_FACTORS: '/getFactors',
  START_AUTH: '/startAuth',
  FINISH_AUTH: '/finishAuth',
  SESSION: '/users/session/v2',
  DEVICES: '/users/devices',
  AUTOMATION_ACTIVE: '/users/devices/automation/active',
  AUTOMATION_DEFINITIONS: '/users/automation/definitions',
  NOTIFY: '/users/devices/notify/',
  LIBRARY: '/users/library',
  FULL_FRAME_SNAPSHOT: '/users/devices/fullFrameSnapshot',
  SUBSCRIBE: '/client/subscribe',
};

/**
 * Headers of the web application. Arlo's front door rejects requests that do
 * not look like they come from my.arlo.com.
 */
export const WEB_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Auth-Version': '2',
  'Content-Type': 'application/json; charset=utf-8',
  Origin: 'https://my.arlo.com',
  Referer: 'https://my.arlo.com/',
  Source: 'arloCamWeb',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  // "BROWSER", base64: how the web application names its own device type.
  'x-user-device-automation-name': 'QlJPV1NFUg==',
  'x-user-device-type': 'BROWSER',
};

/** Arlo device types (`deviceType` of the device list). */
export const ARLO_DEVICE_TYPES = {
  BASE_STATION: 'basestation',
  CAMERA: 'camera',
  ARLO_Q: 'arloq',
  ARLO_QS: 'arloqs',
  DOORBELL: 'doorbell',
  SIREN: 'siren',
};

/** The two modes every Arlo base has, whatever its language. */
export const BUILTIN_MODES = {
  mode0: 'disarmed',
  mode1: 'armed',
};

/** Longest wait for a requested snapshot to come back on the event stream. */
export const SNAPSHOT_TIMEOUT_MS = 10_000;

/** Request timeout of a plain API call. */
export const REQUEST_TIMEOUT_MS = 20_000;
