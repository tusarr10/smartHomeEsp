# CENTRAL SERVER FRONTEND ARCHITECTURE

**Technology**: Pure Vanilla HTML5, Modern CSS3, ECMAScript 2022 JavaScript  
**Framework**: Zero-Dependency Single Page Application (SPA)  
**Source Files**: [`central_server_js/public/index.html`](file:///d:/ai/Homeautomation_server/central_server_js/public/index.html), [`central_server_js/public/assets/app.js`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js), [`central_server_js/public/assets/style.css`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/style.css)  

---

## 1. Architectural Strategy: Zero-Build Standalone SPA

The frontend eliminates Webpack, Vite, React, and Babel build pipelines:
- No `node_modules` or `npm run build` required for frontend assets.
- Changes made to `app.js` or `style.css` take effect immediately on browser refresh.
- Offline-capable: Contains zero external CDN font or library links, ensuring the system operates in completely air-gapped industrial LAN environments.

---

## 2. Global State Store & Transparent Fetch Interceptor

In [`app.js`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js#L5-L63):

```javascript
// Native fetch wrapped in transparent authentication interceptor
window.fetch = async function(resource, init = {}) {
  // 1. Automatically attaches Bearer token from localStorage
  if (authToken && urlStr.includes('/api/')) {
    init.headers['Authorization'] = `Bearer ${authToken}`;
  }
  let res = await _nativeFetch(resource, init);
  
  // 2. Auto-login recovery on HTTP 401 Unauthorized
  if (res.status === 401 && !urlStr.includes('/auth/login')) {
    const loginRes = await _nativeFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    // Auto-refreshes token and retries original request
  }
  return res;
};
```

---

## 3. Real-Time Communication Pipeline

The frontend maintains dual real-time channels:

1. **WebSocket Connection (`connectWebSocket()`)**:
   - Connects to `ws://${window.location.host}/api/v1/ws`.
   - On connection, receives immediate `initial_state` snapshot containing fleet overview, stats, and nodes.
   - Listens for granular events:
     - `node_status`: Node online/offline transition.
     - `telemetry`: Inbound telemetry packet (updates free heap, RSSI, uptime in real-time).
     - `relay_changed`: Remote relay state transition (updates UI toggle switch instantly without reloading).
     - `config_updated` / `config_synced`: Configuration status updates.
     - `notification`: Pushes new alert toast to the notification drawer.
   - Automatically reconnects with exponential backoff if the socket disconnects.

2. **Server-Sent Events (SSE) Fallback (`initSSE()`)**:
   - Secondary listener connecting to `/api/events`.
   - Ensures continuous live updates even in corporate proxy environments that terminate WebSocket connections.
