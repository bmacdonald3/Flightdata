#!/bin/bash
API_ACTIVE=$(systemctl is-active flight-prep-api 2>/dev/null)
CAL_ACTIVE=$(systemctl is-active approach-calibrator 2>/dev/null)
SCORED=0
LAST=""
DB="error"
if [ "$API_ACTIVE" = "active" ]; then
  HEALTH=$(curl -s --max-time 3 http://localhost:5002/api/health 2>/dev/null)
  if echo "$HEALTH" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    DB=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('database','error'))")
    SCORED=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('scored_flights',0))")
    LAST=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('last_scored',''))")
  fi
fi
echo "{\"api_running\": $([ "$API_ACTIVE" = "active" ] && echo true || echo false), \"calibrator_running\": $([ "$CAL_ACTIVE" = "active" ] && echo true || echo false), \"database\": \"$DB\", \"scored_flights\": $SCORED, \"last_scored\": \"$LAST\"}"
