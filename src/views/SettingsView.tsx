import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Columns3,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  History,
  KeyRound,
  MailCheck,
  Plus,
  Settings,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import type {
  AdminUser,
  AppSettingsRecord,
  AuditLogRecord,
  CustomColumnConfig,
} from '../../shared/types.ts';
import { auth } from '../lib/firebase.ts';
import {
  addCustomColumnInFirestore,
  deleteCustomColumnInFirestore,
  saveSettingsInFirestore,
  updateCustomColumnInFirestore,
} from '../lib/firestoreStore.ts';

interface SettingsViewProps {
  admin: AdminUser;
  adminUid: string;
  settings: AppSettingsRecord;
  customColumns: CustomColumnConfig[];
  auditLogs: AuditLogRecord[];
  workspaceSnapshot: unknown;
  hasSampleData: boolean;
  onRefreshAll: () => Promise<void>;
  onSeedSampleData: () => Promise<void>;
  onClearSampleData: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  admin,
  adminUid,
  settings: initialSettings,
  customColumns,
  auditLogs,
  workspaceSnapshot,
  hasSampleData,
  onRefreshAll,
  onSeedSampleData,
  onClearSampleData,
}) => {
  const [settings, setSettings] = useState<AppSettingsRecord>(initialSettings);
  const [newColLabel, setNewColLabel] = useState('');
  const [newColType, setNewColType] = useState<'text' | 'number' | 'date'>('text');
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editColLabel, setEditColLabel] = useState('');
  const [editColVisible, setEditColVisible] = useState(true);
  const [resetSent, setResetSent] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [autoSaveNote, setAutoSaveNote] = useState('');
  const hasUserEditedSettings = useRef(false);
  const editSeqRef = useRef(0);
  const autoSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasUserEditedSettings.current) {
      setSettings(initialSettings);
    }
  }, [initialSettings]);

  // Automatic debounced persistence whenever admin edits system settings
  useEffect(() => {
    if (!hasUserEditedSettings.current) return;
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    const seqAtSchedule = editSeqRef.current;
    setAutoSaveNote('Saving...');
    autoSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveSettingsInFirestore(adminUid, admin.fullName, settings);
        if (editSeqRef.current === seqAtSchedule) {
          hasUserEditedSettings.current = false;
          setAutoSaveNote('Saved automatically');
          await onRefreshAll();
        }
      } catch (err) {
        setAutoSaveNote('');
        setFeedback({
          type: 'err',
          text: err instanceof Error ? err.message : 'Unable to auto-save settings.',
        });
      }
    }, 700);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [settings, adminUid, admin.fullName, onRefreshAll]);

  const updateSettingsField = (updater: (prev: AppSettingsRecord) => AppSettingsRecord) => {
    hasUserEditedSettings.current = true;
    editSeqRef.current += 1;
    setSettings(updater);
  };

  const handleSendPasswordReset = async () => {
    setFeedback(null);
    setResetSent(false);
    try {
      await sendPasswordResetEmail(auth, admin.email);
      setResetSent(true);
      setFeedback({
        type: 'ok',
        text: `Firebase password reset email sent to ${admin.email}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to send password reset email.',
      });
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    setFeedback(null);
    setSavingSettings(true);
    try {
      await saveSettingsInFirestore(adminUid, admin.fullName, settings);
      hasUserEditedSettings.current = false;
      setAutoSaveNote('Saved automatically');
      await onRefreshAll();
      setFeedback({ type: 'ok', text: 'Currency & schedule settings saved to Firestore.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddCustomColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await addCustomColumnInFirestore(
        adminUid,
        admin.fullName,
        newColLabel,
        newColType,
        customColumns.length,
      );
      setNewColLabel('');
      await onRefreshAll();
      setFeedback({ type: 'ok', text: 'Custom logbook column added and saved.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to add custom column.',
      });
    }
  };

  const handleSaveCustomColumn = async (colId: string) => {
    setFeedback(null);
    try {
      await updateCustomColumnInFirestore(adminUid, admin.fullName, colId, {
        label: editColLabel,
        isVisible: editColVisible,
      });
      setEditingColId(null);
      await onRefreshAll();
      setFeedback({ type: 'ok', text: 'Custom column updated.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update custom column.',
      });
    }
  };

  const handleToggleColumnVisibility = async (col: CustomColumnConfig) => {
    setFeedback(null);
    try {
      await updateCustomColumnInFirestore(adminUid, admin.fullName, col.id, {
        label: col.label,
        isVisible: !col.isVisible,
      });
      await onRefreshAll();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update column visibility.',
      });
    }
  };

  const handleDeleteColumn = async (id: string) => {
    try {
      await deleteCustomColumnInFirestore(id);
      await onRefreshAll();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to remove custom column.',
      });
    }
  };

  const handleDownloadBackup = () => {
    const json = JSON.stringify(
      {
        brand: 'OLA Continental Properties & Associate',
        exportedAt: new Date().toISOString(),
        data: workspaceSnapshot,
      },
      null,
      2,
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ola-continental-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Single Administrator Identity & Lock Status */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Shield className="h-4 w-4 text-[#B4832C]" />
            <span>Single Administrator Account Lock</span>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
              <div className="text-xs text-slate-500">Authorized Administrator</div>
              <div className="mt-0.5 font-semibold text-slate-900">{admin.fullName}</div>
              <div className="font-mono text-xs text-slate-600">{admin.email}</div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Public admin registration is permanently locked in Firestore (<code>config/adminLock</code>).
              No additional administrator accounts can be created or access this dashboard.
            </p>
            <div className="pt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSendPasswordReset}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <KeyRound className="h-3.5 w-3.5 text-[#B4832C]" />
                Send Password Reset Email
              </button>
              {resetSent && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <MailCheck className="h-3.5 w-3.5" />
                  Sent
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Currency & Schedule Settings (Auto-saved) */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Settings className="h-4 w-4 text-[#B4832C]" />
              <span>Currency &amp; Expiry Alert Schedule</span>
            </div>
            {autoSaveNote && (
              <span className="text-[11px] font-medium text-emerald-700">{autoSaveNote}</span>
            )}
          </div>
          <form onSubmit={handleSaveSettings} className="mt-4 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Currency Symbol</label>
                <input
                  type="text"
                  maxLength={6}
                  value={settings.currencySymbol}
                  onChange={(e) =>
                    updateSettingsField((s) => ({ ...s, currencySymbol: e.target.value }))
                  }
                  placeholder="₦ / $ / £"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Currency Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={settings.currencyCode}
                  onChange={(e) =>
                    updateSettingsField((s) => ({
                      ...s,
                      currencyCode: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="NGN / USD / GBP"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-center">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Monthly Summary Day (1–28)
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={settings.monthlyReportDay}
                  onChange={(e) =>
                    updateSettingsField((s) => ({
                      ...s,
                      monthlyReportDay: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </div>
              <label className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoCheckEnabled}
                  onChange={(e) =>
                    updateSettingsField((s) => ({ ...s, autoCheckEnabled: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-[#0B192C]"
                />
                Enable Automated Checks
              </label>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132642] disabled:opacity-60"
            >
              {savingSettings ? 'Saving...' : 'Save & Refresh Dashboard'}
            </button>
          </form>
        </section>

        {/* Custom Logbook Columns Manager */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Columns3 className="h-4 w-4 text-[#B4832C]" />
            <span>Configurable Logbook Columns</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Add or edit custom columns to reproduce additional handwritten columns from your
            physical register.
          </p>

          <form onSubmit={handleAddCustomColumn} className="mt-4 flex flex-wrap gap-2">
            <input
              type="text"
              required
              value={newColLabel}
              onChange={(e) => setNewColLabel(e.target.value)}
              placeholder="Column name (e.g. Receipt No. or Guarantor)"
              className="flex-1 min-w-[200px] rounded-md border border-slate-300 px-3 py-1.5 text-xs"
            />
            <select
              value={newColType}
              onChange={(e) => setNewColType(e.target.value as 'text' | 'number' | 'date')}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
            </select>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#132642]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Column
            </button>
          </form>

          <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
            {customColumns.length === 0 ? (
              <div className="pt-3 text-xs text-slate-400">No custom columns configured.</div>
            ) : (
              customColumns.map((col) => {
                const isEditing = editingColId === col.id;
                return (
                  <div key={col.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editColLabel}
                          onChange={(e) => setEditColLabel(e.target.value)}
                          className="w-full max-w-xs rounded border border-slate-300 px-2.5 py-1 text-xs"
                        />
                      ) : (
                        <>
                          <span
                            className={`font-semibold ${
                              col.isVisible ? 'text-slate-800' : 'text-slate-400 line-through'
                            }`}
                          >
                            {col.label}
                          </span>
                          <span className="ml-2 font-mono text-[11px] text-slate-400">
                            ({col.fieldType})
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSaveCustomColumn(col.id)}
                            title="Save column name"
                            className="rounded p-1 text-emerald-700 hover:bg-emerald-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingColId(null)}
                            title="Cancel"
                            className="rounded p-1 text-slate-500 hover:bg-slate-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleToggleColumnVisibility(col)}
                            title={col.isVisible ? 'Hide column in logbook' : 'Show column in logbook'}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            {col.isVisible ? (
                              <Eye className="h-3.5 w-3.5" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingColId(col.id);
                              setEditColLabel(col.label);
                              setEditColVisible(col.isVisible);
                            }}
                            title="Edit column label"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#0B192C]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteColumn(col.id)}
                            title="Delete column"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Database Backup & Sample Data */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Database className="h-4 w-4 text-[#B4832C]" />
            <span>Database Backup &amp; Demonstration Data</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Download a complete JSON snapshot of your OLA Continental Firestore register or manage sample records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {hasSampleData ? (
            <button
              type="button"
              onClick={onClearSampleData}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Sample Data
            </button>
          ) : (
            <button
              type="button"
              onClick={onSeedSampleData}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Load Sample Data
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadBackup}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132642]"
          >
            <Download className="h-3.5 w-3.5 text-[#D4AF37]" />
            Download JSON Backup
          </button>
        </div>
      </section>

      {/* Immutable Audit Log */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3.5">
          <History className="h-4 w-4 text-slate-500" />
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Administrator Audit Log ({auditLogs.length})
          </h3>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Timestamp</th>
                <th className="px-4 py-2 text-left font-semibold">Action</th>
                <th className="px-4 py-2 text-left font-semibold">Actor</th>
                <th className="px-4 py-2 text-left font-semibold">Entity</th>
                <th className="px-4 py-2 text-left font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    {log.createdAt.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="px-4 py-2 font-mono font-semibold text-slate-800 whitespace-nowrap">
                    {log.action}
                  </td>
                  <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{log.actorName}</td>
                  <td className="px-4 py-2 font-mono text-slate-600 whitespace-nowrap">
                    {log.entityType}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-slate-500 max-w-md truncate">
                    {String(log.details?.summary || JSON.stringify(log.details))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
