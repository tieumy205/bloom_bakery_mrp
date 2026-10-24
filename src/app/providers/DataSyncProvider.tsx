import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function DataSyncProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === 'bloom-mrp-v1') void client.invalidateQueries({ queryKey: ['database'] });
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [client]);
  return children;
}
