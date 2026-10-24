import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Command } from '../domain/commands';
import { useCommand } from '../../features/data/hooks/useDatabase';
import { Button, Modal, Notice } from './primitives';

export function CommandModal({
  title,
  children,
  command,
  onClose,
  onSuccess,
  label = 'Xác nhận',
  danger,
  wide,
  submitDisabled,
}: {
  title: string;
  children?: ReactNode;
  command: Command | (() => Command);
  onClose: () => void;
  onSuccess?: () => void;
  label?: string;
  danger?: boolean;
  wide?: boolean;
  submitDisabled?: boolean;
}) {
  const mutation = useCommand();
  const [error, setError] = useState('');
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      wide={wide}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          try {
            await mutation.mutateAsync(typeof command === 'function' ? command() : command);
            onSuccess?.();
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Không thể lưu dữ liệu.');
          }
        }}
      >
        {children}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-footer">
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button
            type="submit"
            variant={danger ? 'danger' : 'primary'}
            disabled={mutation.isPending || submitDisabled}
          >
            {mutation.isPending ? 'Đang xử lý…' : label}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
