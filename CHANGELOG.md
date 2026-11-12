# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version of the Arlo integration (Arlo cloud, Gladys 5.3.0 or later).
- Login with the Arlo account and a verification code sent by email or SMS
  ("Send me a code" / "Validate the code"); the session is kept in `/data`.
- Cameras and video doorbells: picture, camera on/off (Arlo privacy mode),
  motion and battery. Doorbells: ring. Bases: Arlo mode (dynamic list of the
  base's modes). Siren on Pro hubs, Arlo sirens and recent Wi-Fi cameras.
- Real-time events from the Arlo event stream, and a refresh loop for modes,
  pictures and recordings (fallback when the stream is silent).
- Pictures larger than 150 KB are made smaller to fit Gladys.
- Scene triggers: motion detected, person/vehicle/animal/package detected,
  doorbell pressed, mode changed. Scene actions: change mode, take a snapshot,
  sound the siren.
- Dashboard widgets: "Arlo overview" (modes, batteries, latest recordings, arm
  or disarm all) and "Arlo camera" (latest picture, battery, motion, snapshot,
  on/off).
- Cloud transport badge per device (reachable or not).
- Every text in English, French, German and Spanish; user documentation in the
  four languages.
- CI (format, lint, tests on Node 22 and 24, store checks, Docker build),
  Release workflow, GitHub Releases, Dependabot.

[Unreleased]: https://github.com/prohand/gladys-arlo/commits/main
