import { DecimalInput } from '../../../shared/ui/DecimalInput';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LockKeyhole, Pencil, Plus, Trash2 } from 'lucide-react';
import { useSession } from '../../../app/providers/SessionProvider';
import { useDatabase } from '../../data/hooks/useDatabase';
import { bomLocked } from '../../../shared/domain/rules';
import type { Bom } from '../../../shared/domain/types';
import { number } from '../../../shared/domain/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeader,
  ReadOnly,
} from '../../../shared/ui/primitives';
import { DataTable } from '../../../shared/ui/DataTable';
import { CommandModal } from '../../../shared/ui/CommandModal';
import { can } from '../../../shared/domain/permissions';

export function BomsPage() {
  const { user } = useSession();
  const { data, isPending, error, refetch } = useDatabase();
  const [editing, setEditing] = useState<Bom | null>(null);
  const [deleting, setDeleting] = useState<Bom | null>(null);
  const [toggling, setToggling] = useState<Bom | null>(null);
  const wildcard = useParams()['*'];
  const navigate = useNavigate();
  const path = user.role === 'admin' ? '/admin/boms' : '/app/boms';
  if (isPending) return <Loading />;
  if (!data || error)
    return (
      <ErrorState message={error?.message || 'Không tải được BOM.'} retry={() => void refetch()} />
    );
  const selected = data.boms.find((b) => b.id === wildcard);
  const productName = (id: string) => data.products.find((p) => p.id === id)?.name || id;
  const available = data.products;
  const locked = (bom: Bom) => bom.used ?? bomLocked(data, bom.productId);
  const recipeKey = (lines: { materialId: string; quantity: number }[]) =>
    [...lines].map((line) => `${line.materialId}:${line.quantity}`).sort().join('|');
  const versionDuplicate = editing
    ? data.boms.some(
        (b) =>
          b.productId === editing.productId &&
          (b.version || '1.0') === (editing.version || '').trim() &&
          b.id !== editing.id,
      )
    : false;
  return (
    <>
      <PageHeader
        eyebrow="KHO & DANH MỤC"
        title="BOM / Định mức"
        description="Định lượng nguyên liệu cho một đơn vị thành phẩm."
        action={
          can(user, 'boms', 'create') ? (
            <Button
              onClick={() =>
                setEditing({
                  id: '',
                  productId: available[0]?.id || '',
                  lines: [{ materialId: data.materials[0]?.id || '', quantity: 0 }],
                  createdAt: '',
                  version: `${data.boms.filter((b) => b.productId === available[0]?.id).length + 1}.0`,
                  active: true,
                })
              }
            >
              <Plus size={16} />
              Tạo định mức mới
            </Button>
          ) : (
            <ReadOnly />
          )
        }
      />
      <Card>
        <DataTable
          rows={data.boms}
          searchValue={(b) => `${b.id} ${productName(b.productId)} ${b.version || '1.0'}`}
          onRowClick={(b) => navigate(`${path}/${b.id}`)}
          statuses={[
            { value: 'active', label: 'Đang hoạt động' },
            { value: 'inactive', label: 'Ngừng hoạt động' },
          ]}
          statusValue={(b) => (b.active === false ? 'inactive' : 'active')}
          columns={[
            {
              key: 'id',
              label: 'Mã BOM',
              render: (b) => <span className="code">{b.id}</span>,
              sortValue: (b) => b.id,
            },
            {
              key: 'product',
              label: 'Thành phẩm',
              render: (b) => <strong>{productName(b.productId)}</strong>,
              sortValue: (b) => productName(b.productId),
            },
            {
              key: 'version',
              label: 'Phiên bản',
              render: (b) => (
                <strong>
                  {b.version || '1.0'}
                  {b.active === false ? ' · Ngừng hoạt động' : ' · Đang hoạt động'}
                </strong>
              ),
              sortValue: (b) => b.version || '1.0',
            },
            {
              key: 'lines',
              label: 'Nguyên liệu',
              render: (b) => `${b.lines.length} nguyên liệu`,
              sortValue: (b) => b.lines.length,
            },
            {
              key: 'status',
              label: 'Trạng thái sử dụng',
              render: (b) =>
                locked(b) ? (
                  <span className="locked-label">
                    <LockKeyhole size={13} />
                    Đang được sử dụng
                  </span>
                ) : (
                  <span className="muted">Có thể chỉnh sửa</span>
                ),
            },
          ]}
        />
      </Card>
      {wildcard && !selected && <EmptyState title="Không tìm thấy BOM" />}
      {selected && !editing && !deleting && (
        <Modal
          title={`${selected.id} · ${productName(selected.productId)}`}
          onClose={() => navigate(path)}
          wide
        >
          {locked(selected) && (
            <Notice>
              Phiên bản đã được lệnh sử dụng: không sửa định mức hoặc xóa. Có thể ngừng hoạt động và
              tạo phiên bản mới; lệnh cũ giữ nguyên định mức.
            </Notice>
          )}
          <p className="form-note">
            Định mức cho 1 {data.products.find((p) => p.id === selected.productId)?.unit} thành
            phẩm.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nguyên liệu</th>
                  <th className="numeric">Định mức</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.map((line) => {
                  const item = data.materials.find((m) => m.id === line.materialId);
                  return (
                    <tr key={line.materialId}>
                      <td>
                        <strong>{item?.name}</strong>
                      </td>
                      <td className="numeric">
                        {number(line.quantity)} {item?.unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="modal-footer">
            {can(user, 'boms', 'update') && (
              <Button variant="secondary" onClick={() => setToggling(selected)}>
                {selected.active === false ? 'Kích hoạt phiên bản' : 'Ngừng hoạt động'}
              </Button>
            )}
            {can(user, 'boms', 'create') && (
              <Button
                variant="secondary"
                onClick={() =>
                  setEditing({
                    ...selected,
                    id: '',
                    version: '',
                    used: false,
                    active: true,
                    createdAt: '',
                  })
                }
              >
                Tạo phiên bản mới
              </Button>
            )}
            {!locked(selected) && (can(user, 'boms', 'update') || can(user, 'boms', 'delete')) ? (
              <>
                {can(user, 'boms', 'delete') && (
                  <Button variant="ghost" onClick={() => setDeleting(selected)}>
                    <Trash2 size={15} />
                    Xóa
                  </Button>
                )}
                {can(user, 'boms', 'update') && (
                  <Button
                    onClick={() =>
                      setEditing({
                        ...selected,
                        version: selected.version || '1.0',
                        active: selected.active !== false,
                      })
                    }
                  >
                    <Pencil size={15} />
                    Chỉnh sửa
                  </Button>
                )}
              </>
            ) : (
              <ReadOnly />
            )}
          </div>
        </Modal>
      )}
      {editing && !editing.id && !available.length && (
        <Modal title="Tạo định mức mới" onClose={() => setEditing(null)}>
          <EmptyState
            title="Chưa có thành phẩm để tạo BOM"
            description="Thêm thành phẩm, sau đó quay lại để tạo phiên bản định mức."
            action={
              <Link className="button button-primary" to="/app/products">
                Đi đến danh mục thành phẩm
              </Link>
            }
          />
        </Modal>
      )}
      {editing && (editing.id || available.length > 0) && (
        <CommandModal
          title={editing.id ? 'Chỉnh sửa định mức' : 'Tạo định mức mới'}
          wide
          label="Lưu BOM"
          submitDisabled={versionDuplicate}
          command={() => {
            const duplicate = data.boms.some(
              (b) =>
                b.productId === editing.productId &&
                b.id !== editing.id &&
                recipeKey(b.lines) === recipeKey(editing.lines),
            );
            if (duplicate)
              throw new Error('không được tạo 1 phiên bản mới trùng với phiên bản đã có');
            return { type: 'save-bom', payload: editing };
          }}
          onClose={() => setEditing(null)}
        >
          <Field label="Thành phẩm" required>
            <select
              aria-label="Thành phẩm BOM"
              required
              disabled={!!editing.id}
              value={editing.productId}
              onChange={(e) => setEditing({ ...editing, productId: e.target.value })}
            >
              <option value="">Chọn thành phẩm</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phiên bản BOM" required>
            <input
              aria-label="Phiên bản BOM"
              required
              maxLength={20}
              value={editing.version || ''}
              onChange={(e) => setEditing({ ...editing, version: e.target.value })}
            />
          </Field>
          {versionDuplicate && (
            <Notice tone="error">không được nhập trùng tên phiên bản trước đó</Notice>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={editing.active !== false}
              onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
            />{' '}
            Đang hoạt động (phiên bản đang hoạt động trước đó sẽ được ngừng)
          </label>
          <p className="form-note">
            Nhập lượng NVL để làm ra 1 đơn vị thành phẩm. Không chọn trùng nguyên liệu.
          </p>
          <div className="bom-lines">
            {editing.lines.map((line, index) => (
              <div className="bom-line" key={index}>
                <select
                  aria-label={`Nguyên liệu dòng ${index + 1}`}
                  required
                  value={line.materialId}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      lines: editing.lines.map((l, i) =>
                        i === index ? { ...l, materialId: e.target.value } : l,
                      ),
                    })
                  }
                >
                  <option value="">Chọn nguyên liệu</option>
                  {data.materials.map((m) => (
                    <option
                      key={m.id}
                      value={m.id}
                      disabled={editing.lines.some((l, i) => i !== index && l.materialId === m.id)}
                    >
                      {m.name} ({m.unit})
                    </option>
                  ))}
                </select>
                <DecimalInput
                  aria-label={`Định mức dòng ${index + 1}`}
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  value={line.quantity}
                  onValueChange={(quantity) =>
                    setEditing({
                      ...editing,
                      lines: editing.lines.map((l, i) => (i === index ? { ...l, quantity } : l)),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Xóa dòng ${index + 1}`}
                  className="icon-button"
                  onClick={() =>
                    setEditing({ ...editing, lines: editing.lines.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setEditing({ ...editing, lines: [...editing.lines, { materialId: '', quantity: 0 }] })
            }
          >
            <Plus size={15} />
            Thêm nguyên liệu
          </Button>
        </CommandModal>
      )}
      {deleting && (
        <CommandModal
          title="Xóa BOM"
          label="Xóa BOM"
          danger
          onClose={() => setDeleting(null)}
          onSuccess={() => navigate(path)}
          command={{ type: 'delete-catalog', payload: { kind: 'boms', id: deleting.id } }}
        >
          <p>
            Bạn muốn xóa định mức của <strong>{productName(deleting.productId)}</strong>?
          </p>
        </CommandModal>
      )}
      {toggling && (
        <CommandModal
          title={
            toggling.active === false ? 'Kích hoạt phiên bản BOM' : 'Ngừng hoạt động phiên bản BOM'
          }
          label="Xác nhận"
          onClose={() => setToggling(null)}
          command={{
            type: 'set-bom-active',
            payload: { id: toggling.id, active: toggling.active === false },
          }}
        >
          <p>
            Lệnh cũ tiếp tục sử dụng phiên bản đã chọn. Mỗi thành phẩm chỉ có một phiên bản đang
            hoạt động.
          </p>
        </CommandModal>
      )}
    </>
  );
}
