#!/bin/bash
python3 -c "
import json
with open('/home/bmacdonald3/bmac3_state.json','r') as f: s=json.load(f)
print('ON' if s.get('collector_enabled',True) else 'OFF')
"
