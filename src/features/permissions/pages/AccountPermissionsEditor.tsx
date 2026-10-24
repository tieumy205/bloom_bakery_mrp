import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '../../../shared/api/client';
import { useSession } from '../../../app/providers/SessionProvider';
import { can, roleLabels } from '../../../shared/domain/permissions';
import { moduleLabels } from '../../../layouts/OperationsLayout';
import type { Module, Role } from '../../../shared/domain/types';
import {
  Card,
  PageHeader,
  Button,
  Notice,
  Loading,
  ErrorState,
} from '../../../shared/ui/primitives';
interface Matrix {
  permissions: { id: string; module: string; action: string; description: string }[];
  users: {
    id: string;
    name: string;
    role: Role;
    active: boolean;
    flags: Record<string, boolean>;
    ceiling: Record<string, boolean>;
  }[];
}
const actions: Record<string, string> = {
  read: 'Xem',
  create: 'Tạo',
  update: 'Sửa',
  delete: 'Xóa',
  approve: 'Duyệt',
  reject: 'Từ chối',
  start: 'Bắt đầu',
  progress: 'Tiến độ',
  complete: 'Hoàn tất',
  cancel: 'Hủy',
};
export function AccountPermissionsEditor() {
  const { user, refresh } = useSession();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['permission-matrix'],
    queryFn: () => http<Matrix>('/permissions'),
  });
  const [selected, setSelected] = useState<string[]>([]),
    [flags, setFlags] = useState<Record<string, boolean>>({}),
    [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      http<void>('/permissions', {
        method: 'POST',
        body: JSON.stringify({ userIds: selected, flags }),
      }),
    onSuccess: async () => {
      setSaved(true);
      await refresh();
      await client.invalidateQueries();
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error || !query.data)
    return (
      <ErrorState
        message={query.error?.message || 'Không tải được quyền.'}
        retry={() => void query.refetch()}
      />
    );
  const data = query.data;
  const targets = data.users.filter((u) => selected.includes(u.id));
  const valid = (id: string) => targets.length > 0 && targets.every((u) => u.ceiling[id]);
  const choose = (id: string, checked: boolean) => {
    const ids = checked ? [...selected, id] : selected.filter((v) => v !== id);
    setSelected(ids);
    const users = data.users.filter((u) => ids.includes(u.id));
    setFlags(
      Object.fromEntries(
        data.permissions.map((p) => [
          p.id,
          users.length > 0 && users.every((u) => u.ceiling[p.id] && u.flags[p.id]),
        ]),
      ),
    );
    setSaved(false);
  };
  return (
    <>
      <PageHeader
        eyebrow="QUẢN TRỊ HỆ THỐNG"
        title="Vai trò & phân quyền"
        action={
          can(user, 'permissions', 'update') ? (
            <Button
              disabled={!selected.length || save.isPending}
              onClick={() => {
                setSaved(false);
                save.mutate();
              }}
            >
              {save.isPending ? 'Đang lưu…' : 'Lưu quyền'}
            </Button>
          ) : undefined
        }
      />
      <Card title="Tài khoản áp dụng">
        <div className="card-body">
          {data.users.map((u) => (
            <label className="checkbox-label" key={u.id}>
              <input
                type="checkbox"
                checked={selected.includes(u.id)}
                onChange={(e) => choose(u.id, e.target.checked)}
              />{' '}
              {u.name} · {roleLabels[u.role]}
              {!u.active ? ' · Ngừng hoạt động' : ''}
            </label>
          ))}
        </div>
      </Card>
      <Notice tone="info">
        Quyền được tick mới được thực hiện. Bỏ tick sẽ thu hồi quyền. Quyền ngoài phạm vi vai trò
        được khóa.
      </Notice>
      {save.error && <Notice tone="error">{save.error.message}</Notice>}
      {saved && <Notice tone="info">Đã cập nhật quyền.</Notice>}
      <div className="permission-module-grid">
        {[...new Set(data.permissions.map((p) => p.module))].map((module) => {
          const permissions = data.permissions.filter((p) => p.module === module);
          const available = permissions.filter((p) => valid(p.id));
          const all = available.length > 0 && available.every((p) => flags[p.id] === true);
          const writable = can(user, 'permissions', 'update') && available.length > 0;
          const toggleAll = (checked: boolean) => {
            setFlags((old) => ({
              ...old,
              ...Object.fromEntries(available.map((p) => [p.id, checked])),
            }));
            setSaved(false);
          };
          return (
            <Card
              key={module}
              title={moduleLabels[module as Module] || module}
              action={
                <div className="permission-heading-actions">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      aria-label={'Chọn tất cả ' + (moduleLabels[module as Module] || module)}
                      disabled={!writable}
                      checked={all}
                      ref={(node) => {
                        if (node) node.indeterminate = !all && available.some((p) => flags[p.id]);
                      }}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                    Chọn tất cả
                  </label>
                  <Button variant="ghost" disabled={!writable} onClick={() => toggleAll(false)}>
                    Bỏ chọn tất cả
                  </Button>
                </div>
              }
            >
              <div className="card-body">
                <div className="permission-actions">
                  {permissions.map((p) => (
                    <label className="checkbox-label" key={p.id}>
                      <input
                        type="checkbox"
                        aria-label={
                          (moduleLabels[module as Module] || module) +
                          ': ' +
                          (actions[p.action] || p.action)
                        }
                        disabled={!valid(p.id) || !can(user, 'permissions', 'update')}
                        checked={valid(p.id) && flags[p.id] === true}
                        onChange={(e) => {
                          setFlags({ ...flags, [p.id]: e.target.checked });
                          setSaved(false);
                        }}
                      />
                      {actions[p.action] || p.action}
                    </label>
                  ))}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
