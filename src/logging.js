// -----------------------------------------------------------------------------
// Log level switchable from the Configuration screen.
//
// The SDK logger re-reads `process.env.LOG_LEVEL` on every line, so writing the
// variable is enough: it applies at once to every logger already created, the
// SDK's own connection logs included. The level the container was started with
// is the baseline: the switch raises it to debug while on, and puts the
// operator's value back (not `info`) when it goes off.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'logging' });

/** `LOG_LEVEL` as the container was started with, read once. */
const BASELINE = process.env.LOG_LEVEL;

/**
 * Apply the log level a configuration asks for.
 * @param {{ debug_logs?: boolean }} config normalized configuration
 * @returns {string} the level in force afterwards
 */
export function applyLogLevel(config) {
  const wanted = config?.debug_logs ? 'debug' : BASELINE;
  const current = process.env.LOG_LEVEL;
  if (wanted === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = wanted;
  }
  if (current !== process.env.LOG_LEVEL) {
    logger.info(
      config?.debug_logs
        ? 'Detailed logs turned on: every Arlo event is logged'
        : `Detailed logs turned off (level: ${process.env.LOG_LEVEL ?? 'info'})`,
    );
  }
  return process.env.LOG_LEVEL ?? 'info';
}

/**
 * Hide most of a secret or a personal value before it reaches a log line:
 * `john.doe@example.com` -> `jo***@example.com`, a token -> `abcd***`.
 * @param {unknown} value
 * @returns {string}
 */
export function mask(value) {
  const text = String(value ?? '');
  if (text.length === 0) {
    return '';
  }
  const at = text.indexOf('@');
  if (at > 0) {
    return `${text.slice(0, Math.min(2, at))}***${text.slice(at)}`;
  }
  return `${text.slice(0, Math.min(4, Math.floor(text.length / 4)))}***`;
}
