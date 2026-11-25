import React, { useState } from 'react';
import { Building2, Check, DoorClosed, Edit3, Plus, Trash2, X } from 'lucide-react';
import type { LogbookEntry, PropertyRecord, RoomRecord } from '../../shared/types.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  createPropertyDoc,
  createRoomDoc,
  deletePropertyDoc,
  deleteRoomDoc,
  updatePropertyDoc,
  updateRoomDoc,
} from '../lib/firestoreStore.ts';

interface PropertiesViewProps {
  adminUid: string;
  adminName: string;
  properties: PropertyRecord[];
  rooms: RoomRecord[];
  entries: LogbookEntry[];
  onRefresh: () => Promise<void>;
  onSelectOccupant: (id: string) => void;
}

export const PropertiesView: React.FC<PropertiesViewProps> = ({
  adminUid,
  adminName,
  properties,
  rooms,
  entries,
  onRefresh,
  onSelectOccupant,
}) => {
  const [propName, setPropName] = useState('');
  const [propAddress, setPropAddress] = useState('');
  const [propError, setPropError] = useState('');
  const [savingProp, setSavingProp] = useState(false);

  const [editingPropId, setEditingPropId] = useState<string | null>(null);
  const [editPropName, setEditPropName] = useState('');
  const [editPropAddress, setEditPropAddress] = useState('');
  const [savingEditProp, setSavingEditProp] = useState(false);

  const [roomPropertyId, setRoomPropertyId] = useState(properties[0]?.id ?? '');
  const [roomNumber, setRoomNumber] = useState('');
  const [floorOrWing, setFloorOrWing] = useState('');
  const [roomError, setRoomError] = useState('');
  const [savingRoom, setSavingRoom] = useState(false);

  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editRoomNumber, setEditRoomNumber] = useState('');
  const [editRoomFloor, setEditRoomFloor] = useState('');
  const [savingEditRoom, setSavingEditRoom] = useState(false);

  const activePropId = roomPropertyId || properties[0]?.id || '';

  const handleAddProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    setPropError('');
    setSavingProp(true);
    try {
      await createPropertyDoc(adminUid, adminName, {
        name: propName,
        address: propAddress,
      });
      setPropName('');
      setPropAddress('');
      await onRefresh();
    } catch (err) {
      setPropError(err instanceof Error ? err.message : 'Unable to add property.');
    } finally {
      setSavingProp(false);
    }
  };

  const handleSaveEditProperty = async (propertyId: string) => {
    setPropError('');
    setSavingEditProp(true);
    try {
      await updatePropertyDoc(
        adminUid,
        adminName,
        propertyId,
        { name: editPropName, address: editPropAddress },
        rooms,
        entries,
      );
      setEditingPropId(null);
      await onRefresh();
    } catch (err) {
      setPropError(err instanceof Error ? err.message : 'Unable to update property.');
    } finally {
      setSavingEditProp(false);
    }
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoomError('');
    const prop = properties.find((p) => p.id === activePropId);
    if (!prop) {
      setRoomError('Please select a valid property.');
      return;
    }
    setSavingRoom(true);
    try {
      await createRoomDoc(adminUid, adminName, {
        propertyId: prop.id,
        propertyName: prop.name,
        roomNumber,
        floorOrWing,
      });
      setRoomNumber('');
      setFloorOrWing('');
      await onRefresh();
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to add room.');
    } finally {
      setSavingRoom(false);
    }
  };

  const handleSaveEditRoom = async (roomId: string) => {
    setRoomError('');
    setSavingEditRoom(true);
    try {
      await updateRoomDoc(
        adminUid,
        adminName,
        roomId,
        { roomNumber: editRoomNumber, floorOrWing: editRoomFloor },
        entries,
      );
      setEditingRoomId(null);
      await onRefresh();
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to update room.');
    } finally {
      setSavingEditRoom(false);
    }
  };

  const handleDeleteProperty = async (p: PropertyRecord) => {
    setPropError('');
    if ((p.roomCount ?? 0) > 0) {
      setPropError(`Cannot delete "${p.name}" while it still contains rooms.`);
      return;
    }
    try {
      await deletePropertyDoc(adminUid, adminName, p.id);
      await onRefresh();
    } catch (err) {
      setPropError(err instanceof Error ? err.message : 'Unable to delete property.');
    }
  };

  const handleDeleteRoom = async (r: RoomRecord) => {
    setRoomError('');
    if (r.activeOccupantId) {
      setRoomError(`Cannot delete "${r.roomNumber}" while assigned to ${r.activeOccupantName}.`);
      return;
    }
    try {
      await deleteRoomDoc(adminUid, adminName, r.id);
      await onRefresh();
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to delete room.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Add Property Form */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Building2 className="h-4 w-4 text-[#B4832C]" />
            <span>Add Property / Location</span>
          </div>
          {propError && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {propError}
            </div>
          )}
          <form onSubmit={handleAddProperty} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={propName}
                onChange={(e) => setPropName(e.target.value)}
                placeholder="Property name (e.g. OLA Court A)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
              <input
                type="text"
                value={propAddress}
                onChange={(e) => setPropAddress(e.target.value)}
                placeholder="Street address or zone"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={savingProp}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132642] disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5 text-[#D4AF37]" />
              {savingProp ? 'Adding...' : 'Add Property'}
            </button>
          </form>
        </section>

        {/* Add Room Form */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <DoorClosed className="h-4 w-4 text-[#B4832C]" />
            <span>Add Room / Unit</span>
          </div>
          {roomError && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {roomError}
            </div>
          )}
          <form onSubmit={handleAddRoom} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                required
                value={activePropId}
                onChange={(e) => setRoomPropertyId(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              >
                {properties.length === 0 ? (
                  <option value="">Create a property first</option>
                ) : (
                  properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
              <input
                type="text"
                required
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder="Room / Unit (e.g. Room 12)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
              <input
                type="text"
                value={floorOrWing}
                onChange={(e) => setFloorOrWing(e.target.value)}
                placeholder="Floor / Wing (optional)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={savingRoom || properties.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132642] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5 text-[#D4AF37]" />
              {savingRoom ? 'Adding...' : 'Add Room / Unit'}
            </button>
          </form>
        </section>
      </div>

      {/* Properties Summary Table */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Properties ({properties.length})
          </h3>
        </div>
        {properties.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No properties registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Property Name</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Address / Zone</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Rooms</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Occupied</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {properties.map((p) => {
                  const isEditing = editingPropId === p.id;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editPropName}
                            onChange={(e) => setEditPropName(e.target.value)}
                            className="w-full rounded border border-slate-300 px-2.5 py-1 text-xs font-medium"
                          />
                        ) : (
                          p.name
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editPropAddress}
                            onChange={(e) => setEditPropAddress(e.target.value)}
                            placeholder="Address / Zone"
                            className="w-full rounded border border-slate-300 px-2.5 py-1 text-xs"
                          />
                        ) : (
                          p.address || '—'
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{p.roomCount ?? 0}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{p.occupiedCount ?? 0}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={savingEditProp}
                              onClick={() => handleSaveEditProperty(p.id)}
                              title="Save property"
                              className="rounded p-1 text-emerald-700 hover:bg-emerald-50"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingPropId(null)}
                              title="Cancel"
                              className="rounded p-1 text-slate-500 hover:bg-slate-100"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPropId(p.id);
                                setEditPropName(p.name);
                                setEditPropAddress(p.address || '');
                                setPropError('');
                              }}
                              title="Edit property"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#0B192C]"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteProperty(p)}
                              title="Delete empty property"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Rooms & Occupancy Table */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Rooms &amp; Unit Occupancy ({rooms.length})
          </h3>
        </div>
        {rooms.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No rooms registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Property</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Room / Unit</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Floor / Wing</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Assigned Occupant</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Payment Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rooms.map((r) => {
                  const isEditing = editingRoomId === r.id;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-700">{r.propertyName}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editRoomNumber}
                            onChange={(e) => setEditRoomNumber(e.target.value)}
                            className="w-full rounded border border-slate-300 px-2.5 py-1 text-xs font-medium"
                          />
                        ) : (
                          r.roomNumber
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editRoomFloor}
                            onChange={(e) => setEditRoomFloor(e.target.value)}
                            placeholder="Floor / Wing"
                            className="w-full rounded border border-slate-300 px-2.5 py-1 text-xs"
                          />
                        ) : (
                          r.floorOrWing || '—'
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.activeOccupantId && r.activeOccupantName ? (
                          <button
                            type="button"
                            onClick={() => onSelectOccupant(r.activeOccupantId!)}
                            className="font-medium text-[#0B192C] hover:underline"
                          >
                            {r.activeOccupantName}
                          </button>
                        ) : (
                          <span className="text-slate-400">Vacant</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.activeOccupantStatus ? (
                          <StatusBadge status={r.activeOccupantStatus} compact />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={savingEditRoom}
                              onClick={() => handleSaveEditRoom(r.id)}
                              title="Save room"
                              className="rounded p-1 text-emerald-700 hover:bg-emerald-50"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingRoomId(null)}
                              title="Cancel"
                              className="rounded p-1 text-slate-500 hover:bg-slate-100"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRoomId(r.id);
                                setEditRoomNumber(r.roomNumber);
                                setEditRoomFloor(r.floorOrWing || '');
                                setRoomError('');
                              }}
                              title="Edit room"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#0B192C]"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRoom(r)}
                              title="Delete empty room"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
