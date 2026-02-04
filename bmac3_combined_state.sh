#!/bin/bash
python3 -c "
import json

fdps = json.load(open('/home/bmacdonald3/bmac3_state.json','r'))
stdds = json.load(open('/home/bmacdonald3/stdds_state.json','r'))

combined = {
    'pipeline_enabled': fdps.get('collector_enabled', False),
    'fdps_collector_running': fdps.get('collector_running', False),
    'fdps_parser_running': fdps.get('parser_running', False),
    'fdps_rows': fdps.get('total_rows_uploaded', 0),
    'fdps_last_upload': fdps.get('last_upload_time', 'never'),
    'fdps_last_count': fdps.get('last_upload_count', 0),
    'stdds_collector_running': stdds.get('collector_running', False),
    'stdds_parser_running': stdds.get('parser_running', False),
    'stdds_rows': stdds.get('total_rows_uploaded', 0),
    'stdds_last_upload': stdds.get('last_upload_time', 'never'),
    'stdds_last_count': stdds.get('last_upload_count', 0),
    'total_rows': fdps.get('total_rows_uploaded', 0) + stdds.get('total_rows_uploaded', 0),
    'error': fdps.get('error') or stdds.get('error')
}
print(json.dumps(combined))
"
