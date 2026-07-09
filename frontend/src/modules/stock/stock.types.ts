export type StockItem = {
  id: number;
  code?: string;
  name: string;
  category?: string;
  store?: string;
  unit?: string;
  current_quantity?: number;
  minimum_quantity?: number;
  purchase_price?: number;
  average_purchase_price?: number;
  description?: string;
  observations?: string;
  barcode?: string;
  supplier_reference?: string;
  supplier_name?: string;
  brand?: string;
  model?: string;
  attachment_file_name?: string;
  status: string;
  stock_alert?: string;
  last_entry_date?: string;
  last_exit_date?: string;
};

export type StockMovement = {
  id: number;
  movement_number?: string;
  item_code?: string;
  item_name: string;
  category?: string;
  type: string;
  quantity: number;
  unit_price?: number;
  movement_date: string;
  source?: string;
  reference?: string;
  user_name?: string;
  notes?: string;
  unit?: string;
  store?: string;
  document_number?: string;
  document_type?: string;
  document_reason?: string;
  stock_document_id?: number;
  quantity_before?: number;
  quantity_after?: number;
  supplier?: string;
  supplier_reference?: string;
  document_reference?: string;
  document_observations?: string;
  attachment_file_name?: string;
  attachment_file_url?: string;
  purchase_number?: string;
  receipt_number?: string;
};

export type StockPurchase = {
  id: number;
  purchase_number: string;
  purchase_date: string;
  supplier_name: string;
  supplier_reference?: string;
  store?: string;
  payment_terms?: string;
  payment_method?: string;
  payment_type: string;
  due_date?: string;
  subtotal_amount: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  purchase_status: string;
  reception_status: string;
  payment_status: string;
  observations?: string;
  user_name?: string;
  line_count?: number;
};

export type StockPurchaseLine = {
  id: number;
  stock_purchase_id: number;
  stock_item_id: number;
  item_code?: string;
  item_name?: string;
  category?: string;
  unit?: string;
  quantity: number;
  received_quantity: number;
  unit_price: number;
  line_total: number;
};

export type StockPurchaseReceipt = {
  id: number;
  stock_purchase_id: number;
  receipt_number: string;
  receipt_date: string;
  receiver_name?: string;
  store?: string;
  notes?: string;
  quantity_received?: number;
};

export type StockPurchasePayment = {
  id: number;
  stock_purchase_id: number;
  payment_date: string;
  amount: number;
  payment_method?: string;
  reference?: string;
  notes?: string;
  cash_movement_id?: number;
  user_name?: string;
};

export type StockPurchaseTimeline = {
  id: number;
  stock_purchase_id: number;
  event_type: string;
  title: string;
  details?: string;
  created_at: string;
  user_name?: string;
};

export type StockPurchaseDetail = StockPurchase & {
  lines: StockPurchaseLine[];
  receipts: StockPurchaseReceipt[];
  receipt_lines: Array<{
    id: number;
    stock_purchase_receipt_id: number;
    stock_purchase_line_id: number;
    stock_item_id: number;
    item_code?: string;
    item_name?: string;
    unit?: string;
    receipt_number: string;
    receipt_date: string;
    quantity_received: number;
    unit_price: number;
    line_total: number;
  }>;
  payments: StockPurchasePayment[];
  timeline: StockPurchaseTimeline[];
  stock_movements: StockMovement[];
  cash_movements: Array<Record<string, unknown>>;
};

export type InventoryLine = {
  id: number;
  stock_item_id: number;
  item_code: string;
  item_name: string;
  unit?: string;
  theoretical_quantity: number;
  physical_quantity: number;
  difference_quantity: number;
  unit_cost: number;
  difference_cost: number;
  notes?: string;
};

export type StockInventory = {
  id: number;
  inventory_number: string;
  count_date: string;
  status: string;
  line_count?: number;
  positive_difference?: number;
  negative_difference?: number;
  difference_value?: number;
  user_name?: string;
  notes?: string;
  lines?: InventoryLine[];
};
