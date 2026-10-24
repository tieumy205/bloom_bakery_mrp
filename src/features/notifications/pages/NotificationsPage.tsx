import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bell, CheckCheck } from 'lucide-react';
import { useSession } from '../../../app/providers/SessionProvider';
import { useCommand, useDatabase } from '../../data/hooks/useDatabase';
import { dateTime } from '../../../shared/domain/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
} from '../../../shared/ui/primitives';

export function NotificationsPage() {
  const { user } = useSession();
  const { data, isPending, error, refetch } = useDatabase();
  const mutation = useCommand();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [actionError, setActionError] = useState('');
  if (isPending) return <Loading />;
  if (!data || error)
    return (
      <ErrorState
        message={error?.message || 'Không tải được thông báo.'}
        retry={() => void refetch()}
      />
    );
  const mine = data.notifications.filter((n) => n.userId === user.id || n.role === user.role);
  const unread = mine.filter((n) => !n.readBy.includes(user.id));
  return (
    <>
      <PageHeader
        eyebrow="KHÔNG GIAN LÀM VIỆC"
        title="Thông báo"
        description="Cập nhật kịp thời các phiếu và lệnh sản xuất liên quan đến bạn."
        action={
          <Button
            variant="secondary"
            disabled={!unread.length || mutation.isPending}
            onClick={async () => {
              try {
                await mutation.mutateAsync({ type: 'read-notification', payload: 'all' });
              } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Có lỗi xảy ra.');
              }
            }}
          >
            <CheckCheck size={15} />
            Đánh dấu tất cả đã đọc
          </Button>
        }
      />
      {actionError && <Notice tone="error">{actionError}</Notice>}
      <Card>
        <div className="notification-toolbar">
          <div className="segmented">
            <button className={!unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(false)}>
              Tất cả
            </button>
            <button className={unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(true)}>
              Chưa đọc ({unread.length})
            </button>
          </div>
        </div>
        <div className="notifications-list">
          {(unreadOnly ? unread : mine).map((n) => (
            <button
              key={n.id}
              className={!n.readBy.includes(user.id) ? 'unread' : ''}
              onClick={async () => {
                try {
                  await mutation.mutateAsync({ type: 'read-notification', payload: n.id });
                  navigate(n.href);
                } catch (e) {
                  setActionError(e instanceof Error ? e.message : 'Có lỗi xảy ra.');
                }
              }}
            >
              <span className="notification-list-icon">
                <Bell size={19} />
              </span>
              <div>
                <strong>{n.title}</strong>
                <p>{n.body}</p>
                <small>{dateTime(n.createdAt)}</small>
              </div>
              {!n.readBy.includes(user.id) && <Badge tone="green">Mới</Badge>}
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
        {!(unreadOnly ? unread : mine).length && (
          <EmptyState
            title="Không có thông báo"
            description="Các cập nhật liên quan đến bạn sẽ xuất hiện tại đây."
          />
        )}
      </Card>
    </>
  );
}
