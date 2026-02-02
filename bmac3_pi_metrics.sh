#!/bin/bash
python3 -c "
import psutil, json
print(json.dumps({
    'cpu_percent': psutil.cpu_percent(interval=1),
    'mem_percent': psutil.virtual_memory().percent,
    'disk_free_gb': round(psutil.disk_usage('/').free / 1024**3, 2)
}))
"
