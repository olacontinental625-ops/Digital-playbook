import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import type {
  AdminUser,
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
} from '../shared/types.ts';
import { AuthPortal, type PortalMode } from './components/AuthPortal.tsx';
import { CsvImportModal } from './components/CsvImportModal.tsx';
import { OccupantModal } from './components/OccupantModal.tsx';
import { OccupantProfileDrawer } from './components/OccupantProfileDrawer.tsx';
import { PaymentModal } from './components/PaymentModal.tsx';
import { OfflineIndicator, PWAInstallButton } from './hooks/usePWAInstall.tsx';
import { auth, OLA_LOGO_PATH } from './lib/firebase.ts';
import {
  clearSampleDataInFirestore,
  fetchAdminProfile,
  fetchAdminWorkspaceBundle,
  fetchPersonalOccupantRecords,
  fetchPublicSummary,
  fetchUserProfile,
  getAdminClaimStatus,
  seedSampleDataInFirestore,
  verifyUserIsAdmin,
  type AdminWorkspaceBundle,
} from './lib/firestoreStore.ts';
import { DashboardView } from './views/DashboardView.tsx';
import { LogbookView } from './views/LogbookView.tsx';
import { NotificationsView } from './views/NotificationsView.tsx';
import { PropertiesView } from './views/PropertiesView.tsx';
import { ReportsView } from './views/ReportsView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { UserPortalView } from './views/UserPortalView.tsx';

type NavSection =
  | 'dashboard'
  | 'logbook'
  | 'properties'
  | 'notifications'
  | 'reports'
  | 'settings';

