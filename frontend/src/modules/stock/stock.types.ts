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
