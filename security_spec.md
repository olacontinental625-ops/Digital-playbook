# OLA Continental Digital Logbook — Security Specification (Phase 0)

## 1. Data Invariants

1. **Single-Administrator Lock**: Only ONE administrator document can ever be claimed (`config/adminLock` and `admins/{uid}` + `publicStatus/admin`). Once `config/adminLock` exists, all future writes to `config/adminLock`, `admins/{uid}`, and `publicStatus/admin` are rejected.
2. **PII Isolation**: User profiles (`/users/{userId}`) contain email and phone PII and are readable only by the owning user (`request.auth.uid == userId`) or the sole administrator. Standard users cannot list `/users`, `/properties`, `/rooms`, `/transactions`, `/auditLogs`, or other people's `/occupants`.
3. **Aggregate-Only Public Summary**: Standard signed-in users may read `/summary/dashboard` containing aggregate counts (`totalOccupants`, `notPaidCount`, `totalUnpaidBalance`) with zero personal identifiers.
4. **Immutable Ledgers & Timestamps**: `createdAt` is validated against `request.time` and immutable after creation. `transactions` and `auditLogs` cannot be deleted or tampered with by standard users; `auditLogs` cannot be updated or deleted even by the admin.
5. **Query Enforcer**: `allow list` never relies on client filtering alone and never performs `get()` or `exists()` lookups; list rules directly check `resource.data.adminUid == request.auth.uid` or `resource.data.userId == request.auth.uid`.

## 2. "Dirty Dozen" Adversarial Payloads

1. **Second Admin Takeover**: Non-admin user attempts `setDoc(doc(db, 'admins', attackerUid), ...)` after `config/adminLock` exists -> `PERMISSION_DENIED`.
2. **Admin Lock Overwrite**: Attacker attempts `updateDoc(doc(db, 'config', 'adminLock'), { adminUid: attackerUid })` -> `PERMISSION_DENIED`.
3. **Public Status Flip**: Attacker attempts `setDoc(doc(db, 'publicStatus', 'admin'), { claimed: false })` -> `PERMISSION_DENIED`.
4. **Cross-User Profile Read**: Standard user A attempts `getDoc(doc(db, 'users', userBUid))` -> `PERMISSION_DENIED`.
5. **User Profile List Scraping**: Standard user attempts `getDocs(collection(db, 'users'))` -> `PERMISSION_DENIED`.
6. **Shadow Field Injection on User Profile**: Standard user includes `isAdmin: true` or `role: 'admin'` in `setDoc(doc(db, 'users', uid), ...)` -> `PERMISSION_DENIED`.
7. **Timestamp Spoofing**: Standard user sets `createdAt: new Date('2020-01-01')` instead of `serverTimestamp()` -> `PERMISSION_DENIED`.
8. **ID Poisoning**: User attempts write to `/users/${'a'.repeat(300)}` -> `PERMISSION_DENIED`.
9. **Unauthorized Occupant Write**: Standard user attempts `addDoc(collection(db, 'occupants'), ...)` -> `PERMISSION_DENIED`.
10. **Unscoped Occupant List**: Standard user runs `getDocs(collection(db, 'occupants'))` without `where('userId', '==', uid)` -> `PERMISSION_DENIED`.
11. **Summary Tampering**: Standard user attempts `updateDoc(doc(db, 'summary', 'dashboard'), { totalUnpaidBalance: 0 })` -> `PERMISSION_DENIED`.
12. **Audit Log Deletion**: Any user attempts `deleteDoc(doc(db, 'auditLogs', logId))` -> `PERMISSION_DENIED`.
