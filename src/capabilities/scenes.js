// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+).
//
// Triggers say "this happened": the service fires them with
// `gladys.publishSceneEvent` (one event per transition, flat data, only the
// keys the manifest declares). Actions are operations a scene runs: they
// receive the RESOLVED fields and return the declared outputs.
//
// Keys are stored in the users' scenes: never rename one.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'scenes' });

/** Keys of the manifest `scene_triggers`. */
export const SCENE_TRIGGERS = {
  MOTION_DETECTED: 'motion_detected',
  OBJECT_DETECTED: 'object_detected',
  DOORBELL_PRESSED: 'doorbell_pressed',
  MODE_CHANGED: 'mode_changed',
};

/** What Arlo smart detection tells apart (`objCategory` of a recording). */
export const OBJECT_KINDS = ['person', 'vehicle', 'animal', 'package'];

/** Kinds of mode, the `mode` filter of `mode_changed`. */
export const MODE_KINDS = ['armed', 'disarmed', 'custom'];

/** Keys of the manifest `scene_actions`. */
export const SCENE_ACTIONS = {
  set_mode: 'set_mode',
  take_snapshot: 'take_snapshot',
  sound_siren: 'sound_siren',
};

/**
 * The scene action handlers, keyed like SCENE_ACTIONS. A device that cannot
 * do it is an output (`false`), not a failure: a scene action is never a
 * condition, the scene author gates on the output.
 */
export const SCENE_ACTION_HANDLERS = {
  async set_mode(service, fields) {
    logger.info(`Scene action set_mode <- ${fields.device} = ${fields.mode}`);
    const result = await service.setModeByExternalId(fields.device, fields.mode);
    return { changed: result.changed, mode_name: result.modeName };
  },

  async take_snapshot(service, fields) {
    logger.info(`Scene action take_snapshot <- ${fields.device}`);
    const taken = await service.takeSnapshotByExternalId(fields.device);
    return { taken };
  },

  async sound_siren(service, fields) {
    logger.info(`Scene action sound_siren <- ${fields.device}`);
    const started = await service.soundSirenByExternalId(fields.device, {
      duration: fields.duration,
      volume: fields.volume,
    });
    return { started };
  },
};
