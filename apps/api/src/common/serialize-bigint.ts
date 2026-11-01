export function serializeBigInt<T>(value: T): T {
  if (typeof value === 'bigint') return value.toString() as T;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((item) => serializeBigInt(item)) as T;
  if (value && typeof value === 'object') {
    const serialized = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInt(item)]),
    );
    return serialized as T;
  }
  return value;
}
