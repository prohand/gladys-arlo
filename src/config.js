// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`. The SDK fetches it (`getConfig()`) and
// notifies every change (`onConfigUpdated()`). This module only applies the
// defaults and forces the types, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

/** How the Arlo verification code is sent (Arlo "factors"). */
export const MFA_METHODS = ['email', 'sms'];

// Defaults: they MUST match the `default` values of the manifest
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  mfa_method: 'email',
  // Seconds between two refreshes of the modes, batteries and recordings.
  refresh_interval: 60,
  // Ask the camera for a brand-new picture when Gladys wants an image. Off by
  // default: it wakes a battery camera up and drains it.
  live_snapshot: false,
  debug_logs: false,
};

/** Bounds of `refresh_interval`, as declared in the manifest. */
export const REFRESH_INTERVAL_BOUNDS = { min: 60, max: 3600 };

/**
 * Merge the user config with the defaults and force the types.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  const interval = Number(source.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
  const mfaMethod = String(source.mfa_method ?? DEFAULT_CONFIG.mfa_method).toLowerCase();
  return {
    ...DEFAULT_CONFIG,
    email: String(source.email ?? '').trim(),
    password: String(source.password ?? ''),
    mfa_method: MFA_METHODS.includes(mfaMethod) ? mfaMethod : DEFAULT_CONFIG.mfa_method,
    refresh_interval: Number.isFinite(interval)
      ? Math.min(REFRESH_INTERVAL_BOUNDS.max, Math.max(REFRESH_INTERVAL_BOUNDS.min, interval))
      : DEFAULT_CONFIG.refresh_interval,
    live_snapshot: source.live_snapshot === true || source.live_snapshot === 'true',
    debug_logs: source.debug_logs === true || source.debug_logs === 'true',
  };
}

/** Whether the account fields are filled in. */
export function hasCredentials(config) {
  return Boolean(config?.email && config?.password);
}
