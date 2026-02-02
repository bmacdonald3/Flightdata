#!/bin/bash
FILE=~/flight_stream.xml
if [ ! -f "$FILE" ]; then
    echo '{"messages": 0, "size_mb": 0, "est_minutes": 0}'
    exit 0
fi
SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null || echo 0)
SIZE_MB=$((SIZE / 1048576))
MSG_COUNT=$(grep -c '</message>' "$FILE" 2>/dev/null || echo 0)
EST_MIN=$(awk "BEGIN {printf \"%.1f\", $MSG_COUNT / 750}")
echo "{\"messages\": $MSG_COUNT, \"size_mb\": $SIZE_MB, \"est_minutes\": $EST_MIN}"
