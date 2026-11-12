# Arlo for Gladys Assistant

External integration that brings **Arlo** cameras, video doorbells, base
stations and sirens into [Gladys Assistant](https://gladysassistant.com),
through the **Arlo cloud**.

![Cloud](https://img.shields.io/badge/transport-cloud-blue) ![Gladys](https://img.shields.io/badge/Gladys-%E2%89%A5%205.3.0-green)

- Pictures of every camera, fresh snapshot on demand.
- Motion (real time), battery, camera on/off (Arlo privacy mode).
- Doorbell press.
- Arlo modes of every base: armed, disarmed and the custom ones.
- Siren on/off (Pro hubs, Arlo siren, Pro 3 and later Wi-Fi cameras).
- **Scene triggers:** `motion_detected`, `object_detected` (person, vehicle,
  animal, package — Arlo Secure), `doorbell_pressed`, `mode_changed`.
- **Scene actions:** `set_mode`, `take_snapshot`, `sound_siren`.
- **Dashboard widgets:** `arlo_overview` (modes, batteries, latest recordings,
  arm/disarm all) and `arlo_camera` (one camera, picture, snapshot, on/off).
- Every text in **English, French, German and Spanish**.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

> Arlo publishes no official API. This integration uses the calls of the Arlo
> web application (my.arlo.com); an Arlo change can break it until an update.

## Install

In Gladys (5.3.0 or later): **Integrations → Arlo → Install**, then follow the
[documentation](docs/en.md): email, password, **Send me a code**, **Validate the
code**, then add the devices from the **Discovery** tab.

## Project structure

```
.
├─ index.js                        # SDK wiring (no Arlo logic)
├─ src/
│  ├─ arlo/                        # Arlo cloud: client, login, event stream, service
│  ├─ devices/index.js             # Arlo device -> Gladys device
│  ├─ capabilities/                # scene triggers/actions, dashboard widgets
│  ├─ config.js, i18n.js, messages.js, logging.js
├─ docs/{en,fr,de,es}.md           # user documentation (re-hosted by Gladys)
├─ test/                           # node --test, fake Gladys (SDK) + fake Arlo cloud
├─ gladys-assistant-integration.json
├─ Dockerfile                      # Node 24 Alpine, non-root, read-only rootfs ready
├─ CHANGELOG.md · SECURITY.md · CLAUDE.md
└─ .github/                        # CI, Release, build, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm test               # unit tests (no network, no Arlo account needed)
npm run lint           # ESLint
npm run format:check   # Prettier
npx github:GladysAssistant/integration-store .   # store checks
```

Run it against a Gladys in developer mode:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="arlo" \
ARLO_DATA_DIR="./data" \
LOG_LEVEL=debug \
npm start
```

## CI and releases

Same workflows as [gladys-devmel](https://github.com/prohand/gladys-devmel):

| Workflow             | When                         | What                                                                      |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `ci.yml`             | push on `main`, pull request | Prettier, ESLint, tests (Node 22 + 24); PR: store checks + Docker build   |
| `release.yml`        | Actions → Release (manual)   | bump version, roll the changelog, tag, build, GitHub Release, store check |
| `build.yml`          | tag `v*`, manual, release    | multi-arch image `linux/amd64` + `linux/arm64` on `ghcr.io`               |
| `github-release.yml` | push on `main`, release      | creates the missing GitHub Releases from `CHANGELOG.md`                   |

To publish: describe the changes under `## [Unreleased]` in
[`CHANGELOG.md`](CHANGELOG.md), then **Actions → Release → Run workflow**.
Add the GitHub topic `gladys-assistant-integration` to the repository so the
store indexer finds it, and turn on **Private vulnerability reporting**
([`SECURITY.md`](SECURITY.md)).

## License

Apache-2.0. Arlo is a trademark of Arlo Technologies, Inc. This project is not
affiliated with Arlo.
