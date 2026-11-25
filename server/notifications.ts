import type Database from 'better-sqlite3';
import { getTodayIso } from '../shared/paymentCalc.ts';
import type { NotificationRecord, PushSubscriptionRecord } from '../shared/types.ts';
import { generateId, writeAuditLog } from './db.ts';
import { getLogbookEntries } from './logbookData.ts';

interface OneSignalSendResult {
  deliveryStatus: 'sent' | 'failed' | 'skipped_not_configured';
  onesignalNotificationId: string | null;
  errorMessage: string | null;
  recipientCount: number;
}

export async function dispatchOneSignalPush(
  db: Database.Database,
  title: string,
  message: string,
): Promise<OneSignalSendResult> {
  const settings = db
    .prepare('SELECT onesignal_app_id FROM app_settings WHERE id = ?')
    .get('default') as { onesignal_app_id: string } | undefined;

  const appId = (process.env.ONESIGNAL_APP_ID || settings?.onesignal_app_id || '').trim();
  const restApiKey = (process.env.ONESIGNAL_REST_API_KEY || '').trim();

  if (!appId || !restApiKey) {
    return {
      deliveryStatus: 'skipped_not_configured',
      onesignalNotificationId: null,
      errorMessage:
        'OneSignal App ID or ONESIGNAL_REST_API_KEY is not configured in backend environment secrets.',
      recipientCount: 0,
    };
  }

  const activeSubs = db
    .prepare('SELECT player_id FROM push_subscriptions WHERE is_active = 1')
    .all() as Array<{ player_id: string }>;

  const payload: Record<string, unknown> = {
    app_id: appId,
    headings: { en: title },
    contents: { en: message },
  };

  if (activeSubs.length > 0) {
    payload.include_subscription_ids = activeSubs.map((s) => s.player_id);
  } else {
    payload.included_segments = ['Subscribed Users'];
  }

  try {
    const response = await fetch('https://api.onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Basic ${restApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as {
      id?: string;
      recipients?: number;
      errors?: unknown;
    };

    if (!response.ok) {
      return {
        deliveryStatus: 'failed',
        onesignalNotificationId: null,
        errorMessage: `OneSignal API error (${response.status}): ${JSON.stringify(data.errors ?? data)}`,
        recipientCount: 0,
      };
    }

    return {
      deliveryStatus: 'sent',
      onesignalNotificationId: data.id ?? null,
      errorMessage: null,
      recipientCount: Number(data.recipients ?? activeSubs.length),
    };
  } catch (err) {
    return {
      deliveryStatus: 'failed',
      onesignalNotificationId: null,
      errorMessage: err instanceof Error ? err.message : 'Network error calling OneSignal REST API.',
      recipientCount: 0,
    };
  }
}

