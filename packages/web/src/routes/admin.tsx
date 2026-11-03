import React, { lazy, Suspense } from 'react';
import { useAuthStore } from '@festie/shared';
import { useNavigate } from '@tanstack/react-router';
import AdminLayout from '../components/admin/AdminLayout';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import AdminCommandPalette, { openAdminPalette } from '../components/admin/AdminCommandPalette';
import { ADMIN_TABS, useAdminSearch, type AdminTab } from '../components/admin/useAdminSearch';
import { LayoutDashboard, Tent, Users, UsersRound, ClipboardList, TrendingUp, Search } from 'lucide-react';

const AdminDashboard = lazy(() => import('../components/admin/AdminDashboard'));
const AdminFestivals = lazy(() => import('../components/admin/AdminFestivals'));
const AdminUsers = lazy(() => import('../components/admin/AdminUsers'));
const AdminCrews = lazy(() => import('../components/admin/AdminCrews'));
const AdminAudit = lazy(() => import('../components/admin/AdminAudit'));
const AdminAnalytics = lazy(() => import('../components/admin/AdminAnalytics'));

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export default function AdminPanel() {
  return (
    <RenderErrorBoundary name="admin">
      <AdminPanelInner />
    </RenderErrorBoundary>
  );
}

function AdminPanelInner() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [{ tab }, setAdminSearch] = useAdminSearch();
  const activeTab: AdminTab = ADMIN_TABS.find((t) => t === tab) ?? ADMIN_TABS[0];

  if (!user?.isAdmin) {
    return (
      <div className="flex-center min-h-dvh flex-col gap-4">
        <div className="text-lg text-accent-coral">Access Denied</div>
        <button
          type="button"
          onClick={() => navigate({ to: '/cards' })}
          className="px-4 py-2 min-h-11 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity"
        >
          Go Back
        </button>
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    { id: 'festivals', label: 'Festivals', icon: <Tent /> },
    { id: 'users', label: 'Users', icon: <Users /> },
    { id: 'crews', label: 'Crews', icon: <UsersRound /> },
    { id: 'audit', label: 'Audit Log', icon: <ClipboardList /> },
    { id: 'analytics', label: 'Analytics', icon: <TrendingUp /> },
  ] as Array<{ id: AdminTab; label: string; icon: React.ReactNode }>;

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <AdminDashboard />;
      case 'festivals':
        return <AdminFestivals />;
      case 'users':
        return <AdminUsers />;
      case 'crews':
        return <AdminCrews />;
      case 'audit':
        return <AdminAudit />;
      case 'analytics':
        return <AdminAnalytics />;
      default:
        return null;
    }
  };

  return (
    <AdminLayout
      title="Admin Panel"
      description="Manage system, festivals, users, and view analytics"
      activeTab={activeTab}
      onTabChange={(next) => setAdminSearch({ tab: next as AdminTab })}
      tabs={tabs}
      headerAction={
        <button
          type="button"
          onClick={openAdminPalette}
          aria-label="Find a festival, user, crew or invite code"
          className="inline-flex items-center gap-2 min-h-11 px-3 rounded-md border border-glass-border text-sm text-text-secondary hover:text-text-primary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
        >
          <Search className="w-4 h-4" aria-hidden="true" />
          <span>Find</span>
          <kbd className="hidden md:inline text-xs text-text-muted">{IS_MAC ? '⌘ K' : 'Ctrl K'}</kbd>
        </button>
      }
    >
      <AdminCommandPalette />
      <Suspense fallback={<div className="flex-center p-8 text-text-muted">Loading…</div>}>{renderContent()}</Suspense>
    </AdminLayout>
  );
}
