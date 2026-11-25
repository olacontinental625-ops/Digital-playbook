import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  MailCheck,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase.ts';
import {
  claimSingleAdministrator,
  fetchUserProfile,
  upsertUserProfile,
  verifyUserIsAdmin,
} from '../lib/firestoreStore.ts';

export type PortalMode = 'user' | 'admin';

interface AuthPortalProps {
  portalMode: PortalMode;
  adminClaimed: boolean;
  externalError?: string;
  onClearExternalError?: () => void;
  onAuthBusyChange: (busy: boolean) => void;
  onSwitchPortal: (mode: PortalMode) => void;
  onAuthCompleted: () => Promise<void>;
}

function formatAuthError(err: unknown, context: 'signin' | 'signup' | 'reset' = 'signin'): string {
  const code = (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'auth/email-already-in-use') {
    return 'An account with this email address already exists. Switch to Sign In instead.';
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return context === 'signin'
      ? 'Your record was not found or your credentials are incorrect. New users must sign up first before signing in.'
      : 'Invalid email address or password. Please check your credentials.';
  }
  if (code === 'auth/weak-password') {
    return 'Password must be at least 6 characters long.';
  }
  if (code === 'auth/invalid-email') {
    return 'Please enter a valid email address.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in popup was closed before completing.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password sign-in is not yet enabled in Firebase Authentication Console. Use Google or enable Email/Password under Authentication -> Sign-in method.';
  }
  return msg || 'Authentication failed. Please try again.';
}

