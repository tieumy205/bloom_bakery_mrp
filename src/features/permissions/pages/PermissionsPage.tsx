import { Check, Minus, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { can, roleLabels } from '../../../shared/domain/permissions';
import type { Action, Module, Role } from '../../../shared/domain/types';
import { moduleLabels } from '../../../layouts/OperationsLayout';
import { Card, Notice, PageHeader } from '../../../shared/ui/primitives';
import { apiMode } from '../../../app/providers/SessionProvider';
import { AccountPermissionsEditor } from './AccountPermissionsEditor';

const actionLabels: Record<Action, string> = {
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
const modules: Module[] = [
  'materials',
  'products',
  'boms',
  'orders',
  'requests',
  'receipts',
  'material-issues',
  'product-issues',
  'reports',
  'users',
  'permissions',
];
export function PermissionsPage() {
  if (apiMode) return <AccountPermissionsEditor />;
  return (
    <>
      <PageHeader
        eyebrow="QUẢN TRỊ HỆ THỐNG"
        title="Vai trò & phân quyền"
        description="Quyền được chuẩn hóa theo 3 vai trò của hệ thống."
        action={
          <Link className="button button-primary" to="/admin/users">
            <ShieldCheck size={16} />
            Gán vai trò cho tài khoản
          </Link>
        }
      />
      <Notice tone="info">
        Gán vai trò tại màn Tài khoản. Ma trận dưới đây mô tả quyền cố định theo Module.txt; mọi
        thao tác còn chịu điều kiện trạng thái chứng từ.
      </Notice>
      <Card>
        <div className="table-scroll">
          <table className="permission-table">
            <thead>
              <tr>
                <th>Module / Hành động</th>
                {(['admin', 'manager', 'employee'] as Role[]).map((role) => (
                  <th key={role}>{roleLabels[role]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => (
                <tr key={module}>
                  <td>
                    <strong>{moduleLabels[module]}</strong>
                  </td>
                  {(['admin', 'manager', 'employee'] as Role[]).map((role) => {
                    const allowed = (Object.keys(actionLabels) as Action[]).filter((action) =>
                      can(role, module, action),
                    );
                    return (
                      <td key={role}>
                        {allowed.length ? (
                          <div className="permission-chips">
                            {allowed.map((action) => (
                              <span key={action}>
                                <Check size={12} />
                                {actionLabels[action]}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">
                            <Minus size={14} /> Không truy cập
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="fine-print">
        Employee chỉ thao tác lệnh được giao và phiếu của mình. Nhập kho chỉ sửa/xóa khi nháp. Chứng
        từ đã xử lý không sửa/xóa. Admin chỉ xem dữ liệu nghiệp vụ.
      </div>
    </>
  );
}
