import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { EmptyState } from './primitives';
import { businessDay, normalize } from '../domain/format';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  numeric?: boolean;
}
interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  searchValue: (row: T) => string;
  onRowClick?: (row: T) => void;
  statusValue?: (row: T) => string;
  statuses?: { value: string; label: string }[];
  dateValue?: (row: T) => string;
  extraFilters?: ReactNode;
  placeholder?: string;
}
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  searchValue,
  onRowClick,
  statusValue,
  statuses,
  dateValue,
  extraFilters,
  placeholder = 'Tìm theo mã, tên…',
}: Props<T>) {
  const [params, setParams] = useSearchParams();
  const urlQ = params.get('q') || '';
  const [search, setSearch] = useState(urlQ);
  const searchTimer = useRef<number | undefined>(undefined);
  const status = params.get('status') || '';
  const from = dateValue ? params.get('from') || '' : '';
  const to = dateValue ? params.get('to') || '' : '';
  const sort = params.get('sort') || '';
  const direction = params.get('direction') || 'asc';
  const pageSize = [8, 16, 32].includes(Number(params.get('size')))
    ? Number(params.get('size'))
    : 8;
  useEffect(() => {
    setSearch(urlQ);
  }, [urlQ]);
  useEffect(
    () => () => window.clearTimeout(searchTimer.current),
    [],
  );
  function set(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        value ? next.set(key, value) : next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
  function commitSearch(value: string) {
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => set('q', value), 300);
  }
  const filtered = rows.filter(
    (row) =>
      (!search || normalize(searchValue(row)).includes(normalize(search))) &&
      (!status || !statusValue || statusValue(row) === status) &&
      (!from || !dateValue || businessDay(dateValue(row)) >= from) &&
      (!to || !dateValue || businessDay(dateValue(row)) <= to),
  );
  const sorting = columns.find((col) => col.key === sort)?.sortValue;
  if (sorting)
    filtered.sort((a, b) => {
      const av = sorting(a),
        bv = sorting(b);
      return (
        (typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'vi')) * (direction === 'asc' ? 1 : -1)
      );
    });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <div className="data-table">
      <div className="filter-bar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Tìm kiếm"
            placeholder={placeholder}
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              setSearch(value);
              commitSearch(value);
            }}
          />
        </div>
        {statuses && (
          <div className="select-wrap">
            <SlidersHorizontal size={15} />
            <select
              aria-label="Lọc trạng thái"
              value={status}
              onChange={(e) => set('status', e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              {statuses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {dateValue && (
          <div className="date-range">
            <input
              aria-label="Từ ngày"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => set('from', e.target.value)}
            />
            <span>—</span>
            <input
              aria-label="Đến ngày"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => set('to', e.target.value)}
            />
          </div>
        )}
        {extraFilters}
        {(search || status || from || to) && (
          <button
            className="clear-filter"
            onClick={() => {
              window.clearTimeout(searchTimer.current);
              const next = new URLSearchParams(params);
              ['q', 'status', 'from', 'to', 'page'].forEach((key) => next.delete(key));
              setParams(next);
              setSearch('');
            }}
          >
            <X size={14} /> Xóa lọc
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.numeric ? 'numeric' : ''}>
                  {col.sortValue ? (
                    <button
                      className="sort-button"
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        next.set('sort', col.key);
                        next.set(
                          'direction',
                          sort === col.key && direction === 'asc' ? 'desc' : 'asc',
                        );
                        setParams(next, { replace: true });
                      }}
                    >
                      {col.label}
                      {sort === col.key ? (
                        direction === 'asc' ? (
                          <ArrowUp size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        )
                      ) : (
                        <ArrowUpDown size={12} />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                className={onRowClick ? 'clickable-row' : ''}
                onClick={() => onRowClick?.(row)}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick ? `Xem chi tiết ${row.id}` : undefined}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter') onRowClick?.(row);
                }}
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.numeric ? 'numeric' : ''}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <EmptyState
          title={
            search || status || from || to ? 'Không tìm thấy kết quả' : 'Chưa có dữ liệu'
          }
          description="Thử thay đổi bộ lọc hoặc quay lại sau khi có dữ liệu mới."
        />
      )}
      <div className="pagination">
        <span>
          {filtered.length
            ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)}`
            : '0'}{' '}
          trên {filtered.length} kết quả
        </span>
        <div>
          <select
            aria-label="Số dòng mỗi trang"
            value={pageSize}
            onChange={(e) => set('size', e.target.value)}
          >
            {[8, 16, 32].map((size) => (
              <option key={size} value={size}>
                {size} dòng
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label="Trang trước"
            disabled={page <= 1}
            onClick={() => set('page', String(page - 1))}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            className="icon-button"
            aria-label="Trang sau"
            disabled={page >= pages}
            onClick={() => set('page', String(page + 1))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
