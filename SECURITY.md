# Security policy

Sci-Agent is an experimental, locally executed scientific agent. Do not use it
as a security boundary for untrusted tenants, regulated data or production
systems. Security fixes target the current main branch.

## Reporting

Report suspected vulnerabilities privately through the repository's GitHub
Security → Report a vulnerability facility, when enabled. Otherwise contact
the maintainer privately through an available GitHub contact channel. Do not
publish exploit details, access tokens, credentials, private data, or unredacted
logs in an issue. Include the affected version/commit, platform, a minimal
synthetic reproduction and the expected security boundary. No response-time
guarantee is made.

## Execution and trust boundaries

- Only open trusted project directories. Review the full project configuration,
  installed dependencies, skill text and any requested tool action before use.
- Programmatic tool calls requiring approval are denied by default unless an
  explicit approval callback returns true or the tool is explicitly auto-approved.
- Approved shell and Python code runs with your own local privileges unless
  the optional Linux Bubblewrap execution mode is active. Approval is not
  isolation. The API's embedding application must supply its own approval policy.
- The file tools reject paths escaping the workspace, symlink components,
  hardlinked regular files and special files. Final regular-file operations
  check file descriptors and use no-follow flags where available. Concurrent
  malicious filesystem changes, mount points, OS-specific reparse points and
  other local processes are not fully isolated; this is not a race-proof sandbox.
- Optional Bubblewrap confines selected subprocesses only, with read-only
  workspace access and isolated networking. Do not put credentials in the
  mounted project. Other tools, native agents and provider requests are outside
  that subprocess boundary. If isolation cannot start, those subprocesses
  fail closed rather than running natively.
- Provider credentials must be your own. Never paste them into prompts,
  commit them, share the local credential vault or post them in logs.
  The password-encrypted local vault is not an operating-system keychain
  and does not defend against a compromised logged-in user or device.
- Research evidence links and independent numerical replay are methodological
  checks, not guarantees of scientific truth, data privacy or regulatory compliance.

See [PRIVACY.md](PRIVACY.md) for local data and provider transmission details,
and [docs/public-release-checklist.md](docs/public-release-checklist.md) for
remaining release validation.
