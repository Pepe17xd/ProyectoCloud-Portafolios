export function allocateSeedPartitions(total, services, tenants) {
  if (!Number.isSafeInteger(total) || total < 1 || !Array.isArray(services) || !services.length || !Array.isArray(tenants) || !tenants.length) {
    throw new Error('A positive total, services and tenants are required.');
  }
  const partitions = services.flatMap((service) => tenants.map((tenant) => ({ service, tenant })));
  if (total > partitions.length * 10_000) throw new Error('Requested total exceeds the 10,000-record per-partition limit.');
  const base = Math.floor(total / partitions.length);
  const remainder = total % partitions.length;
  return Object.fromEntries(partitions.map(({ service, tenant }, index) => [`${service}/${tenant}`, base + (index < remainder ? 1 : 0)]));
}
