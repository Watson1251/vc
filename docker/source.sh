#!/usr/bin/env bash

# Resolve absolute path to the /docker directory (where this file lives)
__DOCKER_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "[+] Sourcing scripts from: $__DOCKER_DIR"

# Load completion, always using absolute path
source "${__DOCKER_DIR}/scripts/_auto_complete"

# === Global wrappers so you can call from anywhere ===
# Use functions instead of aliases so programmable completion works.
master() {
  ( cd "$__DOCKER_DIR" && ./master.sh "$@" )
}

# Short name
m() { master "$@"; }

# Attach completion to the wrappers
complete -F _docker_scripts_completion master
complete -F _docker_scripts_completion m

echo "[+] Global wrapper commands 'master' and 'm' are ready"

# (Optional) keep direct ./*.sh bindings for use when you're inside /docker
complete -F _docker_scripts_completion "${__DOCKER_DIR}/build.sh"   && echo "[!] build.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/up.sh"      && echo "[!] up.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/down.sh"    && echo "[!] down.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/restart.sh" && echo "[!] restart.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/logs.sh"    && echo "[!] logs.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/list.sh"    && echo "[!] list.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/save.sh"    && echo "[!] save.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/load.sh"    && echo "[!] load.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/run.sh"     && echo "[!] run.sh"
complete -F _docker_scripts_completion "${__DOCKER_DIR}/master.sh"  && echo "[!] master.sh"

echo ""
echo "[+] Autocomplete done. Use 'master' or 'm' from anywhere!"
