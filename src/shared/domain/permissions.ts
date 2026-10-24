import type { Action, Module, Role, User } from './types';

export const roleLabels: Record<Role, string> = {
  admin: 'Quản trị hệ thống',
  manager: 'Quản lý kho',
  employee: 'Nhân viên sản xuất',
};
const crud: Action[] = ['create', 'read', 'update', 'delete'];
export const permissions: Record<Role, Partial<Record<Module, Action[]>>> = {
  admin: {
    users: crud,
    permissions: crud,
    materials: ['read'],
    products: ['read'],
    boms: ['read'],
    orders: ['read'],
    requests: ['read'],
    receipts: ['read'],
    'material-issues': ['read'],
    'product-issues': ['read'],
    reports: ['read'],
  },
  manager: {
    dashboard: ['read'],
    materials: crud,
    products: crud,
    boms: crud,
    orders: ['create', 'read', 'update', 'cancel'],
    requests: ['read', 'approve', 'reject'],
    receipts: [...crud, 'complete'],
    'material-issues': ['read', 'approve', 'reject'],
    'product-issues': ['read', 'approve', 'reject'],
    reports: ['read'],
    notifications: ['read'],
  },
  employee: {
    orders: ['read', 'start', 'progress', 'complete'],
    materials: ['read'],
    products: ['read'],
    requests: crud,
    'material-issues': crud,
    'product-issues': crud,
    notifications: ['read'],
  },
};
export const can = (subject: Role | User, module: Module, action: Action = 'read') =>
  typeof subject === 'string' ? permissions[subject][module]?.includes(action) ?? false
  : subject.flags ? subject.flags[`${module}.${action}`] === true
  : permissions[subject.role][module]?.includes(action) ?? false;
export const homePath = (role: Role) =>
  role === 'admin' ? '/admin/users' : role === 'manager' ? '/app/dashboard' : '/app/orders';
