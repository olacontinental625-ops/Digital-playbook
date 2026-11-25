import type { PaymentStatus, UrgencyLevel } from './paymentCalc.ts';

export interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  username: string;
  sessionTimeoutMinutes: number;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  authProvider: 'password' | 'google';
  createdAt: string;
}

export interface PropertyRecord {
  id: string;
  name: string;
  address: string;
  description: string;
  isSample: boolean;
  roomCount?: number;
  occupiedCount?: number;
  createdAt: string;
}

export interface RoomRecord {
  id: string;
  propertyId: string;
  propertyName: string;
  roomNumber: string;
  floorOrWing: string;
  notes: string;
  isSample: boolean;
  activeOccupantId?: string | null;
  activeOccupantName?: string | null;
  activeOccupantStatus?: PaymentStatus | null;
  createdAt: string;
}

export interface CustomColumnConfig {
  id: string;
  columnKey: string;
  label: string;
  fieldType: 'text' | 'number' | 'date';
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
}

export interface LogbookEntry {
  id: string;
  serialNumber: number;
  fullName: string;
  phone: string;
  email?: string;
  userId?: string;
  propertyId: string;
  propertyName: string;
  roomId: string;
  roomNumber: string;
  notes: string;
  customFields: Record<string, string>;
  isArchived: boolean;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  latestPeriodId: string | null;
  transactionDate: string | null;
  amountPaid: number | null;
  unpaidBalance: number;
  durationMonths: number | null;
  durationLabel: string | null;
  commencementDate: string | null;
  expiryDate: string | null;
  remarks: string;
  monthsUsed: number;
  monthsRemaining: number;
  daysRemaining: number;
  status: PaymentStatus;
  isExpired: boolean;
  isExpiringWithin7Days: boolean;
  isExpiringWithin30Days: boolean;
  isExpiringThisMonth: boolean;
  urgencyLevel: UrgencyLevel;
}

export interface PaymentTransactionRecord {
  id: string;
  occupantId: string;
  occupantName?: string;
  serialNumber?: number;
  propertyName?: string;
  roomNumber?: string;
  periodId: string;
  transactionDate: string;
  amountReceived: number;
  durationMonths: number;
  durationLabel: string;
  commencementDate: string;
  expiryDate: string;
  transactionRef: string;
  recordedBy: string;
  remarks: string;
  receiptUrl?: string;
  isCorrection: boolean;
  correctionNote: string;
  isSample: boolean;
  createdAt: string;
}

export interface DashboardSummary {
  totalOccupants: number;
  totalRooms: number;
  paidOccupants: number;
  notPaidOccupants: number;
  expiringThisMonth: number;
  expiringWithin7Days: number;
  totalAmountCollected: number;
  totalUnpaidBalance: number;
  hasSampleData: boolean;
  currencySymbol: string;
  currencyCode: string;
}

export interface NotificationRecord {
  id: string;
  occupantId: string | null;
  ruleType: string;
  reminderDate: string;
  title: string;
  message: string;
  channel: string;
  deliveryStatus: string;
  onesignalNotificationId: string | null;
  errorMessage: string | null;
  recipientCount: number;
  createdAt: string;
}

export interface PushSubscriptionRecord {
  id: string;
  playerId: string;
  deviceLabel: string;
  browser: string;
  permissionStatus: string;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
}

export interface AppSettingsRecord {
  onesignalAppId: string;
  onesignalRestKeyConfigured: boolean;
  currencySymbol: string;
  currencyCode: string;
  autoCheckEnabled: boolean;
  monthlyReportDay: number;
}

export interface AuditLogRecord {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}
