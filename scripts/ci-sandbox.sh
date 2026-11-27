#!/usr/bin/env bash
set -euo pipefail
# Only for disposable Ubuntu 24.04 GitHub-hosted CI runners.
sudo apt-get update
sudo apt-get install -y bubblewrap util-linux
/usr/bin/bwrap --help | grep -q -- '--disable-userns'
# Ubuntu 24.04 may restrict unprivileged user namespaces via AppArmor.
# Grant userns only to the Bubblewrap executable, not to every process.
if [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" == 1 ]]; then
  if [[ ! -f /etc/apparmor.d/bwrap ]]; then
    sudo tee /etc/apparmor.d/bwrap >/dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
}
PROFILE
  fi
  sudo apparmor_parser -r /etc/apparmor.d/bwrap
fi
