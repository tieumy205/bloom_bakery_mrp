export type Role = 'admin' | 'manager' | 'employee';
export type Module =
  | 'dashboard'
  | 'materials'
  | 'products'
  | 'boms'
  | 'orders'
  | 'requests'
  | 'receipts'
  | 'material-issues'
  | 'product-issues'
  | 'reports'
  | 'notifications'
  | 'users'
  | 'permissions';
export type Action =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'start'
  | 'progress'
  | 'complete'
  | 'cancel';
export type OrderStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type DocumentKind = 'requests' | 'receipts' | 'material-issues' | 'product-issues';
export type DocumentStatus =
  'draft' | 'pending' | 'approved' | 'rejected' | 'fulfilled' | 'completed';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  flags?: Record<string, boolean>;
  password?: string;
}
export interface Material {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  createdAt: string;
}
export interface Product {
  id: string;
  name: string;
  unit: string;
  stock: number;
  image: string;
  createdAt: string;
}
export interface Bom {
  id: string;
  productId: string;
  lines: { materialId: string; quantity: number }[];
  createdAt: string;
  version?: string;
  active?: boolean;
  used?: boolean;
}
export interface TimelineEntry {
  title: string;
  actor: string;
  at: string;
  note?: string;
}
export interface ProductionOrder {
  id: string;
  items: {
    productId: string;
    target: number;
    completed: number;
    bomId?: string;
    bomVersion?: string;
  }[];
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  dueDate: string;
  note: string;
  status: OrderStatus;
  timeline: TimelineEntry[];
  requirements: { materialId: string; quantity: number }[];
}
export interface DocumentLine {
  itemId: string;
  quantity: number;
  minimum?: number;
}
export interface StockDocument {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  orderId?: string;
  requestId?: string;
  source?: 'order' | 'min-stock';
  createdBy: string;
  createdAt: string;
  lines: DocumentLine[];
  supplier: string;
  receiptDate: string;
  note: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  timeline: TimelineEntry[];
}
export interface StockMovement {
  id: string;
  itemId: string;
  itemType: 'material' | 'product';
  delta: number;
  date: string;
  reference: string;
}
export interface Notification {
  id: string;
  userId?: string;
  role?: Role;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readBy: string[];
}
export interface Database {
  units?: { id: string; name: string; symbol: string }[];
  suppliers?: { id: string; name: string }[];
  users: User[];
  materials: Material[];
  products: Product[];
  boms: Bom[];
  orders: ProductionOrder[];
  documents: StockDocument[];
  movements: StockMovement[];
  notifications: Notification[];
  openingStock: Record<string, number>;
}
export interface Session {
  userId: string;
}
