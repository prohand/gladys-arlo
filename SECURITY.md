# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords, emails and addresses
  first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## What this integration holds

- The Arlo email and password typed in the Gladys configuration (the password
  is a `secret` field, stored by Gladys).
- The Arlo session token, in `/data/arlo-session.json` inside the integration
  container (file mode `0600`). The password is never written there.
- Logs never contain the password or the token; the email is masked
  (`jo***@example.com`).
- The integration only connects to Arlo servers (`*.arlo.com`) and to the
  presigned picture URLs Arlo returns (HTTPS only).

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Arlo cloud, apps and devices (report those to Arlo), and the other
third-party services the integration talks to.
