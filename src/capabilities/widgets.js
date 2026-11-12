// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+).
//
//   arlo_overview  every base's mode, every camera's battery, the latest
//                  recordings (with their thumbnail), "Arm all" / "Disarm all"
//   arlo_camera    one camera: its latest picture, live battery and motion
//                  tiles, its state, "Take a snapshot" and on/off buttons
//
// The contents are declarative (the core renders them, no HTML). Pictures are
// served by `onWidgetGetImage` from keys: a key changes when the picture
// changes, the core caches an image one hour by key.
//
// Widget and button keys are stored by the users' dashboards: never rename.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURES, idsOf } from '../devices/index.js';
import { localize, pick } from '../i18n.js';
import { hasBattery, isBase, isCamera, modeKind, modeLabel } from '../arlo/models.js';

const logger = createLogger({ name: 'widgets' });

export const WIDGET_KEYS = {
  OVERVIEW: 'arlo_overview',
  CAMERA: 'arlo_camera',
};

export const WIDGET_ACTIONS = {
  ARM_ALL: 'arm_all',
  DISARM_ALL: 'disarm_all',
  SNAPSHOT: 'snapshot',
};

const KIND_LABELS = {
  person: { en: 'Person', fr: 'Personne', de: 'Person', es: 'Persona' },
  vehicle: { en: 'Vehicle', fr: 'Véhicule', de: 'Fahrzeug', es: 'Vehículo' },
  animal: { en: 'Animal', fr: 'Animal', de: 'Tier', es: 'Animal' },
  package: { en: 'Package', fr: 'Colis', de: 'Paket', es: 'Paquete' },
  motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  audio: { en: 'Sound', fr: 'Son', de: 'Geräusch', es: 'Sonido' },
};

const KIND_COLORS = {
  person: WIDGET_COLORS.WARNING,
  vehicle: WIDGET_COLORS.INFO,
  animal: WIDGET_COLORS.SUCCESS,
  package: WIDGET_COLORS.PRIMARY,
};

const MODE_COLORS = {
  armed: WIDGET_COLORS.SUCCESS,
  disarmed: WIDGET_COLORS.NEUTRAL,
  custom: WIDGET_COLORS.INFO,
};

