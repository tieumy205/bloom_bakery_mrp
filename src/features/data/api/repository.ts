import type { Database, Session } from '../../../shared/domain/types';
import { http } from '../../../shared/api/client';
import { readDatabase } from '../../../mocks/storage';
import { executeMockCommand } from '../../../mocks/commands';
import type { Command } from '../../../shared/domain/commands';
export type { Command } from '../../../shared/domain/commands';

export interface Repository {
  getSnapshot(session: Session): Promise<Database>;
  execute(command: Command, session: Session): Promise<void>;
}
export const repository: Repository =
  import.meta.env.VITE_DATA_SOURCE === 'api'
    ? {
        getSnapshot: () => http<Database>('/snapshot'),
        execute: (command) =>
          http<void>('/commands', {
            method: 'POST',
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify(command),
          }),
      }
    : {
        getSnapshot: async () => {
          await new Promise((resolve) => setTimeout(resolve, 180));
          return readDatabase();
        },
        execute: async (command, session) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          executeMockCommand(command, session);
        },
      };
