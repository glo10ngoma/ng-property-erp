import { exportCsv } from '../utils/exportCsv';
import { exportExcel } from '../utils/exportExcel';

export function useExport() {
  return { exportCsv, exportExcel };
}