const T = {
  battery: { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
  motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  mode: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  camera: { en: 'Camera', fr: 'Caméra', de: 'Kamera', es: 'Cámara' },
  on: { en: 'On', fr: 'Allumée', de: 'An', es: 'Encendida' },
  off: { en: 'Off (privacy)', fr: 'Éteinte (privée)', de: 'Aus (Privat)', es: 'Apagada (privada)' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  lastDetection: {
    en: 'Last recording',
    fr: 'Dernier enregistrement',
    de: 'Letzte Aufnahme',
    es: 'Última grabación',
  },
  none: { en: 'None today', fr: 'Aucun aujourd’hui', de: 'Heute keine', es: 'Ninguna hoy' },
  noRecording: {
    en: 'No recording in the last 24 hours.',
    fr: 'Aucun enregistrement depuis 24 heures.',
    de: 'Keine Aufnahme in den letzten 24 Stunden.',
    es: 'Ninguna grabación en las últimas 24 horas.',
  },
  notConnected: {
    en: 'Not connected to Arlo: see the integration configuration.',
    fr: 'Non connecté à Arlo : voir la configuration de l’intégration.',
    de: 'Nicht mit Arlo verbunden: siehe Konfiguration der Integration.',
    es: 'No conectado a Arlo: vea la configuración de la integración.',
  },
  unknownCamera: {
    en: 'This camera is not (or no longer) on the Arlo account.',
    fr: 'Cette caméra n’est pas (ou plus) sur le compte Arlo.',
    de: 'Diese Kamera ist nicht (mehr) im Arlo-Konto.',
    es: 'Esta cámara no está (o ya no está) en la cuenta Arlo.',
  },
  armAll: { en: 'Arm all', fr: 'Tout armer', de: 'Alle aktivieren', es: 'Armar todo' },
  disarmAll: {
    en: 'Disarm all',
    fr: 'Tout désarmer',
    de: 'Alle deaktivieren',
    es: 'Desarmar todo',
  },
  snapshot: {
    en: 'Take a snapshot',
    fr: 'Prendre une photo',
    de: 'Foto aufnehmen',
    es: 'Tomar una foto',
  },
  turnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  turnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  snapshotDone: {
    en: 'Snapshot taken.',
    fr: 'Photo prise.',
    de: 'Foto aufgenommen.',
    es: 'Foto tomada.',
  },
};

const kindLabel = (kind) => KIND_LABELS[kind] ?? KIND_LABELS.motion;

function batteryItem(service, camera) {
  const level = service.propsOf(camera.deviceId)[FEATURES.BATTERY];
  if (typeof level !== 'number') {
    return { value: T.unknown, color: WIDGET_COLORS.NEUTRAL };
  }
  let color = WIDGET_COLORS.SUCCESS;
  if (level < 20) {
    color = WIDGET_COLORS.DANGER;
  } else if (level < 40) {
    color = WIDGET_COLORS.WARNING;
  }
  return { value: `${level} %`, color };
}

function modeItem(service, base) {
  const modeId = service.activeModes.get(base.deviceId);
  if (!modeId) {
    return { value: T.unknown, color: WIDGET_COLORS.NEUTRAL };
  }
  const mode = (service.modes.get(base.deviceId) ?? []).find((entry) => entry.id === modeId) ?? {
    id: modeId,
  };
  return {
    value: localize((language) => modeLabel(mode, language)),
    color: MODE_COLORS[modeKind(modeId)],
  };
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The "Arlo overview" content. */
export function overviewContent(service) {
  if (!service.connected) {
    return { ttl_seconds: 60, components: [{ type: 'text', text: T.notConnected }] };
  }
  const items = [];
  for (const base of service.devices.filter(isBase)) {
    items.push({
      label: truncate(`${T.mode.en}: ${base.deviceName}`, 40),
      icon: 'shield',
      ...modeItem(service, base),
    });
  }
  for (const camera of service.devices.filter(hasBattery)) {
    items.push({
      label: truncate(camera.deviceName, 40),
      icon: 'battery',
      ...batteryItem(service, camera),
    });
  }

  const components = [];
  if (items.length > 0) {
    components.push({ type: 'status', items: items.slice(0, 10) });
  }

  const recent = service.detections.slice(0, 5);
  if (recent.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: recent.map((detection) => {
        const camera = service.deviceById(detection.deviceId);
        const kind = detection.kind ?? (detection.reason.includes('audio') ? 'audio' : 'motion');
        const item = {
          title: truncate(camera?.deviceName ?? detection.deviceId, 60),
          subtitle: kindLabel(kind),
          date: new Date(detection.at).toISOString(),
          badge: {
            text: kindLabel(kind),
            color: KIND_COLORS[kind] ?? WIDGET_COLORS.NEUTRAL,
          },
        };
        if (detection.thumbnailUrl) {
          const key = service.widgetImageKey('clip', detection.id, detection.at);
          service.rememberWidgetImage(key, detection.thumbnailUrl);
          item.image = key;
        }
        return item;
      }),
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: T.noRecording });
  }

  if (service.devices.some(isBase)) {
    components.push(
      {
        type: 'button',
        label: T.armAll,
        icon: 'lock',
        style: 'primary',
        action: { key: WIDGET_ACTIONS.ARM_ALL, confirm: true },
      },
      {
        type: 'button',
        label: T.disarmAll,
        icon: 'unlock',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.DISARM_ALL, confirm: true },
      },
    );
  }
  return { ttl_seconds: 60, components };
}

