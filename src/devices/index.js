// -----------------------------------------------------------------------------
// Arlo devices -> Gladys devices.
//
// One Gladys device per Arlo device, its features chosen from what the device
// is (see src/arlo/models.js):
//
//   camera / video doorbell  image, camera on/off (Arlo privacy), motion, battery
//   doorbell                 ring (+ battery)
//   base (hub or Wi-Fi cam)  Arlo mode (dynamic select of the base's modes)
//   siren-capable            siren on/off
//
// External ids are `ext:<selector>:arlo:<Arlo deviceId>[:<feature>]`. The
// Arlo deviceId is the serial number and never changes; the type part is the
// same for every device on purpose, so that a classification that improves
// later never renames a device. Ids are forever: never change them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  hasBattery,
  hasSiren,
  isBase,
  isCamera,
  isDoorbell,
  isSupported,
  modeLabel,
} from '../arlo/models.js';

/** Device part of the external ids. */
export const DEVICE_TYPE = 'arlo';

/** Feature keys (last part of the feature external ids). */
export const FEATURES = {
  IMAGE: 'image',
  ENABLED: 'enabled',
  MOTION: 'motion',
  BATTERY: 'battery',
  MODE: 'mode',
  SIREN: 'siren',
  RING: 'ring',
};

/** External ids of one Arlo device. */
export function idsOf(gladys, arloDevice) {
  return gladys.externalIds(DEVICE_TYPE, arloDevice.deviceId);
}

/** The Arlo deviceId behind a Gladys device or feature external id. */
export function arloIdOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  const text = String(externalId ?? '');
  if (!text.startsWith(prefix)) {
    return null;
  }
  return text.slice(prefix.length).split(':')[0] || null;
}

/** The feature key of a feature external id (`mode`, `siren`...). */
export function featureKeyOf(externalId) {
  const parts = String(externalId ?? '').split(':');
  return parts[parts.length - 1];
}

const binary = { min: 0, max: 1 };

/**
 * The discovery payload of one Arlo device.
 * @param {object} gladys
 * @param {object} arloDevice entry of the Arlo device list
 * @param {Array<{ id: string, name: string }>} [modes] the modes, for a base
 */
export function buildDevice(gladys, arloDevice, modes = []) {
  const ids = idsOf(gladys, arloDevice);
  const features = [];

  if (isCamera(arloDevice)) {
    features.push(
      {
        name: 'Image',
        external_id: ids.feature(FEATURES.IMAGE),
        category: DEVICE_FEATURE_CATEGORIES.CAMERA,
        type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
        read_only: true,
        has_feedback: false,
        keep_history: false,
        min: 0,
        max: 0,
      },
      {
        // The Arlo privacy mode: 0 turns the camera off (no detection, no
        // recording), 1 turns it back on.
        name: 'Camera on',
        external_id: ids.feature(FEATURES.ENABLED),
        category: DEVICE_FEATURE_CATEGORIES.CAMERA,
        type: DEVICE_FEATURE_TYPES.CAMERA.ENABLED,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        ...binary,
      },
      {
        name: 'Motion',
        external_id: ids.feature(FEATURES.MOTION),
        category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        ...binary,
      },
    );
  }

  if (isDoorbell(arloDevice)) {
    features.push({
      name: 'Ring',
      external_id: ids.feature(FEATURES.RING),
      category: DEVICE_FEATURE_CATEGORIES.DOORBELL,
      type: DEVICE_FEATURE_TYPES.DOORBELL.RING,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...binary,
    });
  }

  if (hasBattery(arloDevice)) {
    features.push({
      name: 'Battery',
      external_id: ids.feature(FEATURES.BATTERY),
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 100,
    });
  }

  if (isBase(arloDevice)) {
    features.push({
      name: 'Arlo mode',
      external_id: ids.feature(FEATURES.MODE),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 0,
      supported_options: modes.map((mode, index) => ({
        value: mode.id,
        label: modeLabel(mode),
        sort_order: index,
      })),
    });
  }

  if (hasSiren(arloDevice)) {
    features.push({
      name: 'Siren',
      external_id: ids.feature(FEATURES.SIREN),
      category: DEVICE_FEATURE_CATEGORIES.SIREN,
      type: DEVICE_FEATURE_TYPES.SIREN.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      ...binary,
    });
  }

  return {
    name: String(arloDevice.deviceName || arloDevice.modelId || arloDevice.deviceId),
    external_id: ids.device,
    features,
    params: [
      { name: 'arlo_model', value: String(arloDevice.modelId ?? '') },
      { name: 'arlo_type', value: String(arloDevice.deviceType ?? '') },
    ],
  };
}

/**
 * The discovery payload of every supported Arlo device.
 * @param {object} gladys
 * @param {object[]} arloDevices the Arlo device list
 * @param {Map<string, Array<{ id: string, name: string }>>} modesByBase
 */
export function buildDiscoveredDevices(gladys, arloDevices, modesByBase = new Map()) {
  return arloDevices
    .filter(isSupported)
    .map((device) => buildDevice(gladys, device, modesByBase.get(device.deviceId) ?? []))
    .filter((device) => device.features.length > 0);
}
