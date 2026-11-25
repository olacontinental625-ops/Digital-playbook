import React, { useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Play,
  XCircle,
} from 'lucide-react';
import type {
  AppSettingsRecord,
  LogbookEntry,
  NotificationRecord,
} from '../../shared/types.ts';
import { runExpiryNotificationsInFirestore } from '../lib/firestoreStore.ts';

interface NotificationsViewProps {
  adminUid: string;
  entries: LogbookEntry[];
  notifications: NotificationRecord[];
  settings: AppSettingsRecord;
  onRefresh: () => Promise<void>;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  adminUid,
  entries,
  notifications,
  settings,
  onRefresh,
}) => {
  const [browserPermission, setBrowserPermission] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleEnableBrowserPush = async () => {
    setFeedback(null);
    if (typeof Notification === 'undefined') {
      setFeedback({ type: 'err', text: 'Browser notifications are not supported on this device.' });
      return;
    }
    const perm = await Notification.requestPermission();
    setBrowserPermission(perm);
    if (perm === 'granted') {
      new Notification('OLA Continental Alerts Enabled', {
        body: 'You will receive desktop expiry notifications when checks are triggered.',
      });
      setFeedback({ type: 'ok', text: 'Browser notification permission granted.' });
    } else {
      setFeedback({
        type: 'err',
        text: `Browser permission is "${perm}". Allow notifications in your browser settings.`,
      });
    }
  };

  const handleRunCheck = async (forceMonthly: boolean) => {
    setFeedback(null);
    setBusyAction(forceMonthly ? 'monthly' : 'daily');
    try {
      const created = await runExpiryNotificationsInFirestore(
        adminUid,
        entries,
        notifications,
        forceMonthly,
      );
      await onRefresh();
      if (created > 0 && browserPermission === 'granted' && typeof Notification !== 'undefined') {
        new Notification('OLA Continental Payment Alerts', {
          body: `${created} new payment expiry reminder${created === 1 ? '' : 's'} logged.`,
        });
      }
      setFeedback({
        type: 'ok',
        text:
          created > 0
            ? `Generated ${created} new reminder${created === 1 ? '' : 's'} in Firestore (deduplicated per occupant & date).`
            : 'Check completed — no new expiry reminders due today.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to execute expiry check.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const expiring7Count = entries.filter((e) => e.status === 'PAID' && e.isExpiringWithin7Days).length;
  const expiringMonthCount = entries.filter((e) => e.status === 'PAID' && e.isExpiringThisMonth).length;
  const notPaidCount = entries.filter((e) => e.status === 'NOT PAID').length;

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Visibility Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Browser Notification Permission</span>
            <Bell className="h-4 w-4 text-[#B4832C]" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {browserPermission === 'granted' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : browserPermission === 'denied' ? (
              <XCircle className="h-5 w-5 text-red-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            )}
            <span className="font-display text-lg font-semibold capitalize text-slate-900">
              {browserPermission}
            </span>
          </div>
          <button
            type="button"
            onClick={handleEnableBrowserPush}
            className="mt-3 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#132642]"
          >
            {browserPermission === 'granted' ? 'Send Test Desktop Alert' : 'Enable Desktop Alerts'}
          </button>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Live Expiry Queue</span>
            <BellRing className="h-4 w-4 text-[#B4832C]" />
          </div>
          <div className="mt-2 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Not Paid / Expired:</span>
              <span className="font-mono font-semibold text-red-700 tabular-nums">{notPaidCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Expiring Within 7 Days:</span>
              <span className="font-mono font-semibold text-amber-700 tabular-nums">{expiring7Count}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Expiring This Month:</span>
              <span className="font-mono font-semibold text-amber-700 tabular-nums">{expiringMonthCount}</span>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-semibold text-slate-500">
            Expiry Rules (30d · 14d · 7d · Expiry · Monthly)
          </div>
          <p className="mt-1.5 text-xs text-slate-600">
            Auto-check is {settings.autoCheckEnabled ? 'enabled' : 'paused'} (Monthly summary day{' '}
            {settings.monthlyReportDay}). Run manual checks below.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => handleRunCheck(false)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#132642]"
            >
              <Play className="h-3 w-3 text-[#D4AF37]" />
              {busyAction === 'daily' ? 'Checking...' : 'Run Daily Check'}
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => handleRunCheck(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {busyAction === 'monthly' ? 'Generating...' : 'Monthly Summary'}
            </button>
          </div>
        </section>
      </div>

      {/* Notification History Log */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Notification History ({notifications.length})
          </h3>
          <p className="text-xs text-slate-500">
            Deduplicated history of generated expiry reminders and monthly payment summaries.
          </p>
        </div>

        {notifications.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No notifications generated yet. Run a daily expiry check or monthly summary to log alerts.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Reminder Date</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Rule</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Title</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Message</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <tr key={n.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {n.reminderDate}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                      {n.ruleType}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                      {n.title}
                    </td>
                    <td className="px-4 py-2.5 text-slate-900 max-w-lg">{n.message}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> Logged
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
