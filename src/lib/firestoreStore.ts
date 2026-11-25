import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  calculateExpiryDate,
  calculatePaymentMetrics,
  formatDurationLabel,
  getTodayIso,
} from '../../shared/paymentCalc.ts';
import type {
  AppSettingsRecord,
  AuditLogRecord,
  CustomColumnConfig,
  DashboardSummary,
  LogbookEntry,
  NotificationRecord,
  PaymentTransactionRecord,
  PropertyRecord,
  RoomRecord,
  UserProfile,
} from '../../shared/types.ts';
import {
  db,
  handleFirestoreError,
  OperationType,
  storage,
} from './firebase.ts';
import type { CsvImportPreviewRow } from './csvImport.ts';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

// -----------------------------------------------------------------------------
// Admin Claim & User Profile Helpers
// -----------------------------------------------------------------------------

export async function getAdminClaimStatus(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'publicStatus', 'admin'));
    return snap.exists() && Boolean(snap.data()?.claimed);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'publicStatus/admin');
  }
}

export async function verifyUserIsAdmin(user: User): Promise<boolean> {
  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    return adminSnap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `admins/${user.uid}`);
  }
}

export async function fetchAdminProfile(uid: string): Promise<{ uid: string; email: string; fullName: string } | null> {
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid: String(d.uid || uid),
      email: String(d.email || ''),
      fullName: String(d.fullName || 'Administrator'),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `admins/${uid}`);
  }
}

export async function claimSingleAdministrator(user: User, fullName: string): Promise<void> {
  const email = (user.email || '').trim().toLowerCase();
  const cleanName = fullName.trim().slice(0, 120) || user.displayName || 'Administrator';

  const claimBatch = writeBatch(db);
  claimBatch.set(doc(db, 'admins', user.uid), {
    uid: user.uid,
    email,
    fullName: cleanName,
    createdAt: serverTimestamp(),
  });

  claimBatch.set(doc(db, 'config', 'adminLock'), {
    adminUid: user.uid,
    adminEmail: email,
    adminFullName: cleanName,
    claimedAt: serverTimestamp(),
  });

  claimBatch.set(doc(db, 'publicStatus', 'admin'), {
    claimed: true,
    updatedAt: serverTimestamp(),
  });

  try {
    await claimBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'admins/claim');
  }

  const initBatch = writeBatch(db);
  initBatch.set(doc(db, 'settings', 'default'), {
    adminUid: user.uid,
    onesignalAppId: '',
    currencySymbol: '₦',
    currencyCode: 'NGN',
    autoCheckEnabled: true,
    monthlyReportDay: 1,
    updatedAt: serverTimestamp(),
  });

  initBatch.set(doc(db, 'summary', 'dashboard'), {
    adminUid: user.uid,
    totalOccupants: 0,
    totalRooms: 0,
    paidCount: 0,
    notPaidCount: 0,
    expiringThisMonth: 0,
    expiringWithin7Days: 0,
    totalCollected: 0,
    totalUnpaidBalance: 0,
    currencySymbol: '₦',
    currencyCode: 'NGN',
    hasSampleData: false,
    updatedAt: serverTimestamp(),
  });

  try {
    await initBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'settings/summary_init');
  }
}

export async function upsertUserProfile(
  user: User,
  payload: { fullName: string; phone: string; authProvider: 'password' | 'google' },
): Promise<UserProfile> {
  const userRef = doc(db, 'users', user.uid);
  try {
    const existing = await getDoc(userRef);
    if (!existing.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        fullName: payload.fullName.trim().slice(0, 120) || user.displayName || 'User',
        email: (user.email || '').trim().toLowerCase().slice(0, 160),
        phone: payload.phone.trim().slice(0, 40),
        authProvider: payload.authProvider,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (payload.phone || payload.fullName) {
      const data = existing.data();
      await updateDoc(userRef, {
        fullName: (payload.fullName || data.fullName || 'User').trim().slice(0, 120),
        phone: (payload.phone || data.phone || '').trim().slice(0, 40),
        updatedAt: serverTimestamp(),
      });
    }

    const updatedSnap = await getDoc(userRef);
    const d = updatedSnap.data()!;
    return {
      uid: d.uid,
      fullName: d.fullName,
      email: d.email,
      phone: d.phone || '',
      authProvider: d.authProvider,
      createdAt: toIsoString(d.createdAt),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
  }
}

export async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid: d.uid,
      fullName: d.fullName,
      email: d.email,
      phone: d.phone || '',
      authProvider: d.authProvider,
      createdAt: toIsoString(d.createdAt),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }
}

export async function fetchPublicSummary(): Promise<DashboardSummary> {
  try {
    const snap = await getDoc(doc(db, 'summary', 'dashboard'));
    if (!snap.exists()) {
      return {
        totalOccupants: 0,
        totalRooms: 0,
        paidOccupants: 0,
        notPaidOccupants: 0,
        expiringThisMonth: 0,
        expiringWithin7Days: 0,
        totalAmountCollected: 0,
        totalUnpaidBalance: 0,
        hasSampleData: false,
        currencySymbol: '₦',
        currencyCode: 'NGN',
      };
    }
    const d = snap.data();
    return {
      totalOccupants: Number(d.totalOccupants || 0),
      totalRooms: Number(d.totalRooms || 0),
      paidOccupants: Number(d.paidCount || 0),
      notPaidOccupants: Number(d.notPaidCount || 0),
      expiringThisMonth: Number(d.expiringThisMonth || 0),
      expiringWithin7Days: Number(d.expiringWithin7Days || 0),
      totalAmountCollected: Number(d.totalCollected || 0),
      totalUnpaidBalance: Number(d.totalUnpaidBalance || 0),
      hasSampleData: Boolean(d.hasSampleData),
      currencySymbol: String(d.currencySymbol || '₦'),
      currencyCode: String(d.currencyCode || 'NGN'),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'summary/dashboard');
  }
}

export async function fetchPersonalOccupantRecords(user: User): Promise<LogbookEntry[]> {
  const today = getTodayIso();
  try {
    const results = new Map<string, LogbookEntry>();
    const qUid = query(collection(db, 'occupants'), where('userId', '==', user.uid));
    const snapUid = await getDocs(qUid);

    const mapDoc = (docSnap: { id: string; data: () => Record<string, unknown> }): LogbookEntry => {
      const d = docSnap.data();
      const metrics = calculatePaymentMetrics(
        String(d.commencementDate || ''),
        String(d.expiryDate || ''),
        Number(d.durationMonths || 0),
        today,
      );
      return {
        id: docSnap.id,
        serialNumber: Number(d.serialNumber || 1),
        fullName: String(d.fullName || ''),
        phone: String(d.phone || ''),
        email: String(d.email || ''),
        userId: String(d.userId || ''),
        propertyId: String(d.propertyId || ''),
        propertyName: String(d.propertyName || ''),
        roomId: String(d.roomId || ''),
        roomNumber: String(d.roomNumber || ''),
        notes: String(d.notes || ''),
        customFields: (d.customFields as Record<string, string>) || {},
        isArchived: Boolean(d.isArchived),
        isSample: Boolean(d.isSample),
        createdAt: toIsoString(d.createdAt),
        updatedAt: toIsoString(d.updatedAt),
        latestPeriodId: null,
        transactionDate: d.transactionDate ? String(d.transactionDate) : null,
        amountPaid: Number(d.amountPaid || 0),
        unpaidBalance: Number(d.unpaidBalance || 0),
        durationMonths: Number(d.durationMonths || 0),
        durationLabel: d.durationLabel ? String(d.durationLabel) : null,
        commencementDate: d.commencementDate ? String(d.commencementDate) : null,
        expiryDate: d.expiryDate ? String(d.expiryDate) : null,
        remarks: String(d.remarks || d.notes || ''),
        monthsUsed: metrics.monthsUsed,
        monthsRemaining: metrics.monthsRemaining,
        daysRemaining: metrics.daysRemaining,
        status: metrics.status,
        isExpired: metrics.isExpired,
        isExpiringWithin7Days: metrics.isExpiringWithin7Days,
        isExpiringWithin30Days: metrics.isExpiringWithin30Days,
        isExpiringThisMonth: metrics.isExpiringThisMonth,
        urgencyLevel: metrics.urgencyLevel,
      };
    };

    for (const s of snapUid.docs) results.set(s.id, mapDoc(s));

    if (user.email && user.emailVerified) {
      const qEmail = query(
        collection(db, 'occupants'),
        where('email', '==', user.email.toLowerCase()),
      );
      const snapEmail = await getDocs(qEmail);
      for (const s of snapEmail.docs) results.set(s.id, mapDoc(s));
    }

    return Array.from(results.values()).filter((e) => !e.isArchived);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'occupants/personal');
  }
}

