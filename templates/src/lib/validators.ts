export function badRequest(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

export function requireString(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw badRequest(`${field} is required.`);
  return s;
}
