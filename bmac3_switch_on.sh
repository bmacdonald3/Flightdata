#!/bin/bash
python3 -c "
import json

# Enable FDPS
with open('/home/bmacdonald3/bmac3_state.json','r') as f: s=json.load(f)
s['collector_enabled']=True
with open('/home/bmacdonald3/bmac3_state.json','w') as f: json.dump(s,f,indent=2)

# Enable STDDS
with open('/home/bmacdonald3/stdds_state.json','r') as f: s=json.load(f)
s['collector_enabled']=True
with open('/home/bmacdonald3/stdds_state.json','w') as f: json.dump(s,f,indent=2)

print('ON')
"
