# ECOSYSTEM CONTRIBUTING GUIDELINES

**Scope**: Code Conventions, Pull Request Process, and Embedded Safety Rules  

---

## 1. Embedded Safety Guidelines

When modifying microcontroller firmware:
1. **Never Introduce Blocking Delays in `loop()`**: All delays must use non-blocking `millis()` timing arithmetic. Never call `delay()` inside event loops.
2. **Always Call `yield()`**: The ESP8266 software watchdog timer resets the chip if the main loop stalls for > 1.6s. Call `yield()` in long loops.
3. **Avoid Dynamic Heap Allocation**: Avoid `String` concatenation (`+`) inside tight loops; use stack buffers `char buf[256]` or `snprintf()`.
4. **Adhere to Pin Safety Matrix**: Never assign relay outputs to boot-sensitive pins (GPIO 0, 2, 15) without optocoupler isolation.

---

## 2. Server Development Guidelines

1. **Use Prepared Statements**: Never construct raw SQL strings; use `db.prepare('...').run(?)` to prevent SQL injection.
2. **Enforce RBAC**: All new routes in `v1Router.js` must be wrapped with `requirePermission(db, 'permission:code')`.
3. **No External CDN Dependencies**: The frontend must remain fully functional in offline, air-gapped industrial LAN environments.
