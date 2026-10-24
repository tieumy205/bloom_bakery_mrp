import type { Bom, Material, Product, ProductionOrder, StockDocument, User } from './types';
export type Command =
  | { type: 'save-user'; payload: User }
  | { type: 'delete-user'; payload: string }
  | { type: 'save-material'; payload: Material }
  | { type: 'save-product'; payload: Product }
  | { type: 'save-bom'; payload: Bom }
  | { type: 'set-bom-active'; payload: { id: string; active: boolean } }
  | { type: 'delete-catalog'; payload: { kind: 'materials' | 'products' | 'boms'; id: string } }
  | { type: 'save-order'; payload: ProductionOrder }
  | {
      type: 'order-action';
      payload: {
        id: string;
        action: 'start' | 'cancel' | 'complete' | 'progress';
        quantities?: Record<string, number>;
      };
    }
  | { type: 'save-document'; payload: StockDocument }
  | { type: 'delete-document'; payload: string }
  | {
      type: 'document-action';
      payload: {
        id: string;
        action: 'approve' | 'reject' | 'submit' | 'complete';
        reason?: string;
      };
    }
  | { type: 'read-notification'; payload: string };
