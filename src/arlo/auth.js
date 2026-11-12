// -----------------------------------------------------------------------------
// Arlo login, verification code and session storage.
//
// Arlo always asks for a verification code (email or SMS) on a new login. A
// code cannot be typed in a config field ahead of time, so the login is split
// in two Configuration-screen actions: "Send me a code", then "Validate the
// code". The token obtained is kept in /data (the only writable path) and
// reused at every restart until Arlo refuses it; then the connection status
// asks for a new code.
//
// The session file holds a token: it is never logged, and only this module
// reads it.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { mask } from '../logging.js';
import { ArloApiError } from './client.js';

const logger = createLogger({ name: 'arlo-auth' });

/** Where the session lives. `ARLO_DATA_DIR` exists for local runs. */
export const DEFAULT_DATA_DIR = process.env.ARLO_DATA_DIR || '/data';
const SESSION_FILE = 'arlo-session.json';

/** A code sent more than this long ago is no longer accepted by Arlo. */
const PENDING_CODE_TTL_MS = 10 * 60 * 1000;

/** Token lifetime when Arlo does not say. */
const DEFAULT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Login outcomes. */
export const AUTH_STATES = {
  CONNECTED: 'connected',
  CODE_REQUIRED: 'code_required',
  NO_CREDENTIALS: 'no_credentials',
};

/** The Arlo factor type of each `mfa_method` of the configuration. */
const FACTOR_TYPES = { email: 'EMAIL', sms: 'SMS' };

/**
 * Absolute expiry, in ms, of an Arlo `expiresIn`. Arlo has sent it as a
 * duration in seconds, and as an epoch in seconds or in milliseconds.
 */
export function expiryFrom(expiresIn, now = Date.now()) {
  const value = Number(expiresIn);
  if (!Number.isFinite(value) || value <= 0) {
    return now + DEFAULT_TOKEN_TTL_MS;
  }
  if (value > 1e12) {
    return value;
  }
  if (value > 1e9) {
    return value * 1000;
  }
  return now + value * 1000;
}

/**
 * Pick the factor matching the configured method, the primary one first.
 * @param {Array<{ factorId: string, factorType: string, factorRole?: string }>} factors
 * @param {string} method `email` | `sms`
 */
export function pickFactor(factors, method) {
  const wanted = FACTOR_TYPES[method] ?? 'EMAIL';
  const matching = factors.filter((f) => String(f.factorType).toUpperCase() === wanted);
  return matching.find((f) => f.factorRole === 'PRIMARY') ?? matching[0] ?? null;
}

export class ArloAuth {
  /**
   * @param {object} options
   * @param {import('./client.js').ArloClient} options.client
   * @param {string} [options.dataDir]
   * @param {() => number} [options.now]
   */
  constructor({ client, dataDir = DEFAULT_DATA_DIR, now = Date.now }) {
    this.client = client;
    this.dataDir = dataDir;
    this.now = now;
    this.stored = null;
    this.pending = null;
  }

  get sessionPath() {
    return join(this.dataDir, SESSION_FILE);
  }

  /** Read the stored session and the device id; creates the device id once. */
  async load() {
    try {
      this.stored = JSON.parse(await readFile(this.sessionPath, 'utf8'));
    } catch {
      this.stored = {};
    }
    if (!this.stored.deviceId) {
      // Arlo remembers "trusted browsers" by this id: keep it across restarts.
      this.stored.deviceId = randomUUID();
      await this.save();
    }
    this.client.deviceId = this.stored.deviceId;
    return this.stored;
  }

  async save() {
    try {
      await mkdir(this.dataDir, { recursive: true });
      await writeFile(this.sessionPath, JSON.stringify(this.stored), { mode: 0o600 });
    } catch (err) {
      // Read-only /data: the session lives as long as the container.
      logger.warn(`Cannot store the Arlo session in ${this.dataDir}: ${err.message}`);
    }
  }

