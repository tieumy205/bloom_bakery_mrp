import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ArrowRight, ShieldCheck, Sprout } from 'lucide-react';
import { useSession,apiMode } from '../providers/SessionProvider';
import { LoginPage } from '../../features/auth/LoginPage';
import { can, homePath, roleLabels } from '../../shared/domain/permissions';
import type { Module } from '../../shared/domain/types';
import { OperationsLayout, moduleLabels } from '../../layouts/OperationsLayout';
import { AdminLayout } from '../../layouts/AdminLayout';
import { Button, Card, EmptyState, ErrorState, Loading, Notice } from '../../shared/ui/primitives';
import { useDatabase } from '../../features/data/hooks/useDatabase';
import { UsersPage } from '../../features/users/pages/UsersPage';
import { PermissionsPage } from '../../features/permissions/pages/PermissionsPage';
import { CatalogPage } from '../../features/catalog/pages/CatalogPage';
import { BomsPage } from '../../features/boms/pages/BomsPage';
import { OrdersPage } from '../../features/production-orders/pages/OrdersPage';
import { DocumentsPage } from '../../features/documents/pages/DocumentsPage';
import { DashboardPage } from '../../features/dashboard/pages/DashboardPage';
import { ReportsPage } from '../../features/reports/pages/ReportsPage';
import { NotificationsPage } from '../../features/notifications/pages/NotificationsPage';

function LayoutGuard({ admin }: { admin: boolean }) {
  const { user } = useSession();
  return (user.role === 'admin') === admin ? (
    <Outlet />
  ) : (
    <Navigate to={homePath(user.role)} replace />
  );
}
function ModuleGuard({ module }: { module: Module }) {
  const { user } = useSession();
  return can(user, module) ? (
    <Outlet />
  ) : (
    <EmptyState
      title="Bạn không có quyền truy cập"
      description="Vui lòng sử dụng các chức năng được cấp cho vai trò của bạn."
      action={<a href={homePath(user.role)}>Về trang chính</a>}
    />
  );
}
function SessionGate() {
  const { user, selectUser } = useSession();
  const { data, isPending, error, refetch } = useDatabase();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(user.id);
  if (isPending) return <Loading />;
  if (error || !data)
    return (
      <ErrorState
        message={error?.message || 'Không thể tải tài khoản.'}
        retry={() => void refetch()}
      />
    );
  return (
    <div className="session-page">
      <div className="session-brand">
        <Sprout size={32} /> bloom.
      </div>
      <Card>
        <div className="session-intro">
          <ShieldCheck size={30} />
          <h1>Chào mừng đến Bloom</h1>
          <p>Chọn tài khoản demo để khám phá không gian làm việc.</p>
        </div>
        <Notice tone="info">
          Dữ liệu giả lập, lưu trên trình duyệt này. Đây chưa phải hệ thống đăng nhập thật.
        </Notice>
        <div className="account-options">
          {data.users
            .filter((item) => item.active)
            .map((account) => (
              <label
                key={account.id}
                className={`account-option ${selected === account.id ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="account"
                  value={account.id}
                  checked={selected === account.id}
                  onChange={() => setSelected(account.id)}
                />
                <span className="avatar">{account.name[0]}</span>
                <div>
                  <strong>{account.name}</strong>
                  <small>{roleLabels[account.role]}</small>
                </div>
              </label>
            ))}
        </div>
        <Button
          onClick={() => {
            const account = data.users.find((item) => item.id === selected);
            if (account) {
              selectUser(account);
              navigate(homePath(account.role));
            }
          }}
        >
          Vào không gian làm việc <ArrowRight size={16} />
        </Button>
      </Card>
    </div>
  );
}
function ModulePage({ module }: { module: Module }) {
  if (module === 'users') return <UsersPage />;
  if (module === 'permissions') return <PermissionsPage />;
  if (module === 'materials' || module === 'products')
    return <CatalogPage key={module} kind={module} />;
  if (module === 'boms') return <BomsPage />;
  if (module === 'orders') return <OrdersPage />;
  if (module === 'dashboard') return <DashboardPage />;
  if (module === 'reports') return <ReportsPage />;
  if (module === 'notifications') return <NotificationsPage />;
  if (
    module === 'requests' ||
    module === 'receipts' ||
    module === 'material-issues' ||
    module === 'product-issues'
  )
    return <DocumentsPage key={module} kind={module} />;
  return <EmptyState title="Không tìm thấy trang" />;
}
export function AppRouter() {
  const { user,loading,authenticated } = useSession();
  const modules = Object.keys(moduleLabels) as Module[];
  if(loading)return <Loading/>;
  if(apiMode&&!authenticated)return <LoginPage/>;
  return (
    <Routes>
      <Route path="/" element={<Navigate to={homePath(user.role)} replace />} />
      <Route path="/demo" element={apiMode?<Navigate to={homePath(user.role)} replace/>:<SessionGate />} />
      {[true, false].map((admin) => (
        <Route key={String(admin)} element={<LayoutGuard admin={admin} />}>
          <Route
            path={admin ? '/admin' : '/app'}
            element={admin ? <AdminLayout /> : <OperationsLayout />}
          >
            <Route index element={<Navigate to={homePath(user.role)} replace />} />
            {modules.map((module) => (
              <Route key={module} element={<ModuleGuard module={module} />}>
                <Route path={`${module}/*`} element={<ModulePage module={module} />} />
              </Route>
            ))}
          </Route>
        </Route>
      ))}
      <Route
        path="*"
        element={
          <EmptyState
            title="Không tìm thấy trang"
            description="Đường dẫn này không tồn tại."
            action={<a href={homePath(user.role)}>Về trang chính</a>}
          />
        }
      />
    </Routes>
  );
}
