export const OPERATIONS_EVENTS = {
  ORDER_SENT: 'order.sent',
  ORDER_ITEM_STATUS_CHANGED: 'order-item.status.changed',
  ORDER_STATUS_CHANGED: 'order.status.changed',
  TABLE_STATUS_CHANGED: 'table.status.changed',
  PRINT_JOB_STATUS_CHANGED: 'print-job.status.changed',
} as const;

export interface OperationsEvent<T> {
  occurredAt: string;
  data: T;
}