export async function runExpiryAndMonthlyChecks(
  db: Database.Database,
  actorName = 'System Scheduler',
  forceMonthlySummary = false,
): Promise<{ generated: number; details: string[] }> {
  const today = getTodayIso();
  const entries = getLogbookEntries(db, false);
  const details: string[] = [];
  let generated = 0;

  const insertNotification = db.prepare(
    `INSERT INTO notifications (
       id, occupant_id, rule_type, reminder_date, dedupe_key, title, message,
       channel, delivery_status, onesignal_notification_id, error_message, recipient_count, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // 1. Check 30, 14, 7, and 0-day expiry triggers per occupant
  for (const entry of entries) {
    if (!entry.expiryDate) continue;

    let ruleType: string | null = null;
    let message = '';

    if (entry.expiryDate === today) {
      ruleType = 'expiry_day';
      message = `PAYMENT EXPIRY NOTICE: ${entry.fullName}, ${entry.roomNumber} (${entry.propertyName}), payment period expires today (${entry.expiryDate}). Status is now NOT PAID unless renewed.`;
    } else if (entry.status === 'PAID' && entry.daysRemaining === 7) {
      ruleType = '7_days';
      message = `PAYMENT EXPIRY REMINDER: ${entry.fullName}, ${entry.roomNumber}, has 7 days remaining on the current payment period.`;
    } else if (entry.status === 'PAID' && entry.daysRemaining === 14) {
      ruleType = '14_days';
      message = `PAYMENT EXPIRY REMINDER: ${entry.fullName}, ${entry.roomNumber}, has 14 days remaining on the current payment period.`;
    } else if (entry.status === 'PAID' && entry.daysRemaining === 30) {
      ruleType = '30_days';
      message = `PAYMENT EXPIRY REMINDER: ${entry.fullName}, ${entry.roomNumber}, has 30 days remaining on the current payment period.`;
    }

    if (!ruleType) continue;

    const dedupeKey = `${entry.id}:${ruleType}:${today}`;
    const existing = db.prepare('SELECT id FROM notifications WHERE dedupe_key = ?').get(dedupeKey);
    if (existing) continue;

    const title = 'Payment Expiry Reminder';
    const pushResult = await dispatchOneSignalPush(db, title, message);

    insertNotification.run(
      generateId('ntf'),
      entry.id,
      ruleType,
      today,
      dedupeKey,
      title,
      message,
      'onesignal',
      pushResult.deliveryStatus,
      pushResult.onesignalNotificationId,
      pushResult.errorMessage,
      pushResult.recipientCount,
      new Date().toISOString(),
    );
    generated++;
    details.push(message);
  }

  // 2. Monthly payment summary (on configured day of month or when manually triggered)
  const settings = db
    .prepare('SELECT monthly_report_day FROM app_settings WHERE id = ?')
    .get('default') as { monthly_report_day: number } | undefined;
  const currentDay = Number(today.slice(8, 10));
  const reportDay = settings?.monthly_report_day ?? 1;

  if (forceMonthlySummary || currentDay === reportDay) {
    const monthKey = today.slice(0, 7);
    const dedupeKey = `MONTHLY:${monthKey}:${forceMonthlySummary ? today : reportDay}`;
    const existingMonthly = db.prepare('SELECT id FROM notifications WHERE dedupe_key = ?').get(dedupeKey);

    if (!existingMonthly) {
      const expiringCount = entries.filter((e) => e.status === 'PAID' && e.isExpiringThisMonth).length;
      const title = 'Monthly Payment Report';
      const message = `MONTHLY PAYMENT REPORT: ${expiringCount} occupant${expiringCount === 1 ? '' : 's'} have payments expiring this month.`;
      const pushResult = await dispatchOneSignalPush(db, title, message);

      insertNotification.run(
        generateId('ntf'),
        null,
        'monthly_summary',
        today,
        dedupeKey,
        title,
        message,
        'onesignal',
        pushResult.deliveryStatus,
        pushResult.onesignalNotificationId,
        pushResult.errorMessage,
        pushResult.recipientCount,
        new Date().toISOString(),
      );
      generated++;
      details.push(message);
    }
  }

  if (generated > 0 || forceMonthlySummary) {
    writeAuditLog(db, actorName, 'RUN_NOTIFICATION_CHECK', 'notifications', today, {
      generated,
      forceMonthlySummary,
    });
  }

  return { generated, details };
}

export function getNotificationsHistory(db: Database.Database): NotificationRecord[] {
  const rows = db
    .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200')
    .all() as Array<{
      id: string;
      occupant_id: string | null;
      rule_type: string;
      reminder_date: string;
      title: string;
      message: string;
      channel: string;
      delivery_status: string;
      onesignal_notification_id: string | null;
      error_message: string | null;
      recipient_count: number;
      created_at: string;
    }>;

  return rows.map((r) => ({
    id: r.id,
    occupantId: r.occupant_id,
    ruleType: r.rule_type,
    reminderDate: r.reminder_date,
    title: r.title,
    message: r.message,
    channel: r.channel,
    deliveryStatus: r.delivery_status,
    onesignalNotificationId: r.onesignal_notification_id,
    errorMessage: r.error_message,
    recipientCount: r.recipient_count,
    createdAt: r.created_at,
  }));
}

export function getPushSubscriptions(db: Database.Database): PushSubscriptionRecord[] {
  const rows = db
    .prepare('SELECT * FROM push_subscriptions ORDER BY last_seen_at DESC')
    .all() as Array<{
      id: string;
      player_id: string;
      device_label: string;
      browser: string;
      permission_status: string;
      is_active: number;
      last_seen_at: string;
      created_at: string;
    }>;

  return rows.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    deviceLabel: r.device_label,
    browser: r.browser,
    permissionStatus: r.permission_status,
    isActive: r.is_active === 1,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
  }));
}
