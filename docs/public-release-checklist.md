# Public release checklist

This checklist distinguishes source changes from maintainer/account actions.
Public visibility is not certification of security, scientific validity or
provider approval.

## Before publishing

- [x] Add workspace path guards and regression tests.
- [x] Expand ignore rules for local credentials and research artifacts.
- [x] Add security, privacy and third-party notices.
- [x] Harden GitHub Actions with read-only permission, pinned action revisions,
  bounded runtime, Node 22/24 matrix and dependency audit.
- [ ] Resolve GitHub-hosted Actions account billing/spending restriction or
  verify a successful run after permitted publication. The preceding failure
  had no executed test steps. Do not increase spending automatically.
- [ ] Enable GitHub private vulnerability reporting, secret scanning and
  push protection when supported by repository visibility/account.
- [ ] Review history before publication: an obsolete desktop screenshot
  contains a personal local workspace path. The file is absent from HEAD but
  remains in history. Confirm historical artwork rights. If removal is needed,
  explicitly authorize a history cleanup or publish a clean snapshot; rewriting
  history changes commit IDs and existing clones. No history rewrite has
  been performed.
- [ ] Complete real-account provider acceptance checks below. Keep these
  integrations described as experimental until verified.
- [ ] Confirm applicable provider terms, distribution eligibility and any
  necessary approval. Do not present local account modes as an unlimited
  shared backend, resale service, or bypass of provider quotas.

## Provider acceptance (manual, user-authorized)

Use a dedicated empty project and your own eligible account. Do not run
automatically in public CI, commit credentials, or assume inference is free.
Use the smallest benign test possible. Stop at an unexpected charge or
permission request. Record provider version, date, selected model, outcome,
and sanitized diagnostics; never include tokens or account identifiers.

| Provider | Manual check |
| --- | --- |
| ChatGPT | Login through documented Sign in with ChatGPT, confirm plan consent and model catalog, one small tool-assisted calculation, refresh and logout/revocation. Verify the local token storage meets current requirements. |
| GitHub Copilot | Official CLI sign-in, SDK recognizes the user account, eligible model selection, valid JSON tool bridge for a small calculation, native tools disabled and session cleanup. |
| OpenRouter | Headless PKCE code, user-approved key spending cap and expiry, model catalog, one small calculation, local logout and separate remote key revocation. |
| Claude Code | Unmodified local CLI launch, own sign-in, one benign native turn and exit. Do not use subscription tokens as a third-party inference API. |
| Google Antigravity | Official ACP connection, own login, one benign interactive turn, cancel/permission behavior and exit. Not a hidden inference backend. |

Check current official guidance before distribution:
- OpenAI: https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- GitHub Copilot SDK: https://github.com/microsoft/copilot-sdk
- OpenRouter: https://openrouter.ai/docs/guides/overview/auth/oauth
- Anthropic: https://code.claude.com/docs/en/legal-and-compliance
- Google: https://antigravity.google/docs/cli/acp and https://antigravity.google/docs/faq

Paid or hosted Sign in with ChatGPT distributions require separate eligibility
review. Anthropic requires applicable commercial terms for running Claude Code
in products/services; do not modify the binary, restrict its authentication
methods or intermediate credentials/usage. Google documents ACP clients but
restricts use of Antigravity as a third-party coding-agent backend. Publishing
source does not automatically grant the right to operate an integration in
all distribution or billing contexts.

No authenticated live inference test was executed as part of the release audit.
