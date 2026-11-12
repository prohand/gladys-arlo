// -----------------------------------------------------------------------------
// Arlo event stream (server-sent events).
//
// Arlo pushes what happens on the devices — motion, doorbell press, battery,
// privacy, mode change, a snapshot ready — on a long-lived HTTP response, one
// `data: {json}` per event. This module keeps that response open: it reads
// it, hands every JSON event to `onMessage`, and reopens it after a cut with
// a growing delay. A 401 stops it: the session needs a new login.
//
// Some accounts get nothing on this stream (Arlo moved part of its users to
// another channel): the refresh loop of the service polls the modes and the
// recordings, so motion and mode changes still reach Gladys, a little later.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'arlo-events' });

const MIN_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;
/** No byte for this long means a dead connection nobody closed. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

/**
 * Build a parser fed with raw text chunks; calls `onMessage(object)` for every
 * complete event whose data is JSON.
 * @param {(message: object) => void} onMessage
 * @returns {(chunk: string) => void}
 */
export function createSseParser(onMessage) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        logger.debug(`Ignored a non-JSON event: ${data.slice(0, 80)}`);
        continue;
      }
      if (message && typeof message === 'object') {
        onMessage(message);
      }
    }
  };
}

export class EventStream {
  /**
   * @param {object} options
   * @param {import('./client.js').ArloClient} options.client
   * @param {(message: object) => void} options.onMessage
   * @param {(connected: boolean) => void} [options.onStatus]
   * @param {(err: Error) => void} [options.onAuthError]
   */
  constructor({ client, onMessage, onStatus = () => {}, onAuthError = () => {} }) {
    this.client = client;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onAuthError = onAuthError;
    this.running = false;
    this.connected = false;
    this.controller = null;
    this.retryTimer = null;
    this.retryDelay = MIN_RETRY_MS;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.retryDelay = MIN_RETRY_MS;
    this.run();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.wake?.();
    this.wake = null;
    this.controller?.abort();
    this.controller = null;
    this.setConnected(false);
  }

  setConnected(connected) {
    if (this.connected !== connected) {
      this.connected = connected;
      this.onStatus(connected);
    }
  }

  async run() {
    while (this.running) {
      try {
        await this.readOnce();
        // The server closed it cleanly: routine, reopen after a short pause
        // (never at once: a stream that closes on open would spin).
        this.retryDelay = MIN_RETRY_MS;
        await this.pause(MIN_RETRY_MS);
      } catch (err) {
        this.setConnected(false);
        if (!this.running) {
          return;
        }
        if (err?.isAuthError) {
          logger.warn('The Arlo event stream refused the session');
          this.running = false;
          this.onAuthError(err);
          return;
        }
        logger.warn(`Arlo event stream cut (${err.message}): retry in ${this.retryDelay / 1000} s`);
        await this.pause(this.retryDelay);
        this.retryDelay = Math.min(MAX_RETRY_MS, this.retryDelay * 2);
      }
    }
  }

  pause(ms) {
    if (!this.running) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.retryTimer = setTimeout(resolve, ms);
      this.retryTimer.unref?.();
      this.wake = resolve;
    });
  }

  async readOnce() {
    this.controller = new AbortController();
    const { signal } = this.controller;
    const response = await this.client.openEventStream(signal);
    const parse = createSseParser((message) => {
      if (message.status === 'connected') {
        this.setConnected(true);
        return;
      }
      try {
        this.onMessage(message);
      } catch (err) {
        logger.error('Arlo event handling failed', err);
      }
    });
    const decoder = new TextDecoder();
    let idle = setTimeout(() => this.controller?.abort(), IDLE_TIMEOUT_MS);
    try {
      for await (const chunk of response.body) {
        clearTimeout(idle);
        idle = setTimeout(() => this.controller?.abort(), IDLE_TIMEOUT_MS);
        this.retryDelay = MIN_RETRY_MS;
        parse(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
      }
    } finally {
      clearTimeout(idle);
    }
    this.setConnected(false);
  }
}
