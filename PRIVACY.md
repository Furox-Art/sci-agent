# Privacy and data handling

Sci-Agent is a local CLI, not a hosted account service. Its source code does not
implement a maintainer-operated prompt collection or analytics server. This
statement does not cover optional dependencies, downloaded skills, external
agents or a user's own deployment.

## Where data goes

The chosen model endpoint receives prompts, conversation context, available
tool schemas and tool results as needed. Separate reviewer/verifier providers
can receive their own research context. Literature tools may send search
terms, identifiers and other request parameters to public literature services.
External skills and optional packages can make their own network requests.
Claude Code and Antigravity are separately installed native agents with their
own data handling, account and retention policies. Copilot and OpenRouter
requests follow their respective service policies. A local model is not a
guarantee that every optional tool is offline.

Review each service's terms and privacy controls before submitting unpublished,
personal, confidential or regulated information. Provider billing and retention
are not controlled by Sci-Agent. No zero-retention guarantee is offered.

## Local storage

Normal CLI history may be stored in .sci-agent-sessions/ in the workspace.
Explicit exports, scientific memory and lesson records may contain sensitive
text, tool arguments and outputs. Scientific memory is plaintext, not an
encrypted research database. Connected account modes suppress automatic
conversation-history loading and saving in Sci-Agent; explicit exports and
research-memory options remain available. Native agents may retain their own
sessions.

ChatGPT and OpenRouter credentials are stored in the user's password-encrypted
local vault (~/.sci-agent-auth/). Copilot, Claude Code and Antigravity manage
their own credentials. API keys supplied through environment variables or
project configuration remain the user's responsibility. Avoid storing them
in a model-accessible workspace. Local removal of a credential is distinct
from revoking it at the provider.

To remove local data, exit running sessions, review and remove only the
relevant local history, exports, memory and credential files. Revoke provider
authorizations separately where required. Deleting a local file does not delete
remote provider records, backups, or previously committed Git history.

## Security and limitations

Read [SECURITY.md](SECURITY.md). Ignore rules are a safeguard against
accidental Git staging, not a guarantee. Review what a model will see and what
each tool is authorized to do.
