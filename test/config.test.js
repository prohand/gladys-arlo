import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, normalizeConfig } from '../src/config.js';
import { localize, LANGUAGES, pick } from '../src/i18n.js';
import { mask } from '../src/logging.js';

test('normalizeConfig applies the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('normalizeConfig forces the types and the bounds', () => {
  const config = normalizeConfig({
    email: '  me@x.fr ',
    password: 'p',
    mfa_method: 'SMS',
    refresh_interval: '10',
    live_snapshot: 'true',
    debug_logs: true,
  });
  assert.equal(config.email, 'me@x.fr');
  assert.equal(config.mfa_method, 'sms');
  assert.equal(config.refresh_interval, 60);
  assert.equal(config.live_snapshot, true);
  assert.equal(config.debug_logs, true);
  assert.equal(normalizeConfig({ refresh_interval: 99999 }).refresh_interval, 3600);
  assert.equal(normalizeConfig({ refresh_interval: 'abc' }).refresh_interval, 60);
  assert.equal(normalizeConfig({ mfa_method: 'pigeon' }).mfa_method, 'email');
});

test('hasCredentials needs both the email and the password', () => {
  assert.equal(hasCredentials(normalizeConfig({ email: 'a@b.c' })), false);
  assert.equal(hasCredentials(normalizeConfig({ email: 'a@b.c', password: 'x' })), true);
});

test('localize builds one text per language, pick falls back to English', () => {
  assert.deepEqual(Object.keys(localize((l) => l)), LANGUAGES);
  assert.equal(pick('it', { en: 'Hello', fr: 'Bonjour' }), 'Hello');
});

test('mask hides personal values and secrets', () => {
  assert.equal(mask('john.doe@example.com'), 'jo***@example.com');
  assert.equal(mask('abcdefghijklmnop'), 'abcd***');
  assert.ok(!mask('a-very-long-secret-token').includes('secret'));
  assert.equal(mask(''), '');
});
