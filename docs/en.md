# Arlo integration

Brings your Arlo cameras, video doorbells, base stations and sirens into Gladys:
pictures, motion, battery, Arlo modes (armed, disarmed, custom), siren, scenes
and dashboard widgets.

> **Cloud integration.** Arlo has no local API: everything goes through the Arlo
> cloud, with your Arlo account. Gladys needs an internet connection, and Arlo
> must be reachable.

## What you get

| Arlo device                     | In Gladys                                                        |
| ------------------------------- | ---------------------------------------------------------------- |
| Camera (Pro, Ultra, Essential…) | Image, camera on/off (Arlo privacy mode), motion, battery        |
| Video doorbell                  | Same as a camera, plus "Ring"                                    |
| Audio doorbell                  | Ring, battery                                                    |
| Base station (hub)              | Arlo mode (list of the modes of the base), siren on Pro hubs     |
| Wi-Fi camera without hub        | Camera features, plus its own Arlo mode and siren (Pro 3 and up) |
| Arlo siren                      | Siren on/off                                                     |

Not supported (yet): live video streams, Arlo lights and chimes.

## Setup

1. **Tip:** create a second Arlo account for Gladys and share your devices with
   it from the Arlo app (Settings → Grant access). Arlo allows only one web
   session per account: using your main account in Gladys can log you out of
   my.arlo.com, and the reverse.
2. In Gladys, open the integration configuration and fill in:
   - **Arlo email** and **Arlo password**;
   - **Verification code sent by**: email or SMS (the method must be active
     on the Arlo account).
3. Save, then click **Send me a code**. Arlo sends a code by email or SMS.
4. Type the code in **Validate the code** (within 10 minutes).
5. The status turns green. Open the **Discovery** tab and add your devices.

The login is kept in the integration (`/data`) and reused at every restart.
When Arlo ends it (usually after a few weeks), the status asks for a new code:
click **Send me a code** again.

### Options

| Option                  | Default | What it does                                                                                                |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| Refresh interval (s)    | 60      | How often modes, batteries, pictures and recordings are read from Arlo. One minute minimum.                 |
| Fresh picture on demand | off     | When Gladys asks for an image, the camera takes a new one. Wakes battery cameras up: it uses their battery. |
| Detailed logs           | off     | Logs every Arlo event. Useful to report a problem, turn it off afterwards.                                  |

The **Test the connection** button checks the login and reads the device list.

## How it works

- **Real time:** motion, doorbell press, battery, privacy and siren changes
  arrive on the Arlo event stream.
- **Every refresh:** the integration reads the device list (new picture of each
  camera), the active modes and the recordings of the last 24 hours.
- **Pictures:** Gladys accepts camera images up to 150 KB. Larger Arlo pictures
  are made smaller by the integration.
- Some Arlo accounts get no real-time stream. Then motion, mode changes and
  smart detections still arrive, but up to one refresh later.

## Scenes

### Triggers

| Key                | When                                                                                                | Filters                                                  | Variables           |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| `motion_detected`  | A camera saw something move.                                                                        | Camera                                                   | –                   |
| `object_detected`  | Arlo smart detection recognized what moved (needs an Arlo Secure plan). Arrives with the recording. | Camera, what was seen (person, vehicle, animal, package) | `object`            |
| `doorbell_pressed` | Someone pressed a doorbell.                                                                         | Doorbell                                                 | –                   |
| `mode_changed`     | A base changed mode from the Arlo app, a schedule or a geofence. Not fired when Gladys changed it.  | Base, new mode (armed, disarmed, custom)                 | `mode`, `mode_name` |

Use the variables in the next actions, for example
`{{triggerEvent.data.object}}`.

### Actions

| Key             | What it does                                                                                       | Result                 |
| --------------- | -------------------------------------------------------------------------------------------------- | ---------------------- |
| `set_mode`      | Switches a base to a mode: `armed`, `disarmed`, or the name of a custom mode (e.g. `Night`).       | `changed`, `mode_name` |
| `take_snapshot` | The camera takes a new picture, shown in Gladys. Follow it with "Send camera image" to receive it. | `taken`                |
| `sound_siren`   | Sounds a siren for a duration (5 to 300 s) and a volume (1 to 8).                                  | `started`              |

The standard Gladys actions also work on the features: turn a camera on/off,
set the "Arlo mode" select, stop the siren.

## Dashboard widgets

- **Arlo overview** (`arlo_overview`): the mode of each base, the battery of
  each camera, the latest recordings with their thumbnail, and two buttons:
  **Arm all** / **Disarm all**.
- **Arlo camera** (`arlo_camera`): pick a camera. Shows its latest picture,
  live battery and motion, its state and its last recording, with **Take a
  snapshot** and **Turn on/off** buttons.

## Troubleshooting

| Problem                                        | What to do                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| "Arlo needs a verification code"               | Click **Send me a code**, then **Validate the code**.                                                          |
| "No email verification method on this account" | Choose the other method (SMS), or add it in the Arlo app (Settings → Two-step verification).                   |
| "Invalid credentials"                          | Check the email and the password. Log in once at my.arlo.com to be sure.                                       |
| Refused with HTTP 403                          | Arlo's front door blocked the request. Wait a few minutes and retry; if it lasts, open an issue with the logs. |
| No battery value                               | Wait for the next refresh: Arlo sends it on the event stream.                                                  |
| Detection does not fire                        | Smart detection (person, vehicle…) needs an Arlo Secure plan; motion alone does not.                           |

To report a problem, turn on **Detailed logs**, reproduce it, and attach the
integration logs (Gladys → Integrations → Arlo → Logs) to a GitHub issue. The
logs never contain your password or your token.

## Privacy

Your email, password and Arlo session stay in your Gladys. The integration
only talks to Arlo servers (`arlo.com` domains). Arlo publishes no official
API: this integration uses the same calls as the Arlo web application, and an
Arlo change can break it until an update.