// -----------------------------------------------------------------------------
// Admin Workspace Read & Sync Helpers
// -----------------------------------------------------------------------------

export interface AdminWorkspaceBundle {
  properties: PropertyRecord[];
  rooms: RoomRecord[];
  entries: LogbookEntry[];
  transactions: PaymentTransactionRecord[];
  customColumns: CustomColumnConfig[];
  notifications: NotificationRecord[];
  auditLogs: AuditLogRecord[];
  settings: AppSettingsRecord;
  summary: DashboardSummary;
}

export async function fetchAdminWorkspaceBundle(adminUid: string): Promise<AdminWorkspaceBundle> {
  const today = getTodayIso();

  try {
    const [propSnap, roomSnap, occSnap, txSnap, colSnap, notifSnap, auditSnap, settingsSnap] =
      await Promise.all([
        getDocs(query(collection(db, 'properties'), where('adminUid', '==', adminUid))),
        getDocs(query(collection(db, 'rooms'), where('adminUid', '==', adminUid))),
        getDocs(query(collection(db, 'occupants'), where('adminUid', '==', adminUid))),
        getDocs(query(collection(db, 'transactions'), where('adminUid', '==', adminUid))),
        getDocs(query(collection(db, 'customColumns'), where('adminUid', '==', adminUid))),
        getDocs(query(collection(db, 'notifications'), where('adminUid', '==', adminUid))),
        getDocs(query(collection(db, 'auditLogs'), where('adminUid', '==', adminUid))),
        getDoc(doc(db, 'settings', 'default')),
      ]);

    const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};
    const settings: AppSettingsRecord = {
      onesignalAppId: String(settingsData.onesignalAppId || ''),
      onesignalRestKeyConfigured: false,
      currencySymbol: String(settingsData.currencySymbol || '₦'),
      currencyCode: String(settingsData.currencyCode || 'NGN'),
      autoCheckEnabled: settingsData.autoCheckEnabled !== false,
      monthlyReportDay: Number(settingsData.monthlyReportDay || 1),
    };

    const entries: LogbookEntry[] = occSnap.docs
      .map((s) => {
        const d = s.data();
        const metrics = calculatePaymentMetrics(
          String(d.commencementDate || ''),
          String(d.expiryDate || ''),
          Number(d.durationMonths || 0),
          today,
        );
        return {
          id: s.id,
          serialNumber: Number(d.serialNumber || 1),
          fullName: String(d.fullName || ''),
          phone: String(d.phone || ''),
          email: String(d.email || ''),
          userId: String(d.userId || ''),
          propertyId: String(d.propertyId || ''),
          propertyName: String(d.propertyName || ''),
          roomId: String(d.roomId || ''),
          roomNumber: String(d.roomNumber || ''),
          notes: String(d.notes || ''),
          customFields: (d.customFields as Record<string, string>) || {},
          isArchived: Boolean(d.isArchived),
          isSample: Boolean(d.isSample),
          createdAt: toIsoString(d.createdAt),
          updatedAt: toIsoString(d.updatedAt),
          latestPeriodId: null,
          transactionDate: d.transactionDate ? String(d.transactionDate) : null,
          amountPaid: d.amountPaid !== undefined ? Number(d.amountPaid) : null,
          unpaidBalance: Number(d.unpaidBalance || 0),
          durationMonths: d.durationMonths !== undefined ? Number(d.durationMonths) : null,
          durationLabel: d.durationLabel ? String(d.durationLabel) : null,
          commencementDate: d.commencementDate ? String(d.commencementDate) : null,
          expiryDate: d.expiryDate ? String(d.expiryDate) : null,
          remarks: String(d.remarks || d.notes || ''),
          monthsUsed: metrics.monthsUsed,
          monthsRemaining: metrics.monthsRemaining,
          daysRemaining: metrics.daysRemaining,
          status: metrics.status,
          isExpired: metrics.isExpired,
          isExpiringWithin7Days: metrics.isExpiringWithin7Days,
          isExpiringWithin30Days: metrics.isExpiringWithin30Days,
          isExpiringThisMonth: metrics.isExpiringThisMonth,
          urgencyLevel: metrics.urgencyLevel,
        };
      })
      .filter((e) => !e.isArchived)
      .sort((a, b) => a.serialNumber - b.serialNumber);

    const occupantByRoom = new Map<string, LogbookEntry>();
    const occupiedCountByProp = new Map<string, number>();
    for (const e of entries) {
      occupantByRoom.set(e.roomId, e);
      occupiedCountByProp.set(e.propertyId, (occupiedCountByProp.get(e.propertyId) || 0) + 1);
    }

    const rooms: RoomRecord[] = roomSnap.docs
      .map((s) => {
        const d = s.data();
        const occ = occupantByRoom.get(s.id);
        return {
          id: s.id,
          propertyId: String(d.propertyId || ''),
          propertyName: String(d.propertyName || ''),
          roomNumber: String(d.roomNumber || ''),
          floorOrWing: String(d.floorOrWing || ''),
          notes: String(d.notes || ''),
          isSample: Boolean(d.isSample),
          activeOccupantId: occ?.id ?? null,
          activeOccupantName: occ?.fullName ?? null,
          activeOccupantStatus: occ?.status ?? null,
          createdAt: toIsoString(d.createdAt),
        };
      })
      .sort((a, b) =>
        `${a.propertyName}:${a.roomNumber}`.localeCompare(`${b.propertyName}:${b.roomNumber}`),
      );

    const roomCountByProp = new Map<string, number>();
    for (const r of rooms) {
      roomCountByProp.set(r.propertyId, (roomCountByProp.get(r.propertyId) || 0) + 1);
    }

    const properties: PropertyRecord[] = propSnap.docs
      .map((s) => {
        const d = s.data();
        return {
          id: s.id,
          name: String(d.name || ''),
          address: String(d.address || ''),
          description: String(d.description || ''),
          isSample: Boolean(d.isSample),
          roomCount: roomCountByProp.get(s.id) || 0,
          occupiedCount: occupiedCountByProp.get(s.id) || 0,
          createdAt: toIsoString(d.createdAt),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const transactions: PaymentTransactionRecord[] = txSnap.docs
      .map((s) => {
        const d = s.data();
        return {
          id: s.id,
          occupantId: String(d.occupantId || ''),
          occupantName: String(d.occupantName || ''),
          serialNumber: Number(d.serialNumber || 0),
          propertyName: String(d.propertyName || ''),
          roomNumber: String(d.roomNumber || ''),
          periodId: s.id,
          transactionDate: String(d.transactionDate || ''),
          amountReceived: Number(d.amountReceived || 0),
          durationMonths: Number(d.durationMonths || 1),
          durationLabel: String(d.durationLabel || ''),
          commencementDate: String(d.commencementDate || ''),
          expiryDate: String(d.expiryDate || ''),
          transactionRef: String(d.transactionRef || ''),
          recordedBy: String(d.recordedBy || ''),
          remarks: String(d.remarks || ''),
          receiptUrl: d.receiptUrl ? String(d.receiptUrl) : undefined,
          isCorrection: Boolean(d.isCorrection),
          correctionNote: String(d.correctionNote || ''),
          isSample: Boolean(d.isSample),
          createdAt: toIsoString(d.createdAt),
        };
      })
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt));

    const customColumns: CustomColumnConfig[] = colSnap.docs
      .map((s) => {
        const d = s.data();
        return {
          id: s.id,
          columnKey: String(d.columnKey || ''),
          label: String(d.label || ''),
          fieldType: (d.fieldType as 'text' | 'number' | 'date') || 'text',
          sortOrder: Number(d.sortOrder || 0),
          isVisible: d.isVisible !== false,
          createdAt: toIsoString(d.createdAt),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const notifications: NotificationRecord[] = notifSnap.docs
      .map((s) => {
        const d = s.data();
        return {
          id: s.id,
          occupantId: d.occupantId ? String(d.occupantId) : null,
          ruleType: String(d.ruleType || ''),
          reminderDate: String(d.reminderDate || ''),
          title: String(d.title || ''),
          message: String(d.message || ''),
          channel: 'firestore',
          deliveryStatus: String(d.deliveryStatus || 'sent'),
          onesignalNotificationId: null,
          errorMessage: null,
          recipientCount: 1,
          createdAt: toIsoString(d.createdAt),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const auditLogs: AuditLogRecord[] = auditSnap.docs
      .map((s) => {
        const d = s.data();
        return {
          id: s.id,
          actorName: String(d.actorName || ''),
          action: String(d.action || ''),
          entityType: String(d.entityType || ''),
          entityId: String(d.entityId || ''),
          details: { summary: String(d.detailsSummary || '') },
          createdAt: toIsoString(d.createdAt),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    let paidOccupants = 0;
    let notPaidOccupants = 0;
    let expiringThisMonth = 0;
    let expiringWithin7Days = 0;
    let totalUnpaidBalance = 0;
    let hasSampleData = false;

    for (const e of entries) {
      if (e.isSample) hasSampleData = true;
      totalUnpaidBalance += Math.max(0, Number(e.unpaidBalance || 0));
      if (e.status === 'PAID') {
        paidOccupants++;
        if (e.isExpiringThisMonth) expiringThisMonth++;
        if (e.isExpiringWithin7Days) expiringWithin7Days++;
      } else {
        notPaidOccupants++;
      }
    }

    const totalAmountCollected = Math.max(
      0,
      transactions.reduce((sum, t) => sum + t.amountReceived, 0),
    );

    const summary: DashboardSummary = {
      totalOccupants: entries.length,
      totalRooms: rooms.length,
      paidOccupants,
      notPaidOccupants,
      expiringThisMonth,
      expiringWithin7Days,
      totalAmountCollected,
      totalUnpaidBalance,
      hasSampleData,
      currencySymbol: settings.currencySymbol,
      currencyCode: settings.currencyCode,
    };

    return {
      properties,
      rooms,
      entries,
      transactions,
      customColumns,
      notifications,
      auditLogs,
      settings,
      summary,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'admin_workspace');
  }
}

export async function syncDashboardSummaryDoc(adminUid: string): Promise<void> {
  const bundle = await fetchAdminWorkspaceBundle(adminUid);
  const { summary } = bundle;
  try {
    await setDoc(doc(db, 'summary', 'dashboard'), {
      adminUid,
      totalOccupants: summary.totalOccupants,
      totalRooms: summary.totalRooms,
      paidCount: summary.paidOccupants,
      notPaidCount: summary.notPaidOccupants,
      expiringThisMonth: summary.expiringThisMonth,
      expiringWithin7Days: summary.expiringWithin7Days,
      totalCollected: summary.totalAmountCollected,
      totalUnpaidBalance: summary.totalUnpaidBalance,
      currencySymbol: summary.currencySymbol,
      currencyCode: summary.currencyCode,
      hasSampleData: summary.hasSampleData,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'summary/dashboard');
  }
}

// -----------------------------------------------------------------------------
// Admin Mutations
// -----------------------------------------------------------------------------

export async function uploadReceiptFile(adminUid: string, file: File): Promise<string> {
  try {
    const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storageRef = ref(storage, `receipts/${adminUid}/${safeName}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404') || msg.includes('storage/unknown') || msg.includes('object-not-found')) {
      throw new Error(
        'Firebase Storage is not initialized yet. Enable Storage in the Firebase Console or submit payment without attaching a receipt file.',
      );
    }
    throw err;
  }
}

export async function createPropertyDoc(
  adminUid: string,
  adminName: string,
  payload: { name: string; address: string; description?: string },
): Promise<string> {
  const id = makeId('prop');
  const batch = writeBatch(db);
  batch.set(doc(db, 'properties', id), {
    adminUid,
    name: payload.name.trim().slice(0, 120),
    address: payload.address.trim().slice(0, 250),
    description: (payload.description || '').trim().slice(0, 300),
    isSample: false,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'PROPERTY_CREATED',
    entityType: 'property',
    entityId: id,
    detailsSummary: payload.name.trim(),
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `properties/${id}`);
  }
}

export async function updatePropertyDoc(
  adminUid: string,
  adminName: string,
  propertyId: string,
  payload: { name: string; address: string; description?: string },
  relatedRooms: RoomRecord[],
  relatedOccupants: LogbookEntry[],
): Promise<void> {
  const cleanName = payload.name.trim().slice(0, 120);
  if (!cleanName) throw new Error('Property name is required.');
  const cleanAddress = payload.address.trim().slice(0, 250);
  const cleanDesc = (payload.description || '').trim().slice(0, 300);

  const batch = writeBatch(db);
  batch.update(doc(db, 'properties', propertyId), {
    name: cleanName,
    address: cleanAddress,
    description: cleanDesc,
  });

  for (const r of relatedRooms) {
    if (r.propertyId === propertyId && r.propertyName !== cleanName) {
      batch.update(doc(db, 'rooms', r.id), {
        propertyName: cleanName,
      });
    }
  }

  for (const occ of relatedOccupants) {
    if (occ.propertyId === propertyId && occ.propertyName !== cleanName) {
      batch.update(doc(db, 'occupants', occ.id), {
        propertyName: cleanName,
        updatedAt: serverTimestamp(),
      });
    }
  }

  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'PROPERTY_UPDATED',
    entityType: 'property',
    entityId: propertyId,
    detailsSummary: `${cleanName} · ${cleanAddress || 'No address'}`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `properties/${propertyId}`);
  }
}

export async function deletePropertyDoc(
  adminUid: string,
  adminName: string,
  propertyId: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'properties', propertyId));
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'PROPERTY_DELETED',
    entityType: 'property',
    entityId: propertyId,
    detailsSummary: propertyId,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `properties/${propertyId}`);
  }
}

export async function createRoomDoc(
  adminUid: string,
  adminName: string,
  payload: { propertyId: string; propertyName: string; roomNumber: string; floorOrWing: string },
): Promise<string> {
  const id = makeId('room');
  const batch = writeBatch(db);
  batch.set(doc(db, 'rooms', id), {
    adminUid,
    propertyId: payload.propertyId,
    propertyName: payload.propertyName.trim().slice(0, 120),
    roomNumber: payload.roomNumber.trim().slice(0, 60),
    floorOrWing: payload.floorOrWing.trim().slice(0, 80),
    notes: '',
    isSample: false,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'ROOM_CREATED',
    entityType: 'room',
    entityId: id,
    detailsSummary: `${payload.propertyName} · ${payload.roomNumber}`,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `rooms/${id}`);
  }
}

export async function updateRoomDoc(
  adminUid: string,
  adminName: string,
  roomId: string,
  payload: { roomNumber: string; floorOrWing: string; notes?: string },
  relatedOccupants: LogbookEntry[],
): Promise<void> {
  const cleanRoomNumber = payload.roomNumber.trim().slice(0, 60);
  if (!cleanRoomNumber) throw new Error('Room / unit number is required.');
  const cleanFloor = payload.floorOrWing.trim().slice(0, 80);
  const cleanNotes = (payload.notes || '').trim().slice(0, 200);

  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomId), {
    roomNumber: cleanRoomNumber,
    floorOrWing: cleanFloor,
    notes: cleanNotes,
  });

  for (const occ of relatedOccupants) {
    if (occ.roomId === roomId && occ.roomNumber !== cleanRoomNumber) {
      batch.update(doc(db, 'occupants', occ.id), {
        roomNumber: cleanRoomNumber,
        updatedAt: serverTimestamp(),
      });
    }
  }

  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'ROOM_UPDATED',
    entityType: 'room',
    entityId: roomId,
    detailsSummary: `${cleanRoomNumber} · ${cleanFloor || 'No floor'}`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

export async function deleteRoomDoc(
  adminUid: string,
  adminName: string,
  roomId: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'rooms', roomId));
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'ROOM_DELETED',
    entityType: 'room',
    entityId: roomId,
    detailsSummary: roomId,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `rooms/${roomId}`);
  }
}

export async function createOccupantInFirestore(
  adminUid: string,
  adminName: string,
  existingEntries: LogbookEntry[],
  existingProps: PropertyRecord[],
  existingRooms: RoomRecord[],
  payload: {
    fullName: string;
    phone: string;
    email?: string;
    propertyId: string;
    propertyName: string;
    roomId: string;
    roomNumber: string;
    notes: string;
    customFields: Record<string, string>;
    recordInitialPayment: boolean;
    transactionDate: string;
    amountPaid: number;
    unpaidBalance: number;
    durationMonths: number;
    commencementDate: string;
    expiryDate: string;
    transactionRef: string;
  },
): Promise<void> {
  const batch = writeBatch(db);

  let propId = payload.propertyId;
  let propName = payload.propertyName;
  if (!propId && propName) {
    const found = existingProps.find((p) => p.name.toLowerCase() === propName.toLowerCase());
    if (found) {
      propId = found.id;
      propName = found.name;
    } else {
      propId = makeId('prop');
      batch.set(doc(db, 'properties', propId), {
        adminUid,
        name: propName.trim().slice(0, 120),
        address: '',
        description: '',
        isSample: false,
        createdAt: serverTimestamp(),
      });
    }
  } else {
    propName = existingProps.find((p) => p.id === propId)?.name || propName;
  }

  let rId = payload.roomId;
  let rNum = payload.roomNumber;
  if (!rId && rNum) {
    const found = existingRooms.find(
      (r) => r.propertyId === propId && r.roomNumber.toLowerCase() === rNum.toLowerCase(),
    );
    if (found) {
      rId = found.id;
      rNum = found.roomNumber;
    } else {
      rId = makeId('room');
      batch.set(doc(db, 'rooms', rId), {
        adminUid,
        propertyId: propId,
        propertyName: propName.slice(0, 120),
        roomNumber: rNum.trim().slice(0, 60),
        floorOrWing: '',
        notes: '',
        isSample: false,
        createdAt: serverTimestamp(),
      });
    }
  } else {
    rNum = existingRooms.find((r) => r.id === rId)?.roomNumber || rNum;
  }

  const maxSerial = existingEntries.reduce((m, e) => Math.max(m, e.serialNumber), 0);
  const serialNumber = maxSerial + 1;
  const occId = makeId('occ');
  const durationLabel = payload.recordInitialPayment
    ? formatDurationLabel(payload.durationMonths)
    : 'Not Paid';

  batch.set(doc(db, 'occupants', occId), {
    adminUid,
    userId: '',
    serialNumber,
    fullName: payload.fullName.trim().slice(0, 140),
    phone: payload.phone.trim().slice(0, 40),
    email: (payload.email || '').trim().toLowerCase().slice(0, 160),
    propertyId: propId,
    propertyName: propName.slice(0, 120),
    roomId: rId,
    roomNumber: rNum.slice(0, 60),
    notes: payload.notes.trim().slice(0, 500),
    customFields: payload.customFields || {},
    isArchived: false,
    isSample: false,
    transactionDate: payload.recordInitialPayment ? payload.transactionDate : '',
    amountPaid: payload.recordInitialPayment ? Math.max(0, Number(payload.amountPaid)) : 0,
    unpaidBalance: Math.max(0, Number(payload.unpaidBalance || 0)),
    durationMonths: payload.recordInitialPayment ? payload.durationMonths : 0,
    durationLabel,
    commencementDate: payload.recordInitialPayment ? payload.commencementDate : '',
    expiryDate: payload.recordInitialPayment ? payload.expiryDate : '',
    remarks: payload.notes.trim().slice(0, 500),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (payload.recordInitialPayment) {
    const txId = makeId('tx');
    const txRef =
      payload.transactionRef.trim() ||
      `OLA-${payload.transactionDate.replace(/-/g, '')}-${String(serialNumber).padStart(4, '0')}`;
    batch.set(doc(db, 'transactions', txId), {
      adminUid,
      occupantId: occId,
      occupantName: payload.fullName.trim().slice(0, 140),
      serialNumber,
      propertyName: propName.slice(0, 120),
      roomNumber: rNum.slice(0, 60),
      transactionDate: payload.transactionDate,
      amountReceived: Math.max(0, Number(payload.amountPaid)),
      durationMonths: payload.durationMonths,
      durationLabel,
      commencementDate: payload.commencementDate,
      expiryDate: payload.expiryDate,
      transactionRef: txRef.slice(0, 80),
      recordedBy: adminName.slice(0, 120),
      remarks: payload.notes.trim().slice(0, 500),
      receiptUrl: '',
      isCorrection: false,
      correctionNote: '',
      isSample: false,
      createdAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'OCCUPANT_REGISTERED',
    entityType: 'occupant',
    entityId: occId,
    detailsSummary: `#${serialNumber} ${payload.fullName} · ${propName} ${rNum}`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `occupants/${occId}`);
  }
}

export async function updateOccupantInFirestore(
  adminUid: string,
  adminName: string,
  occupantId: string,
  existingProps: PropertyRecord[],
  existingRooms: RoomRecord[],
  payload: {
    fullName: string;
    phone: string;
    email?: string;
    propertyId: string;
    propertyName: string;
    roomId: string;
    roomNumber: string;
    notes: string;
    unpaidBalance: number;
    customFields: Record<string, string>;
    hasPaymentDetails: boolean;
    transactionDate: string;
    amountPaid: number;
    durationMonths: number;
    commencementDate: string;
    expiryDate: string;
  },
): Promise<void> {
  const batch = writeBatch(db);

  let propId = payload.propertyId;
  let propName = payload.propertyName.trim();
  if (!propId && propName) {
    const found = existingProps.find((p) => p.name.toLowerCase() === propName.toLowerCase());
    if (found) {
      propId = found.id;
      propName = found.name;
    } else {
      propId = makeId('prop');
      batch.set(doc(db, 'properties', propId), {
        adminUid,
        name: propName.slice(0, 120),
        address: '',
        description: '',
        isSample: false,
        createdAt: serverTimestamp(),
      });
    }
  } else {
    propName = existingProps.find((p) => p.id === propId)?.name || propName;
  }

  let rId = payload.roomId;
  let rNum = payload.roomNumber.trim();
  if (!rId && rNum) {
    const found = existingRooms.find(
      (r) => r.propertyId === propId && r.roomNumber.toLowerCase() === rNum.toLowerCase(),
    );
    if (found) {
      rId = found.id;
      rNum = found.roomNumber;
    } else {
      rId = makeId('room');
      batch.set(doc(db, 'rooms', rId), {
        adminUid,
        propertyId: propId,
        propertyName: propName.slice(0, 120),
        roomNumber: rNum.slice(0, 60),
        floorOrWing: '',
        notes: '',
        isSample: false,
        createdAt: serverTimestamp(),
      });
    }
  } else {
    rNum = existingRooms.find((r) => r.id === rId)?.roomNumber || rNum;
  }

  if (!propId || !propName || !rId || !rNum) {
    throw new Error('Please select or enter a valid property and room/unit.');
  }

  const durationMonths = payload.hasPaymentDetails
    ? Math.min(120, Math.max(1, Math.round(Number(payload.durationMonths) || 1)))
    : 0;
  const durationLabel = payload.hasPaymentDetails ? formatDurationLabel(durationMonths) : 'Not Paid';

  batch.update(doc(db, 'occupants', occupantId), {
    fullName: payload.fullName.trim().slice(0, 140),
    phone: payload.phone.trim().slice(0, 40),
    email: (payload.email || '').trim().toLowerCase().slice(0, 160),
    propertyId: propId,
    propertyName: propName.slice(0, 120),
    roomId: rId,
    roomNumber: rNum.slice(0, 60),
    notes: payload.notes.trim().slice(0, 500),
    remarks: payload.notes.trim().slice(0, 500),
    unpaidBalance: Math.max(0, Number(payload.unpaidBalance || 0)),
    transactionDate: payload.hasPaymentDetails ? payload.transactionDate.slice(0, 20) : '',
    amountPaid: payload.hasPaymentDetails ? Math.max(0, Number(payload.amountPaid || 0)) : 0,
    durationMonths,
    durationLabel: durationLabel.slice(0, 60),
    commencementDate: payload.hasPaymentDetails ? payload.commencementDate.slice(0, 20) : '',
    expiryDate: payload.hasPaymentDetails ? payload.expiryDate.slice(0, 20) : '',
    customFields: payload.customFields || {},
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'OCCUPANT_UPDATED',
    entityType: 'occupant',
    entityId: occupantId,
    detailsSummary: `${payload.fullName.trim()} · ${propName} ${rNum} · Balance ${payload.unpaidBalance}`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `occupants/${occupantId}`);
  }
}

export async function bulkImportOccupantsInFirestore(
  adminUid: string,
  adminName: string,
  existingEntries: LogbookEntry[],
  existingProps: PropertyRecord[],
  existingRooms: RoomRecord[],
  rows: CsvImportPreviewRow[],
  recordTransactionsForPaidRows: boolean,
): Promise<{ createdCount: number; updatedCount: number; txCreatedCount: number }> {
  const actionableRows = rows.filter((r) => r.action === 'create' || r.action === 'update');
  if (actionableRows.length === 0) {
    return { createdCount: 0, updatedCount: 0, txCreatedCount: 0 };
  }

  const propByName = new Map<string, { id: string; name: string }>();
  for (const p of existingProps) {
    propByName.set(p.name.trim().toLowerCase(), { id: p.id, name: p.name });
  }

  const roomByPropAndNum = new Map<string, { id: string; roomNumber: string }>();
  for (const r of existingRooms) {
    roomByPropAndNum.set(`${r.propertyId}::${r.roomNumber.trim().toLowerCase()}`, {
      id: r.id,
      roomNumber: r.roomNumber,
    });
  }

  // Pass 1: Collect & create missing properties first
  const newPropsToCreate: Array<{ id: string; name: string }> = [];
  for (const row of actionableRows) {
    const cleanProp = row.payload.propertyName.trim().slice(0, 120);
    const key = cleanProp.toLowerCase();
    if (cleanProp && !propByName.has(key)) {
      const id = makeId('prop');
      propByName.set(key, { id, name: cleanProp });
      newPropsToCreate.push({ id, name: cleanProp });
    }
  }

  if (newPropsToCreate.length > 0) {
    try {
      let batch = writeBatch(db);
      let ops = 0;
      for (const p of newPropsToCreate) {
        batch.set(doc(db, 'properties', p.id), {
          adminUid,
          name: p.name,
          address: '',
          description: '',
          isSample: false,
          createdAt: serverTimestamp(),
        });
        ops++;
        if (ops >= 350) {
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'properties/bulk_csv');
    }
  }

  // Pass 2: Collect & create missing rooms next (properties already exist in Firestore)
  const newRoomsToCreate: Array<{
    id: string;
    propertyId: string;
    propertyName: string;
    roomNumber: string;
  }> = [];
  for (const row of actionableRows) {
    const cleanProp = row.payload.propertyName.trim().slice(0, 120);
    const prop = propByName.get(cleanProp.toLowerCase());
    if (!prop) continue;
    const cleanRoom = row.payload.roomNumber.trim().slice(0, 60);
    const rKey = `${prop.id}::${cleanRoom.toLowerCase()}`;
    if (cleanRoom && !roomByPropAndNum.has(rKey)) {
      const id = makeId('room');
      roomByPropAndNum.set(rKey, { id, roomNumber: cleanRoom });
      newRoomsToCreate.push({
        id,
        propertyId: prop.id,
        propertyName: prop.name,
        roomNumber: cleanRoom,
      });
    }
  }

  if (newRoomsToCreate.length > 0) {
    try {
      let batch = writeBatch(db);
      let ops = 0;
      for (const r of newRoomsToCreate) {
        batch.set(doc(db, 'rooms', r.id), {
          adminUid,
          propertyId: r.propertyId,
          propertyName: r.propertyName.slice(0, 120),
          roomNumber: r.roomNumber.slice(0, 60),
          floorOrWing: '',
          notes: '',
          isSample: false,
          createdAt: serverTimestamp(),
        });
        ops++;
        if (ops >= 350) {
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'rooms/bulk_csv');
    }
  }

  // Pass 3: Create/Update occupants + optional transactions in chunked batches
  const usedSerials = new Set<number>(existingEntries.map((e) => e.serialNumber));
  let maxSerial = existingEntries.reduce((m, e) => Math.max(m, e.serialNumber), 0);

  let createdCount = 0;
  let updatedCount = 0;
  let txCreatedCount = 0;

  try {
    let batch = writeBatch(db);
    let ops = 0;

    const flushIfFull = async (neededOps: number) => {
      if (ops + neededOps > 380 && ops > 0) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    };

    for (const row of actionableRows) {
      const p = row.payload;
      const prop = propByName.get(p.propertyName.trim().toLowerCase())!;
      const room = roomByPropAndNum.get(`${prop.id}::${p.roomNumber.trim().toLowerCase()}`)!;

      const durationMonths = p.hasPaymentDetails
        ? Math.min(120, Math.max(1, Math.round(Number(p.durationMonths) || 1)))
        : 0;
      const durationLabel = p.hasPaymentDetails ? formatDurationLabel(durationMonths) : 'Not Paid';
      const cleanName = p.fullName.trim().slice(0, 140);
      const cleanPhone = p.phone.trim().slice(0, 40);
      const cleanEmail = p.email.trim().toLowerCase().slice(0, 160);
      const cleanNotes = p.notes.trim().slice(0, 500);
      const cleanAmount = p.hasPaymentDetails ? Math.max(0, Number(p.amountPaid || 0)) : 0;
      const cleanUnpaid = Math.max(0, Number(p.unpaidBalance || 0));
      const cleanTxDate = p.hasPaymentDetails ? p.transactionDate.slice(0, 20) : '';
      const cleanStart = p.hasPaymentDetails ? p.commencementDate.slice(0, 20) : '';
      const cleanExpiry = p.hasPaymentDetails ? p.expiryDate.slice(0, 20) : '';

      const sanitizedCustom: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.customFields || {})) {
        const cleanK = k.trim().slice(0, 60);
        if (cleanK) sanitizedCustom[cleanK] = String(v ?? '').trim().slice(0, 200);
      }

      if (row.action === 'update' && row.matchedEntry) {
        const matched = row.matchedEntry;
        const paymentChanged =
          p.hasPaymentDetails &&
          cleanAmount > 0 &&
          durationMonths >= 1 &&
          (cleanAmount !== Number(matched.amountPaid || 0) ||
            cleanTxDate !== (matched.transactionDate || '') ||
            cleanStart !== (matched.commencementDate || '') ||
            cleanExpiry !== (matched.expiryDate || ''));
        const shouldRecordTx = recordTransactionsForPaidRows && paymentChanged;

        await flushIfFull(shouldRecordTx ? 2 : 1);

        batch.update(doc(db, 'occupants', matched.id), {
          fullName: cleanName,
          phone: cleanPhone,
          email: cleanEmail,
          propertyId: prop.id,
          propertyName: prop.name.slice(0, 120),
          roomId: room.id,
          roomNumber: room.roomNumber.slice(0, 60),
          notes: cleanNotes,
          remarks: cleanNotes,
          unpaidBalance: cleanUnpaid,
          transactionDate: cleanTxDate,
          amountPaid: cleanAmount,
          durationMonths,
          durationLabel: durationLabel.slice(0, 60),
          commencementDate: cleanStart,
          expiryDate: cleanExpiry,
          customFields: sanitizedCustom,
          updatedAt: serverTimestamp(),
        });
        ops++;
        updatedCount++;

        if (shouldRecordTx) {
          const txId = makeId('tx');
          const txRef =
            p.transactionRef ||
            `OLA-CSV-${cleanTxDate.replace(/-/g, '')}-${String(matched.serialNumber).padStart(4, '0')}-${txCreatedCount + 1}`;
          batch.set(doc(db, 'transactions', txId), {
            adminUid,
            occupantId: matched.id,
            occupantName: cleanName,
            serialNumber: matched.serialNumber,
            propertyName: prop.name.slice(0, 120),
            roomNumber: room.roomNumber.slice(0, 60),
            transactionDate: cleanTxDate || getTodayIso(),
            amountReceived: cleanAmount,
            durationMonths,
            durationLabel: durationLabel.slice(0, 60),
            commencementDate: cleanStart,
            expiryDate: cleanExpiry,
            transactionRef: txRef.slice(0, 80),
            recordedBy: adminName.slice(0, 120),
            remarks: cleanNotes || 'Bulk CSV update payment',
            receiptUrl: '',
            isCorrection: false,
            correctionNote: '',
            isSample: matched.isSample,
            createdAt: serverTimestamp(),
          });
          ops++;
          txCreatedCount++;
        }
      } else {
        let serialNumber =
          p.serialNumber && p.serialNumber >= 1 && !usedSerials.has(p.serialNumber)
            ? p.serialNumber
            : maxSerial + 1;
        usedSerials.add(serialNumber);
        maxSerial = Math.max(maxSerial, serialNumber);

        const occId = makeId('occ');
        const shouldRecordTx =
          recordTransactionsForPaidRows &&
          p.hasPaymentDetails &&
          cleanAmount > 0 &&
          durationMonths >= 1;

        await flushIfFull(shouldRecordTx ? 2 : 1);

        batch.set(doc(db, 'occupants', occId), {
          adminUid,
          userId: '',
          serialNumber,
          fullName: cleanName,
          phone: cleanPhone,
          email: cleanEmail,
          propertyId: prop.id,
          propertyName: prop.name.slice(0, 120),
          roomId: room.id,
          roomNumber: room.roomNumber.slice(0, 60),
          notes: cleanNotes,
          customFields: sanitizedCustom,
          isArchived: false,
          isSample: false,
          transactionDate: cleanTxDate,
          amountPaid: cleanAmount,
          unpaidBalance: cleanUnpaid,
          durationMonths,
          durationLabel: durationLabel.slice(0, 60),
          commencementDate: cleanStart,
          expiryDate: cleanExpiry,
          remarks: cleanNotes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        ops++;
        createdCount++;

        if (shouldRecordTx) {
          const txId = makeId('tx');
          const txRef =
            p.transactionRef ||
            `OLA-CSV-${cleanTxDate.replace(/-/g, '')}-${String(serialNumber).padStart(4, '0')}`;
          batch.set(doc(db, 'transactions', txId), {
            adminUid,
            occupantId: occId,
            occupantName: cleanName,
            serialNumber,
            propertyName: prop.name.slice(0, 120),
            roomNumber: room.roomNumber.slice(0, 60),
            transactionDate: cleanTxDate || getTodayIso(),
            amountReceived: cleanAmount,
            durationMonths,
            durationLabel: durationLabel.slice(0, 60),
            commencementDate: cleanStart,
            expiryDate: cleanExpiry,
            transactionRef: txRef.slice(0, 80),
            recordedBy: adminName.slice(0, 120),
            remarks: cleanNotes || 'Imported via CSV',
            receiptUrl: '',
            isCorrection: false,
            correctionNote: '',
            isSample: false,
            createdAt: serverTimestamp(),
          });
          ops++;
          txCreatedCount++;
        }
      }
    }

    await flushIfFull(1);
    batch.set(doc(db, 'auditLogs', makeId('aud')), {
      adminUid,
      actorName: adminName,
      action: 'BULK_CSV_IMPORT',
      entityType: 'occupant',
      entityId: 'bulk_csv',
      detailsSummary: `CSV import: ${createdCount} created, ${updatedCount} updated, ${txCreatedCount} payments logged`,
      createdAt: serverTimestamp(),
    });
    ops++;

    if (ops > 0) {
      await batch.commit();
    }

    await syncDashboardSummaryDoc(adminUid);
    return { createdCount, updatedCount, txCreatedCount };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'occupants/bulk_csv');
  }
}

export async function recordPaymentInFirestore(
  adminUid: string,
  adminName: string,
  occupant: LogbookEntry,
  payload: {
    transactionDate: string;
    amountReceived: number;
    unpaidBalanceAfter: number;
    durationMonths: number;
    commencementDate: string;
    expiryDate: string;
    transactionRef: string;
    remarks: string;
    receiptFile?: File | null;
  },
): Promise<void> {
  let receiptUrl = '';
  if (payload.receiptFile) {
    receiptUrl = await uploadReceiptFile(adminUid, payload.receiptFile);
  }

  const durationLabel = formatDurationLabel(payload.durationMonths);
  const txId = makeId('tx');
  const txRef =
    payload.transactionRef.trim() ||
    `OLA-${payload.transactionDate.replace(/-/g, '')}-${String(occupant.serialNumber).padStart(4, '0')}`;

  const batch = writeBatch(db);
  batch.update(doc(db, 'occupants', occupant.id), {
    transactionDate: payload.transactionDate,
    amountPaid: Math.max(0, Number(payload.amountReceived)),
    unpaidBalance: Math.max(0, Number(payload.unpaidBalanceAfter)),
    durationMonths: payload.durationMonths,
    durationLabel,
    commencementDate: payload.commencementDate,
    expiryDate: payload.expiryDate,
    remarks: payload.remarks.trim().slice(0, 500),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'transactions', txId), {
    adminUid,
    occupantId: occupant.id,
    occupantName: occupant.fullName,
    serialNumber: occupant.serialNumber,
    propertyName: occupant.propertyName,
    roomNumber: occupant.roomNumber,
    transactionDate: payload.transactionDate,
    amountReceived: Math.max(0, Number(payload.amountReceived)),
    durationMonths: payload.durationMonths,
    durationLabel,
    commencementDate: payload.commencementDate,
    expiryDate: payload.expiryDate,
    transactionRef: txRef.slice(0, 80),
    recordedBy: adminName.slice(0, 120),
    remarks: payload.remarks.trim().slice(0, 500),
    receiptUrl,
    isCorrection: false,
    correctionNote: '',
    isSample: occupant.isSample,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'PAYMENT_RECORDED',
    entityType: 'payment_transaction',
    entityId: txId,
    detailsSummary: `${occupant.fullName} · ${payload.amountReceived} · ${durationLabel}`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `occupants/${occupant.id}/payment`);
  }
}

export async function recordCorrectionInFirestore(
  adminUid: string,
  adminName: string,
  occupant: LogbookEntry,
  originalTx: PaymentTransactionRecord,
  payload: {
    adjustedAmount: number;
    adjustedExpiryDate: string;
    correctionNote: string;
  },
): Promise<void> {
  const corrId = makeId('tx');
  const today = getTodayIso();
  const batch = writeBatch(db);

  batch.update(doc(db, 'occupants', occupant.id), {
    amountPaid: Math.max(0, Number(payload.adjustedAmount)),
    expiryDate: payload.adjustedExpiryDate,
    remarks: `[Corrected] ${payload.correctionNote}`.slice(0, 500),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'transactions', corrId), {
    adminUid,
    occupantId: occupant.id,
    occupantName: occupant.fullName,
    serialNumber: occupant.serialNumber,
    propertyName: occupant.propertyName,
    roomNumber: occupant.roomNumber,
    transactionDate: today,
    amountReceived: Number(payload.adjustedAmount) - originalTx.amountReceived,
    durationMonths: originalTx.durationMonths,
    durationLabel: originalTx.durationLabel,
    commencementDate: originalTx.commencementDate,
    expiryDate: payload.adjustedExpiryDate,
    transactionRef: `CORR-${originalTx.transactionRef}`.slice(0, 80),
    recordedBy: adminName.slice(0, 120),
    remarks: `Audit adjustment for ${originalTx.transactionRef}`,
    receiptUrl: '',
    isCorrection: true,
    correctionNote: payload.correctionNote.trim().slice(0, 400),
    isSample: originalTx.isSample,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'PAYMENT_AUDITED_CORRECTION',
    entityType: 'payment_transaction',
    entityId: originalTx.id,
    detailsSummary: payload.correctionNote.trim().slice(0, 400),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `transactions/${corrId}`);
  }
}

export async function addCustomColumnInFirestore(
  adminUid: string,
  adminName: string,
  label: string,
  fieldType: 'text' | 'number' | 'date',
  existingCount: number,
): Promise<void> {
  const cleanLabel = label.trim().slice(0, 60);
  if (!cleanLabel) throw new Error('Column label is required.');
  const colKey =
    cleanLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || `col_${Date.now()}`;
  const id = makeId('col');
  const batch = writeBatch(db);
  batch.set(doc(db, 'customColumns', id), {
    adminUid,
    columnKey: colKey,
    label: cleanLabel,
    fieldType,
    sortOrder: existingCount + 1,
    isVisible: true,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'CUSTOM_COLUMN_ADDED',
    entityType: 'custom_column',
    entityId: id,
    detailsSummary: cleanLabel,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `customColumns/${id}`);
  }
}

export async function updateCustomColumnInFirestore(
  adminUid: string,
  adminName: string,
  colId: string,
  payload: { label: string; isVisible: boolean },
): Promise<void> {
  const cleanLabel = payload.label.trim().slice(0, 60);
  if (!cleanLabel) throw new Error('Column label is required.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'customColumns', colId), {
    label: cleanLabel,
    isVisible: Boolean(payload.isVisible),
  });
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'CUSTOM_COLUMN_UPDATED',
    entityType: 'custom_column',
    entityId: colId,
    detailsSummary: `${cleanLabel} (${payload.isVisible ? 'visible' : 'hidden'})`,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `customColumns/${colId}`);
  }
}

export async function deleteCustomColumnInFirestore(colId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'customColumns', colId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `customColumns/${colId}`);
  }
}

export async function saveSettingsInFirestore(
  adminUid: string,
  adminName: string,
  settings: AppSettingsRecord,
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'settings', 'default'), {
    adminUid,
    onesignalAppId: settings.onesignalAppId.trim().slice(0, 120),
    currencySymbol: settings.currencySymbol.trim().slice(0, 8) || '₦',
    currencyCode: settings.currencyCode.trim().toUpperCase().slice(0, 8) || 'NGN',
    autoCheckEnabled: Boolean(settings.autoCheckEnabled),
    monthlyReportDay: Math.min(28, Math.max(1, Math.round(settings.monthlyReportDay || 1))),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'SETTINGS_UPDATED',
    entityType: 'settings',
    entityId: 'default',
    detailsSummary: `${settings.currencyCode} (${settings.currencySymbol})`,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'settings/default');
  }
}

export async function runExpiryNotificationsInFirestore(
  adminUid: string,
  entries: LogbookEntry[],
  existingNotifs: NotificationRecord[],
  forceMonthly: boolean,
): Promise<number> {
  const today = getTodayIso();
  const existingKeys = new Set(
    existingNotifs.map((n) => `${n.occupantId || 'MONTHLY'}:${n.ruleType}:${n.reminderDate}`),
  );
  const batch = writeBatch(db);
  let created = 0;

  for (const e of entries) {
    if (!e.expiryDate) continue;
    let ruleType: string | null = null;
    let message = '';
    if (e.expiryDate === today) {
      ruleType = 'expiry_day';
      message = `PAYMENT EXPIRY NOTICE: ${e.fullName}, ${e.roomNumber} (${e.propertyName}), payment period expires today (${e.expiryDate}).`;
    } else if (e.status === 'PAID' && [30, 14, 7].includes(e.daysRemaining)) {
      ruleType = `${e.daysRemaining}_days`;
      message = `PAYMENT EXPIRY REMINDER: ${e.fullName}, ${e.roomNumber}, has ${e.daysRemaining} days remaining on the current payment period.`;
    }
    if (!ruleType) continue;

    const key = `${e.id}:${ruleType}:${today}`;
    if (existingKeys.has(key)) continue;

    const id = makeId('ntf');
    batch.set(doc(db, 'notifications', id), {
      adminUid,
      occupantId: e.id,
      ruleType,
      reminderDate: today,
      dedupeKey: key,
      title: 'Payment Expiry Reminder',
      message: message.slice(0, 500),
      deliveryStatus: 'sent',
      createdAt: serverTimestamp(),
    });
    created++;
  }

  if (forceMonthly || today.endsWith('-01')) {
    const key = `MONTHLY:monthly_summary:${today}`;
    if (!existingKeys.has(key)) {
      const expiringCount = entries.filter((e) => e.status === 'PAID' && e.isExpiringThisMonth).length;
      const msg = `MONTHLY PAYMENT REPORT: ${expiringCount} occupant${expiringCount === 1 ? '' : 's'} have payments expiring this month.`;
      batch.set(doc(db, 'notifications', makeId('ntf')), {
        adminUid,
        occupantId: '',
        ruleType: 'monthly_summary',
        reminderDate: today,
        dedupeKey: key,
        title: 'Monthly Payment Report',
        message: msg,
        deliveryStatus: 'sent',
        createdAt: serverTimestamp(),
      });
      created++;
    }
  }

  if (created > 0) {
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notifications');
    }
  }
  return created;
}

// -----------------------------------------------------------------------------
// Sample Data Seeding / Clearing in Firestore (Clearly Labeled)
// -----------------------------------------------------------------------------

function addDaysIso(dateIso: string, deltaDays: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

function addMonthsRelativeIso(dateIso: string, deltaMonths: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + deltaMonths, d)).toISOString().slice(0, 10);
}

export async function seedSampleDataInFirestore(
  adminUid: string,
  adminName: string,
  existingEntries: LogbookEntry[],
): Promise<void> {
  if (existingEntries.some((e) => e.isSample)) return;

  const today = getTodayIso();
  const batch = writeBatch(db);

  const prop1 = makeId('prop');
  const prop2 = makeId('prop');
  batch.set(doc(db, 'properties', prop1), {
    adminUid,
    name: 'OLA Continental Court A (Sample)',
    address: 'LAUTECH Teaching Hospital Area, Ogbomoso',
    description: 'Sample demonstration residential block',
    isSample: true,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'properties', prop2), {
    adminUid,
    name: 'OLA Continental Annex B (Sample)',
    address: 'Isale General Road, Ogbomoso',
    description: 'Sample demonstration commercial & apartment annex',
    isSample: true,
    createdAt: serverTimestamp(),
  });

  const roomDefs = [
    { id: makeId('room'), propId: prop1, propName: 'OLA Continental Court A (Sample)', num: 'Room 01', wing: 'Ground Floor' },
    { id: makeId('room'), propId: prop1, propName: 'OLA Continental Court A (Sample)', num: 'Room 02', wing: 'Ground Floor' },
    { id: makeId('room'), propId: prop1, propName: 'OLA Continental Court A (Sample)', num: 'Room 05', wing: 'First Floor' },
    { id: makeId('room'), propId: prop2, propName: 'OLA Continental Annex B (Sample)', num: 'Suite 101', wing: 'East Wing' },
    { id: makeId('room'), propId: prop2, propName: 'OLA Continental Annex B (Sample)', num: 'Suite 104', wing: 'West Wing' },
  ];

  for (const r of roomDefs) {
    batch.set(doc(db, 'rooms', r.id), {
      adminUid,
      propertyId: r.propId,
      propertyName: r.propName,
      roomNumber: r.num,
      floorOrWing: r.wing,
      notes: 'Sample unit',
      isSample: true,
      createdAt: serverTimestamp(),
    });
  }

  let serial = existingEntries.reduce((m, e) => Math.max(m, e.serialNumber), 0);
  const samplePeople = [
    {
      name: 'John Doe (Sample)',
      phone: '0803-555-0105',
      propId: prop1,
      propName: 'OLA Continental Court A (Sample)',
      roomId: roomDefs[2].id,
      roomNumber: roomDefs[2].num,
      durationMonths: 12,
      amount: 250000,
      unpaidBalance: 0,
      commencement: addMonthsRelativeIso(addDaysIso(today, 7), -12),
      remarks: 'Sample record — expiring in 7 days',
    },
    {
      name: 'Adebayo Kunle (Sample)',
      phone: '0805-555-0142',
      propId: prop1,
      propName: 'OLA Continental Court A (Sample)',
      roomId: roomDefs[0].id,
      roomNumber: roomDefs[0].num,
      durationMonths: 12,
      amount: 300000,
      unpaidBalance: 0,
      commencement: addMonthsRelativeIso(today, -3),
      remarks: 'Sample record — active 12-month payment',
    },
    {
      name: 'Folake Adeyemi (Sample)',
      phone: '0812-555-0188',
      propId: prop2,
      propName: 'OLA Continental Annex B (Sample)',
      roomId: roomDefs[3].id,
      roomNumber: roomDefs[3].num,
      durationMonths: 12,
      amount: 280000,
      unpaidBalance: 280000,
      commencement: addMonthsRelativeIso(addDaysIso(today, -10), -12),
      remarks: 'Sample record — expired, unpaid balance due',
    },
    {
      name: 'Samuel Okafor (Sample)',
      phone: '0706-555-0194',
      propId: prop2,
      propName: 'OLA Continental Annex B (Sample)',
      roomId: roomDefs[4].id,
      roomNumber: roomDefs[4].num,
      durationMonths: 6,
      amount: 150000,
      unpaidBalance: 75000,
      commencement: addMonthsRelativeIso(addDaysIso(today, 20), -6),
      remarks: 'Sample record — expiring within 30 days',
    },
  ];

  for (const s of samplePeople) {
    serial += 1;
    const occId = makeId('occ');
    const txId = makeId('tx');
    const expiry = calculateExpiryDate(s.commencement, s.durationMonths);
    const label = formatDurationLabel(s.durationMonths);

    batch.set(doc(db, 'occupants', occId), {
      adminUid,
      userId: '',
      serialNumber: serial,
      fullName: s.name,
      phone: s.phone,
      email: '',
      propertyId: s.propId,
      propertyName: s.propName,
      roomId: s.roomId,
      roomNumber: s.roomNumber,
      notes: s.remarks,
      customFields: {},
      isArchived: false,
      isSample: true,
      transactionDate: s.commencement,
      amountPaid: s.amount,
      unpaidBalance: s.unpaidBalance,
      durationMonths: s.durationMonths,
      durationLabel: label,
      commencementDate: s.commencement,
      expiryDate: expiry,
      remarks: s.remarks,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'transactions', txId), {
      adminUid,
      occupantId: occId,
      occupantName: s.name,
      serialNumber: serial,
      propertyName: s.propName,
      roomNumber: s.roomNumber,
      transactionDate: s.commencement,
      amountReceived: s.amount,
      durationMonths: s.durationMonths,
      durationLabel: label,
      commencementDate: s.commencement,
      expiryDate: expiry,
      transactionRef: `SAMPLE-${String(serial).padStart(4, '0')}`,
      recordedBy: adminName,
      remarks: s.remarks,
      receiptUrl: '',
      isCorrection: false,
      correctionNote: '',
      isSample: true,
      createdAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'SEED_SAMPLE_DATA',
    entityType: 'system',
    entityId: 'sample',
    detailsSummary: `${samplePeople.length} sample occupants added`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'sample_seed');
  }
}

export async function clearSampleDataInFirestore(
  adminUid: string,
  adminName: string,
  bundle: AdminWorkspaceBundle,
): Promise<void> {
  const batch = writeBatch(db);
  for (const tx of bundle.transactions) {
    if (tx.isSample) batch.delete(doc(db, 'transactions', tx.id));
  }
  for (const occ of bundle.entries) {
    if (occ.isSample) batch.delete(doc(db, 'occupants', occ.id));
  }
  for (const room of bundle.rooms) {
    if (room.isSample) batch.delete(doc(db, 'rooms', room.id));
  }
  for (const prop of bundle.properties) {
    if (prop.isSample) batch.delete(doc(db, 'properties', prop.id));
  }
  batch.set(doc(db, 'auditLogs', makeId('aud')), {
    adminUid,
    actorName: adminName,
    action: 'CLEAR_SAMPLE_DATA',
    entityType: 'system',
    entityId: 'sample',
    detailsSummary: 'Cleared all sample demonstration records',
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncDashboardSummaryDoc(adminUid);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, 'sample_clear');
  }
}
