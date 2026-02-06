#!/bin/bash
API=$(systemctl is-active flight-prep-api 2>/dev/null)
CAL=$(systemctl is-active approach-calibrator 2>/dev/null)
if [ "$API" = "active" ] && [ "$CAL" = "active" ]; then
  echo "ON"
else
  echo "OFF"
fi
