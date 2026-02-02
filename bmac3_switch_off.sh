#!/bin/bash
python3 -c "
import json
with open('/home/bmacdonald3/bmac3_state.json','r') as f: s=json.load(f)
s['collector_enabled']=False
with open('/home/bmacdonald3/bmac3_state.json','w') as f: json.dump(s,f,indent=2)
print('OFF')
"
