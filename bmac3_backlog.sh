#!/bin/bash
FDPS_FILE=~/flight_stream.xml
STDDS_FILE=~/stdds_stream.xml

# FDPS backlog
if [ -f "$FDPS_FILE" ]; then
    FDPS_SIZE=$(stat -c%s "$FDPS_FILE" 2>/dev/null || echo 0)
    FDPS_MSG=$(grep -c '</message>' "$FDPS_FILE" 2>/dev/null | head -1 || echo 0)
else
    FDPS_SIZE=0
    FDPS_MSG=0
fi

# STDDS backlog
if [ -f "$STDDS_FILE" ]; then
    STDDS_SIZE=$(stat -c%s "$STDDS_FILE" 2>/dev/null || echo 0)
    STDDS_MSG=$(grep -c 'TATrackAndFlightPlan>' "$STDDS_FILE" 2>/dev/null | head -1 || echo 0)
else
    STDDS_SIZE=0
    STDDS_MSG=0
fi

# Ensure numeric values
FDPS_SIZE=${FDPS_SIZE:-0}
FDPS_MSG=${FDPS_MSG:-0}
STDDS_SIZE=${STDDS_SIZE:-0}
STDDS_MSG=${STDDS_MSG:-0}

# Combined totals
TOTAL_SIZE=$((FDPS_SIZE + STDDS_SIZE))
SIZE_MB=$((TOTAL_SIZE / 1048576))
TOTAL_MSG=$((FDPS_MSG + STDDS_MSG))
EST_MIN=$(awk "BEGIN {printf \"%.1f\", $TOTAL_MSG / 750}")

echo "{\"messages\": $TOTAL_MSG, \"size_mb\": $SIZE_MB, \"est_minutes\": $EST_MIN, \"fdps_messages\": $FDPS_MSG, \"stdds_messages\": $STDDS_MSG}"
