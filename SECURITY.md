# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub: on this repository, open the **Security** tab and
choose **Report a vulnerability**. Include what you found, how to reproduce it, and which
version you tested (shown next to the logo in the top bar).

This is a hobby project maintained in spare time — expect an answer within about a week.
Fixes for confirmed issues are released as a patch version and listed in the [changelog](CHANGELOG.md); reporters are credited unless they
prefer not to be.

Deutsch ist ebenfalls willkommen.

## Supported versions

Only the latest release receives security fixes. Container images: use the major tag
(`ghcr.io/l3t-io/ipam:2`) to get them automatically.

## Scope

In scope: the application in `app/`, the container image and the deployment templates in
this repository.

Out of scope: your UniFi controller, reverse proxy or tunnel configuration, and findings
that need administrator access to L3T IPAM (administrators can already change everything,
including the UniFi connection).

## How L3T IPAM protects itself

- Built-in login: scrypt password hashes, session tokens stored only as SHA-256 hashes,
  `HttpOnly`/`SameSite=Strict` cookies, lockout per client after failed attempts.
- Role checks (Administrator, Editor, Viewer) on the server for every request; only
  canonical API paths are accepted.
- CSRF protection via a required request header, strict Content-Security-Policy, no
  framing, HSTS over HTTPS.
- The UniFi API key never leaves the server; the controller certificate is pinned before
  the key is sent.
- No runtime dependencies.

Every finding of the security review done before the 2.0 release (a code audit with
black-box probing, not a professional penetration test) is reproduced in
`tests/security.test.js` and `tests/zertifikat.test.js`.
