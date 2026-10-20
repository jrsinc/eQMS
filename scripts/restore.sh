#!/usr/bin/env bash
# Restore after QA and System Owner approval only. Usage: restore.sh <backup-file.db.gz.gpg>
# Afterwards complete the post-restore checklist (Technical Design 9.5).
set -euo pipefail
F="$1"; DATA=${DATA:-/opt/qms/data}
Q=/var/backups/qms/quarantine-$(date -u +%Y%m%dT%H%M%SZ)
sha256sum -c "$F.sha256"
systemctl stop qms
mkdir -p "$Q" && cp "$DATA"/qms.db* "$Q"/ 2>/dev/null || true
gpg --decrypt "$F" | gunzip > "$DATA/qms.db.restore"
node --disable-warning=ExperimentalWarning -e "
const {DatabaseSync}=require('node:sqlite');
const r=new DatabaseSync(process.argv[1]).prepare('PRAGMA integrity_check').get();
if(Object.values(r)[0]!=='ok'){console.error('Integrity check failed');process.exit(1)}" "$DATA/qms.db.restore"
rm -f "$DATA/qms.db" "$DATA/qms.db-wal" "$DATA/qms.db-shm"
mv "$DATA/qms.db.restore" "$DATA/qms.db" && chown qms:qms "$DATA/qms.db"
systemctl start qms
echo "Restored $F. Damaged copy kept in $Q. Complete the post-restore checklist (9.5)."
