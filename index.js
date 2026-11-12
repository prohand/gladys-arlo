// -----------------------------------------------------------------------------
// Entry point of the Arlo integration for Gladys Assistant.
//
// SDK wiring only: handlers registered BEFORE connect(), then connect. The
// Arlo logic lives in src/arlo/ (cloud client, login, event stream, service),
// the Gladys device mapping in src/devices/, the scenes and widgets in
// src/capabilities/.
//
// Environment variables provided by the Gladys supervisor (read by the SDK):
//   GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// -----------------------------------------------------------------------------

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { ArloAuth, AUTH_STATES } from './src/arlo/auth.js';
import { ArloClient } from './src/arlo/client.js';
import { ArloService } from './src/arlo/service.js';
import { SCENE_ACTION_HANDLERS, SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { createWidgets, refreshWidgets, WIDGET_KEYS } from './src/capabilities/widgets.js';
import { hasCredentials, normalizeConfig } from './src/config.js';
import { applyLogLevel } from './src/logging.js';
import { arloFailed, codeSent, connectedWith, MESSAGES } from './src/messages.js';

/**
 * Register every handler on a Gladys client and return the service. Exported
 * for the tests, which pass the fake Gladys of the SDK.
 * @param {GladysIntegration} gladys
 * @param {{ client?: ArloClient, auth?: ArloAuth, EventStreamClass?: Function }} [deps]
 */
export function setup(gladys, deps = {}) {
  const client = deps.client ?? new ArloClient();
  const auth = deps.auth ?? new ArloAuth({ client });

  // The widgets follow modes, batteries and recordings: nudge them, at most
  // once every 10 s (the core drops the extra nudges anyway).
  let lastNudge = 0;
  const onChange = () => {
    const now = Date.now();
    if (gladys.connected && now - lastNudge >= 10_000) {
      lastNudge = now;
      refreshWidgets(gladys);
    }
  };

  const service = new ArloService({
    gladys,
    client,
    auth,
    onChange,
    ...(deps.EventStreamClass ? { EventStreamClass: deps.EventStreamClass } : {}),
  });
  let config = normalizeConfig();

  // --- Discovery ------------------------------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> reading the Arlo devices');
    if (service.connected) {
      service.discoveryKey = null; // publish again even if nothing changed
      await service.refreshDevices();
    }
  });

  // --- Commands (mode, camera on/off, siren) --------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    await service.setValue(device, feature, value);
  });

  // --- Camera image ---------------------------------------------------------
  gladys.onGetImage(async (device) => {
    logger.info(`onGetImage <- ${device.external_id}`);
    return service.getImage(device);
  });

  // --- Configuration screen actions ----------------------------------------
  gladys.onAction('send_code', async () => {
    if (!hasCredentials(config)) {
      return MESSAGES.NO_CREDENTIALS;
    }
    try {
      const result = await service.sendCode(config);
      return result.sent ? codeSent(result.destination) : MESSAGES.ALREADY_TRUSTED;
    } catch (err) {
      logger.error(`send_code failed: ${err.message}`);
      return arloFailed(err.message);
    }
  });

  gladys.onAction('verify_code', async (fields) => {
    if (!hasCredentials(config)) {
      return MESSAGES.NO_CREDENTIALS;
    }
    if (!service.auth.pending) {
      return MESSAGES.NO_PENDING_CODE;
    }
    try {
      await service.verifyCode(config, fields.code);
      return connectedWith(service.devices.length);
    } catch (err) {
      logger.error(`verify_code failed: ${err.message}`);
      return arloFailed(err.message);
    }
  });

  gladys.onAction('test_connection', async () => {
    if (!hasCredentials(config)) {
      return MESSAGES.NO_CREDENTIALS;
    }
    try {
      if (!service.connected) {
        await service.start(config);
      } else {
        await service.client.getSession();
        await service.refreshDevices();
      }
    } catch (err) {
      return arloFailed(err.message);
    }
    if (service.connected) {
      return connectedWith(service.devices.length);
    }
    return service.authState === AUTH_STATES.CODE_REQUIRED
      ? MESSAGES.CODE_REQUIRED
      : arloFailed(service.lastError);
  });

  // --- Scene actions --------------------------------------------------------
  for (const key of Object.keys(SCENE_ACTIONS)) {
    gladys.onSceneAction(SCENE_ACTIONS[key], (fields) =>
      SCENE_ACTION_HANDLERS[key](service, fields),
    );
  }

  // --- Dashboard widgets ----------------------------------------------------
  const widgets = createWidgets(service, gladys);
  gladys.onWidgetGet(WIDGET_KEYS.OVERVIEW, (request) => widgets[WIDGET_KEYS.OVERVIEW].get(request));
  gladys.onWidgetAction(WIDGET_KEYS.OVERVIEW, (actionKey, params, extra) =>
    widgets[WIDGET_KEYS.OVERVIEW].action({ actionKey, params, ...extra }),
  );
  gladys.onWidgetGet(WIDGET_KEYS.CAMERA, (request) => widgets[WIDGET_KEYS.CAMERA].get(request));
  gladys.onWidgetAction(WIDGET_KEYS.CAMERA, (actionKey, params, extra) =>
    widgets[WIDGET_KEYS.CAMERA].action({ actionKey, params, ...extra }),
  );
  gladys.onWidgetGetImage((key) => service.widgetImage(key));

  // --- Configuration updated ------------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    const previous = config;
    config = normalizeConfig(newConfig);
    applyLogLevel(config);
    const accountChanged = previous.email !== config.email || previous.password !== config.password;
    if (accountChanged || !service.connected) {
      await service.start(config);
    } else {
      service.config = config;
      service.scheduleLoop();
    }
    refreshWidgets(gladys);
  });

  // --- Connection lifecycle -------------------------------------------------
  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      applyLogLevel(config);
      if (service.connected) {
        // Gladys came back: Arlo never left. Publish again what it may have missed.
        service.discoveryKey = null;
        await service.refreshDevices();
        await service.reportStatus();
      } else {
        await service.start(config);
      }
      refreshWidgets(gladys);
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys.setConnectionStatus(false, MESSAGES.INIT_FAILED).catch(() => {});
    }
  });

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    service.stop();
  });

  return service;
}

// --- Startup ------------------------------------------------------------------
// Only when run as the program (`node index.js`), not when a test imports it.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const gladys = new GladysIntegration();
  setup(gladys);
  logger.info('Starting the Arlo integration...');
  gladys.connect().catch((err) => {
    logger.error('Initial connection failed', err);
    process.exit(1);
  });
}
