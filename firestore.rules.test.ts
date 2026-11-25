/**
 * Verification matrix for the 12 Dirty Dozen security scenarios defined in security_spec.md.
 * Documents the expected PERMISSION_DENIED outcomes enforced by firestore.rules.
 */
export const DIRTY_DOZEN_TEST_CASES = [
  { id: 1, name: 'Second Admin Takeover', path: 'admins/attacker', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Admin Lock Overwrite', path: 'config/adminLock', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Public Status Flip', path: 'publicStatus/admin', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Cross-User Profile Read', path: 'users/otherUser', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'User Profile List Scraping', path: 'users', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Shadow Field Injection', path: 'users/self', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Timestamp Spoofing', path: 'users/self', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'ID Poisoning', path: 'users/long_id', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Unauthorized Occupant Write', path: 'occupants/occ1', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Unscoped Occupant List', path: 'occupants', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Summary Tampering', path: 'summary/dashboard', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Audit Log Deletion', path: 'auditLogs/log1', expected: 'PERMISSION_DENIED' },
] as const;
