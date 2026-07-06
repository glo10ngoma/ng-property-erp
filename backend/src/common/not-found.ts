import { NotFoundException } from '@nestjs/common';

export function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) {
    throw new NotFoundException(`${label} not found`);
  }

  return row;
}
