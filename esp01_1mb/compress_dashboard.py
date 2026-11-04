import gzip

html = """<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ESP-01 Setup</title><style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;margin:0;padding:16px;display:flex;justify-content:center}
.c{background:#1e293b;border-radius:12px;padding:22px;width:100%;max-width:400px;border:1px solid #334155;box-shadow:0 8px 24px rgba(0,0,0,0.4)}
h2,h3{color:#38bdf8;margin:0 0 10px 0;font-size:1.1rem;font-weight:700}
label{font-size:0.75rem;color:#94a3b8;display:block;margin:8px 0 3px}
input,select,button{width:100%;padding:9px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:0.85rem}
button{background:#0284c7;border:none;font-weight:600;cursor:pointer;margin-top:10px;transition:0.2s}
button:hover{background:#0369a1}
.btn-s{background:#334155;margin-top:6px;padding:7px;font-size:0.8rem}
.btn-s:hover{background:#475569}
.btn-p{background:#7c3aed}.btn-p:hover{background:#6d28d9}
.btn-d{background:#475569;margin-top:8px}
.badge{display:inline-block;padding:3px 9px;border-radius:99px;font-size:0.75rem;font-weight:600;margin-bottom:12px}
.b-ok{background:#14532d;color:#4ade80}
.b-warn{background:#713f12;color:#facc15}
.b-err{background:#7f1d1d;color:#f87171}
.msg{font-size:0.8rem;margin-top:8px;min-height:1.2em;text-align:center;color:#38bdf8}
.row{display:flex;gap:6px}.row select{flex:1}.row button{width:auto;margin:0;white-space:nowrap}
hr{border:none;border-top:1px solid #334155;margin:16px 0}
</style></head><body><div class='c'>
<h2>⚡ ESP-01 Satellite</h2>
<div id='st' class='badge b-warn'>Connecting...</div>

<div id='sec-auth' style='display:none;'>
<h3>🔐 Login</h3>
<input id='u' placeholder='Username' value='admin'>
<input type='password' id='p' placeholder='Password' style='margin-top:8px;'>
<button onclick='lg()'>Sign In</button>
</div>

<div id='sec-main' style='display:none;'>
<h3>🌐 Wi-Fi & Central Server</h3>
<label>Nearby Wi-Fi:</label>
<div class='row'>
<select id='wl' onchange='selW(this)'><option value=''>-- Select or Scan Below --</option></select>
<button type='button' class='btn-s' id='sb' onclick='sc()'>🔍 Scan</button>
</div>
<label>Wi-Fi SSID:</label>
<input id='ssid' placeholder='SSID'>
<label>Wi-Fi Password:</label>
<input type='password' id='pass' placeholder='Password'>
<label>Central Server (IP:Port):</label>
<input id='srv' placeholder='e.g. 192.168.1.10:2000'>
<button onclick='cf()'>Save & Connect</button>
<div id='conn-info' style='margin-top:6px;font-size:0.8rem;'></div>

<hr>
<h3>🔑 Change Admin Password</h3>
<input type='password' id='cp' placeholder='Current Password'>
<input type='password' id='np' placeholder='New Password (min 4 chars)' style='margin-top:8px;'>
<button onclick='chp()' class='btn-s'>Update Password</button>

<hr>
<h3>🚀 Firmware OTA</h3>
<form method='POST' action='/api/ota/upload' enctype='multipart/form-data'>
<input type='file' name='update' accept='.bin' required>
<button type='submit' class='btn-p'>Flash Firmware (.bin)</button>
</form>

<button onclick='rb()' class='btn-d'>Reboot Device</button>
</div>
<div id='m' class='msg'></div>
</div>

<script>
function sm(t,c){let e=document.getElementById('m');e.innerText=t;e.style.color=c||'#38bdf8';}
function chk(){
fetch('/api/auth/check').then(r=>r.json()).then(d=>{
if(d.authenticated){
document.getElementById('sec-auth').style.display='none';
document.getElementById('sec-main').style.display='block';
}else{
document.getElementById('sec-auth').style.display='block';
document.getElementById('sec-main').style.display='none';
}
}).catch(()=>{document.getElementById('sec-main').style.display='block';});
uSt();
}
function uSt(){
fetch('/api/status').then(r=>r.json()).then(d=>{
let b=document.getElementById('st');
if(d.staConnected){
b.className='badge b-ok';
b.innerText='✅ Connected: '+d.ssid+' ('+d.ip+')';
}else{
b.className='badge b-warn';
b.innerText='⚠️ AP Mode: '+d.ip;
}
if(!document.getElementById('ssid').value&&d.ssid)document.getElementById('ssid').value=d.ssid;
if(!document.getElementById('srv').value&&d.receiverServer)document.getElementById('srv').value=d.receiverServer;
});
}
function lg(){
fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('u').value,password:document.getElementById('p').value})})
.then(r=>r.json()).then(d=>{if(d.success){sm('Logged in!');chk();}else sm('Invalid password','#f87171');});
}
function sc(){
let b=document.getElementById('sb');b.innerText='⏳...';b.disabled=true;
fetch('/api/wifi/scan').then(r=>r.json()).then(list=>{
let s=document.getElementById('wl');s.innerHTML='<option value="">-- Select Discovered Wi-Fi --</option>';
list.forEach(n=>{
let opt=document.createElement('option');
opt.value=n.ssid;
opt.innerText=n.ssid+' ('+n.rssi+' dBm)'+(n.enc?' 🔒':'');
s.appendChild(opt);
});
b.innerText='🔍 Scan';b.disabled=false;
sm('Discovered '+list.length+' network(s)');
}).catch(()=>{b.innerText='🔍 Scan';b.disabled=false;sm('Scan failed','#f87171');});
}
function selW(e){if(e.value)document.getElementById('ssid').value=e.value;}
function cf(){
let s=document.getElementById('srv').value.split(':');
let b={ssid:document.getElementById('ssid').value,password:document.getElementById('pass').value};
if(s[0]){b.serverHost=s[0];b.serverPort=parseInt(s[1]||'2000');}
sm('Connecting to '+b.ssid+'... please wait');
let ci=document.getElementById('conn-info');ci.innerText='Connecting to router...';ci.style.color='#facc15';
fetch('/api/wifi/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})
.then(r=>r.json()).then(d=>{
sm(d.message||'Credentials sent!');
let tries=0;
let t=setInterval(()=>{
tries++;
fetch('/api/status').then(r=>r.json()).then(st=>{
if(st.staConnected){
clearInterval(t);
ci.innerText='✅ Connected! IP: '+st.ip+' (Signal: '+st.rssi+' dBm)';
ci.style.color='#4ade80';
uSt();
}else if(tries>=12){
clearInterval(t);
ci.innerText='❌ Connection failed. Check password and router.';
ci.style.color='#f87171';
}
});
},1500);
});
}
function chp(){
let cp=document.getElementById('cp').value;let np=document.getElementById('np').value;
if(!np||np.length<4){sm('New password too short (min 4 chars)','#f87171');return;}
fetch('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:cp,newPassword:np})})
.then(r=>r.json()).then(d=>{
if(d.success){sm('Admin password updated successfully!','#4ade80');document.getElementById('cp').value='';document.getElementById('np').value='';}
else sm(d.error||'Failed to change password','#f87171');
});
}
function rb(){if(confirm('Reboot ESP-01?'))fetch('/api/system/reboot',{method:'POST'}).then(()=>sm('Rebooting...'));}
chk();setInterval(uSt,4000);
</script></body></html>"""

gz = gzip.compress(html.encode('utf-8'), 9)
print(f'Raw HTML: {len(html.encode("utf-8"))} bytes')
print(f'Gzipped:  {len(gz)} bytes ({len(gz)/len(html.encode("utf-8"))*100:.1f}%)')

lines = []
for i in range(0, len(gz), 16):
    chunk = gz[i:i+16]
    lines.append('    ' + ', '.join(f'0x{b:02x}' for b in chunk))
c_array = 'static const uint8_t DASHBOARD_HTML_GZ[] PROGMEM = {\n' + ',\n'.join(lines) + '\n};\n'
c_array += f'#define DASHBOARD_HTML_GZ_LEN {len(gz)}\n'
with open('esp01_1mb/src/dashboard_html.h', 'w') as f:
    f.write('#ifndef DASHBOARD_HTML_H\n#define DASHBOARD_HTML_H\n\n#include <Arduino.h>\n\n' + c_array + '\n#endif // DASHBOARD_HTML_H\n')
print(f'Generated dashboard_html.h successfully ({len(gz)} bytes)')
