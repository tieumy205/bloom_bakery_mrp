import { cloneElement, isValidElement, useEffect, useRef, useId } from 'react';
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { TimelineEntry } from '../domain/types';
import { dateTime } from '../domain/format';

export function Button({
  variant = 'primary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button className={`button button-${variant}`} {...props}>
      {children}
    </button>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{action}</div>
    </header>
  );
}
export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
const statuses: Record<string, [string, string]> = {
  draft: ['Nháp', 'gray'],
  approved: ['Đã duyệt', 'blue'],
  rejected: ['Từ chối', 'red'],
  fulfilled: ['Đã hoàn tất', 'green'],
  in_progress: ['Đang sản xuất', 'blue'],
  cancelled: ['Đã hủy', 'red'],
};
export function StatusBadge({ status, kind }: { status: string; kind: string }) {
  const [label, tone] =
    status === 'pending'
      ? [
          kind === 'orders' ? 'Chờ xử lý' : kind === 'receipts' ? 'Chờ hoàn tất' : 'Chờ duyệt',
          'amber',
        ]
      : status === 'completed'
        ? [kind === 'orders' ? 'Hoàn thành' : 'Đã nhập kho', 'green']
        : statuses[status] || [status, 'gray'];
  return <Badge tone={tone}>{label}</Badge>;
}
export function Notice({
  children,
  tone = 'warning',
}: {
  children: ReactNode;
  tone?: 'warning' | 'info' | 'error' | 'success';
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <AlertCircle size={18} />
      <div>{children}</div>
    </div>
  );
}
export function EmptyState({
  title = 'Chưa có dữ liệu',
  description = 'Dữ liệu sẽ xuất hiện tại đây khi được tạo.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={25} />
      <span>Đang tải dữ liệu…</span>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state">
      <Notice tone="error">{message}</Notice>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}
export function ReadOnly() {
  return (
    <span className="readonly">
      <LockKeyhole size={13} /> Chỉ xem
    </span>
  );
}
export function BackLink({
  to,
  children = 'Quay lại danh sách',
}: {
  to: string;
  children?: ReactNode;
}) {
  return (
    <Link className="back-link" to={to}>
      <ArrowLeft size={15} />
      {children}
    </Link>
  );
}
export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  const id = useId();
  const directControl =
    isValidElement<{ id?: string; 'aria-describedby'?: string }>(children) &&
    ['input', 'select', 'textarea'].includes(String(children.type));
  const control = directControl
    ? cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })
    : children;
  return (
    <div className="field">
      <label htmlFor={directControl ? id : undefined}>
        {label}
        {required && <span className="required"> *</span>}
      </label>
      <div className="field-control">{control}</div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button aria-label="Đóng" className="icon-button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="timeline">
      {[...entries].reverse().map((entry, index) => (
        <li key={`${entry.at}-${index}`}>
          <span className="timeline-node">
            <Check size={11} />
          </span>
          <div>
            <strong>{entry.title}</strong>
            <p>
              {entry.actor} · {dateTime(entry.at)}
            </p>
            {entry.note && <div className="timeline-note">{entry.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ChevronRight size={14} />
    </Link>
  );
}
