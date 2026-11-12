// -----------------------------------------------------------------------------
// The Arlo service: keeps Gladys in step with the Arlo cloud.
//
//   - login (stored session, or the two-step code flow of src/arlo/auth.js);
//   - the event stream (real time: motion, doorbell, battery, privacy, siren,
//     snapshot ready);
//   - a refresh loop every `refresh_interval` seconds: device list (new
//     pictures), active modes, recordings (smart detection: person, vehicle,
//     animal, package), and the "keep me subscribed" ping of the stream;
//   - the commands Gladys sends: mode, camera on/off, siren, snapshot.
//
// Rules that matter:
//   - one scene event per transition, and never one caused by a Gladys
//     command (a scene bound to it would loop through the integration);
//   - a token Arlo refuses ends everything until a new login: the
//     Configuration screen then asks for a code.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { OBJECT_KINDS, SCENE_TRIGGERS } from '../capabilities/scenes.js';
import {
  arloIdOf,
  buildDiscoveredDevices,
  featureKeyOf,
  FEATURES,
  idsOf,
} from '../devices/index.js';
import { MESSAGES, arloFailed } from '../messages.js';
import { AUTH_STATES } from './auth.js';
import { ArloApiError } from './client.js';
import { SNAPSHOT_TIMEOUT_MS } from './constants.js';
import { EventStream } from './events.js';
import { toCameraImage, toWidgetImage } from './image.js';
import {
  baseOf,
  findMode,
  hasBattery,
  hasSiren,
  isBase,
  isCamera,
  isDoorbell,
  isSupported,
  modeKind,
  modeLabel,
  modesOf,
} from './models.js';

const logger = createLogger({ name: 'arlo' });

/** A recording older than this when first seen raises no scene event. */
const RECORDING_FRESHNESS_MS = 15 * 60_000;
/** A recording this close to a motion the stream reported is the same motion. */
const SAME_MOTION_MS = 2 * 60_000;
/** Motion reported by a recording only: back to 0 after this. */
const RECORDING_MOTION_MS = 30_000;
/** Motion from the stream with no "stopped" event: back to 0 after this. */
const STREAM_MOTION_MAX_MS = 3 * 60_000;
/** A doorbell press is a pulse: back to 0 after this. */
const RING_PULSE_MS = 5_000;
/** A mode set from Gladys and seen again within this delay raises no event. */
const OWN_MODE_CHANGE_MS = 60_000;
/** Detections kept for the widget. */
const MAX_DETECTIONS = 20;

export const ERROR_STATE = 'error';

const objectKindOf = (category) => {
  const kind = String(category ?? '').toLowerCase();
  return OBJECT_KINDS.includes(kind) ? kind : null;
};

