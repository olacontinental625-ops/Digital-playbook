import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, X } from 'lucide-react';
import {
  calculateExpiryDate,
  calculatePaymentMetrics,
  getTodayIso,
} from '../../shared/paymentCalc.ts';
import type {
  CustomColumnConfig,
  LogbookEntry,
  PropertyRecord,
  RoomRecord,
} from '../../shared/types.ts';
import {
  createOccupantInFirestore,
  updateOccupantInFirestore,
} from '../lib/firestoreStore.ts';

interface OccupantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  adminUid: string;
  adminName: string;
  entries: LogbookEntry[];
  properties: PropertyRecord[];
  rooms: RoomRecord[];
  customColumns: CustomColumnConfig[];
  currencySymbol: string;
  editEntry?: LogbookEntry | null;
}

const DURATION_PRESETS = [
  { label: 'Monthly (1 Month)', value: 1 },
  { label: '3 Months', value: 3 },
  { label: '6 Months', value: 6 },
  { label: '9 Months', value: 9 },
  { label: '12 Months', value: 12 },
  { label: '18 Months', value: 18 },
  { label: '24 Months', value: 24 },
];

export const OccupantModal: React.FC<OccupantModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  adminUid,
  adminName,
  entries,
  properties,
  rooms,
  customColumns,
  currencySymbol,
  editEntry,
}) => {
  const isEditing = Boolean(editEntry);
  const today = getTodayIso();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [newPropertyName, setNewPropertyName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [unpaidBalance, setUnpaidBalance] = useState('0');
  const [notes, setNotes] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, string>>({});

  // Payment fields (for new registration)
  const [recordInitialPayment, setRecordInitialPayment] = useState(true);
  const [transactionDate, setTransactionDate] = useState(today);
  const [amountPaid, setAmountPaid] = useState('');
  const [durationPreset, setDurationPreset] = useState<string>('12');
  const [customDurationMonths, setCustomDurationMonths] = useState('4');
  const [commencementDate, setCommencementDate] = useState(today);
  const [expiryOverride, setExpiryOverride] = useState('');
  const [transactionRef, setTransactionRef] = useState('');

  // Duplicate room warning state
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [confirmDuplicateRoom, setConfirmDuplicateRoom] = useState(false);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setDuplicateWarning(null);
    setConfirmDuplicateRoom(false);

    if (editEntry) {
      setFullName(editEntry.fullName);
      setPhone(editEntry.phone);
      setEmail(editEntry.email || '');
      setPropertyId(editEntry.propertyId);
      setNewPropertyName('');
      setRoomId(editEntry.roomId);
      setNewRoomNumber('');
      setUnpaidBalance(String(editEntry.unpaidBalance ?? 0));
      setNotes(editEntry.notes || '');
      setCustomFields(editEntry.customFields || {});

      const hasPayment =
        Boolean(editEntry.commencementDate && editEntry.expiryDate) ||
        (editEntry.amountPaid ?? 0) > 0 ||
        (editEntry.durationMonths ?? 0) > 0;
      setRecordInitialPayment(hasPayment);
      setTransactionDate(editEntry.transactionDate || today);
      setAmountPaid(editEntry.amountPaid ? String(editEntry.amountPaid) : '');
      const dur = editEntry.durationMonths || 12;
      const presetMatch = DURATION_PRESETS.find((d) => d.value === dur);
      if (presetMatch) {
        setDurationPreset(String(dur));
        setCustomDurationMonths('4');
      } else {
        setDurationPreset('custom');
        setCustomDurationMonths(String(dur));
      }
      setCommencementDate(editEntry.commencementDate || today);
      setExpiryOverride(editEntry.expiryDate || '');
      setTransactionRef('');
    } else {
      setFullName('');
      setPhone('');
      setEmail('');
      setPropertyId(properties[0]?.id ?? '__NEW__');
      setNewPropertyName('');
      setRoomId('');
      setNewRoomNumber('');
      setUnpaidBalance('0');
      setNotes('');
      setCustomFields({});
      setRecordInitialPayment(true);
      setTransactionDate(today);
      setAmountPaid('');
      setDurationPreset('12');
      setCustomDurationMonths('4');
      setCommencementDate(today);
      setExpiryOverride('');
      setTransactionRef('');
    }
  }, [isOpen, editEntry, properties, today]);

  const propertyRooms = useMemo(() => {
    if (!propertyId || propertyId === '__NEW__') return [];
    return rooms.filter((r) => r.propertyId === propertyId);
  }, [rooms, propertyId]);

  useEffect(() => {
    if (!isOpen) return;
    if (propertyId === '__NEW__') {
      setRoomId('__NEW__');
      return;
    }
    if (roomId === '__NEW__') return;
    if (propertyRooms.some((r) => r.id === roomId)) return;

    if (propertyRooms.length > 0) {
      const vacant = propertyRooms.find((r) => !r.activeOccupantId);
      setRoomId(vacant?.id ?? propertyRooms[0].id);
    } else {
      setRoomId('__NEW__');
    }
  }, [propertyId, propertyRooms, roomId, isOpen]);

  const effectiveDurationMonths = useMemo(() => {
    if (durationPreset === 'custom') {
      const parsed = Math.round(Number(customDurationMonths));
      return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    }
    return Number(durationPreset);
  }, [durationPreset, customDurationMonths]);

  const computedExpiryDate = useMemo(() => {
    if (!commencementDate || !/^\d{4}-\d{2}-\d{2}$/.test(commencementDate)) return '';
    return calculateExpiryDate(commencementDate, effectiveDurationMonths);
  }, [commencementDate, effectiveDurationMonths]);

  const finalExpiryDate = expiryOverride || computedExpiryDate;

  const liveMetrics = useMemo(() => {
    if (!recordInitialPayment || !commencementDate || !finalExpiryDate) return null;
    return calculatePaymentMetrics(commencementDate, finalExpiryDate, effectiveDurationMonths, today);
  }, [recordInitialPayment, commencementDate, finalExpiryDate, effectiveDurationMonths, today]);

  if (!isOpen) return null;

  const submitForm = async (overrideDuplicate = false) => {
    setError('');

    const chosenRoomId = roomId === '__NEW__' ? '' : roomId;
    if (chosenRoomId && !(overrideDuplicate || confirmDuplicateRoom)) {
      const conflict = entries.find(
        (e) => !e.isArchived && e.roomId === chosenRoomId && e.id !== editEntry?.id,
      );
      if (conflict) {
        setDuplicateWarning(
          `${conflict.roomNumber} (${conflict.propertyName}) is currently assigned to ${conflict.fullName}. Confirm to allow dual occupancy on this unit.`,
        );
        return;
      }
    }

    setSaving(true);
    try {
      if (isEditing && editEntry) {
        await updateOccupantInFirestore(adminUid, adminName, editEntry.id, properties, rooms, {
          fullName,
          phone,
          email,
          propertyId: propertyId === '__NEW__' ? '' : propertyId,
          propertyName: propertyId === '__NEW__' ? newPropertyName : '',
          roomId: roomId === '__NEW__' ? '' : roomId,
          roomNumber: roomId === '__NEW__' ? newRoomNumber : '',
          notes,
          unpaidBalance: Math.max(0, Number(unpaidBalance) || 0),
          customFields,
          hasPaymentDetails: recordInitialPayment,
          transactionDate,
          amountPaid: Math.max(0, Number(amountPaid) || 0),
          durationMonths: effectiveDurationMonths,
          commencementDate,
          expiryDate: finalExpiryDate,
        });
      } else {
        await createOccupantInFirestore(adminUid, adminName, entries, properties, rooms, {
          fullName,
          phone,
          email,
          propertyId: propertyId === '__NEW__' ? '' : propertyId,
          propertyName: propertyId === '__NEW__' ? newPropertyName : '',
          roomId: roomId === '__NEW__' ? '' : roomId,
          roomNumber: roomId === '__NEW__' ? newRoomNumber : '',
          notes,
          customFields,
          recordInitialPayment,
          transactionDate,
          amountPaid: Number(amountPaid) || 0,
          unpaidBalance: Math.max(0, Number(unpaidBalance) || 0),
          durationMonths: effectiveDurationMonths,
          commencementDate,
          expiryDate: finalExpiryDate,
          transactionRef,
        });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save occupant record.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitForm(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
      <div className="my-8 w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              {isEditing
                ? `Edit Occupant · #${String(editEntry?.serialNumber).padStart(3, '0')}`
                : 'Add New Occupant'}
            </h2>
            <p className="text-xs text-slate-500">
              {isEditing
                ? 'Update occupant details, assigned unit, unpaid balance, or custom columns.'
                : 'Register occupant, room assignment, unpaid balance, and initial payment period.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[80vh] overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {duplicateWarning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-amber-900">
                    Duplicate Active Room Assignment Detected
                  </div>
                  <p className="mt-1 text-xs text-amber-800">{duplicateWarning}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDuplicateRoom(true);
                        submitForm(true);
                      }}
                      className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
                    >
                      Confirm &amp; Assign Anyway
                    </button>
                    <button
                      type="button"
                      onClick={() => setDuplicateWarning(null)}
                      className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    >
                      Choose Another Room
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Occupant & Unit Assignment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Full Name *</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Adewale Johnson"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none focus:ring-1 focus:ring-[#0B192C]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Phone Number *</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +234 803 000 0000"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none focus:ring-1 focus:ring-[#0B192C]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Occupant Email (Links to User Portal)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="occupant@example.com (optional)"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none focus:ring-1 focus:ring-[#0B192C]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Unpaid Balance ({currencySymbol})
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unpaidBalance}
                onChange={(e) => setUnpaidBalance(e.target.value)}
                placeholder="0.00"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-[#0B192C] focus:outline-none focus:ring-1 focus:ring-[#0B192C]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Property / Location *
              </label>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none focus:ring-1 focus:ring-[#0B192C]"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="__NEW__">+ Add New Property / Location</option>
              </select>
              {propertyId === '__NEW__' && (
                <input
                  type="text"
                  required
                  value={newPropertyName}
                  onChange={(e) => setNewPropertyName(e.target.value)}
                  placeholder="Enter new property name"
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Room / Unit Number *
              </label>
              <select
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                disabled={propertyId === '__NEW__'}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none focus:ring-1 focus:ring-[#0B192C] disabled:bg-slate-100"
              >
                {propertyRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.roomNumber}
                    {r.activeOccupantName ? ` (Assigned: ${r.activeOccupantName})` : ' (Vacant)'}
                  </option>
                ))}
                <option value="__NEW__">+ Add New Room / Unit</option>
              </select>
              {(roomId === '__NEW__' || propertyId === '__NEW__') && (
                <input
                  type="text"
                  required
                  value={newRoomNumber}
                  onChange={(e) => setNewRoomNumber(e.target.value)}
                  placeholder="e.g. Room 05"
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                />
              )}
            </div>
          </div>

          {/* Payment Record Section (Add & Edit) */}
          <div className="border-t border-slate-200 pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {isEditing ? 'Payment Period & Amount' : 'Initial Payment Record'}
                </h3>
                <p className="text-xs text-slate-500">
                  Leave unchecked only if the occupant has no active payment period.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recordInitialPayment}
                  onChange={(e) => setRecordInitialPayment(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0B192C]"
                />
                {isEditing ? 'Active Payment Details' : 'Record Payment Now'}
              </label>
            </div>

            {recordInitialPayment && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Amount Paid ({currencySymbol}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                      placeholder="0.00"
                      className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Payment Duration *
                      </label>
                      <select
                        value={durationPreset}
                        onChange={(e) => {
                          setDurationPreset(e.target.value);
                          setExpiryOverride('');
                        }}
                        className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      >
                        {DURATION_PRESETS.map((d) => (
                          <option key={d.value} value={String(d.value)}>
                            {d.label}
                          </option>
                        ))}
                        <option value="custom">Custom Duration (Months)</option>
                      </select>
                    </div>

                    {durationPreset === 'custom' ? (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Custom Months *
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="120"
                          required
                          value={customDurationMonths}
                          onChange={(e) => {
                            setCustomDurationMonths(e.target.value);
                            setExpiryOverride('');
                          }}
                          className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-[#0B192C] focus:outline-none"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Transaction Date *
                        </label>
                        <input
                          type="date"
                          required
                          value={transactionDate}
                          onChange={(e) => setTransactionDate(e.target.value)}
                          className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Payment Start Date *
                      </label>
                      <input
                        type="date"
                        required
                        value={commencementDate}
                        onChange={(e) => {
                          setCommencementDate(e.target.value);
                          setExpiryOverride('');
                        }}
                        className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Payment Expiry Date (Auto)
                      </label>
                      <input
                        type="date"
                        required
                        value={finalExpiryDate}
                        onChange={(e) => setExpiryOverride(e.target.value)}
                        className="mt-1.5 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Transaction Ref (Optional)
                      </label>
                      <input
                        type="text"
                        value={transactionRef}
                        onChange={(e) => setTransactionRef(e.target.value)}
                        placeholder="Auto-generated if blank"
                        className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Live Duration Calculator Summary */}
                  {liveMetrics && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[#0B192C]">
                        <CalendarClock className="h-4 w-4 text-[#B4832C]" />
                        <span>Automatic Payment Duration Calculator Preview</span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                        <div>
                          <div className="text-slate-500">Total Months</div>
                          <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                            {liveMetrics.totalMonths} mo
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Months Used</div>
                          <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                            {liveMetrics.monthsUsed} mo
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Months Remaining</div>
                          <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                            {liveMetrics.monthsRemaining} mo
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Days Remaining</div>
                          <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                            {liveMetrics.daysRemaining} d
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Computed Status</div>
                          <div
                            className={`mt-0.5 font-semibold ${
                              liveMetrics.status === 'PAID' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {liveMetrics.status}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

          {/* Custom Logbook Columns */}
          {customColumns.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <div className="text-xs font-semibold text-slate-700 mb-3">
                Configured Logbook Columns
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {customColumns.map((col) => (
                  <div key={col.id}>
                    <label className="block text-xs font-medium text-slate-600">{col.label}</label>
                    <input
                      type={col.fieldType === 'number' ? 'number' : col.fieldType === 'date' ? 'date' : 'text'}
                      value={customFields[col.columnKey] ?? ''}
                      onChange={(e) =>
                        setCustomFields((prev) => ({ ...prev, [col.columnKey]: e.target.value }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Additional Notes / Remarks
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional remarks recorded in the logbook..."
              className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[#0B192C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#132642] disabled:opacity-60"
            >
              {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Register Occupant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