const DEFAULT_SUMMARY: DashboardSummary = {
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

const DEFAULT_SETTINGS: AppSettingsRecord = {
  onesignalAppId: '',
  onesignalRestKeyConfigured: false,
  currencySymbol: '₦',
  currencyCode: 'NGN',
  autoCheckEnabled: true,
  monthlyReportDay: 1,
};

function getInitialPortalMode(): PortalMode {
  if (typeof window === 'undefined') return 'user';
  const params = new URLSearchParams(window.location.search);
  return params.get('portal') === 'admin' ? 'admin' : 'user';
}

export default function App() {
  const [portalMode, setPortalMode] = useState<PortalMode>(getInitialPortalMode);
  const [authChecked, setAuthChecked] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [adminClaimed, setAdminClaimed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);

  // Normal User Portal state
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [publicSummary, setPublicSummary] = useState<DashboardSummary>(DEFAULT_SUMMARY);
  const [personalRecords, setPersonalRecords] = useState<LogbookEntry[]>([]);
  const [userPortalLoading, setUserPortalLoading] = useState(false);
  const [authFlowBusy, setAuthFlowBusy] = useState(false);
  const [authGateError, setAuthGateError] = useState('');
  const authFlowBusyRef = useRef(false);

  // Admin Workspace state
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [logbookPresetFilter, setLogbookPresetFilter] = useState<string>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary>(DEFAULT_SUMMARY);
  const [entries, setEntries] = useState<LogbookEntry[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransactionRecord[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomColumnConfig[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [settings, setSettings] = useState<AppSettingsRecord>(DEFAULT_SETTINGS);
  const [workspaceBundle, setWorkspaceBundle] = useState<AdminWorkspaceBundle | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

  // Modals & drawers
  const [occupantModalOpen, setOccupantModalOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LogbookEntry | null>(null);
  const [paymentModalEntry, setPaymentModalEntry] = useState<LogbookEntry | null>(null);
  const [profileOccupantId, setProfileOccupantId] = useState<string | null>(null);

  const switchPortal = useCallback((nextMode: PortalMode) => {
    setPortalMode(nextMode);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (nextMode === 'admin') {
        url.searchParams.set('portal', 'admin');
      } else {
        url.searchParams.delete('portal');
      }
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const handleAuthBusyChange = useCallback((busy: boolean) => {
    authFlowBusyRef.current = busy;
    setAuthFlowBusy(busy);
  }, []);

  const refreshAuthAndClaims = useCallback(async (user: User | null) => {
    const claimed = await getAdminClaimStatus().catch(() => false);
    setAdminClaimed(claimed);

    if (!user) {
      setIsAdmin(false);
      setAdminUser(null);
      setUserProfile(null);
      setAuthChecked(true);
      return;
    }

    const [adminFlag, existingProfile] = await Promise.all([
      verifyUserIsAdmin(user).catch(() => false),
      fetchUserProfile(user.uid).catch(() => null),
    ]);

    // If an unregistered user tries to enter the User Portal without signing up first,
    // reject and sign them out cleanly.
    if (!adminFlag && !existingProfile) {
      await signOut(auth).catch(() => {});
      setFirebaseUser(null);
      setIsAdmin(false);
      setAdminUser(null);
      setUserProfile(null);
      setAuthGateError('Your record was not found. New users must sign up first before signing in.');
      setAuthChecked(true);
      return;
    }

    setAuthGateError('');
    setIsAdmin(adminFlag);
    setUserProfile(existingProfile);

    if (adminFlag) {
      const prof = await fetchAdminProfile(user.uid).catch(() => null);
      setAdminUser({
        id: user.uid,
        fullName: prof?.fullName || user.displayName || 'OLA Continental Admin',
        email: prof?.email || user.email || '',
        username: (prof?.email || user.email || 'admin').split('@')[0],
        sessionTimeoutMinutes: 60,
        createdAt: new Date().toISOString(),
      });
    } else {
      setAdminUser(null);
    }
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (authFlowBusyRef.current) {
        return;
      }
      setFirebaseUser(user);
      refreshAuthAndClaims(user);
    });
    return () => unsubscribe();
  }, [refreshAuthAndClaims]);

  const loadUserPortalData = useCallback(async (user: User) => {
    setUserPortalLoading(true);
    try {
      const [profile, pubSum, personal] = await Promise.all([
        fetchUserProfile(user.uid).catch(() => null),
        fetchPublicSummary().catch(() => DEFAULT_SUMMARY),
        fetchPersonalOccupantRecords(user).catch(() => []),
      ]);
      setUserProfile(profile);
      setPublicSummary(pubSum);
      setPersonalRecords(personal);
    } finally {
      setUserPortalLoading(false);
    }
  }, []);

  const loadAdminWorkspace = useCallback(async (uid: string) => {
    setDataLoading(true);
    try {
      const bundle = await fetchAdminWorkspaceBundle(uid);
      setWorkspaceBundle(bundle);
      setSummary(bundle.summary);
      setEntries(bundle.entries);
      setTransactions(bundle.transactions);
      setProperties(bundle.properties);
      setRooms(bundle.rooms);
      setCustomColumns(bundle.customColumns);
      setNotifications(bundle.notifications);
      setAuditLogs(bundle.auditLogs);
      setSettings(bundle.settings);
    } catch (err) {
      console.error('Failed to load workspace:', err);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!firebaseUser || authFlowBusy) return;
    if (portalMode === 'user') {
      loadUserPortalData(firebaseUser);
    } else if (portalMode === 'admin' && isAdmin) {
      loadAdminWorkspace(firebaseUser.uid);
    }
  }, [firebaseUser, authFlowBusy, portalMode, isAdmin, loadUserPortalData, loadAdminWorkspace]);

  const handleSignOut = async () => {
    await signOut(auth);
    setEntries([]);
    setTransactions([]);
    setProperties([]);
    setRooms([]);
    setUserProfile(null);
    setPersonalRecords([]);
    setSummary(DEFAULT_SUMMARY);
  };

  const handleSeedSample = async () => {
    if (!firebaseUser || !adminUser) return;
    await seedSampleDataInFirestore(firebaseUser.uid, adminUser.fullName, entries);
    await loadAdminWorkspace(firebaseUser.uid);
  };

  const handleClearSample = async () => {
    if (!firebaseUser || !adminUser || !workspaceBundle) return;
    await clearSampleDataInFirestore(firebaseUser.uid, adminUser.fullName, workspaceBundle);
    await loadAdminWorkspace(firebaseUser.uid);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0B192C] flex items-center justify-center text-white">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-300">
          <img
            src={OLA_LOGO_PATH}
            alt="OLA Continental"
            className="h-8 w-8 rounded border border-[#C59B38]/60 object-cover bg-white"
          />
          <span>Loading OLA Continental Portal...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated or auth check in progress -> Show AuthPortal
  if (!firebaseUser || authFlowBusy) {
    return (
      <>
        <AuthPortal
          portalMode={portalMode}
          adminClaimed={adminClaimed}
          externalError={authGateError}
          onClearExternalError={() => setAuthGateError('')}
          onAuthBusyChange={handleAuthBusyChange}
          onSwitchPortal={switchPortal}
          onAuthCompleted={async () => {
            const current = auth.currentUser;
            setFirebaseUser(current);
            await refreshAuthAndClaims(current);
          }}
        />
        <OfflineIndicator />
      </>
    );
  }

  // Authenticated in Normal User Portal -> Show User Account, People Recorded & Unpaid Balance
  if (portalMode === 'user') {
    return (
      <>
        <UserPortalView
          userProfile={userProfile}
          userEmail={firebaseUser.email || ''}
          userDisplayName={firebaseUser.displayName || ''}
          isAdmin={isAdmin}
          summary={publicSummary}
          personalRecords={personalRecords}
          loading={userPortalLoading}
          onSignOut={handleSignOut}
          onOpenAdminDashboard={() => switchPortal('admin')}
        />
        <OfflineIndicator />
      </>
    );
  }

  // Authenticated in Admin Portal, but NOT the Single Authorized Administrator
  if (portalMode === 'admin' && !isAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-7 shadow-sm text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold text-slate-900">
            Administrator Access Restricted
          </h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Signed in as <strong className="text-slate-900">{firebaseUser.email}</strong>. The
            OLA Continental Admin Dashboard is locked exclusively to the single authorized
            administrator account.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
            <button
              type="button"
              onClick={() => switchPortal('user')}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132642]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Go to User Portal
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out &amp; Switch Account
            </button>
          </div>
        </div>
        <OfflineIndicator />
      </div>
    );
  }

  // Authorized Single Administrator -> Full Admin Dashboard & Backend Register Management
  const currentAdmin: AdminUser = adminUser || {
    id: firebaseUser.uid,
    fullName: firebaseUser.displayName || 'OLA Continental Admin',
    email: firebaseUser.email || '',
    username: (firebaseUser.email || 'admin').split('@')[0],
    sessionTimeoutMinutes: 60,
    createdAt: new Date().toISOString(),
  };

  const navItems: Array<{ id: NavSection; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'logbook', label: 'Digital Logbook', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'properties', label: 'Properties & Rooms', icon: <Building2 className="h-4 w-4" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
    { id: 'reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'settings', label: 'Settings & Security', icon: <Settings className="h-4 w-4" /> },
  ];

  const sectionTitles: Record<NavSection, string> = {
    dashboard: 'Executive Dashboard',
    logbook: 'Digital Logbook Register',
    properties: 'Properties & Units',
    notifications: 'Payment Expiry Alerts',
    reports: 'Reports & Analytics',
    settings: 'Settings & Security',
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B192C] text-slate-200 border-r border-slate-800">
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
          <img
            src={OLA_LOGO_PATH}
            alt="OLA Continental logo"
            className="h-9 w-9 rounded border border-[#C59B38]/60 object-cover bg-white shrink-0"
          />
          <div className="min-w-0">
            <span className="font-display text-sm font-bold tracking-tight text-white block truncate">
              OLA CONTINENTAL
            </span>
            <span className="text-[10px] text-[#D4AF37] uppercase tracking-wider block truncate">
              Admin Logbook Console
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === 'logbook') setLogbookPresetFilter('all');
                  setActiveSection(item.id);
                }}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#132642] text-white border border-[#C59B38]/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className={active ? 'text-[#D4AF37]' : 'text-slate-400'}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4 space-y-2.5">
          <div>
            <div className="text-xs font-semibold text-white truncate">{currentAdmin.fullName}</div>
            <div className="text-[11px] text-slate-400 truncate">{currentAdmin.email}</div>
          </div>
          <button
            type="button"
            onClick={() => switchPortal('user')}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors"
          >
            <UserCheck className="h-3.5 w-3.5 text-[#D4AF37]" />
            <span>View Member Portal</span>
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-64 flex-col bg-[#0B192C] text-slate-200">
            <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
              <div className="flex items-center gap-2.5">
                <img
                  src={OLA_LOGO_PATH}
                  alt="OLA Continental"
                  className="h-7 w-7 rounded border border-[#C59B38]/60 object-cover bg-white"
                />
                <span className="font-display text-sm font-bold text-white">OLA CONTINENTAL</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-300 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4">
              {navItems.map((item) => {
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === 'logbook') setLogbookPresetFilter('all');
                      setActiveSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium ${
                      active ? 'bg-[#132642] text-white' : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <span className={active ? 'text-[#D4AF37]' : 'text-slate-400'}>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-white/10 p-4 space-y-2">
              <div className="text-xs font-semibold text-white truncate">{currentAdmin.fullName}</div>
              <div className="text-[11px] text-slate-400 truncate">{currentAdmin.email}</div>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  switchPortal('user');
                }}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200"
              >
                <UserCheck className="h-3.5 w-3.5 text-[#D4AF37]" />
                <span>View Member Portal</span>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 flex h-14 sm:h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="hidden sm:inline text-slate-400">OLA Continental</span>
              <span className="hidden sm:inline text-slate-300">/</span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {sectionTitles[activeSection]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => {
                setEditingEntry(null);
                setOccupantModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#132642] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5 text-[#D4AF37]" />
              <span>New Occupant</span>
            </button>
          </div>
        </header>

        {/* Active View Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">
          {activeSection === 'dashboard' && (
            <DashboardView
              summary={summary}
              entries={entries}
              recentTransactions={transactions.slice(0, 10)}
              loading={dataLoading}
              onAddOccupant={() => {
                setEditingEntry(null);
                setOccupantModalOpen(true);
              }}
              onSelectOccupant={(id) => setProfileOccupantId(id)}
              onRecordPayment={(entry) => setPaymentModalEntry(entry)}
              onNavigateLogbook={(preset = 'all') => {
                setLogbookPresetFilter(preset);
                setActiveSection('logbook');
              }}
              onSeedSampleData={handleSeedSample}
              onClearSampleData={handleClearSample}
            />
          )}

          {activeSection === 'logbook' && (
            <LogbookView
              key={logbookPresetFilter}
              entries={entries}
              properties={properties}
              customColumns={customColumns}
              currencySymbol={summary.currencySymbol}
              initialFilter={logbookPresetFilter}
              onAddOccupant={() => {
                setEditingEntry(null);
                setOccupantModalOpen(true);
              }}
              onImportCsv={() => setCsvModalOpen(true)}
              onEditOccupant={(entry) => {
                setEditingEntry(entry);
                setOccupantModalOpen(true);
              }}
              onRecordPayment={(entry) => setPaymentModalEntry(entry)}
              onSelectOccupant={(id) => setProfileOccupantId(id)}
            />
          )}

          {activeSection === 'properties' && (
            <PropertiesView
              adminUid={firebaseUser.uid}
              adminName={currentAdmin.fullName}
              properties={properties}
              rooms={rooms}
              entries={entries}
              onRefresh={() => loadAdminWorkspace(firebaseUser.uid)}
              onSelectOccupant={(id) => setProfileOccupantId(id)}
            />
          )}

          {activeSection === 'notifications' && (
            <NotificationsView
              adminUid={firebaseUser.uid}
              entries={entries}
              notifications={notifications}
              settings={settings}
              onRefresh={() => loadAdminWorkspace(firebaseUser.uid)}
            />
          )}

          {activeSection === 'reports' && (
            <ReportsView
              entries={entries}
              transactions={transactions}
              properties={properties}
              rooms={rooms}
              currencySymbol={summary.currencySymbol}
              onSelectOccupant={(id) => setProfileOccupantId(id)}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              admin={currentAdmin}
              adminUid={firebaseUser.uid}
              settings={settings}
              customColumns={customColumns}
              auditLogs={auditLogs}
              workspaceSnapshot={workspaceBundle}
              hasSampleData={summary.hasSampleData}
              onRefreshAll={() => loadAdminWorkspace(firebaseUser.uid)}
              onSeedSampleData={handleSeedSample}
              onClearSampleData={handleClearSample}
            />
          )}
        </main>
      </div>

      {/* Modals & Profile Drawer */}
      <OccupantModal
        isOpen={occupantModalOpen}
        onClose={() => {
          setOccupantModalOpen(false);
          setEditingEntry(null);
        }}
        onSaved={() => loadAdminWorkspace(firebaseUser.uid)}
        adminUid={firebaseUser.uid}
        adminName={currentAdmin.fullName}
        entries={entries}
        properties={properties}
        rooms={rooms}
        customColumns={customColumns}
        currencySymbol={summary.currencySymbol}
        editEntry={editingEntry}
      />

      <CsvImportModal
        isOpen={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        onImported={() => loadAdminWorkspace(firebaseUser.uid)}
        adminUid={firebaseUser.uid}
        adminName={currentAdmin.fullName}
        entries={entries}
        properties={properties}
        rooms={rooms}
        customColumns={customColumns}
        currencySymbol={summary.currencySymbol}
      />

      <PaymentModal
        isOpen={Boolean(paymentModalEntry)}
        onClose={() => setPaymentModalEntry(null)}
        onSaved={() => loadAdminWorkspace(firebaseUser.uid)}
        adminUid={firebaseUser.uid}
        adminName={currentAdmin.fullName}
        occupant={paymentModalEntry}
        currencySymbol={summary.currencySymbol}
      />

      <OccupantProfileDrawer
        occupantId={profileOccupantId}
        adminUid={firebaseUser.uid}
        adminName={currentAdmin.fullName}
        entries={entries}
        transactions={transactions}
        onClose={() => setProfileOccupantId(null)}
        onRecordPayment={(entry) => setPaymentModalEntry(entry)}
        onEditOccupant={(entry) => {
          setEditingEntry(entry);
          setOccupantModalOpen(true);
        }}
        onUpdated={() => loadAdminWorkspace(firebaseUser.uid)}
        customColumns={customColumns}
        currencySymbol={summary.currencySymbol}
      />

      <OfflineIndicator />
    </div>
  );
}
