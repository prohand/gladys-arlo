// -----------------------------------------------------------------------------
// Arlo cloud HTTP client.
//
// One method per Arlo endpoint, nothing else: no state beyond the session
// token, no retry, no timer. The service (src/arlo/service.js) decides what to
// call and when. `fetch` is injected so the tests never touch the network.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { API_URL, AUTH_URL, PATHS, REQUEST_TIMEOUT_MS, WEB_HEADERS } from './constants.js';

/** An answer of the Arlo cloud that is not a success. */
export class ArloApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string|number, reason?: string }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'ArloApiError';
    this.status = details.status;
    this.code = details.code;
    this.reason = details.reason;
  }

  /** The token is no longer accepted: a new login is needed. */
  get isAuthError() {
    return this.status === 401 || this.code === 2015;
  }
}

const toBase64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');

/** `YYYYMMDD` of a date, in the container's time zone (what the library expects). */
export function libraryDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** A transaction id shaped like the web application's. */
function transactionId() {
  return `web!${randomBytes(4).toString('hex')}.${randomBytes(4).toString('hex')}!${Date.now()}`;
}

export class ArloClient {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] injected for the tests
   * @param {string} [options.deviceId] stable id of this "browser" for Arlo
   */
  constructor({ fetch = globalThis.fetch, deviceId = '' } = {}) {
    this.fetch = fetch;
    this.deviceId = deviceId;
    this.token = null;
    this.userId = null;
  }

  /** Use a session obtained by a login (or read back from /data). */
  setSession({ token, userId } = {}) {
    this.token = token ?? null;
    this.userId = userId ?? null;
  }

  get hasSession() {
    return Boolean(this.token && this.userId);
  }

  /** The `from` of the notify commands: the web application's client id. */
  get webClientId() {
    return `${this.userId}_web`;
  }

  headers(extra = {}) {
    return {
      ...WEB_HEADERS,
      ...(this.deviceId ? { 'x-user-device-id': this.deviceId } : {}),
      ...extra,
    };
  }

  /**
   * One HTTP call, JSON in and out.
   * @returns {Promise<any>} the parsed body
   */
  async call(baseUrl, path, { method = 'GET', query, body, headers = {}, signal } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const response = await this.fetch(url, {
      method,
      headers: this.headers(headers),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Cloudflare and gateway errors answer HTML: keep the status only.
    }
    if (!response.ok) {
      const message = parsed?.meta?.message ?? parsed?.data?.message ?? `HTTP ${response.status}`;
      throw new ArloApiError(`Arlo ${method} ${path}: ${message}`, {
        status: response.status,
        code: parsed?.meta?.code ?? parsed?.data?.error,
        reason: parsed?.data?.reason,
      });
    }
    return parsed;
  }

  // --- Authentication (ocapi-app.arlo.com) ----------------------------------
  // Answers are `{ meta: { code, message }, data }`; the code is 200 on success.

  async authCall(path, options) {
    const body = await this.call(AUTH_URL, path, options);
    const code = body?.meta?.code;
    if (code !== undefined && code !== 200) {
      throw new ArloApiError(`Arlo ${path}: ${body.meta.message ?? `code ${code}`}`, {
        status: code === 401 ? 401 : undefined,
        code,
      });
    }
    return body?.data ?? {};
  }

  /**
   * First login step: email and password.
   * @returns {Promise<{ token: string, userId: string, authenticated: number,
   *   authCompleted: boolean, expiresIn?: number }>}
   */
  async login(email, password) {
    const data = await this.authCall(PATHS.AUTH, {
      method: 'POST',
      body: { email, password: toBase64(password), language: 'en', EnvSource: 'prod' },
    });
    if (!data.token || !data.userId) {
      throw new ArloApiError('Arlo login: no token in the answer');
    }
    return data;
  }

  /** The ways Arlo can send a verification code to this account. */
  async getFactors(authToken, authenticated) {
    const data = await this.authCall(PATHS.GET_FACTORS, {
      query: { data: authenticated },
      headers: { Authorization: toBase64(authToken) },
    });
    return Array.isArray(data.items) ? data.items : [];
  }

  /** Have Arlo send a verification code; resolves the code's transaction. */
  async startAuth(authToken, { factorId, userId }) {
    const data = await this.authCall(PATHS.START_AUTH, {
      method: 'POST',
      headers: { Authorization: toBase64(authToken) },
      body: { factorId, factorType: 'BROWSER', userId },
    });
    if (!data.factorAuthCode) {
      throw new ArloApiError('Arlo startAuth: no factorAuthCode in the answer');
    }
    return data.factorAuthCode;
  }

  /** Check the code the user received; resolves the final token. */
  async finishAuth(authToken, { factorAuthCode, otp }) {
    const data = await this.authCall(PATHS.FINISH_AUTH, {
      method: 'POST',
      headers: { Authorization: toBase64(authToken) },
      body: { factorAuthCode, otp: String(otp).trim(), isBrowserTrusted: true },
    });
    if (!data.token) {
      throw new ArloApiError('Arlo finishAuth: no token in the answer');
    }
    return data;
  }

  // --- API (myapi.arlo.com/hmsweb) -------------------------------------------
  // Answers are `{ success, data }`.

  async apiCall(path, options = {}) {
    if (!this.hasSession) {
      throw new ArloApiError('Not logged in to Arlo', { status: 401 });
    }
    const body = await this.call(API_URL, path, {
      ...options,
      headers: { Authorization: this.token, ...(options.headers ?? {}) },
    });
    if (body && body.success === false) {
      const error = body.data ?? {};
      throw new ArloApiError(`Arlo ${path}: ${error.message ?? error.reason ?? 'failed'}`, {
        code: Number(error.error) || error.error,
        reason: error.reason,
        status: Number(error.error) === 2015 ? 401 : undefined,
      });
    }
    return body?.data;
  }

  /** Cheap call that fails with a 401 when the token expired. */
  getSession() {
    return this.apiCall(PATHS.SESSION);
  }

  async getDevices() {
    const data = await this.apiCall(PATHS.DEVICES, { query: { t: Date.now() } });
    return Array.isArray(data) ? data : [];
  }

  /** The active mode of every base: `[{ gatewayId|deviceId, uniqueId, activeModes }]`. */
  async getActiveModes() {
    const data = await this.apiCall(PATHS.AUTOMATION_ACTIVE);
    return Array.isArray(data) ? data : [];
  }

  /** The modes each base offers: `{ <uniqueId>: { modes: [{ id, name }] } }`. */
  async getModeDefinitions() {
    const data = await this.apiCall(PATHS.AUTOMATION_DEFINITIONS, { query: { uniqueIds: 'all' } });
    return data && typeof data === 'object' ? data : {};
  }

  /** Switch a base to one of its modes (`mode0`, `mode1`, `mode2`...). */
  setActiveMode(base, modeId) {
    return this.apiCall(PATHS.AUTOMATION_ACTIVE, {
      method: 'POST',
      body: {
        activeAutomations: [
          {
            deviceId: base.deviceId,
            timestamp: Date.now(),
            activeModes: [modeId],
            activeSchedules: [],
          },
        ],
      },
    });
  }

  /**
   * Send a command to a base (or to a device that is its own base). Its
   * answer, when there is one, comes back on the event stream.
   */
  notify(base, { action, resource, properties, publishResponse = true }) {
    return this.apiCall(`${PATHS.NOTIFY}${encodeURIComponent(base.deviceId)}`, {
      method: 'POST',
      headers: { xcloudId: base.xCloudId },
      body: {
        from: this.webClientId,
        to: base.deviceId,
        action,
        resource,
        publishResponse,
        transId: transactionId(),
        ...(properties === undefined ? {} : { properties }),
      },
    });
  }

  /** Recordings of a day range (both included), newest first. */
  async getLibrary(from, to = from) {
    const data = await this.apiCall(PATHS.LIBRARY, {
      method: 'POST',
      body: { dateFrom: libraryDate(from), dateTo: libraryDate(to) },
    });
    return Array.isArray(data) ? data : [];
  }

  /** Ask a camera for a full-frame snapshot; the URL comes back as an event. */
  requestSnapshot(camera, base) {
    return this.apiCall(PATHS.FULL_FRAME_SNAPSHOT, {
      method: 'POST',
      headers: { xcloudId: base.xCloudId },
      body: {
        from: this.webClientId,
        to: base.deviceId,
        resource: `cameras/${camera.deviceId}`,
        action: 'set',
        publishResponse: true,
        transId: transactionId(),
        properties: { activityState: 'fullFrameSnapshot' },
      },
    });
  }

  /**
   * Download a picture from a presigned Arlo URL (no auth header: the URL
   * carries its own signature).
   * @returns {Promise<Buffer>}
   */
  async downloadImage(url, { maxBytes = 5 * 1024 * 1024 } = {}) {
    if (!/^https:\/\//.test(String(url ?? ''))) {
      throw new ArloApiError('No image URL for this device');
    }
    const response = await this.fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      throw new ArloApiError(`Image download: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new ArloApiError(`Image download: ${buffer.length} bytes, too large`);
    }
    return buffer;
  }

  /**
   * Open the server-sent event stream. Resolves the response, whose body the
   * caller reads (see src/arlo/events.js).
   */
  async openEventStream(signal) {
    if (!this.hasSession) {
      throw new ArloApiError('Not logged in to Arlo', { status: 401 });
    }
    const response = await this.fetch(new URL(`${API_URL}${PATHS.SUBSCRIBE}`), {
      headers: this.headers({ Authorization: this.token, Accept: 'text/event-stream' }),
      signal,
    });
    if (!response.ok || !response.body) {
      throw new ArloApiError(`Arlo event stream: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return response;
  }
}
