import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { repository } from '../api/repository';
import type { Command } from '../api/repository';
import { useSession, apiMode } from '../../../app/providers/SessionProvider';

export function useDatabase() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['database', user.id],
    queryFn: () => repository.getSnapshot({ userId: user.id }),
    refetchInterval: apiMode ? 15000 : false,
  });
}
export function useCommand() {
  const { user } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: Command) => repository.execute(command, { userId: user.id }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['database'] }),
        client.invalidateQueries({ queryKey: ['report'] }),
      ]);
    },
    onError: () => client.invalidateQueries({ queryKey: ['database'] }),
  });
}