/** A number, or the fallback when the value is empty or not a number. */
const numberOr = (value, fallback) => {
  const number = value === null || value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const shortHash = (text) => createHash('sha1').update(String(text)).digest('hex').slice(0, 12);

export class ArloService {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {import('./client.js').ArloClient} options.client
   * @param {import('./auth.js').ArloAuth} options.auth
   * @param {() => void} [options.onChange] something the widgets show changed
   * @param {() => number} [options.now]
   * @param {typeof EventStream} [options.EventStreamClass] injected by the tests
   */
  constructor({
    gladys,
    client,
    auth,
    onChange = () => {},
    now = Date.now,
    EventStreamClass = EventStream,
  }) {
    this.gladys = gladys;
    this.client = client;
    this.auth = auth;
    this.onChange = onChange;
    this.now = now;
    this.config = null;
    this.authState = AUTH_STATES.NO_CREDENTIALS;
    this.lastError = null;

    this.devices = [];
    this.modes = new Map();
    this.activeModes = new Map();
    this.props = new Map();
    this.detections = [];
    this.seenRecordings = new Set();
    this.librarySeeded = false;
    this.lastStreamMotion = new Map();
    this.ownModeChanges = new Map();
    this.timers = new Map();
    this.snapshotWaiters = new Map();
    this.widgetImages = new Map();
    this.discoveryKey = null;
    this.loopTimer = null;
    this.ticking = false;

    this.stream = new EventStreamClass({
      client,
      onMessage: (message) => this.handleEvent(message),
      onStatus: (connected) => {
        logger.info(`Arlo event stream ${connected ? 'connected' : 'disconnected'}`);
        if (connected) {
          this.pingBases().catch((err) => logger.debug(`Ping failed: ${err.message}`));
        }
      },
      onAuthError: () => this.onAuthLost(),
    });
  }

  get connected() {
    return this.authState === AUTH_STATES.CONNECTED;
  }

  // --- Lifecycle --------------------------------------------------------------

  /**
   * (Re)start with a configuration: login, devices, stream, refresh loop.
   * @returns {Promise<string>} the login state
   */
  async start(config) {
    this.config = config;
    this.stopRunning();
    try {
      this.authState = await this.auth.connect(config);
      this.lastError = null;
    } catch (err) {
      this.authState = ERROR_STATE;
      this.lastError = err.message;
      logger.error(`Arlo login failed: ${err.message}`);
    }
    if (this.connected) {
      await this.onLoggedIn();
    } else {
      await this.reportStatus();
    }
    return this.authState;
  }

  /** Everything that follows a successful login. */
  async onLoggedIn() {
    this.authState = AUTH_STATES.CONNECTED;
    try {
      await this.refreshDevices();
      await this.refreshModes();
      await this.pollLibrary();
      this.lastError = null;
    } catch (err) {
      if (await this.handleFailure(err)) {
        return;
      }
    }
    this.stream.start();
    this.scheduleLoop();
    await this.reportStatus();
    this.onChange();
  }

  /** Stop the stream, the loop and the pending timers. */
  stopRunning() {
    this.stream.stop();
    clearTimeout(this.loopTimer);
    this.loopTimer = null;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const waiters of this.snapshotWaiters.values()) {
      for (const waiter of waiters) {
        waiter.reject(new Error('Stopped'));
      }
    }
    this.snapshotWaiters.clear();
  }

  stop() {
    this.stopRunning();
  }

  scheduleLoop() {
    clearTimeout(this.loopTimer);
    const seconds = this.config?.refresh_interval ?? 60;
    this.loopTimer = setTimeout(() => this.tick(), seconds * 1000);
    this.loopTimer.unref?.();
  }

  /** One refresh round, then the next one is scheduled. */
  async tick() {
    if (this.ticking || !this.connected) {
      return;
    }
    this.ticking = true;
    try {
      await this.refreshDevices();
      await this.refreshModes();
      await this.pollLibrary();
      await this.pingBases();
      if (this.lastError) {
        this.lastError = null;
        await this.reportStatus();
      }
    } catch (err) {
      if (await this.handleFailure(err)) {
        return;
      }
    } finally {
      this.ticking = false;
    }
    if (this.connected) {
      this.scheduleLoop();
    }
  }

  /**
   * A refused token stops everything (see onAuthLost); anything else is
   * reported and retried at the next round.
   * @returns {Promise<boolean>} true when the session was lost
   */
  async handleFailure(err) {
    if (err instanceof ArloApiError && err.isAuthError) {
      await this.onAuthLost();
      return true;
    }
    logger.error(`Arlo refresh failed: ${err.message}`);
    if (this.lastError !== err.message) {
      this.lastError = err.message;
      await this.reportStatus();
    }
    return false;
  }

  /** Arlo refused the token: try a login without code, else ask for one. */
  async onAuthLost() {
    if (this.authState !== AUTH_STATES.CONNECTED) {
      return;
    }
    logger.warn('Arlo refused the session: a new login is needed');
    this.stopRunning();
    this.authState = AUTH_STATES.CODE_REQUIRED;
    await this.auth.clear();
    // One silent re-login at most per minute: a token refused again right
    // after a login must not turn into a login loop.
    const now = this.now();
    if (this.config && (this.lastAuthLost === undefined || now - this.lastAuthLost > 60_000)) {
      this.lastAuthLost = now;
      await this.start(this.config);
      return;
    }
    await this.reportStatus();
  }

  /** The application-level status of the Configuration screen. */
  async reportStatus() {
    let connected = false;
    let message;
    if (this.connected) {
      connected = !this.lastError;
      message = this.lastError ? arloFailed(this.lastError) : undefined;
    } else if (this.authState === AUTH_STATES.CODE_REQUIRED) {
      message = MESSAGES.CODE_REQUIRED;
    } else if (this.authState === AUTH_STATES.NO_CREDENTIALS) {
      message = MESSAGES.NO_CREDENTIALS;
    } else {
      message = arloFailed(this.lastError);
    }
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.warn(`Cannot report the connection status: ${err.message}`);
    }
  }

  // --- Code flow (Configuration screen actions) -----------------------------

  async sendCode(config) {
    this.config = config;
    const result = await this.auth.sendCode(config);
    if (!result.sent) {
      this.stopRunning();
      await this.onLoggedIn();
    } else {
      this.authState = AUTH_STATES.CODE_REQUIRED;
    }
    return result;
  }

  async verifyCode(config, code) {
    this.config = config;
    await this.auth.verifyCode(config, code);
    this.stopRunning();
    await this.onLoggedIn();
  }

  // --- Reading the cloud ------------------------------------------------------

  deviceById(deviceId) {
    return this.devices.find((device) => device.deviceId === deviceId) ?? null;
  }

  deviceByExternalId(externalId) {
    return this.deviceById(arloIdOf(this.gladys, externalId));
  }

  propsOf(deviceId) {
    if (!this.props.has(deviceId)) {
      this.props.set(deviceId, {});
    }
    return this.props.get(deviceId);
  }

  /** Device list + mode definitions; publishes the discovery when it changed. */
  async refreshDevices() {
    const list = await this.client.getDevices();
    this.devices = list.filter(isSupported);
    let definitions = {};
    try {
      definitions = await this.client.getModeDefinitions();
    } catch (err) {
      if (err instanceof ArloApiError && err.isAuthError) {
        throw err;
      }
      logger.warn(`Cannot read the Arlo modes: ${err.message}`);
    }
    for (const base of this.devices.filter(isBase)) {
      this.modes.set(base.deviceId, modesOf(definitions, base));
    }

    const discovered = buildDiscoveredDevices(this.gladys, this.devices, this.modes);
    const key = JSON.stringify(discovered);
    if (key !== this.discoveryKey) {
      await this.gladys.publishDiscoveredDevices(discovered);
      this.discoveryKey = key;
      logger.info(`${discovered.length} Arlo device(s) published to the Discovery tab`);
      await this.publishTransports();
    }

    for (const device of this.devices) {
      // Some models report their battery and privacy in the device list too.
      const properties = device.properties ?? {};
      this.applyProperties(device.deviceId, {
        ...(properties.batteryLevel !== undefined ? { batteryLevel: properties.batteryLevel } : {}),
        ...(typeof properties.privacyActive === 'boolean'
          ? { privacyActive: properties.privacyActive }
          : {}),
      });
      if (isCamera(device)) {
        await this.refreshLastImage(device);
      }
    }
  }

  /** Publish the picture Arlo keeps for a camera, when it is a new one. */
  async refreshLastImage(camera) {
    const props = this.propsOf(camera.deviceId);
    const url = camera.presignedLastImageUrl;
    const stamp = camera.lastImageUploaded ?? url;
    if (!url || stamp === props.imageStamp) {
      return;
    }
    props.imageStamp = stamp;
    props.imageUrl = url;
    props.imageAt = this.now();
    try {
      const image = toCameraImage(await this.client.downloadImage(url));
      await this.gladys.publishCameraImage(idsOf(this.gladys, camera).device, image);
      this.onChange();
    } catch (err) {
      logger.warn(`Cannot publish the picture of ${camera.deviceName}: ${err.message}`);
    }
  }

  async refreshModes() {
    const entries = await this.client.getActiveModes();
    for (const entry of entries) {
      const base = this.devices.find(
        (device) =>
          isBase(device) &&
          (device.uniqueId === entry.uniqueId ||
            device.deviceId === entry.gatewayId ||
            device.deviceId === entry.deviceId),
      );
      const modeId = Array.isArray(entry.activeModes) ? entry.activeModes[0] : null;
      if (base && modeId) {
        await this.applyMode(base, modeId);
      }
    }
  }

  /**
   * Keep the base subscribed to the stream, and ask it for the camera
   * properties (battery...): the answers arrive on the stream.
   */
  async pingBases() {
    if (!this.stream.connected) {
      return;
    }
    for (const base of this.devices.filter(isBase)) {
      try {
        await this.client.notify(base, {
          action: 'set',
          resource: `subscriptions/${this.client.webClientId}`,
          publishResponse: false,
          properties: { devices: [base.deviceId] },
        });
        await this.client.notify(base, {
          action: 'get',
          resource: 'cameras',
          publishResponse: false,
        });
      } catch (err) {
        if (err instanceof ArloApiError && err.isAuthError) {
          throw err;
        }
        logger.debug(`Ping of ${base.deviceName} failed: ${err.message}`);
      }
    }
  }

  /** New recordings since the last round: motion fallback and smart detection. */
  async pollLibrary() {
    const now = this.now();
    const recordings = await this.client.getLibrary(new Date(now - 24 * 3600_000), new Date(now));
    const fresh = [];
    for (const recording of recordings) {
      const id = recording.name ?? `${recording.deviceId}:${recording.utcCreatedDate}`;
      if (this.seenRecordings.has(id)) {
        continue;
      }
      this.seenRecordings.add(id);
      fresh.push({ id, recording });
    }
    if (this.seenRecordings.size > 2000) {
      this.seenRecordings = new Set(fresh.map((entry) => entry.id));
    }
    // Oldest first, so the events and the widget keep the real order.
    fresh.sort((a, b) => this.recordedAt(a.recording) - this.recordedAt(b.recording));
    for (const { id, recording } of fresh) {
      await this.handleRecording(id, recording, { silent: !this.librarySeeded });
    }
    this.librarySeeded = true;
    if (fresh.length > 0) {
      this.onChange();
    }
  }

  recordedAt(recording) {
    const at = Number(recording.utcCreatedDate ?? recording.createdDate);
    return Number.isFinite(at) && at > 0 ? at : this.now();
  }

  async handleRecording(id, recording, { silent }) {
    const camera = this.deviceById(recording.deviceId);
    if (!camera) {
      return;
    }
    const at = this.recordedAt(recording);
    const kind = objectKindOf(recording.objCategory);
    this.detections.unshift({
      id,
      deviceId: camera.deviceId,
      at,
      kind,
      reason: String(recording.reason ?? ''),
      thumbnailUrl: recording.presignedThumbnailUrl ?? null,
      duration: Number(recording.mediaDurationSecond) || null,
    });
    this.detections.sort((a, b) => b.at - a.at);
    this.detections.length = Math.min(this.detections.length, MAX_DETECTIONS);

    if (silent || this.now() - at > RECORDING_FRESHNESS_MS) {
      return;
    }
    const external = idsOf(this.gladys, camera).device;
    const lastStream = this.lastStreamMotion.get(camera.deviceId);
    if (lastStream === undefined || Math.abs(at - lastStream) > SAME_MOTION_MS) {
      // The stream did not report this motion (or this account gets no
      // stream): the recording is the proof of it.
      await this.publishFeature(camera, FEATURES.MOTION, 1);
      this.pulse(`motion:${camera.deviceId}`, RECORDING_MOTION_MS, () =>
        this.publishFeature(camera, FEATURES.MOTION, 0),
      );
      await this.fireSceneEvent(SCENE_TRIGGERS.MOTION_DETECTED, { device: external });
    }
    if (kind) {
      await this.fireSceneEvent(SCENE_TRIGGERS.OBJECT_DETECTED, { device: external, object: kind });
    }
  }

  // --- Events (stream) --------------------------------------------------------

  handleEvent(message) {
    logger.debug(`Arlo event: ${JSON.stringify(message).slice(0, 500)}`);
    if (message.action === 'logout') {
      this.onAuthLost().catch((err) => logger.error('Re-login failed', err));
      return;
    }
    const resource = String(message.resource ?? '');
    const properties = message.properties;

    if (resource === 'activeAutomations' || resource.startsWith('automation')) {
      this.handleAutomation(message);
      return;
    }
    if (resource === 'modes' && properties?.active) {
      const base = this.deviceById(message.from);
      if (base) {
        this.applyMode(base, properties.active).catch((err) => logger.error('Mode update', err));
      }
      return;
    }
    if (resource === 'cameras' && Array.isArray(properties)) {
      for (const entry of properties) {
        this.applyProperties(entry?.serialNumber, entry);
      }
      return;
    }
    if (resource === 'siren') {
      this.applyProperties(message.from, properties);
      return;
    }
    const match = /^(cameras|doorbells|siren|sirens|basestations?)\/(.+)$/.exec(resource);
    if (match) {
      this.applyProperties(match[2], properties);
    }
  }

  /** `{ resource: 'activeAutomations', <deviceId>: { activeModes: [...] } }` */
  handleAutomation(message) {
    const candidates = { ...message, ...(message.properties ?? {}) };
    for (const [key, value] of Object.entries(candidates)) {
      if (!value || typeof value !== 'object' || !Array.isArray(value.activeModes)) {
        continue;
      }
      const base =
        this.deviceById(key) ??
        this.devices.find(
          (device) => device.uniqueId === key || device.deviceId === value.deviceId,
        );
      if (base && value.activeModes[0]) {
        this.applyMode(base, value.activeModes[0]).catch((err) => logger.error('Mode update', err));
      }
    }
  }

  /** Apply the properties Arlo reports for one device. */
  applyProperties(deviceId, properties) {
    const device = this.deviceById(deviceId);
    if (!device || !properties || typeof properties !== 'object') {
      return;
    }
    const run = (promise) => promise.catch((err) => logger.error('State update failed', err));

    if (properties.batteryLevel !== undefined && hasBattery(device)) {
      const level = Math.round(Number(properties.batteryLevel));
      if (Number.isFinite(level)) {
        run(this.publishFeature(device, FEATURES.BATTERY, Math.max(0, Math.min(100, level))));
      }
    }
    if (typeof properties.privacyActive === 'boolean' && isCamera(device)) {
      run(this.publishFeature(device, FEATURES.ENABLED, properties.privacyActive ? 0 : 1));
    }
    if (properties.sirenState !== undefined && hasSiren(device)) {
      run(this.publishFeature(device, FEATURES.SIREN, properties.sirenState === 'on' ? 1 : 0));
    }
    if (typeof properties.motionDetected === 'boolean' && isCamera(device)) {
      run(this.onStreamMotion(device, properties.motionDetected));
    }
    if (properties.buttonPressed === true && isDoorbell(device)) {
      run(this.onRing(device));
    }
    if (typeof properties.connectionState === 'string') {
      const props = this.propsOf(device.deviceId);
      const reachable = properties.connectionState !== 'unavailable';
      if (props.reachable !== reachable) {
        props.reachable = reachable;
        run(this.publishTransports());
      }
    }
    const snapshotUrl = properties.presignedFullFrameSnapshotUrl;
    if (snapshotUrl) {
      this.resolveSnapshot(device.deviceId, snapshotUrl);
    }
    if (properties.presignedLastImageUrl && isCamera(device)) {
      run(
        this.refreshLastImage({
          ...device,
          presignedLastImageUrl: properties.presignedLastImageUrl,
        }),
      );
    }
  }

  async onStreamMotion(camera, detected) {
    const key = `motion:${camera.deviceId}`;
    if (!detected) {
      this.cancelPulse(key);
      await this.publishFeature(camera, FEATURES.MOTION, 0);
      return;
    }
    const wasOn = this.propsOf(camera.deviceId)[FEATURES.MOTION] === 1;
    this.lastStreamMotion.set(camera.deviceId, this.now());
    this.pulse(key, STREAM_MOTION_MAX_MS, () => this.publishFeature(camera, FEATURES.MOTION, 0));
    if (wasOn) {
      return;
    }
    await this.publishFeature(camera, FEATURES.MOTION, 1);
    await this.fireSceneEvent(SCENE_TRIGGERS.MOTION_DETECTED, {
      device: idsOf(this.gladys, camera).device,
    });
  }

  async onRing(doorbell) {
    const key = `ring:${doorbell.deviceId}`;
    if (this.timers.has(key)) {
      return; // the same press, reported twice
    }
    this.pulse(key, RING_PULSE_MS, () => this.publishFeature(doorbell, FEATURES.RING, 0));
    await this.publishFeature(doorbell, FEATURES.RING, 1);
    await this.fireSceneEvent(SCENE_TRIGGERS.DOORBELL_PRESSED, {
      device: idsOf(this.gladys, doorbell).device,
    });
  }

  /** Record and publish the active mode of a base; fires `mode_changed`. */
  async applyMode(base, modeId) {
    const previous = this.activeModes.get(base.deviceId);
    if (previous === modeId) {
      return;
    }
    this.activeModes.set(base.deviceId, modeId);
    await this.gladys.publishState(idsOf(this.gladys, base).feature(FEATURES.MODE), {
      text: modeId,
    });
    this.onChange();
    const own = this.ownModeChanges.get(base.deviceId);
    this.ownModeChanges.delete(base.deviceId);
    if (previous === undefined || (own && own.modeId === modeId && own.until > this.now())) {
      return; // first reading, or Gladys asked for it: not an event
    }
    const mode = (this.modes.get(base.deviceId) ?? []).find((entry) => entry.id === modeId);
    await this.fireSceneEvent(SCENE_TRIGGERS.MODE_CHANGED, {
      device: idsOf(this.gladys, base).device,
      mode: modeKind(modeId),
      mode_name: modeLabel(mode ?? { id: modeId }),
    });
  }

  // --- Publishing helpers -----------------------------------------------------

  /** Publish one feature state when it changed. */
  async publishFeature(device, featureKey, value) {
    const props = this.propsOf(device.deviceId);
    if (props[featureKey] === value) {
      return;
    }
    props[featureKey] = value;
    await this.gladys.publishState(idsOf(this.gladys, device).feature(featureKey), value);
    if (featureKey !== FEATURES.MOTION && featureKey !== FEATURES.RING) {
      this.onChange();
    }
  }

  async fireSceneEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  async publishTransports() {
    const entries = this.devices.map((device) => ({
      external_id: idsOf(this.gladys, device).device,
      transport:
        this.propsOf(device.deviceId).reachable === false
          ? DEVICE_TRANSPORTS.UNREACHABLE
          : DEVICE_TRANSPORTS.CLOUD,
    }));
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  pulse(key, delay, done) {
    this.cancelPulse(key);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      Promise.resolve(done()).catch((err) => logger.error('State reset failed', err));
    }, delay);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  cancelPulse(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  // --- Commands ---------------------------------------------------------------

  requireDevice(externalId) {
    const device = this.deviceByExternalId(externalId);
    if (!device) {
      throw new Error(`Unknown Arlo device: ${externalId}`);
    }
    return device;
  }

  /** Gladys sets a feature value (onSetValue). */
  async setValue(gladysDevice, feature, value) {
    const device = this.requireDevice(gladysDevice.external_id);
    switch (featureKeyOf(feature.external_id)) {
      case FEATURES.MODE:
        await this.setMode(device, value);
        return;
      case FEATURES.ENABLED:
        await this.setCameraOn(device, Number(value) === 1);
        return;
      case FEATURES.SIREN:
        if (Number(value) === 1) {
          await this.soundSiren(device);
        } else {
          await this.stopSiren(device);
        }
        return;
      default:
        throw new Error(`Read-only feature: ${feature.external_id}`);
    }
  }

  /**
   * Switch a base to a mode: its id, its kind (armed/disarmed) or its name.
   * @returns {Promise<{ changed: boolean, modeName: string }>}
   */
  async setMode(device, wanted) {
    const base = baseOf(device, this.devices);
    if (!isBase(base)) {
      throw new Error(`${device.deviceName} has no Arlo mode`);
    }
    const modes = this.modes.get(base.deviceId) ?? modesOf({}, base);
    const mode = findMode(modes, wanted);
    if (!mode) {
      throw new Error(`Unknown Arlo mode "${wanted}"`);
    }
    const modeName = modeLabel(mode);
    if (this.activeModes.get(base.deviceId) === mode.id) {
      return { changed: false, modeName };
    }
    this.ownModeChanges.set(base.deviceId, {
      modeId: mode.id,
      until: this.now() + OWN_MODE_CHANGE_MS,
    });
    await this.client.setActiveMode(base, mode.id);
    await this.applyMode(base, mode.id);
    logger.info(`${base.deviceName}: mode set to ${modeName}`);
    return { changed: true, modeName };
  }

  /** Arlo privacy mode: a camera off neither detects nor records. */
  async setCameraOn(camera, on) {
    if (!isCamera(camera)) {
      throw new Error(`${camera.deviceName} is not a camera`);
    }
    await this.client.notify(baseOf(camera, this.devices), {
      action: 'set',
      resource: `cameras/${camera.deviceId}`,
      properties: { privacyActive: !on },
    });
    await this.publishFeature(camera, FEATURES.ENABLED, on ? 1 : 0);
  }

  sirenTarget(device) {
    const base = baseOf(device, this.devices);
    const resource = device === base ? 'siren' : `siren/${device.deviceId}`;
    return { base, resource };
  }

  /**
   * @param {object} device
   * @param {{ duration?: number, volume?: number }} [options] seconds, 1-8
   */
  async soundSiren(device, { duration = 60, volume = 8 } = {}) {
    if (!hasSiren(device)) {
      throw new Error(`${device.deviceName} has no siren`);
    }
    const seconds = Math.max(5, Math.min(300, Math.round(numberOr(duration, 60))));
    const level = Math.max(1, Math.min(8, Math.round(numberOr(volume, 8))));
    const { base, resource } = this.sirenTarget(device);
    await this.client.notify(base, {
      action: 'set',
      resource,
      properties: {
        sirenState: 'on',
        duration: seconds,
        volume: level,
        pattern: 'alarm',
        sirenTrigger: 'manual',
      },
    });
    await this.publishFeature(device, FEATURES.SIREN, 1);
    // Arlo stops it by itself; the stream says so, this is the fallback.
    this.pulse(`siren:${device.deviceId}`, seconds * 1000, () =>
      this.publishFeature(device, FEATURES.SIREN, 0),
    );
  }

  async stopSiren(device) {
    if (!hasSiren(device)) {
      throw new Error(`${device.deviceName} has no siren`);
    }
    const { base, resource } = this.sirenTarget(device);
    await this.client.notify(base, { action: 'set', resource, properties: { sirenState: 'off' } });
    this.cancelPulse(`siren:${device.deviceId}`);
    await this.publishFeature(device, FEATURES.SIREN, 0);
  }

  waitSnapshot(deviceId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const list = this.snapshotWaiters.get(deviceId) ?? [];
      list.push(waiter);
      this.snapshotWaiters.set(deviceId, list);
      const timer = setTimeout(() => {
        const current = this.snapshotWaiters.get(deviceId) ?? [];
        this.snapshotWaiters.set(
          deviceId,
          current.filter((entry) => entry !== waiter),
        );
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      waiter.resolve = (url) => {
        clearTimeout(timer);
        resolve(url);
      };
    });
  }

  resolveSnapshot(deviceId, url) {
    const waiters = this.snapshotWaiters.get(deviceId) ?? [];
    this.snapshotWaiters.delete(deviceId);
    for (const waiter of waiters) {
      waiter.resolve(url);
    }
    if (waiters.length === 0) {
      // A snapshot someone else asked for (the Arlo app): show it too.
      const camera = this.deviceById(deviceId);
      if (camera) {
        this.publishImageFromUrl(camera, url).catch((err) =>
          logger.warn(`Cannot publish the snapshot: ${err.message}`),
        );
      }
    }
  }

  async publishImageFromUrl(camera, url) {
    const image = toCameraImage(await this.client.downloadImage(url));
    await this.gladys.publishCameraImage(idsOf(this.gladys, camera).device, image);
    return image;
  }

  /**
   * Have the camera take a new picture, publish it and resolve it. Without
   * the stream the URL never comes as an event: the device list is read again
   * after a short wait instead.
   * @returns {Promise<string>} `image/jpg;base64,...`
   */
  async takeSnapshot(camera) {
    if (!isCamera(camera)) {
      throw new Error(`${camera.deviceName} is not a camera`);
    }
    const timeout = this.stream.connected ? SNAPSHOT_TIMEOUT_MS : 4_000;
    const waiting = this.waitSnapshot(camera.deviceId, timeout);
    await this.client.requestSnapshot(camera, baseOf(camera, this.devices));
    let url = await waiting;
    if (!url) {
      const fresh = (await this.client.getDevices()).find((d) => d.deviceId === camera.deviceId);
      url = fresh?.presignedFullFrameSnapshotUrl ?? fresh?.presignedLastImageUrl;
    }
    if (!url) {
      throw new Error(`${camera.deviceName} sent no picture`);
    }
    const image = await this.publishImageFromUrl(camera, url);
    this.onChange();
    return image;
  }

  /** Gladys wants an image now (onGetImage). */
  async getImage(gladysDevice) {
    const camera = this.requireDevice(gladysDevice.external_id);
    if (this.config?.live_snapshot) {
      return this.takeSnapshot(camera);
    }
    const url = this.propsOf(camera.deviceId).imageUrl ?? camera.presignedLastImageUrl;
    if (!url) {
      return this.takeSnapshot(camera);
    }
    return toCameraImage(await this.client.downloadImage(url));
  }

  // --- Entry points of the scene actions and widgets ---------------------------

  async setModeByExternalId(externalId, wanted) {
    return this.setMode(this.requireDevice(externalId), wanted);
  }

  async takeSnapshotByExternalId(externalId) {
    const device = this.deviceByExternalId(externalId);
    if (!device || !isCamera(device)) {
      return false;
    }
    await this.takeSnapshot(device);
    return true;
  }

  async soundSirenByExternalId(externalId, options) {
    const device = this.deviceByExternalId(externalId);
    if (!device || !hasSiren(device)) {
      return false;
    }
    await this.soundSiren(device, options);
    return true;
  }

  /** Set every base to a mode kind (armed / disarmed). */
  async setAllModes(wanted) {
    let changed = 0;
    for (const base of this.devices.filter(isBase)) {
      const result = await this.setMode(base, wanted);
      changed += result.changed ? 1 : 0;
    }
    return changed;
  }

  /**
   * A stable widget image key for a picture URL; the URL is remembered so
   * `widgetImage(key)` can serve it.
   */
  widgetImageKey(prefix, id, stamp) {
    const key = `${prefix}-${shortHash(`${id}|${stamp}`)}`;
    return key;
  }

  rememberWidgetImage(key, url) {
    this.widgetImages.set(key, url);
    if (this.widgetImages.size > 100) {
      const [oldest] = this.widgetImages.keys();
      this.widgetImages.delete(oldest);
    }
  }

  /** Raw base64 of a widget image key (onWidgetGetImage). */
  async widgetImage(key) {
    const url = this.widgetImages.get(key);
    if (!url) {
      throw new Error(`Unknown image: ${key}`);
    }
    return toWidgetImage(await this.client.downloadImage(url));
  }
}
