#!/bin/bash
FILE=~/flight_stream.xml
if [ ! -f "$FILE" ]; then
    echo '{"messages": 0, "size_mb": 0, "est_minutes": 0}'
    exit 0
fi
SIZE_MB=$(du -m "$FILE" | cut -f1)
# Count messages (approximate - faster than regex)
MSG_COUNT=$(grep -c '</message>' "$FILE" 2>/dev/null || echo 0)
# Estimate: ~500 msgs per 40 seconds = 750/min
EST_MIN=$(echo "scale=1; $MSG_COUNT / 750" | bc)
echo "{\"messages\": $MSG_COUNT, \"size_mb\": $SIZE_MB, \"est_minutes\": $EST_MIN}"
