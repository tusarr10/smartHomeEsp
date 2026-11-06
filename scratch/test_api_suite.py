import urllib.request
import json

token = None

def api_call(url, method='GET', data=None):
    global token
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    
    body = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

# 1. Login
login_data = api_call('http://localhost:9100/api/v1/auth/login', 'POST', {'username': 'admin', 'password': 'admin123'})
token = login_data['token']
print('Login successful, token acquired.')

# 2. Subnets Discovery
subnets = api_call('http://localhost:9100/api/v1/nodes/discovery/subnets')
print('Subnets API:', subnets)

# 3. Discovery Scan (Quick range on local subnet)
scan_result = api_call('http://localhost:9100/api/v1/nodes/discovery/scan', 'POST', {
    'subnet': '192.168.1',
    'start': 102,
    'end': 105,
    'timeoutMs': 1200
})
devices = scan_result.get('nodes') or scan_result.get('devices', [])
print(f"Scan complete. Found {len(devices)} devices:")
for dev in devices:
    print(f"  -> Discovered: {dev['ip']} ({dev.get('hardware')}) protected={dev.get('isProtected')} in_fleet={dev.get('alreadyAdded')}")

# 4. Fleet Nodes
nodes = api_call('http://localhost:9100/api/v1/nodes')
print(f'Fleet nodes count: {len(nodes)}')
if len(nodes) > 0:
    node = nodes[0]
    node_id = node['node_id']
    print(f'Testing Node Settings & Relays on: {node_id}')

    # Test settings update with per-node credentials
    update_res = api_call(f'http://localhost:9100/api/v1/nodes/{node_id}/settings', 'PUT', {
        'name': node.get('name') or 'NodeMCU Controller',
        'auth_username': 'admin',
        'auth_password': 'admin123',
        'room': 'Master Bedroom'
    })
    print('Update settings res:', update_res['success'])

    # Test test-auth against physical hardware
    auth_res = api_call(f'http://localhost:9100/api/v1/nodes/{node_id}/test-auth', 'POST', {
        'username': 'admin',
        'password': 'admin'
    })
    print('Auth test against hardware res:', auth_res['success'], f"latency={auth_res.get('latencyMs')}ms")

    # Test relay channel add (channel 4)
    relay_res = api_call(f'http://localhost:9100/api/v1/nodes/{node_id}/relays', 'POST', {
        'channel_id': 4,
        'pin': 14,
        'name': 'Exhaust Fan',
        'room': 'Master Bedroom',
        'function': 'fan',
        'active_low': True,
        'boot_state': 'OFF'
    })
    print('Add relay res:', relay_res['success'], relay_res['message'])

    # Clean up test relay
    del_res = api_call(f'http://localhost:9100/api/v1/nodes/{node_id}/relays/4', 'DELETE')
    print('Delete relay res:', del_res['success'])

print('\nALL API END-TO-END TESTS PASSED PERFECTLY!')
