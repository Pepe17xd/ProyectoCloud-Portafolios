import { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { StatusBadge, UserAvatar } from '../../components/StatusBadge';
import { formatResourceType } from '../../utils/display';

type Item = Record<string, unknown> & { id?: string; sk?: string };
type RequestFn = <T = any>(module: string, path: string, method?: string, body?: unknown) => Promise<T>;

export default function TeamAvailabilityPanel({
  request,
  refreshToken,
}: {
  request: RequestFn;
  refreshToken: number;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await request<{ items: Item[] }>('resource', 'availability');
      setItems(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return (
    <section className="panel availability-panel" aria-label="Disponibilidad real del equipo">
      <div className="panelHeading">
        <div>
          <h2><Users size={18} /> Disponibilidad en tiempo real</h2>
          <span>Capacidad ocupada frente al margen libre de cada recurso de tu organización.</span>
        </div>
        <span className="mode-chip">{items.length} RECURSOS</span>
      </div>

      {error && <p className="error banner" role="alert">{error}</p>}

      {loading ? (
        <div className="empty">Calculando disponibilidad actual…</div>
      ) : items.length ? (
        <div className="availability-grid">
          {items.map((item, idx) => {
            const capacity = Number(item.capacity ?? 1);
            const rawAllocated = Number(item.allocated ?? 0);
            const remaining = item.remainingCapacity != null ? Number(item.remainingCapacity) : null;
            const allocated =
              rawAllocated === 0 && remaining !== null && Number.isFinite(remaining) && capacity > remaining
                ? Math.max(0, capacity - remaining)
                : rawAllocated;
            const available =
              remaining !== null && rawAllocated === 0 && capacity > remaining
                ? Math.max(0, remaining)
                : Math.max(0, Number(item.available ?? capacity - allocated));

            const pctUsed = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0;
            const pctFree = capacity > 0 ? Math.max(0, Math.round((available / capacity) * 100)) : 0;
            const statusCode =
              allocated > capacity ? 'OVERALLOCATED' : allocated > 0 ? 'ASSIGNED' : 'AVAILABLE';

            return (
              <article className="availability-card" key={String(item.id || item.sk || idx)}>
                <div className="availability-card-head">
                  <UserAvatar name={item.name || 'Recurso'} size={28} />
                  <StatusBadge value={statusCode} />
                </div>
                <span className="availability-card-type">
                  {formatResourceType(item.type)} · Capacidad total {Math.round(capacity * 100)}%
                </span>
                <div className="inline-meter-track">
                  <span
                    className={`inline-meter-fill ${
                      allocated > capacity ? 'fill-rose' : pctUsed >= 85 ? 'fill-amber' : 'fill-emerald'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, pctUsed))}%` }}
                  />
                </div>
                <div className="availability-metrics">
                  <span>Asignado: <strong>{pctUsed}%</strong></span>
                  <span>Libre: <strong>{pctFree}%</strong></span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty">No hay recursos registrados para calcular disponibilidad.</div>
      )}
    </section>
  );
}
