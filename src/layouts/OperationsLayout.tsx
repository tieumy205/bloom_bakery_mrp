import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  Boxes,
  ChartNoAxesCombined,
  ChefHat,
  LogOut,
  ClipboardList,
  FileInput,
  FileOutput,
  LayoutDashboard,
  Menu,
  Package,
  PanelLeftClose,
  Settings2,
  ShieldCheck,
  Sprout,
  Users,
  Wheat,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Module } from '../shared/domain/types';
import { can, roleLabels } from '../shared/domain/permissions';
import { useSession, apiMode } from '../app/providers/SessionProvider';
import { useDatabase } from '../features/data/hooks/useDatabase';
import { today, date } from '../shared/domain/format';

export const moduleLabels: Record<Module, string> = {
  dashboard: 'Tổng quan',
  materials: 'Nguyên vật liệu',
  products: 'Thành phẩm',
  boms: 'BOM / Định mức',
  orders: 'Lệnh sản xuất',
  requests: 'Bổ sung NVL',
  receipts: 'Nhập nguyên liệu',
  'material-issues': 'Xuất nguyên liệu',
  'product-issues': 'Xuất thành phẩm',
  reports: 'Thống kê báo cáo',
  notifications: 'Thông báo',
  users: 'Tài khoản',
  permissions: 'Phân quyền',
};
const navigation: { title: string; entries: [Module, LucideIcon][] }[] = [
  { title: '', entries: [['dashboard', LayoutDashboard]] },
  {
    title: 'KHO & DANH MỤC',
    entries: [
      ['materials', Wheat],
      ['products', Package],
      ['boms', Boxes],
    ],
  },
  { title: 'SẢN XUẤT', entries: [['orders', ChefHat]] },
  {
    title: 'CHỨNG TỪ',
    entries: [
      ['requests', ClipboardList],
      ['receipts', FileInput],
      ['material-issues', FileOutput],
      ['product-issues', Package],
    ],
  },
  {
    title: 'BÁO CÁO',
    entries: [
      ['reports', ChartNoAxesCombined],
      ['notifications', Bell],
    ],
  },
];
export function OperationsLayout({ admin = false }: { admin?: boolean }) {
  const { user, logout } = useSession();
  const { data } = useDatabase();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const prefix = admin ? '/admin' : '/app';
  const current = location.pathname.split('/')[2] as Module;
  const unread =
    data?.notifications.filter(
      (n) => (n.userId === user.id || n.role === user.role) && !n.readBy.includes(user.id),
    ).length || 0;
  const groups = admin
    ? [
        {
          title: 'QUẢN TRỊ',
          entries: [
            ['users', Users],
            ['permissions', Settings2],
          ] as [Module, LucideIcon][],
        },
        ...navigation
          .filter((group) => group.title !== '')
          .map((group) => ({
            ...group,
            title: group.title === 'BÁO CÁO' ? 'THỐNG KÊ' : group.title,
          })),
      ]
    : navigation;
  return (
    <div className={`app-shell ${admin ? 'admin-theme' : ''}`}>
      {open && (
        <button aria-label="Đóng menu" className="sidebar-overlay" onClick={() => setOpen(false)} />
      )}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <NavLink
          to={admin ? '/admin/users' : user.role === 'employee' ? '/app/orders' : '/app/dashboard'}
          className="brand"
        >
          <span className="brand-symbol">
            <Sprout size={25} />
          </span>
          <div>
            <strong>
              bloom<span>.</span>
            </strong>
            <small>{admin ? 'ADMIN CONSOLE' : 'BAKERY WORKSPACE'}</small>
          </div>
        </NavLink>
        <button
          className="sidebar-close icon-button"
          aria-label="Đóng menu"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <div className="workspace-label">
          {admin ? <ShieldCheck size={15} /> : <ChefHat size={15} />}
          <span>{admin ? 'Quản trị hệ thống' : 'Không gian vận hành'}</span>
        </div>
        <nav>
          {groups.map((group, index) => {
            const entries = group.entries.filter(([module]) => can(user, module));
            return entries.length ? (
              <div className="nav-group" key={index}>
                {group.title && (
                  <div className="nav-group-label">
                    {user.role === 'employee' && group.title === 'CHỨNG TỪ'
                      ? 'PHIẾU CỦA TÔI'
                      : group.title}
                  </div>
                )}
                {entries.map(([module, Icon]) => {
                  const pending =
                    user.role === 'manager' &&
                    ['requests', 'material-issues', 'product-issues'].includes(module)
                      ? data?.documents.filter(
                          (doc) => doc.kind === module && doc.status === 'pending',
                        ).length
                      : 0;
                  return (
                    <NavLink
                      key={module}
                      to={`${prefix}/${module}`}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    >
                      <Icon size={18} />
                      <span>
                        {module === 'orders' && user.role === 'employee'
                          ? 'Lệnh được giao'
                          : moduleLabels[module]}
                      </span>
                      {!!pending && <span className="nav-count">{pending}</span>}
                    </NavLink>
                  );
                })}
              </div>
            ) : null;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="bakery-mark">
            <Wheat size={27} />
            <div>
              <strong>Mỗi mẻ bánh, một niềm vui.</strong>
              <small>Bloom Bakery MRP</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setOpen(true)}
              aria-label="Mở menu"
            >
              <Menu size={20} />
            </button>
            <PanelLeftClose className="desktop-menu" size={18} />
            <span className="topbar-divider" />
            <span>{admin ? 'Quản trị' : 'Không gian làm việc'}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{moduleLabels[current] || 'Chi tiết'}</strong>
          </div>
          <div className="topbar-right">
            <span className="topbar-date">{date(today())}</span>
            {!admin && can(user, 'notifications') && (
              <NavLink
                to="/app/notifications"
                className="notification-button"
                aria-label={`Thông báo, ${unread} chưa đọc`}
              >
                <Bell size={19} />
                {!!unread && <span>{unread}</span>}
              </NavLink>
            )}
            <div className="user-pill">
              <span className="avatar">
                {user.name
                  .split(' ')
                  .map((part) => part[0])
                  .slice(-2)
                  .join('')}
              </span>
              <div>
                <strong>{user.name}</strong>
                <small>{roleLabels[user.role]}</small>
              </div>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                if (apiMode)
                  void logout().catch(() => window.alert('Không thể đăng xuất. Vui lòng thử lại.'));
                else window.location.assign('/demo');
              }}
            >
              <LogOut size={16} />
              Đăng xuất
            </button>
          </div>
        </header>
        <main className="main-content">
          <Outlet />
        </main>
        <footer className="app-footer">Bloom Bakery MRP</footer>
      </div>
    </div>
  );
}
