#!/usr/bin/env bash
# Hourly backup (cron: 0 * * * * /opt/qms/scripts/backup.sh). See Technical Design section 9.
# Requires: node 22, gzip, gpg (public key "qms-backup" imported), rclone remote "offsite".
set -euo pipefail
DB=${DB:-/opt/qms/data/qms.db}
DEST=${DEST:-/var/backups/qms}
TS=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$DEST"
SNAP="$DEST/qms-$TS.db"
# 1-2: consistent online copy + integrity check
node --disable-warning=ExperimentalWarning -e "
const {DatabaseSync}=require('node:sqlite');
new DatabaseSync(process.argv[1]).exec(\"VACUUM INTO '\"+process.argv[2]+\"'\");
const r=new DatabaseSync(process.argv[2]).prepare('PRAGMA integrity_check').get();
if(Object.values(r)[0]!=='ok'){console.error('integrity check failed');process.exit(1)}" "$DB" "$SNAP"
# 3-4: compress, encrypt, checksum
gzip "$SNAP"
gpg --batch --yes --trust-model always --recipient qms-backup --encrypt "$SNAP.gz" && rm "$SNAP.gz"
sha256sum "$SNAP.gz.gpg" > "$SNAP.gz.gpg.sha256"
# 5: off-site copy (immutable Azure Blob container / S3 Object Lock bucket)
rclone copy "$DEST" offsite:qms-backups --include "qms-$TS*" --checksum
# 6-7: local retention 48 h and log
find "$DEST" -maxdepth 1 -name 'qms-*' -mmin +2880 -delete
echo "$TS OK" >> /var/log/qms-backup.log
