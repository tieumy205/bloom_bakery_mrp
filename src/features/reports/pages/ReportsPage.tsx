import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, CalendarDays, ChartNoAxesCombined, Package, Wheat } from 'lucide-react';
import { useDatabase } from '../../data/hooks/useDatabase';
import { useSession } from '../../../app/providers/SessionProvider';
import { date, number, today } from '../../../shared/domain/format';
import {
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  ReadOnly,
} from '../../../shared/ui/primitives';
import { aggregateReport } from '../model';
import type { Grouping, ReportMode, ReportPoint } from '../model';
import { DataTable } from '../../../shared/ui/DataTable';
import { useQuery } from '@tanstack/react-query';
import { apiMode } from '../../../app/providers/SessionProvider';
import { http } from '../../../shared/api/client';
import { validDay } from '../model';

const modeLabels: Record<ReportMode, string> = {
  'in-out': 'Nhập / Xuất kho',
  'material-use': 'NVL sử dụng',
  'product-out': 'Thành phẩm xuất',
  stock: 'Tồn nguyên liệu',
};
export function ReportsPage() {
  const { user } = useSession();
  const { data, isPending, error, refetch } = useDatabase();
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(params);
  useEffect(() => {
    latestParams.current = params;
  }, [params]);
  const requestedMode = params.get('report') || 'in-out';
  const mode: ReportMode = requestedMode in modeLabels ? (requestedMode as ReportMode) : 'in-out';
  const itemType = params.get('warehouse') === 'product' ? 'product' : 'material';
  const type = mode === 'product-out' ? 'product' : mode === 'in-out' ? itemType : 'material';
  const allItems = type === 'material' ? data?.materials : data?.products;
  const selected = allItems?.find((item) => item.id === params.get('item')) || allItems?.[0];
  const from = params.get('start') || `${today().slice(0, 7)}-01`,
    to = params.get('end') || today();
  const requestedGroup = params.get('group') || 'day';
  const group: Grouping =
    ['day', 'month', 'quarter', 'year'].includes(requestedGroup) &&
    !(mode === 'stock' && requestedGroup === 'quarter')
      ? (requestedGroup as Grouping)
      : 'day';
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(latestParams.current);
    next.set(key, value);
    if (key === 'warehouse') next.delete('item');
    ['q', 'page', 'from', 'to', 'sort', 'direction'].forEach((k) => next.delete(k));
    latestParams.current = next;
    setParams(next, { replace: true });
  };
  const reportReady =
    !!selected &&
    validDay(from) &&
    validDay(to) &&
    from <= to &&
    (Date.parse(to) - Date.parse(from)) / 86400000 <= 3659;
  const remote = useQuery({
    queryKey: ['report', user.id, selected?.id, from, to, group, mode, type],
    enabled: apiMode && reportReady,
    queryFn: () =>
      http<{ points: ReportPoint[] }>(
        `/reports?${new URLSearchParams({ item: selected!.id, from, to, group, mode, warehouse: type })}`,
      ),
  });
  if (isPending || (apiMode && reportReady && remote.isPending)) return <Loading />;
  if (!data || error || (apiMode && remote.error))
    return (
      <ErrorState
        message={remote.error?.message || error?.message || 'Không tải được báo cáo.'}
        retry={() => {
          void refetch();
          void remote.refetch();
        }}
      />
    );
  const points = apiMode
    ? remote.data?.points || []
    : selected
      ? aggregateReport(data, selected.id, from, to, group)
      : [];
  const minimum = selected && 'minStock' in selected ? selected.minStock : undefined;
  const totalIn = points.reduce((sum, p) => sum + p.incoming, 0),
    totalOut = points.reduce((sum, p) => sum + p.outgoing, 0);
  const dateSpan = (Date.parse(to) - Date.parse(from)) / 86400000;
  return (
    <>
      <PageHeader
        eyebrow="THỐNG KÊ"
        title="Báo cáo kho & sản xuất"
        description="Nhìn rõ dòng nguyên liệu và thành phẩm qua từng thời điểm."
        action={
          user.role === 'admin' ? (
            <ReadOnly />
          ) : (
            <span className="date-chip">
              <ChartNoAxesCombined size={16} />
              Dữ liệu theo chứng từ
            </span>
          )
        }
      />
      <div className="document-tabs report-tabs">
        {(Object.keys(modeLabels) as ReportMode[]).map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => set('report', m)}>
            {m === 'stock' ? (
              <Wheat size={15} />
            ) : m === 'product-out' ? (
              <Package size={15} />
            ) : (
              <BarChart3 size={15} />
            )}
            {modeLabels[m]}
          </button>
        ))}
      </div>
      <Card>
        <div className="report-filters">
          {mode === 'in-out' && (
            <label>
              Loại kho
              <select
                aria-label="Loại kho"
                value={type}
                onChange={(e) => {
                  set('warehouse', e.target.value);
                }}
              >
                <option value="material">Nguyên liệu</option>
                <option value="product">Thành phẩm</option>
              </select>
            </label>
          )}
          <label>
            {type === 'material' ? 'Nguyên liệu' : 'Thành phẩm'}
            <select
              aria-label="Mặt hàng báo cáo"
              value={selected?.id || ''}
              onChange={(e) => set('item', e.target.value)}
            >
              {allItems?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Từ ngày
            <input
              aria-label="Báo cáo từ ngày"
              type="date"
              value={from}
              max={to}
              onChange={(e) => set('start', e.target.value)}
            />
          </label>
          <label>
            Đến ngày
            <input
              aria-label="Báo cáo đến ngày"
              type="date"
              value={to}
              min={from}
              max={today()}
              onChange={(e) => set('end', e.target.value)}
            />
          </label>
          <label>
            Nhóm theo
            <select
              aria-label="Nhóm thời gian"
              value={group}
              onChange={(e) => set('group', e.target.value)}
            >
              <option value="day">Ngày</option>
              <option value="month">Tháng</option>
              {mode !== 'stock' && <option value="quarter">Quý</option>}
              <option value="year">Năm</option>
            </select>
          </label>
        </div>
      </Card>
      {from > to || dateSpan > 3659 ? (
        <Notice tone="error">Chọn khoảng ngày hợp lệ, tối đa 10 năm.</Notice>
      ) : (
        <>
          <div className="report-metrics">
            {mode !== 'stock' && mode === 'in-out' && (
              <div>
                <small>Tổng nhập trong kỳ</small>
                <strong>
                  {number(totalIn)} <span>{selected?.unit}</span>
                </strong>
                <i className="green-bg" />
              </div>
            )}
            {mode !== 'stock' && (
              <div>
                <small>
                  {mode === 'material-use' ? 'Đã xuất cho sản xuất' : 'Tổng xuất trong kỳ'}
                </small>
                <strong>
                  {number(totalOut)} <span>{selected?.unit}</span>
                </strong>
                <i className="amber-bg" />
              </div>
            )}
            <div>
              <small>{mode === 'stock' ? 'Tồn cuối kỳ được chọn' : 'Tồn cuối kỳ'}</small>
              <strong>
                {number(points.at(-1)?.stock || 0)} <span>{selected?.unit}</span>
              </strong>
              <i className="blue-bg" />
            </div>
            {mode === 'stock' && (
              <div>
                <small>Tồn tối thiểu hiện tại</small>
                <strong>
                  {number(minimum || 0)} <span>{selected?.unit}</span>
                </strong>
                <i className="amber-bg" />
              </div>
            )}
          </div>
          <Card
            title={`${modeLabels[mode]} · ${selected?.name || 'Chưa có mặt hàng'}`}
            action={<span className="chart-unit">Đơn vị: {selected?.unit}</span>}
          >
            <div className="report-chart-wrap">
              {points.length && selected ? (
                <ReportChart points={points} mode={mode} minimum={minimum} unit={selected.unit} />
              ) : (
                <EmptyState title="Chưa có dữ liệu báo cáo" />
              )}
              <div className="chart-caption">
                <CalendarDays size={13} />
                {date(from)} — {date(to)}
                <span>
                  {mode === 'stock'
                    ? 'Tồn tại cuối mỗi mốc thời gian. Đường tối thiểu dùng mức cấu hình hiện tại.'
                    : mode === 'material-use'
                      ? 'NVL sử dụng được tính theo phiếu xuất NVL đã duyệt.'
                      : 'Chỉ ghi nhận nghiệp vụ đã duyệt hoặc đã hoàn tất.'}
                </span>
              </div>
            </div>
          </Card>
          <Card
            title="Bảng số liệu chi tiết"
            action={
              <span className="muted">
                {selected?.name} · {selected?.unit}
              </span>
            }
          >
            <DataTable
              key={`${mode}-${selected?.id}`}
              rows={points.map((p) => ({ ...p, id: p.key }))}
              searchValue={(p) => p.label}
              placeholder="Tìm mốc thời gian…"
              columns={[
                {
                  key: 'time',
                  label: 'Thời gian',
                  render: (p) => <strong>{group === 'day' ? date(p.key) : p.label}</strong>,
                  sortValue: (p) => p.key,
                },
                ...(mode === 'in-out'
                  ? [
                      {
                        key: 'in',
                        label: 'Nhập',
                        numeric: true,
                        render: (p: ReportPoint) => number(p.incoming),
                        sortValue: (p: ReportPoint) => p.incoming,
                      },
                    ]
                  : []),
                ...(mode !== 'stock'
                  ? [
                      {
                        key: 'out',
                        label: mode === 'material-use' ? 'Sử dụng' : 'Xuất',
                        numeric: true,
                        render: (p: ReportPoint) => number(p.outgoing),
                        sortValue: (p: ReportPoint) => p.outgoing,
                      },
                    ]
                  : []),
                {
                  key: 'stock',
                  label: 'Tồn cuối mốc',
                  numeric: true,
                  render: (p) => number(p.stock),
                  sortValue: (p) => p.stock,
                },
                { key: 'unit', label: 'Đơn vị', render: () => selected?.unit },
              ]}
            />
          </Card>
        </>
      )}
    </>
  );
}

