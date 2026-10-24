import { DecimalInput } from '../../../shared/ui/DecimalInput';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUpRight, ImagePlus, Package, Pencil, Plus, Trash2, Wheat } from 'lucide-react';
import { useDatabase } from '../../data/hooks/useDatabase';
import { useSession } from '../../../app/providers/SessionProvider';
import type { Material, Product } from '../../../shared/domain/types';
import { can } from '../../../shared/domain/permissions';
import { date, number } from '../../../shared/domain/format';
import {
  Badge,
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

type Item = Material | Product;
export function CatalogPage({ kind }: { kind: 'materials' | 'products' }) {
  const { user } = useSession();
  const { data, isPending, error, refetch } = useDatabase();
  const [editing, setEditing] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [imageError, setImageError] = useState('');
  const navigate = useNavigate();
  const wildcard = useParams()['*'];
  const prefix = user.role === 'admin' ? '/admin' : '/app';
  const path = `${prefix}/${kind}`;
  const material = kind === 'materials';
  const title = material ? 'Nguyên vật liệu' : 'Thành phẩm';
  const writable = can(user, kind, 'create');
  if (isPending) return <Loading />;
  if (!data || error)
    return (
      <ErrorState
        message={error?.message || 'Không tải được danh mục.'}
        retry={() => void refetch()}
      />
    );
  const rows: Item[] = data[kind];
  const selected = wildcard ? rows.find((item) => item.id === wildcard) : undefined;
  const newItem = (): Item =>
    material
      ? { id: '', name: '', unit: 'kg', stock: 0, minStock: 0, createdAt: '' }
      : { id: '', name: '', unit: 'cái', stock: 0, image: '', createdAt: '' };
  const stockBadge = (row: Item) => (
    <Badge
      tone={
        row.stock === 0 ? 'red' : 'minStock' in row && row.stock < row.minStock ? 'amber' : 'green'
      }
    >
      {row.stock === 0
        ? 'Hết hàng'
        : 'minStock' in row && row.stock < row.minStock
          ? 'Dưới tối thiểu'
          : 'Đủ tồn'}
    </Badge>
  );
  return (
    <>
      <PageHeader
        eyebrow="KHO & DANH MỤC"
        title={title}
        description={
          material
            ? 'Theo dõi nguyên liệu để mỗi mẻ bánh luôn sẵn sàng.'
            : 'Quản lý thành phẩm và lượng bánh sẵn có trong kho.'
        }
        action={
          writable ? (
            <Button onClick={() => setEditing(newItem())}>
              <Plus size={16} />
              {material ? 'Thêm nguyên liệu' : 'Thêm thành phẩm'}
            </Button>
          ) : (
            <ReadOnly />
          )
        }
      />
      {material && data.materials.some((m) => m.stock < m.minStock) && (
        <Notice>
          <strong>
            {data.materials.filter((m) => m.stock < m.minStock).length} nguyên liệu dưới mức tối
            thiểu.
          </strong>{' '}
          Kiểm tra nhu cầu bổ sung để đảm bảo kế hoạch sản xuất.
        </Notice>
      )}
      <Card>
        <DataTable
          rows={rows}
          searchValue={(row) => `${row.id} ${row.name}`}
          onRowClick={(row) => navigate(`${path}/${row.id}`)}
          statusValue={(row) =>
            row.stock === 0
              ? 'empty'
              : 'minStock' in row && row.stock < row.minStock
                ? 'low'
                : 'healthy'
          }
          statuses={[
            { value: 'healthy', label: 'Đủ tồn' },
            ...(material ? [{ value: 'low', label: 'Dưới tối thiểu' }] : []),
            { value: 'empty', label: 'Hết hàng' },
          ]}
          columns={[
            {
              key: 'id',
              label: 'Mã',
              sortValue: (row) => row.id,
              render: (row) => <span className="code">{row.id}</span>,
            },
            {
              key: 'name',
              label: material ? 'Nguyên liệu' : 'Thành phẩm',
              sortValue: (row) => row.name,
              render: (row) => (
                <div className="item-cell">
                  <span className={`item-thumb ${material ? 'material-thumb' : 'product-thumb'}`}>
                    {'image' in row && row.image ? (
                      <img src={row.image} alt={row.name} />
                    ) : material ? (
                      <Wheat size={19} />
                    ) : (
                      <Package size={19} />
                    )}
                  </span>
                  <strong>{row.name}</strong>
                </div>
              ),
            },
            {
              key: 'stock',
              label: 'Tồn hiện tại',
              sortValue: (row) => row.stock,
              numeric: true,
              render: (row) => (
                <strong className={row.stock === 0 ? 'danger-text' : ''}>
                  {number(row.stock)} <span className="unit">{row.unit}</span>
                </strong>
              ),
            },
            ...(material
              ? [
                  {
                    key: 'minStock',
                    label: 'Tồn tối thiểu',
                    numeric: true,
                    render: (row: Item) =>
                      `${number('minStock' in row ? row.minStock : 0)} ${row.unit}`,
                  },
                ]
              : []),
            { key: 'status', label: 'Tình trạng', render: stockBadge },
            { key: 'more', label: '', render: () => <ArrowUpRight size={14} className="muted" /> },
          ]}
        />
      </Card>
      {wildcard && !selected && (
        <EmptyState
          title="Danh mục không tồn tại"
          action={
            <Button variant="secondary" onClick={() => navigate(path)}>
              Về danh sách
            </Button>
          }
        />
      )}
      {selected && !editing && !deleting && (
        <Modal title={`${selected.id} · ${selected.name}`} onClose={() => navigate(path)}>
          <div className="detail-kv">
            <span>Đơn vị tính</span>
            <strong>{selected.unit}</strong>
            <span>Tồn hiện tại</span>
            <strong>
              {number(selected.stock)} {selected.unit}
            </strong>
            {'minStock' in selected && (
              <>
                <span>Tồn tối thiểu</span>
                <strong>
                  {number(selected.minStock)} {selected.unit}
                </strong>
              </>
            )}
            <span>Tình trạng</span>
            {stockBadge(selected)}
            <span>Ngày tạo</span>
            <strong>{date(selected.createdAt)}</strong>
          </div>
          {'image' in selected && selected.image && (
            <img className="product-preview" src={selected.image} alt={selected.name} />
          )}
          <div className="modal-footer">
            {(can(user, kind, 'update') || can(user, kind, 'delete')) && (
              <>
                {can(user, kind, 'delete') && (
                  <Button variant="ghost" onClick={() => setDeleting(selected)}>
                    <Trash2 size={15} />
                    Xóa
                  </Button>
                )}
                {can(user, kind, 'update') && (
                  <Button onClick={() => setEditing(selected)}>
                    <Pencil size={15} />
                    Chỉnh sửa
                  </Button>
                )}
              </>
            )}
            {material && can(user, 'requests', 'create') && (
              <Button
                onClick={() =>
                  navigate(`/app/requests/new?source=min-stock&material=${selected.id}`)
                }
              >
                <Plus size={15} />
                Tạo phiếu bổ sung
              </Button>
            )}
            {!material && can(user, 'product-issues', 'create') && (
              <Button onClick={() => navigate(`/app/product-issues/new?product=${selected.id}`)}>
                <ArrowUpRight size={15} />
                Xuất thành phẩm từ kho
              </Button>
            )}
            {!writable && user.role !== 'employee' && <ReadOnly />}
          </div>
        </Modal>
      )}
      {editing && (
        <CommandModal
          title={`${editing.id ? 'Chỉnh sửa' : 'Thêm'} ${material ? 'nguyên liệu' : 'thành phẩm'}`}
          onClose={() => {
            setEditing(null);
            setImageError('');
          }}
          label="Lưu danh mục"
          command={
            material
              ? { type: 'save-material', payload: editing as Material }
              : { type: 'save-product', payload: editing as Product }
          }
        >
          <Field label="Tên" required>
            <input
              aria-label="Tên danh mục"
              required
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </Field>
          <div className="form-grid">
            <Field label="Đơn vị tính" required>
              <select
                aria-label="Đơn vị tính"
                required
                value={editing.unit}
                onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
              >
                <option value="">Chọn đơn vị tính</option>
                {(
                  data.units ||
                  [...new Set([...data.materials, ...data.products].map((i) => i.unit))].map(
                    (symbol) => ({ id: symbol, name: symbol, symbol }),
                  )
                ).map((unit) => (
                  <option key={unit.id} value={unit.symbol}>
                    {unit.name} ({unit.symbol})
                  </option>
                ))}
              </select>
            </Field>
            {'minStock' in editing && (
              <Field label="Tồn tối thiểu" required>
                <DecimalInput
                  aria-label="Tồn tối thiểu"
                  required
                  type="number"
                  step="any"
                  min="0"
                  value={editing.minStock}
                  onValueChange={(minStock) => setEditing({ ...editing, minStock })}
                />
              </Field>
            )}
          </div>
          {'image' in editing && (
            <>
              <Field label="Ảnh thành phẩm" hint="PNG, JPEG hoặc WebP, tối đa 1,5 MB.">
                <div className="image-upload">
                  {editing.image ? (
                    <img src={editing.image} alt="Ảnh đã chọn" />
                  ) : (
                    <ImagePlus size={25} />
                  )}
                  <input
                    aria-label="Chọn ảnh thành phẩm"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (
                        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
                        file.size > 1_500_000
                      ) {
                        setImageError('Chọn ảnh PNG, JPEG hoặc WebP dưới 1,5 MB.');
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        setEditing({ ...editing, image: String(reader.result) });
                        setImageError('');
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </div>
              </Field>
              {imageError && <Notice tone="error">{imageError}</Notice>}
            </>
          )}
        </CommandModal>
      )}
      {deleting && (
        <CommandModal
          title="Xóa danh mục"
          danger
          label="Xóa"
          onClose={() => setDeleting(null)}
          onSuccess={() => navigate(path)}
          command={{ type: 'delete-catalog', payload: { kind, id: deleting.id } }}
        >
          <p>
            Xóa <strong>{deleting.name}</strong>? Danh mục có tồn hoặc đã được sử dụng sẽ không thể
            xóa.
          </p>
        </CommandModal>
      )}
    </>
  );
}
