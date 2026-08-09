// src/components/PerfVerifyImport.jsx
import { useMemo, useState } from 'react';
import { parsePerfVerifyClipboard, resolveCodes, toWatchlistFile, downloadJson } from '../lib/perfVerify';

export default function PerfVerifyImport({ nameToCode, onLoaded }) {
  const [raw, setRaw] = useState('');
  const [baseDate, setBaseDate] = useState('');   // YYYY-MM-DD
  const [baseTime, setBaseTime] = useState('09:02');
  const [condition, setCondition] = useState('');
  const [tickMul, setTickMul] = useState(24);
  const [bucketSec, setBucketSec] = useState(900);
  const [slots, setSlots] = useState(20);
  const [err, setErr] = useState('');

  const parsed = useMemo(() => {
    if (!raw.trim()) return null;
    try {
      setErr('');
      const p = parsePerfVerifyClipboard(raw, {
        baseDate: baseDate.replaceAll('-', ''),
        baseTime: baseTime.replace(':', ''),
        condition,
      });
      return nameToCode ? resolveCodes(p, nameToCode) : { ...p, unresolved: [] };
    } catch (e) {
      setErr(e.message);
      return null;
    }
  }, [raw, baseDate, baseTime, condition, nameToCode]);

  const periods = parsed?.meta.periods.map(p => p.label) ?? [];

  const save = () => {
    const file = toWatchlistFile(parsed, { tickMul, bucketSec, slots });
    downloadJson(file, `cond_${file.baseDate || 'nodate'}_${file.baseTime || 'notime'}.json`);
  };

  return (
    <div className="pv-import">
      <div className="pv-row">
        <label>검색시각
          <input type="date" value={baseDate} onChange={e => setBaseDate(e.target.value)} />
          <input type="time" value={baseTime} onChange={e => setBaseTime(e.target.value)} />
        </label>
        <label>조건식
          <input value={condition} onChange={e => setCondition(e.target.value)} placeholder="다량어" />
        </label>
        <label>틱캔들
          <select value={tickMul} onChange={e => setTickMul(+e.target.value)}>
            {[1, 2, 4, 8, 12, 16, 24].map(m => <option key={m} value={m}>{m * 30}틱</option>)}
          </select>
        </label>
        <label>단위구간
          <select value={bucketSec} onChange={e => setBucketSec(+e.target.value)}>
            <option value={60}>1분</option><option value={180}>3분</option>
            <option value={300}>5분</option><option value={900}>15분</option>
          </select>
        </label>
        <label>슬롯/구간
          <input type="number" min={4} max={120} value={slots} onChange={e => setSlots(+e.target.value)} />
        </label>
      </div>

      <textarea
        className="pv-paste"
        rows={8}
        placeholder="[1516] 성과검증 > 검색 종목 리스트를 복사해서 붙여넣으세요"
        value={raw}
        onChange={e => setRaw(e.target.value)}
      />

      {err && <div className="pv-err">{err}</div>}

      {parsed && (
        <>
          <div className="pv-summary">
            {parsed.meta.count}종목 인식
            {parsed.unresolved.length > 0 && ` · 코드 미확인 ${parsed.unresolved.length}건 (${parsed.unresolved.join(', ')})`}
          </div>

          <table className="pv-table">
            <thead>
              <tr>
                <th>종목명</th><th>코드</th>
                {periods.map(p => <th key={p}>{p}</th>)}
                <th>최고수익률</th><th>검색시점 거래량</th><th>기타</th>
              </tr>
            </thead>
            <tbody>
              {parsed.rows.map(r => (
                <tr key={r.name} className={r.code ? '' : 'pv-nocode'}>
                  <td>{r.name}</td><td>{r.code ?? '—'}</td>
                  {periods.map(p => {
                    const v = r.returns[p];
                    return <td key={p} className={v > 0 ? 'up' : v < 0 ? 'dn' : ''}>
                      {v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`}
                    </td>;
                  })}
                  <td className="up">{r.maxReturn == null ? '' : `+${r.maxReturn.toFixed(2)}%`}</td>
                  <td>{r.searchVolume?.toLocaleString() ?? ''}</td>
                  <td>{r.etc ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pv-actions">
            <button onClick={save}>파일로 저장</button>
            <button onClick={() => onLoaded?.(toWatchlistFile(parsed, { tickMul, bucketSec, slots }))}>
              차트로 보내기
            </button>
          </div>
        </>
      )}
    </div>
  );
}
