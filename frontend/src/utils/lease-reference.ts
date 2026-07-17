export function formatLeaseReference(
  leaseNumber?: unknown,
  fallbackId?: unknown,
): string {
  const normalizedLeaseNumber = Number(leaseNumber);
  if (Number.isInteger(normalizedLeaseNumber) && normalizedLeaseNumber > 0) {
    return `B-${String(normalizedLeaseNumber).padStart(5, '0')}`;
  }

  const normalizedFallbackId = Number(fallbackId);
  if (Number.isInteger(normalizedFallbackId) && normalizedFallbackId > 0) {
    return `B-${String(normalizedFallbackId).padStart(5, '0')}`;
  }

  return 'Bail sans reference';
}
