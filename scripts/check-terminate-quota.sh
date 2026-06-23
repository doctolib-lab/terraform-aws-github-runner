#!/usr/bin/env bash
# Snapshot EC2 bucket-1 (Fleet mutations) quota usage for cicd-prod (346156333547).
# Run before and after deploying the batched-terminate change to measure impact.
#
# Usage: check-terminate-quota.sh [--from=2d]
#   --from accepts pup relative ranges: 1h, 2d, 7d, etc. (default: 2d)
#
# Requires: pup CLI authenticated (pup auth login)
set -euo pipefail

FROM="${1:---from=2d}"

q() {
  local query="$1"
  pup metrics query --query="$query" "$FROM" --output=json \
    | python3 -c '
import sys, json
d = json.load(sys.stdin)
pts = [p[1] for p in d["data"]["series"][0]["pointlist"] if p[1] is not None]
if not pts:
    print("no data")
    sys.exit()
s = sorted(pts)
n = len(s)
print(f"p50={s[n//2]:.0f}  p95={s[int(n*0.95)]:.0f}  p99={s[int(n*0.99)]:.0f}  max={max(pts):.0f}  calls/min")
'
}

TERMINATE='sum:aws.usage.call_count.sum{service:ec2,resource:terminateinstances}.rollup(max,60)'
BUCKET1="${TERMINATE}\
+sum:aws.usage.call_count.sum{service:ec2,resource:createfleet}.rollup(max,60)\
+sum:aws.usage.call_count.sum{service:ec2,resource:runinstances}.rollup(max,60)\
+sum:aws.usage.call_count.sum{service:ec2,resource:deletenetworkinterfaces}.rollup(max,60)"

echo "Window: ${FROM#--from=}"
echo ""
printf "%-30s %s\n" "TerminateInstances alone:" "$(q "$TERMINATE")"
printf "%-30s %s  (sustained limit: 540)\n" "Bucket-1 total:" "$(q "$BUCKET1")"
