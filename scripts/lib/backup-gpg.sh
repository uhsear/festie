#!/usr/bin/env bash
# Shared by the backup scripts (source it, do not run it): the GPG passphrase and the encrypt and
# decrypt steps for on-host dumps. The flags are the ones scripts/backup-offsite-git.sh used for the
# off-site copy before on-host dumps were encrypted: symmetric AES256, passphrase on fd 3.
# The passphrase is BACKUP_GPG_PASSPHRASE. It never appears on a command line.

# load_backup_passphrase <repo root>: keep BACKUP_GPG_PASSPHRASE from the environment, else read it from
# <repo root>/.env the way backup-offsite-git.sh does (a sourced file, so quoting behaves the same).
load_backup_passphrase() {
  if [ -z "${BACKUP_GPG_PASSPHRASE:-}" ] && [ -f "$1/.env" ]; then
    BACKUP_GPG_PASSPHRASE="$( (source "$1/.env" 2>/dev/null; printf '%s' "${BACKUP_GPG_PASSPHRASE:-}") )" || true
  fi
  export BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:-}"
}

# backup_encrypt <plain file> <encrypted file>. fd 9 (the backup lock) is closed for gpg so a
# gpg-agent that outlives the run cannot hold the lock.
backup_encrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
    --passphrase-fd 3 --output "$2" "$1" 3<<<"$BACKUP_GPG_PASSPHRASE" 9>&-
}

# backup_decrypt <encrypted file> <plain file>
backup_decrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --output "$2" --decrypt "$1" 3<<<"$BACKUP_GPG_PASSPHRASE" 9>&-
}
