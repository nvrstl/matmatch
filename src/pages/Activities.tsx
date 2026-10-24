import { useState } from 'react'
import type { Activity } from '../../shared/types'
import { Card, Loading, PageHeader, Segmented, inputCls } from '../components/ui'
import { useApi } from '../lib/api'
import { fmtDate, fmtKm, fmtPace, fmtTime } from '../lib/format'

type SportFilter = '' | 'run' | 'bike' | 'swim' | 'walk' | 'strength'

export default function Activities() {
  const [sport, setSport] = useState<SportFilter>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const { data, error } = useApi<{ total: number; items: Activity[] }>(
    `/activities?sport=${sport}&q=${encodeURIComponent(q)}&page=${page}`,
  )
  const pages = data ? Math.ceil(data.total / 50) : 0

  return (
    <>
      <PageHeader title="Activities">Every activity you’ve recorded, newest first.</PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={sport}
          onChange={(v) => (setSport(v), setPage(0))}
          options={[
            { value: '', label: 'All' },
            { value: 'run', label: 'Run' },
            { value: 'bike', label: 'Bike' },
            { value: 'swim', label: 'Swim' },
            { value: 'walk', label: 'Walk' },
            { value: 'strength', label: 'Strength' },
          ]}
        />
        <input className={`${inputCls} max-w-60`} placeholder="Search name or date…" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
        {data && <span className="text-[13px] text-muted">{data.total.toLocaleString()} activities</span>}
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Name</th>
                  <th className="py-2 text-right font-normal">Distance</th>
                  <th className="py-2 text-right font-normal">Time</th>
                  <th className="py-2 text-right font-normal">Pace</th>
                  <th className="py-2 text-right font-normal">Avg HR</th>
                  <th className="py-2 text-right font-normal">Fastest 5K</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap py-2 text-ink-2">{fmtDate(a.date)}</td>
                    <td className="py-2">
                      {a.name}
                      <div className="text-[11px] text-muted">{a.typeKey.replace(/_/g, ' ')}</div>
                    </td>
                    <td className="py-2 text-right">{a.distanceM ? `${fmtKm(a.distanceM / 1000, 2)} km` : '–'}</td>
                    <td className="py-2 text-right">{fmtTime(a.durationS)}</td>
                    <td className="py-2 text-right">{a.sport === 'run' && a.distanceM ? fmtPace(a.durationS / (a.distanceM / 1000)) : '–'}</td>
                    <td className="py-2 text-right">{a.avgHr ? Math.round(a.avgHr) : '–'}</td>
                    <td className="py-2 text-right">{a.fastest['5k'] ? fmtTime(a.fastest['5k']) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <button className="rounded-lg border border-line px-3 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Newer
              </button>
              <span className="text-muted">
                {page + 1} / {pages}
              </span>
              <button className="rounded-lg border border-line px-3 py-1 disabled:opacity-40" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                Older
              </button>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