export const AuthPortal: React.FC<AuthPortalProps> = ({
  portalMode,
  adminClaimed,
  externalError = '',
  onClearExternalError,
  onAuthBusyChange,
  onSwitchPortal,
  onAuthCompleted,
}) => {
  // User portal tab: 'signup' | 'signin' | 'reset'
  const [userTab, setUserTab] = useState<'signup' | 'signin' | 'reset'>('signup');
  // Admin portal tab when claimed: 'signin' | 'reset'
  const [adminResetMode, setAdminResetMode] = useState(false);

  // User Sign Up fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  // Admin Claim fields
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');

  // Sign In fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  // Reset Password field
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const [error, setError] = useState(externalError);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (externalError) {
      setError(externalError);
    }
  }, [externalError]);

  const clearFeedback = () => {
    setError('');
    setResetSent(false);
    onClearExternalError?.();
  };

  // Normal User Email/Password Sign Up (creates user account & Firestore record)
  const handleUserSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (fullName.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!phone.trim()) {
      setError('Please enter your phone number.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    onAuthBusyChange(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: fullName.trim() });
      await upsertUserProfile(cred.user, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        authProvider: 'password',
      });
      sendEmailVerification(cred.user).catch(() => {});
      onAuthBusyChange(false);
      await onAuthCompleted();
    } catch (err) {
      onAuthBusyChange(false);
      setError(formatAuthError(err, 'signup'));
    } finally {
      setLoading(false);
    }
  };

  // Normal User Google Sign Up (only on Sign Up tab — registers user record in Firestore)
  const handleUserGoogleSignUp = async () => {
    clearFeedback();
    setLoading(true);
    onAuthBusyChange(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await upsertUserProfile(cred.user, {
        fullName: cred.user.displayName || 'Registered Member',
        phone: '',
        authProvider: 'google',
      });
      onAuthBusyChange(false);
      await onAuthCompleted();
    } catch (err) {
      onAuthBusyChange(false);
      setError(formatAuthError(err, 'signup'));
    } finally {
      setLoading(false);
    }
  };

  // Normal User Email/Password Sign In (must have an existing registered record)
  const handleUserSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setLoading(true);
    onAuthBusyChange(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      const [existingProfile, isAdminAcct] = await Promise.all([
        fetchUserProfile(cred.user.uid).catch(() => null),
        verifyUserIsAdmin(cred.user).catch(() => false),
      ]);

      if (!existingProfile && !isAdminAcct) {
        await signOut(auth).catch(() => {});
        onAuthBusyChange(false);
        setError('Your record was not found. New users must sign up first before signing in.');
        return;
      }

      onAuthBusyChange(false);
      await onAuthCompleted();
    } catch (err) {
      onAuthBusyChange(false);
      setError(formatAuthError(err, 'signin'));
    } finally {
      setLoading(false);
    }
  };

  // Normal User Google Sign In (rejects new users who have not signed up first)
  const handleUserGoogleSignIn = async () => {
    clearFeedback();
    setLoading(true);
    onAuthBusyChange(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const [existingProfile, isAdminAcct] = await Promise.all([
        fetchUserProfile(cred.user.uid).catch(() => null),
        verifyUserIsAdmin(cred.user).catch(() => false),
      ]);

      if (!existingProfile && !isAdminAcct) {
        const extra = getAdditionalUserInfo(cred);
        if (extra?.isNewUser) {
          await cred.user.delete().catch(() => {});
        }
        await signOut(auth).catch(() => {});
        onAuthBusyChange(false);
        setError('Your record was not found. New users must sign up first before signing in.');
        return;
      }

      onAuthBusyChange(false);
      await onAuthCompleted();
    } catch (err) {
      onAuthBusyChange(false);
      setError(formatAuthError(err, 'signin'));
    } finally {
      setLoading(false);
    }
  };

  // Single Admin First-Time Sign Up (Email/Password)
  const handleAdminClaimEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (adminClaimed) {
      setError('Administrator setup is already locked.');
      return;
    }
    if (adminName.trim().length < 2) {
      setError('Please enter administrator full name.');
      return;
    }
    if (adminPassword.length < 8) {
      setError('Administrator password must be at least 8 characters.');
      return;
    }
    if (adminPassword !== adminConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    onAuthBusyChange(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, adminEmail.trim(), adminPassword);
      await updateProfile(cred.user, { displayName: adminName.trim() });
      await claimSingleAdministrator(cred.user, adminName.trim());
      sendEmailVerification(cred.user).catch(() => {});
      onAuthBusyChange(false);
      await onAuthCompleted();
    } catch (err) {
      onAuthBusyChange(false);
      setError(formatAuthError(err, 'signup'));
    } finally {
      setLoading(false);
    }
  };

  // Single Admin First-Time Claim with Google
  const handleAdminClaimGoogle = async () => {
    clearFeedback();
    if (adminClaimed) {
      setError('Administrator setup is already locked.');
      return;
    }
    setLoading(true);
    onAuthBusyChange(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await claimSingleAdministrator(
        cred.user,
        adminName.trim() || cred.user.displayName || 'Administrator',
      );
      onAuthBusyChange(false);
      await onAuthCompleted();
    } catch (err) {
      onAuthBusyChange(false);
      setError(formatAuthError(err, 'signup'));
    } finally {
      setLoading(false);
    }
  };

  // Single Admin Sign In (Email/Password)
  const handleAdminSignInEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setLoading(true);
    onAuthBusyChange(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      onAuthBusyChange(false);
      await onAuthCompleted();
    } catch (err) {
      onAuthBusyChange(false);
      setError(formatAuthError(err, 'signin'));
    } finally {
      setLoading(false);
    }
  };

  // Single Admin Sign In with Google
  const handleAdminSignInGoogle = async () => {
    clearFeedback();
    setLoading(true);
    onAuthBusyChange(true);
    try {
      await signInWithPopup(auth, googleProvider);
      onAuthBusyChange(false);
      await onAuthCompleted();
    } catch (err) {
      onAuthBusyChange(false);
      setError(formatAuthError(err, 'signin'));
    } finally {
      setLoading(false);
    }
  };

  // Password Reset Email
  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setResetSent(true);
    } catch (err) {
      setError(formatAuthError(err, 'reset'));
    } finally {
      setLoading(false);
    }
  };

  const renderGoogleButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2.5 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 transition-colors"
    >
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
        />
      </svg>
      <span>{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md">
        {portalMode === 'admin' ? (
          /* ================================================================= */
          /* SEPARATE ADMIN PORTAL SECTION (?portal=admin)                     */
          /* ================================================================= */
          <div className="rounded-lg border border-slate-200 bg-white p-7 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  clearFeedback();
                  onSwitchPortal('user');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0B192C]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to User Portal
              </button>
              <span className="inline-flex items-center gap-1 rounded bg-[#0B192C] px-2 py-0.5 text-[11px] font-semibold text-[#D4AF37]">
                <ShieldCheck className="h-3 w-3" />
                Admin Section
              </span>
            </div>

            {adminResetMode ? (
              <>
                <h1 className="mt-5 font-display text-2xl font-bold text-[#0B192C]">
                  Reset Administrator Password
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Enter your authorized administrator email address to receive a password reset link.
                </p>

                {error && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {error}
                  </div>
                )}
                {resetSent && (
                  <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
                    <MailCheck className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Password reset instructions have been sent to {resetEmail}.</span>
                  </div>
                )}

                <form onSubmit={handlePasswordReset} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Administrator Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="admin@example.com"
                      className="mt-1.5 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-md bg-[#0B192C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#132642] disabled:opacity-60"
                  >
                    {loading ? 'Sending...' : 'Send Reset Email'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => {
                    clearFeedback();
                    setAdminResetMode(false);
                  }}
                  className="mt-4 w-full text-center text-xs font-medium text-slate-600 hover:text-[#0B192C]"
                >
                  Return to Administrator Sign In
                </button>
              </>
            ) : !adminClaimed ? (
              /* ADMIN ONE-TIME SIGN-UP (VISIBLE ONLY UNTIL ONE PERSON CLAIMS IT) */
              <>
                <div className="mt-5 flex items-center gap-2 text-[#B4832C]">
                  <Lock className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    One-Time Administrator Registration
                  </span>
                </div>
                <h1 className="mt-1.5 font-display text-2xl font-bold text-[#0B192C]">
                  Create Administrator Account
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Only <strong>one person</strong> can register as Administrator. Once created,
                  admin sign-up is permanently hidden from everyone else.
                </p>

                {error && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <form onSubmit={handleAdminClaimEmail} className="mt-5 space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Administrator Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      placeholder="e.g. Managing Director"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@example.com"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Password (min 8) *
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="••••••••"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Confirm Password *
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={adminConfirmPassword}
                        onChange={(e) => setAdminConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-md bg-[#0B192C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#132642] disabled:opacity-60 transition-colors"
                  >
                    {loading ? 'Claiming Admin Access...' : 'Claim Single Admin Account'}
                  </button>
                </form>

                <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>OR</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                {renderGoogleButton('Claim Single Admin with Google', handleAdminClaimGoogle)}
              </>
            ) : (
              /* ADMIN SIGN-IN ONLY (ONCE CLAIMED, ADMIN SIGN-UP IS PERMANENTLY HIDDEN) */
              <>
                <div className="mt-5 flex items-center justify-between">
                  <h1 className="font-display text-2xl font-bold text-[#0B192C]">
                    Administrator Sign In
                  </h1>
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-[#0B192C]">
                    <Lock className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-1.5 text-sm text-slate-600">
                  Admin registration is closed. Sign in with the single authorized administrator
                  credentials to manage occupant records.
                </p>

                {error && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <form onSubmit={handleAdminSignInEmail} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Administrator Email Address
                    </label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="admin@example.com"
                      className="mt-1.5 w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-700">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          clearFeedback();
                          setResetEmail(loginEmail);
                          setAdminResetMode(true);
                        }}
                        className="text-xs font-medium text-[#0B192C] hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative mt-1.5">
                      <input
                        type={showLoginPass ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPass((v) => !v)}
                        aria-label={showLoginPass ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-700"
                      >
                        {showLoginPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-md bg-[#0B192C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#132642] disabled:opacity-60 transition-colors"
                  >
                    {loading ? 'Verifying...' : 'Sign In to Admin Dashboard'}
                  </button>
                </form>

                <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>OR</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                {renderGoogleButton('Sign In with Google', handleAdminSignInGoogle)}
              </>
            )}
          </div>
        ) : (
          /* ================================================================= */
          /* NORMAL USER SIGN UP / SIGN IN PORTAL (NO IMAGE, NO BRAND NAME)    */
          /* ================================================================= */
          <div className="rounded-lg border border-slate-200 bg-white p-7 shadow-sm">
            <div className="text-center">
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#0B192C]">
                Digital Logbook Portal
              </h1>
            </div>

            {/* Segmented Toggle: Sign Up vs Sign In */}
            {userTab !== 'reset' && (
              <div className="mt-6 grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    clearFeedback();
                    setUserTab('signup');
                  }}
                  className={`rounded py-2 text-xs font-semibold transition-colors ${
                    userTab === 'signup'
                      ? 'bg-[#0B192C] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign Up (New User)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearFeedback();
                    setUserTab('signin');
                  }}
                  className={`rounded py-2 text-xs font-semibold transition-colors ${
                    userTab === 'signin'
                      ? 'bg-[#0B192C] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In (Existing User)
                </button>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            {userTab === 'signup' ? (
              <>
                <div className="mt-5">
                  <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <UserPlus className="h-5 w-5 text-[#B4832C]" />
                    Create Your Account
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    Register first to access database records and unpaid balances.
                  </p>
                </div>

                <form onSubmit={handleUserSignUp} className="mt-4 space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Adewale Johnson"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Phone Number *
                      </label>
                      <input
                        type="tel"
                        required
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+234 800 000 0000"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Password *
                    </label>
                    <div className="relative mt-1">
                      <input
                        type={showPass ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Minimum 6 characters"
                        className="w-full rounded-md border border-slate-300 px-3.5 py-2 pr-10 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((v) => !v)}
                        aria-label={showPass ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-700"
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Confirm Password *
                    </label>
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-md bg-[#0B192C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#132642] disabled:opacity-60 transition-colors"
                  >
                    {loading ? 'Creating Account...' : 'Sign Up'}
                  </button>
                </form>

                <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>OR SIGN UP WITH</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                {renderGoogleButton('Sign Up with Google', handleUserGoogleSignUp)}
              </>
            ) : userTab === 'signin' ? (
              <>
                <div className="mt-5">
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Sign In
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    Only registered users can sign in. New users must sign up first.
                  </p>
                </div>

                <form onSubmit={handleUserSignIn} className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-700">
                        Password *
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          clearFeedback();
                          setResetEmail(loginEmail);
                          setUserTab('reset');
                        }}
                        className="text-xs font-medium text-[#0B192C] hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative mt-1">
                      <input
                        type={showLoginPass ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPass((v) => !v)}
                        aria-label={showLoginPass ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-700"
                      >
                        {showLoginPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-md bg-[#0B192C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#132642] disabled:opacity-60 transition-colors"
                  >
                    {loading ? 'Checking Record...' : 'Sign In'}
                  </button>
                </form>

                <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>OR</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                {renderGoogleButton('Sign In with Google', handleUserGoogleSignIn)}
              </>
            ) : (
              <>
                <div className="mt-5">
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Reset Your Password
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    Enter your registered email address to receive a password reset link.
                  </p>
                </div>

                {resetSent && (
                  <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
                    <MailCheck className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Reset link sent to {resetEmail}. Check your inbox.</span>
                  </div>
                )}

                <form onSubmit={handlePasswordReset} className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B192C] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-md bg-[#0B192C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#132642] disabled:opacity-60"
                  >
                    {loading ? 'Sending...' : 'Send Reset Email'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => {
                    clearFeedback();
                    setUserTab('signin');
                  }}
                  className="mt-4 w-full text-center text-xs font-medium text-slate-600 hover:text-[#0B192C]"
                >
                  Back to Sign In
                </button>
              </>
            )}

            {/* Separate Admin Portal Section / Tab Launcher */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-xs">
              <button
                type="button"
                onClick={() => {
                  clearFeedback();
                  onSwitchPortal('admin');
                }}
                className="inline-flex items-center gap-1.5 font-semibold text-[#0B192C] hover:underline"
              >
                <Building2 className="h-3.5 w-3.5 text-[#B4832C]" />
                <span>{adminClaimed ? 'Admin Sign In Portal' : 'Admin Portal Setup'}</span>
              </button>
              <a
                href="/?portal=admin"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-slate-500 hover:text-[#0B192C]"
              >
                <span>Open in new tab</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
