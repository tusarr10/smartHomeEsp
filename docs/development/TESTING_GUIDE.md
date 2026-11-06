# ECOSYSTEM TESTING & BENCHMARKING GUIDE

**Scope**: Test Scripts, Integration Suites, and Stress Test Procedures  

---

## 1. Automated Integration Test Suite

The Central Server includes an internal integration test verifying RBAC permissions, command queuing, and configuration sync:

```powershell
cd d:\ai\Homeautomation_server\central_server_js
node test_rbac_commands_sync.js
```

### Verified Test Cases:
1. User creation and salted PBKDF2 hash verification.
2. RBAC permission checks: Verifies VIEWER role is blocked from dispatching commands (HTTP 403).
3. Command enqueuing in `device_commands`.
4. Configuration versioning and rollback in `configuration_versions`.

---

## 2. Hardware Concurrency & Protocol Stress Testing

The workspace includes empirical Python test suites that exercise live microcontrollers:

### Multi-Client Concurrency Stress Test (`stress_test/`):
```powershell
cd d:\ai\Homeautomation_server\stress_test
python phase3_phase4_stress.py
```
- Spawns concurrent threads querying `/api/status`, `/api/gpio`, and `/index.html`.
- Measures latency percentiles, heap dip, and socket reclamation.
- Automatically generates PNG visual graphs (`api_latency_graph.png`, `heap_stress_graph.png`).

### Event Heap Audit (`event_audit/`):
```powershell
cd d:\ai\Homeautomation_server\event_audit
python event_heap_audit.py
```
- Triggers high-frequency relay state transitions.
- Records memory recovery curves and heap fragmentation metrics.