/** The "Arlo camera" content, for the camera chosen in the widget settings. */
export function cameraContent(service, gladys, settings) {
  if (!service.connected) {
    return { ttl_seconds: 60, components: [{ type: 'text', text: T.notConnected }] };
  }
  const camera = service.deviceByExternalId(settings?.camera);
  if (!camera || !isCamera(camera)) {
    return { ttl_seconds: 300, components: [{ type: 'text', text: T.unknownCamera }] };
  }
  const ids = idsOf(gladys, camera);
  const props = service.propsOf(camera.deviceId);
  const components = [];

  if (props.imageUrl) {
    const key = service.widgetImageKey('cam', camera.deviceId, props.imageStamp ?? props.imageAt);
    service.rememberWidgetImage(key, props.imageUrl);
    components.push({ type: 'image', key, alt: camera.deviceName, fit: 'cover' });
  }
  if (hasBattery(camera)) {
    components.push({
      type: 'value',
      label: T.battery,
      icon: 'battery',
      device_feature: ids.feature(FEATURES.BATTERY),
    });
  }
  components.push({
    type: 'value',
    label: T.motion,
    icon: 'activity',
    device_feature: ids.feature(FEATURES.MOTION),
  });

  const last = service.detections.find((detection) => detection.deviceId === camera.deviceId);
  const items = [
    {
      label: T.camera,
      icon: 'video',
      value: props[FEATURES.ENABLED] === 0 ? T.off : T.on,
      color: props[FEATURES.ENABLED] === 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    {
      label: T.lastDetection,
      icon: 'clock',
      value: last
        ? localize(
            (language) =>
              `${new Date(last.at).toISOString().slice(11, 16)} UTC · ${pick(language, kindLabel(last.kind ?? 'motion'))}`,
          )
        : T.none,
      color: last ? (KIND_COLORS[last.kind] ?? WIDGET_COLORS.NEUTRAL) : WIDGET_COLORS.NEUTRAL,
    },
  ];
  const base = service.devices.find((device) => device.deviceId === camera.parentId) ?? camera;
  if (isBase(base)) {
    items.push({ label: T.mode, icon: 'shield', ...modeItem(service, base) });
  }
  components.push({ type: 'status', items });

  components.push(
    {
      type: 'button',
      label: T.snapshot,
      icon: 'camera',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.SNAPSHOT, params: { device: ids.device } },
    },
    props[FEATURES.ENABLED] === 0
      ? {
          type: 'button',
          label: T.turnOn,
          icon: 'eye',
          style: 'secondary',
          device_feature: ids.feature(FEATURES.ENABLED),
          value: 1,
        }
      : {
          type: 'button',
          label: T.turnOff,
          icon: 'eye-off',
          style: 'secondary',
          device_feature: ids.feature(FEATURES.ENABLED),
          value: 0,
        },
  );
  return { ttl_seconds: 60, components };
}

/** "3 bases armed." */
function modesChanged(count, kind) {
  const word = {
    armed: { en: 'armed', fr: 'armée(s)', de: 'aktiviert', es: 'armada(s)' },
    disarmed: { en: 'disarmed', fr: 'désarmée(s)', de: 'deaktiviert', es: 'desarmada(s)' },
  }[kind];
  return localize((language) =>
    pick(language, {
      en: `${count} base(s) ${word.en}.`,
      fr: `${count} base(s) ${word.fr}.`,
      de: `${count} Basis(en) ${word.de}.`,
      es: `${count} base(s) ${word.es}.`,
    }),
  );
}

/** Widget handlers, keyed by widget key: `get` and `action`. */
export function createWidgets(service, gladys) {
  return {
    [WIDGET_KEYS.OVERVIEW]: {
      async get() {
        return overviewContent(service);
      },
      async action({ actionKey }) {
        logger.info(`Widget ${WIDGET_KEYS.OVERVIEW}.${actionKey}`);
        if (actionKey === WIDGET_ACTIONS.ARM_ALL || actionKey === WIDGET_ACTIONS.DISARM_ALL) {
          const kind = actionKey === WIDGET_ACTIONS.ARM_ALL ? 'armed' : 'disarmed';
          return modesChanged(await service.setAllModes(kind), kind);
        }
        throw new Error(`Unknown widget action: ${actionKey}`);
      },
    },
    [WIDGET_KEYS.CAMERA]: {
      async get({ settings }) {
        return cameraContent(service, gladys, settings);
      },
      async action({ actionKey, params }) {
        logger.info(`Widget ${WIDGET_KEYS.CAMERA}.${actionKey}`);
        if (actionKey === WIDGET_ACTIONS.SNAPSHOT) {
          await service.takeSnapshotByExternalId(params.device);
          return T.snapshotDone;
        }
        throw new Error(`Unknown widget action: ${actionKey}`);
      },
    },
  };
}

/** Ask the core to re-pull every widget now (rate-limited core-side). */
export function refreshWidgets(gladys) {
  for (const key of Object.values(WIDGET_KEYS)) {
    gladys.requestWidgetRefresh(key);
  }
}
