export function isValidExternalPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const cleaned = value.trim().replace(/\/*\*$/, '');
  return cleaned.length > 0 && !cleaned.includes('\0')
    && (cleaned.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cleaned));
}

export function normalizeExternalPath(p: string): string {
  const cleaned = p.trim();
  if (!cleaned) return '';
  if (cleaned.endsWith('/*') || cleaned.endsWith('*')) return cleaned;
  if (!cleaned.includes('.')) return cleaned.endsWith('/') ? `${cleaned}*` : `${cleaned}/*`;
  return cleaned;
}
