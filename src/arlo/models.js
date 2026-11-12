// -----------------------------------------------------------------------------
// What an Arlo device is, read from the cloud device list.
//
// Arlo has no capability list per device: the `deviceType` and the `modelId`
// say what it can do. A "base" holds the modes (Disarmed, Armed, custom ones)
// and relays the commands: a hub (basestation), or a Wi-Fi camera / doorbell
// that is its own base (`parentId` equal to its own id).
// -----------------------------------------------------------------------------

import { ARLO_DEVICE_TYPES, BUILTIN_MODES } from './constants.js';

const CAMERA_TYPES = [
  ARLO_DEVICE_TYPES.CAMERA,
  ARLO_DEVICE_TYPES.ARLO_Q,
  ARLO_DEVICE_TYPES.ARLO_QS,
];

/** Wired cameras: no battery to report. */
const WIRED_TYPES = [ARLO_DEVICE_TYPES.ARLO_Q, ARLO_DEVICE_TYPES.ARLO_QS];

const typeOf = (device) => String(device?.deviceType ?? '').toLowerCase();
const modelOf = (device) => String(device?.modelId ?? '').toUpperCase();

/** A doorbell that films (Arlo Video Doorbell: AVD...). */
export function isVideoDoorbell(device) {
  return typeOf(device) === ARLO_DEVICE_TYPES.DOORBELL && modelOf(device).startsWith('AVD');
}

export function isDoorbell(device) {
  return typeOf(device) === ARLO_DEVICE_TYPES.DOORBELL;
}

export function isCamera(device) {
  return CAMERA_TYPES.includes(typeOf(device)) || isVideoDoorbell(device);
}

/** Holds the modes: a hub, or a device that is its own base. */
export function isBase(device) {
  if (typeOf(device) === ARLO_DEVICE_TYPES.BASE_STATION) {
    return true;
  }
  if (!isCamera(device) && !isDoorbell(device)) {
    return false;
  }
  return !device.parentId || device.parentId === device.deviceId;
}

export function hasBattery(device) {
  return (isCamera(device) || isDoorbell(device)) && !WIRED_TYPES.includes(typeOf(device));
}

/**
 * Has a siren Gladys can sound: the Arlo siren, the Pro hubs (VMB4xxx,
 * VMB5xxx) and the Wi-Fi cameras with a built-in one (Pro 3 and later, Ultra)
 * when they are their own base.
 */
export function hasSiren(device) {
  const type = typeOf(device);
  const model = modelOf(device);
  if (type === ARLO_DEVICE_TYPES.SIREN) {
    return true;
  }
  if (type === ARLO_DEVICE_TYPES.BASE_STATION) {
    return /^VMB[45]/.test(model);
  }
  return isCamera(device) && isBase(device) && /^VMC[45]/.test(model);
}

/** Whether Gladys gets this device at all. */
export function isSupported(device) {
  return (
    Boolean(device?.deviceId) &&
    (isBase(device) || isCamera(device) || isDoorbell(device) || hasSiren(device))
  );
}

/** The base that relays the commands of a device (the device itself for a base). */
export function baseOf(device, devices) {
  if (isBase(device)) {
    return device;
  }
  return devices.find((candidate) => candidate.deviceId === device.parentId) ?? device;
}

/** The kind of a mode, for the scene filters: armed, disarmed or custom. */
export function modeKind(modeId) {
  return BUILTIN_MODES[modeId] ?? 'custom';
}

const BUILTIN_MODE_LABELS = {
  disarmed: { en: 'Disarmed', fr: 'Désarmé', de: 'Deaktiviert', es: 'Desarmado' },
  armed: { en: 'Armed', fr: 'Armé', de: 'Aktiviert', es: 'Armado' },
};

/**
 * The name of a mode: the one the user gave it in the Arlo app, else the
 * built-in name of mode0 / mode1.
 */
export function modeLabel(mode, language = 'en') {
  const name = String(mode?.name ?? '').trim();
  if (name) {
    return name;
  }
  const builtin = BUILTIN_MODE_LABELS[BUILTIN_MODES[mode?.id]];
  return builtin ? (builtin[language] ?? builtin.en) : String(mode?.id ?? '');
}

/**
 * The modes of a base from the automation definitions, the two built-in ones
 * at least.
 * @param {object} definitions `{ <uniqueId>: { modes: [...] } }`
 * @param {object} base an Arlo device
 * @returns {Array<{ id: string, name: string }>}
 */
export function modesOf(definitions, base) {
  const entry = definitions?.[base.uniqueId] ?? definitions?.[base.deviceId];
  const modes = Array.isArray(entry?.modes) ? entry.modes : [];
  const list = modes
    .filter((mode) => mode && typeof mode.id === 'string')
    .map((mode) => ({ id: mode.id, name: String(mode.name ?? '') }));
  for (const id of Object.keys(BUILTIN_MODES)) {
    if (!list.some((mode) => mode.id === id)) {
      list.push({ id, name: '' });
    }
  }
  return list.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/**
 * Find the mode a user means: its id (`mode2`), its kind (`armed`,
 * `disarmed`) or its name, any case.
 */
export function findMode(modes, wanted) {
  const text = String(wanted ?? '')
    .trim()
    .toLowerCase();
  if (!text) {
    return null;
  }
  return (
    modes.find((mode) => mode.id.toLowerCase() === text) ??
    modes.find((mode) => BUILTIN_MODES[mode.id] === text) ??
    modes.find((mode) => mode.name.trim().toLowerCase() === text) ??
    modes.find((mode) =>
      Object.values(BUILTIN_MODE_LABELS[BUILTIN_MODES[mode.id]] ?? {}).some(
        (label) => label.toLowerCase() === text,
      ),
    ) ??
    null
  );
}
