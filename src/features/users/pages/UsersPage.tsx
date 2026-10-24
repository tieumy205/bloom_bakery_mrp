import { useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useDatabase } from '../../data/hooks/useDatabase';
import { useSession } from '../../../app/providers/SessionProvider';
import type { User } from '../../../shared/domain/types';
import { roleLabels, can } from '../../../shared/domain/permissions';
import { date } from '../../../shared/domain/format';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Loading,
  PageHeader,
} from '../../../shared/ui/primitives';
import { DataTable } from '../../../shared/ui/DataTable';
import { CommandModal } from '../../../shared/ui/CommandModal';

export function UsersPage() {
  const { data, isPending, error, refetch } = useDatabase();
  const { user } = useSession();
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  if (isPending) return <Loading />;
  if (!data || error)
    return (
      <ErrorState
        message={error?.message || 'Không tải được tài khoản.'}
        retry={() => void refetch()}
      />
    );
  return (
    <>
      <PageHeader
        eyebrow="QUẢN TRỊ HỆ THỐNG"
        title="Quản lý tài khoản"
        description="Quản lý thành viên và vai trò trong Bloom Bakery."
        action={
          can(user, 'users', 'create') ? (
            <Button
              onClick={() =>
                setEditing({
                  id: '',
                  name: '',
                  email: '',
                  role: 'employee',
                  active: true,
                  createdAt: '',
                })
              }
            >
              <Plus size={16} />
              Tạo tài khoản
            </Button>
          ) : undefined
        }
      />
      <div className="stat-grid stat-grid-three">
        <div className="mini-stat">
          <span className="stat-icon">
            <Users size={20} />
          </span>
          <div>
            <small>Tổng tài khoản</small>
            <strong>{data.users.length}</strong>
          </div>
        </div>
        <div className="mini-stat">
          <span className="stat-icon green">
            <Users size={20} />
          </span>
          <div>
            <small>Đang hoạt động</small>
            <strong>{data.users.filter((u) => u.active).length}</strong>
          </div>
        </div>
        <div className="mini-stat">
          <span className="stat-icon amber">
            <Users size={20} />
          </span>
          <div>
            <small>Vai trò hệ thống</small>
            <strong>3</strong>
          </div>
        </div>
      </div>
      <Card>
        <DataTable
          rows={data.users}
          searchValue={(u) => `${u.name} ${u.email}`}
          statuses={[
            { value: 'active', label: 'Đang hoạt động' },
            { value: 'inactive', label: 'Ngừng hoạt động' },
          ]}
          statusValue={(u) => (u.active ? 'active' : 'inactive')}
          dateValue={(u) => u.createdAt}
          onRowClick={can(user, 'users', 'update') ? setEditing : undefined}
          columns={[
            {
              key: 'name',
              label: 'Thành viên',
              sortValue: (u) => u.name,
              render: (u) => (
                <div className="person-cell">
                  <span className="avatar">{u.name[0]}</span>
                  <div>
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                  </div>
                </div>
              ),
            },
            {
              key: 'role',
              label: 'Vai trò',
              sortValue: (u) => u.role,
              render: (u) => (
                <Badge tone={u.role === 'admin' ? 'blue' : u.role === 'manager' ? 'green' : 'gray'}>
                  {roleLabels[u.role]}
                </Badge>
              ),
            },
            {
              key: 'status',
              label: 'Trạng thái',
              render: (u) => (
                <Badge tone={u.active ? 'green' : 'gray'}>
                  {u.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                </Badge>
              ),
            },
            {
              key: 'createdAt',
              label: 'Ngày tạo',
              sortValue: (u) => u.createdAt,
              render: (u) => date(u.createdAt),
            },
            {
              key: 'actions',
              label: '',
              render: (u) => (
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  {can(user, 'users', 'update') && (
                    <button
                      className="icon-button"
                      aria-label={`Sửa ${u.name}`}
                      onClick={() => setEditing(u)}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {u.id !== user.id && can(user, 'users', 'delete') && (
                    <button
                      className="icon-button danger-text"
                      aria-label={`Xóa ${u.name}`}
                      onClick={() => setDeleting(u)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
      {editing && (
        <CommandModal
          title={editing.id ? 'Chỉnh sửa tài khoản' : 'Tạo tài khoản'}
          label="Lưu tài khoản"
          onClose={() => setEditing(null)}
          command={{ type: 'save-user', payload: editing }}
        >
          <Field label="Họ tên" required>
            <input
              aria-label="Họ tên"
              required
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </Field>
          <Field label="Email" required>
            <input
              aria-label="Email"
              type="email"
              required
              value={editing.email}
              onChange={(e) => setEditing({ ...editing, email: e.target.value })}
            />
          </Field>
          <Field label="Vai trò" required>
            <select
              aria-label="Vai trò"
              value={editing.role}
              onChange={(e) => setEditing({ ...editing, role: e.target.value as User['role'] })}
            >
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={editing.active}
              onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
            />{' '}
            Tài khoản đang hoạt động
          </label>
          <Field
            label={editing.id ? 'Mật khẩu mới (để trống để giữ nguyên)' : 'Mật khẩu'}
            required={!editing.id}
          >
            <input
              type="password"
              autoComplete="new-password"
              minLength={5}
              maxLength={128}
              required={!editing.id}
              value={editing.password || ''}
              onChange={(e) => setEditing({ ...editing, password: e.target.value })}
            />
          </Field>
        </CommandModal>
      )}
      {deleting && (
        <CommandModal
          title="Xóa tài khoản"
          danger
          label="Xóa tài khoản"
          onClose={() => setDeleting(null)}
          command={{ type: 'delete-user', payload: deleting.id }}
        >
          <p>
            Bạn muốn xóa tài khoản <strong>{deleting.name}</strong>? Tài khoản đã có dữ liệu liên
            quan chỉ có thể ngừng hoạt động.
          </p>
        </CommandModal>
      )}
    </>
  );
}
