# METAR Collector - Pi Installation Guide

## Overview

This moves the METAR weather data collection from Azure Automation to the Raspberry Pi,
using the same monitoring pattern as the BMAC3 SWIM pipeline.

## Files to Deploy

Copy these files to the Pi (`192.168.42.13`):

| File | Destination | Permissions |
|------|-------------|-------------|
| `metar_collector.py` | `/home/bmacdonald3/metar_collector.py` | `chmod +x` |
| `metar_switch_on.sh` | `/home/bmacdonald3/metar_switch_on.sh` | `chmod +x` |
| `metar_switch_off.sh` | `/home/bmacdonald3/metar_switch_off.sh` | `chmod +x` |
| `metar_switch_state.sh` | `/home/bmacdonald3/metar_switch_state.sh` | `chmod +x` |
| `metar_status.sh` | `/home/bmacdonald3/metar_status.sh` | `chmod +x` |
| `metar_log.sh` | `/home/bmacdonald3/metar_log.sh` | `chmod +x` |
| `metar_azure_count.sh` | `/home/bmacdonald3/metar_azure_count.sh` | `chmod +x` |
| `metar_azure_clear.sh` | `/home/bmacdonald3/metar_azure_clear.sh` | `chmod +x` |
| `metar-collector.service` | `/etc/systemd/system/metar-collector.service` | root owned |

## Step-by-Step Installation

### 1. SSH to the Pi

```bash
ssh bmacdonald3@192.168.42.13
```

### 2. Verify Prerequisites

```bash
# Check Python and required packages
python3 --version
python3 -c "import pymssql; import requests; print('OK')"

# Check jq is installed (needed for shell scripts)
jq --version

# If jq is missing:
sudo apt install jq
```

### 3. Verify .env File

Your `~/.env` should have these variables (you likely already have them for BMAC3):

```bash
cat ~/.env
```

Should contain:
```
AZURE_SERVER=flight-data-server-macdonaldfamily.database.windows.net
AZURE_DATABASE=Flightdata
AZURE_USER=your_username
AZURE_PASSWORD=your_password
```

### 4. Deploy Scripts

If you have the files in your GitHub repo, just pull:

```bash
cd ~/Flightdata  # or wherever your repo is
git pull
cp metar_collector.py ~/
cp metar_*.sh ~/
chmod +x ~/metar_collector.py ~/metar_*.sh
```

Or copy manually via scp from your local machine:

```bash
scp metar_collector.py metar_*.sh bmacdonald3@192.168.42.13:~/
ssh bmacdonald3@192.168.42.13 "chmod +x ~/metar_collector.py ~/metar_*.sh"
```

### 5. Install Systemd Service

```bash
sudo cp metar-collector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable metar-collector
sudo systemctl start metar-collector
```

### 6. Verify It's Running

```bash
# Check service status
sudo systemctl status metar-collector

# Check the state file
cat ~/metar_state.json

# Watch the log
tail -f ~/metar.log
```

### 7. Test Shell Scripts

```bash
# Check status
~/metar_status.sh

# Check switch state
~/metar_switch_state.sh

# Turn off (collector will pause at next loop)
~/metar_switch_off.sh

# Turn on
~/metar_switch_on.sh

# Check Azure count
~/metar_azure_count.sh
```

## Home Assistant Configuration

### 1. Add Shell Commands

Add to your `shell_command:` section in `configuration.yaml`:

```yaml
shell_command:
  metar_switch_on: 'ssh -i /config/ssh_keys/pi_ha -o StrictHostKeyChecking=no bmacdonald3@192.168.42.13 "~/metar_switch_on.sh"'
  metar_switch_off: 'ssh -i /config/ssh_keys/pi_ha -o StrictHostKeyChecking=no bmacdonald3@192.168.42.13 "~/metar_switch_off.sh"'
  metar_restart_collector: 'ssh -i /config/ssh_keys/pi_ha -o StrictHostKeyChecking=no bmacdonald3@192.168.42.13 "sudo systemctl restart metar-collector"'
  metar_clear_azure: 'ssh -i /config/ssh_keys/pi_ha -o StrictHostKeyChecking=no bmacdonald3@192.168.42.13 "~/metar_azure_clear.sh"'
```

### 2. Add Sensors and Switch

Copy the contents of `ha_metar_config.yaml` into your configuration, or include it as a package.

### 3. Restart Home Assistant

```bash
# Check config first
ha core check

# Restart
ha core restart
```

### 4. Test in HA

Go to Developer Tools > States and search for "metar" to see all the new entities.

## Disable Azure Automation

Once the Pi collector is running and you've verified data is flowing:

1. Go to Azure Portal > Automation Accounts > metar-automation
2. Go to Schedules > Metar-1hour
3. Disable the schedule (or delete it)

You can keep the runbook code in Azure as a backup, but disable the schedule so it doesn't duplicate data.

## Troubleshooting

### Collector won't start

```bash
# Check for Python errors
journalctl -u metar-collector -n 50

# Test the script directly
python3 ~/metar_collector.py
```

### SSH from HA times out

```bash
# Test SSH from HA container
ssh -i /config/ssh_keys/pi_ha -o StrictHostKeyChecking=no bmacdonald3@192.168.42.13 "echo test"

# Check SSH key permissions
ls -la /config/ssh_keys/
```

### No data in Azure

```bash
# Check the API directly
curl "https://aviationweather.gov/api/data/metar?ids=KBOS,KJFK&format=json"

# Check database connection
python3 -c "
import os
import pymssql
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path.home() / '.env')
conn = pymssql.connect(
    server=os.environ['AZURE_SERVER'],
    user=os.environ['AZURE_USER'],
    password=os.environ['AZURE_PASSWORD'],
    database=os.environ['AZURE_DATABASE'],
    tds_version='7.3'
)
print('Connected!')
conn.close()
"
```

## Data Estimates

- 104 airports × 12 fetches/hour × 24 hours = ~30,000 rows/day
- ~900,000 rows/month
- At ~300 bytes/row = ~270 MB/month

The Pi has plenty of capacity to handle this alongside BMAC3.
