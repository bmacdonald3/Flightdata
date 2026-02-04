#!/bin/bash
python3 -c "
import json

# Disable FDPS
with open('/home/bmacdonald3/bmac3_state.json','r') as f: s=json.load(f)
s['collector_enabled']=False
with open('/home/bmacdonald3/bmac3_state.json','w') as f: json.dump(s,f,indent=2)

# Disable STDDS
with open('/home/bmacdonald3/stdds_state.json','r') as f: s=json.load(f)
s['collector_enabled']=False
with open('/home/bmacdonald3/stdds_state.json','w') as f: json.dump(s,f,indent=2)

print('OFF')
"