  /** Forget the token (kept: the device id). */
  async clear() {
    this.client.setSession({});
    this.stored = { deviceId: this.stored?.deviceId };
    if (!this.stored.deviceId) {
      await rm(this.sessionPath, { force: true }).catch(() => {});
      return;
    }
    await this.save();
  }

  /** A stored token for this account, not expired. */
  storedSessionFor(email) {
    const s = this.stored ?? {};
    if (!s.token || !s.userId || s.email !== email) {
      return null;
    }
    if (Number(s.expiresAt) <= this.now()) {
      return null;
    }
    return s;
  }

  async keep({ email, token, userId, expiresIn }) {
    this.stored = {
      ...this.stored,
      email,
      token,
      userId,
      expiresAt: expiryFrom(expiresIn, this.now()),
    };
    this.client.setSession({ token, userId });
    await this.save();
  }

  /**
   * Get a working session without bothering the user: the stored token, else a
   * plain login when Arlo trusts this device and skips the code.
   * @param {{ email: string, password: string }} config
   * @returns {Promise<string>} one of AUTH_STATES
   */
  async connect(config) {
    if (!config.email || !config.password) {
      return AUTH_STATES.NO_CREDENTIALS;
    }
    if (!this.stored) {
      await this.load();
    }
    const stored = this.storedSessionFor(config.email);
    if (stored) {
      this.client.setSession(stored);
      try {
        await this.client.getSession();
        logger.info(`Arlo session restored for ${mask(config.email)}`);
        return AUTH_STATES.CONNECTED;
      } catch (err) {
        if (!(err instanceof ArloApiError && err.isAuthError)) {
          throw err;
        }
        logger.info('The stored Arlo session expired: logging in again');
        this.client.setSession({});
      }
    }
    const login = await this.client.login(config.email, config.password);
    if (login.authCompleted) {
      await this.keep({ email: config.email, ...login });
      logger.info(`Logged in to Arlo as ${mask(config.email)} (no code needed)`);
      return AUTH_STATES.CONNECTED;
    }
    logger.info('Arlo needs a verification code: waiting for the user');
    return AUTH_STATES.CODE_REQUIRED;
  }

  /**
   * Have Arlo send a verification code.
   * @returns {Promise<{ destination: string, sent: boolean }>} where it went;
   *   `sent: false` when no code was needed after all
   */
  async sendCode(config) {
    if (!this.stored) {
      await this.load();
    }
    const login = await this.client.login(config.email, config.password);
    if (login.authCompleted) {
      await this.keep({ email: config.email, ...login });
      return { destination: '', sent: false };
    }
    const factors = await this.client.getFactors(login.token, login.authenticated);
    const factor = pickFactor(factors, config.mfa_method);
    if (!factor) {
      throw new ArloApiError(`No ${config.mfa_method} verification method on this Arlo account`);
    }
    const factorAuthCode = await this.client.startAuth(login.token, {
      factorId: factor.factorId,
      userId: login.userId,
    });
    this.pending = {
      email: config.email,
      authToken: login.token,
      userId: login.userId,
      factorAuthCode,
      expiresAt: this.now() + PENDING_CODE_TTL_MS,
    };
    logger.info(`Arlo verification code sent (${config.mfa_method})`);
    return { destination: factor.displayName ?? '', sent: true };
  }

  /** Check the code the user typed and keep the session. */
  async verifyCode(config, code) {
    const pending = this.pending;
    if (!pending || pending.email !== config.email || pending.expiresAt <= this.now()) {
      this.pending = null;
      throw new ArloApiError('No code is waiting: ask for a new one first');
    }
    if (!/^\d{4,8}$/.test(String(code ?? '').trim())) {
      throw new ArloApiError('The code is made of digits only');
    }
    const finished = await this.client.finishAuth(pending.authToken, {
      factorAuthCode: pending.factorAuthCode,
      otp: code,
    });
    this.pending = null;
    await this.keep({
      email: config.email,
      token: finished.token,
      userId: finished.userId ?? pending.userId,
      expiresIn: finished.expiresIn,
    });
    logger.info(`Logged in to Arlo as ${mask(config.email)}`);
  }
}
