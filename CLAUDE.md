# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step) for
**Arlo** cameras, video doorbells, base stations and sirens, through the **Arlo
cloud** (no local API exists). It runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js);
CI and release workflows follow
[gladys-devmel](https://github.com/prohand/gladys-devmel). Requires Gladys 5.3+.

Runtime dependencies: the SDK, and `jpeg-js` (pure JS, no native build) to
shrink Arlo pictures under the 150 KB Gladys accepts.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/service.test.js            # one file
node --test --test-name-pattern "doorbell"  # tests whose name matches
LOG_LEVEL=debug npm test                    # with the logs (silent by default)
npm run lint                                # ESLint
npm run format:check                        # Prettier, as the CI runs it
npm run format                              # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node
22 and 24; pull requests also run the store checks and build the image. Run the
three commands before pushing.

## Architecture

```
index.js                     SDK wiring only (handlers before connect); `setup(gladys, deps)` is tested
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  LANGUAGES (en, fr, de, es), localize / pick
src/messages.js              user-facing action answers and connection statuses
src/logging.js               log level from the config, mask() for emails/tokens
src/arlo/constants.js        Arlo hosts, paths, web-app headers (fix Arlo changes here)
src/arlo/client.js           one method per Arlo endpoint, fetch injected
src/arlo/auth.js             login, verification code (2 actions), session in /data
src/arlo/events.js           server-sent event stream, parser, reconnect with backoff
src/arlo/models.js           what a device is (base, camera, doorbell, siren), modes
src/arlo/image.js            fit a JPEG under 150 KB (camera) / 300 KB (widget)
src/arlo/service.js          state, refresh loop, event handling, commands, scene events
src/devices/index.js         Arlo device -> Gladys discovery payload, external ids
src/capabilities/scenes.js   scene trigger keys + scene action handlers
src/capabilities/widgets.js  arlo_overview and arlo_camera widgets
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (mandatory)
test/helpers/fakeArlo.js     in-memory Arlo cloud behind an injected fetch
```

## Rules

- **External ids are forever.** `ext:<selector>:arlo:<Arlo deviceId>[:feature]`,
  the deviceId being Arlo's serial. The type part is `arlo` for every device on
  purpose: a better classification later must never rename a device. Same for
  every key users store: `config_schema`, `actions`, scene trigger/action keys,
  widget keys, feature keys (`image`, `enabled`, `motion`, `battery`, `mode`,
  `siren`, `ring`).
- **Arlo has no public API.** Endpoints and headers copy the my.arlo.com web
  app (see `src/arlo/constants.js`). Keep every Arlo detail there or in
  `client.js`; the tests fake the cloud (`test/helpers/fakeArlo.js`) and never
  touch the network.
- **Secrets.** Never log the password, the token or a full email (`mask()`).
  The session file lives in `/data` only (read-only rootfs elsewhere).
- **Scene events:** one per transition (motion edge, press, mode change), flat
  data with only the declared keys, and **never** one caused by a Gladys
  command (`ownModeChanges` in the service): a scene bound to it would loop.
- **Pictures** go through `publishCameraImage` / `onGetImage`
  (`image/jpg;base64,`, ≤ 150 KB, see `image.js`), never through states.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading: the Release workflow does.
- **Manifest.** Every text is `{ en, fr, de, es }` (labels, descriptions,
  placeholders), checked by `test/manifest.test.js`. `transports: ["cloud"]`.
  `keywords` needs `gladys_version >=5.3.0`. Change the manifest and the code
  together: the tests tie actions, scene keys and widget keys to the handlers.
- **User-facing text** is in the four languages: action messages, statuses,
  widget texts, manifest, and `docs/*.md` kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Simple words in user texts.
