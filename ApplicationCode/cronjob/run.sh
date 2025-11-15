#!/bin/bash
set -euo pipefail

LOG_PREFIX="[LOADTEST]"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $LOG_PREFIX $1"
}

log "Script started"

if ! command -v locust >/dev/null 2>&1; then
  log "ERROR: locust command not found"
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  log "ERROR: aws CLI not found"
  exit 1
fi

log "Preparing timestamp"
timestamp=$(date +%Y-%m-%d-%H-%M)
log "Timestamp = $timestamp"

log "Starting Locust test with users=50 rate=5 runtime=2m"
log "Locust output will be saved to: report.html, report_data*, loadtest.log"

locust -f load_test.py \
  --headless \
  -u 50 \
  -r 5 \
  --run-time 2m \
  --stop-timeout 1 \
  --html report.html \
  --csv report_data \
  --logfile loadtest.log \
  --loglevel INFO \
  --exit-code-on-error 0 \
  --skip-log-setup

log "Locust execution completed"

log "Checking generated files"
ls -lh   || {
  log "ERROR: Required output files missing"
  exit 1

}

log "Preparing S3 upload"
S3_PATH="s3://${S3_BUCKET}/${timestamp}-report.html"

log "Uploading report.html to $S3_PATH"
aws s3 cp report.html "$S3_PATH"

log "Upload completed"
log "S3 Report URL: $S3_PATH"

log "Job Complete"