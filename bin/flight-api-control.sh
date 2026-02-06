#!/bin/bash
SERVICE="flight-prep-api"

case "$1" in
  status)
    if systemctl is-active --quiet $SERVICE; then
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5002/api/health 2>/dev/null)
      if [ "$HTTP_CODE" = "200" ]; then
        echo "running"
      else
        echo "degraded"
      fi
    else
      echo "stopped"
    fi
    ;;
  start)
    sudo systemctl start $SERVICE
    echo "started"
    ;;
  stop)
    sudo systemctl stop $SERVICE
    echo "stopped"
    ;;
  restart)
    sudo systemctl restart $SERVICE
    echo "restarted"
    ;;
  *)
    echo "Usage: $0 {status|start|stop|restart}"
    exit 1
    ;;
esac