function ReportChart({
  points,
  mode,
  minimum,
  unit,
}: {
  points: ReportPoint[];
  mode: ReportMode;
  minimum?: number;
  unit: string;
}) {
  const width = 960,
    height = 270,
    left = 50,
    right = 20,
    top = 18,
    bottom = 36;
  const max =
    Math.max(
      1,
      ...points.map((p) =>
        mode === 'stock' ? p.stock : Math.max(mode === 'in-out' ? p.incoming : 0, p.outgoing),
      ),
      mode === 'stock' ? minimum || 0 : 0,
    ) * 1.15;
  const min = Math.min(0, ...points.map((p) => (mode === 'stock' ? p.stock : 0)));
  const chartHeight = height - top - bottom,
    chartWidth = width - left - right;
  const y = (value: number) => top + ((max - value) / (max - min)) * chartHeight;
  const spacing = chartWidth / Math.max(1, points.length);
  const x = (index: number) => left + spacing * (index + 0.5);
  const series = points
    .map((p, i) => `${x(i)},${y(mode === 'stock' ? p.stock : p.outgoing)}`)
    .join(' ');
  const skip = Math.max(1, Math.ceil(points.length / 12));
  return (
    <>
      <div className="chart-legend">
        {mode === 'in-out' && (
          <span>
            <i className="green-bg" />
            Nhập
          </span>
        )}
        <span>
          <i className={mode === 'stock' ? 'green-bg' : 'amber-bg'} />
          {mode === 'stock' ? 'Tồn NVL' : mode === 'material-use' ? 'NVL sử dụng' : 'Xuất'}
        </span>
        {mode === 'stock' && (
          <span>
            <i className="legend-dashed" />
            Tồn tối thiểu
          </span>
        )}
      </div>
      <div className="chart-scroll">
        <svg
          className="report-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Biểu đồ ${modeLabels[mode]}. Đơn vị ${unit}. Số liệu chi tiết ở bảng bên dưới.`}
        >
          {Array.from({ length: 5 }, (_, i) => {
            const value = min + ((max - min) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="#edf0e9"
                  strokeDasharray="3 5"
                />
                <text x={left - 12} y={y(value) + 4} textAnchor="end" fontSize="10" fill="#9da895">
                  {number(value)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => (
            <g key={p.key}>
              {mode === 'in-out' ? (
                <>
                  <rect
                    x={x(i) - Math.min(12, spacing * 0.28)}
                    y={y(p.incoming)}
                    width={Math.min(10, spacing * 0.25)}
                    height={y(0) - y(p.incoming)}
                    rx="3"
                    fill="#84a58a"
                  >
                    <title>
                      {p.label}: nhập {number(p.incoming)} {unit}
                    </title>
                  </rect>
                  <rect
                    x={x(i) + 2}
                    y={y(p.outgoing)}
                    width={Math.min(10, spacing * 0.25)}
                    height={y(0) - y(p.outgoing)}
                    rx="3"
                    fill="#d4b98a"
                  >
                    <title>
                      {p.label}: xuất {number(p.outgoing)} {unit}
                    </title>
                  </rect>
                </>
              ) : (
                mode !== 'stock' && (
                  <rect
                    x={x(i) - Math.min(17, spacing * 0.3)}
                    y={y(p.outgoing)}
                    width={Math.min(34, spacing * 0.6)}
                    height={y(0) - y(p.outgoing)}
                    rx="4"
                    fill="#bfa276"
                  >
                    <title>
                      {p.label}: {number(p.outgoing)} {unit}
                    </title>
                  </rect>
                )
              )}
              {i % skip === 0 && (
                <text x={x(i)} y={height - 10} textAnchor="middle" fill="#9aa68f" fontSize="9">
                  {p.label}
                </text>
              )}
            </g>
          ))}
          {mode === 'stock' && (
            <>
              <polygon
                points={`${x(0)},${y(0)} ${series} ${x(points.length - 1)},${y(0)}`}
                fill="#eaf2e5"
                opacity=".6"
              />
              <polyline
                points={series}
                fill="none"
                stroke="#7b9b6c"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {points.map((p, i) => (
                <circle
                  key={p.key}
                  cx={x(i)}
                  cy={y(p.stock)}
                  r={points.length > 70 ? 1 : 3}
                  fill="#7b9b6c"
                >
                  <title>
                    {p.label}: tồn {number(p.stock)} {unit}
                  </title>
                </circle>
              ))}
              {minimum !== undefined && (
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(minimum)}
                  y2={y(minimum)}
                  stroke="#c5a56a"
                  strokeWidth="1.5"
                  strokeDasharray="5 5"
                />
              )}
            </>
          )}
        </svg>
      </div>
    </>
  );
}
