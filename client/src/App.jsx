import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';

// Default (empty) state of the Add Trade form
const getDefaultTradeForm = () => ({
    accountId: null, // null = not chosen yet
    date: new Date().toLocaleDateString('en-CA'), // local date (YYYY-MM-DD)
    pairDirection: '',
    session: '',
    fvgTap: '',
    smtDivergence: '',
    executionRules: [],
    entryPrice: '',
    slPrice: '',
    planeTarget: '1:2 (0p : 0p)',
    lotSizeRisk: '',
    outcome: '',
    profitAmount: '',
    lossAmount: '',
    psychologicalState: [],
    beforeCharts: '', // optional image links (comma / new line separated)
    afterCharts: '',
    beforeChartFiles: [], // images selected from the computer (multiple allowed)
    afterChartFiles: [],
    note: ''
});

// Always show prices with 5 decimals (1.3 -> 1.30000). Returns '' for empty / invalid input
const formatPrice5 = (value) => {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num.toFixed(5) : '';
};

// Counts image links typed in the URL box (separated by comma or new line)
const countLinks = (text) => String(text || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean).length;

const MAX_IMAGES_PER_CHART = 10;

// Pip size per instrument (JPY pairs 0.01, gold 0.1, everything else 0.0001)
const getPipSize = (pairDirection) => {
    const pair = String(pairDirection || '').toUpperCase();
    if (pair.includes('JPY')) return 0.01;
    if (pair.includes('XAU')) return 0.1;
    return 0.0001;
};

// Builds "1:2 (SLp : TPp)" from entry + SL prices (fixed 1:2 risk-reward). Falls back to 0p : 0p
const buildPlaneTarget = (entry, sl, pairDirection) => {
    const e = parseFloat(entry);
    const l = parseFloat(sl);
    if (!Number.isFinite(e) || !Number.isFinite(l)) return '1:2 (0p : 0p)';
    const slPips = Math.abs(e - l) / getPipSize(pairDirection);
    const fmt = (n) => String(parseFloat(n.toFixed(1))); // 8.95 -> "9", 20.0 -> "20"
    return `1:2 (${fmt(slPips)}p : ${fmt(slPips * 2)}p)`;
};

// ---------------------------------------------------------------------------
// Chart theme (shared by every chart)
// ---------------------------------------------------------------------------
Chart.defaults.font.family = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
Chart.defaults.animation.duration = 700;
const C = { up: '#34D399', down: '#FB7185' };
const chartKit = (isDark) => ({
    grid: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(15,23,42,0.07)',
    text: isDark ? '#7C88A6' : '#64748B',
    tooltip: {
        backgroundColor: isDark ? 'rgba(8,12,26,0.96)' : 'rgba(255,255,255,0.98)',
        titleColor: isDark ? '#F1F5F9' : '#0F172A',
        bodyColor: isDark ? '#CBD5E1' : '#334155',
        borderColor: isDark ? 'rgba(129,140,248,0.35)' : '#E2E8F0',
        borderWidth: 1, padding: 12, cornerRadius: 12, boxPadding: 4, usePointStyle: true,
        titleFont: { weight: '700', size: 12 }, bodyFont: { size: 12 }
    }
});
const axes = (k, money) => ({
    x: { grid: { display: false }, border: { display: false }, ticks: { color: k.text, font: { size: 11, weight: '600' }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
    y: { border: { display: false }, grid: { color: k.grid, drawTicks: false }, ticks: { color: k.text, font: { size: 11 }, padding: 10, callback: money ? (v) => `$${Number(v).toLocaleString('en-US')}` : undefined } }
});
// ---------------------------------------------------------------------------
// Analytics helpers
// ---------------------------------------------------------------------------
const RULE_NAMES = ['1min MSS & FVG Entry', 'SMT Divergence', 'HTF Context (15min FVG)', 'Time Filter', 'Daily Bias Alignment'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DEFAULT_SETTINGS = { startingBalance: '', dailyLossLimit: '', weeklyLossLimit: '', riskTargetPct: '', maxLossStreak: '' };

const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

const fmtMoney = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtSigned = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const localDateKey = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in the viewer's time zone

// Monday of the week that contains `d` (trading week = Mon-Fri)
const getWeekStartKey = (d = new Date()) => {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return localDateKey(x);
};

const tradeDateKey = (t) => (t && t.date && t.date !== 'N/A') ? String(t.date).slice(0, 10) : '';

// Equity, drawdown, expectancy, streak... (trades must be oldest -> newest)
const computeAnalytics = (trades, startBal) => {
    let equity = startBal, peak = startBal, maxDD = 0, maxDDPct = 0;
    let net = 0, winSum = 0, lossSum = 0, wins = 0, losses = 0;
    const ddSeries = [0];

    trades.forEach(t => {
        equity += t.pnl;
        net += t.pnl;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
        if (dd > maxDD) maxDD = dd;
        if (ddPct > maxDDPct) maxDDPct = ddPct;
        ddSeries.push(-dd);
        if (t.result === 'Win') { wins++; winSum += Math.abs(t.pnl); } else { losses++; lossSum += Math.abs(t.pnl); }
    });

    const avgWin = wins ? winSum / wins : 0;
    const avgLoss = losses ? lossSum / losses : 0;

    let streakType = '', streakLen = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
        if (i === trades.length - 1) { streakType = trades[i].result; streakLen = 1; }
        else if (trades[i].result === streakType) streakLen++;
        else break;
    }

    return {
        count: trades.length,
        net, equity, peak, maxDD, maxDDPct,
        currentDD: peak - equity,
        currentDDPct: peak > 0 ? ((peak - equity) / peak) * 100 : 0,
        expectancy: trades.length ? net / trades.length : 0,
        avgWin, avgLoss,
        payoff: avgLoss > 0 ? avgWin / avgLoss : 0,
        recovery: maxDD > 0 ? net / maxDD : 0,
        streakType, streakLen,
        ddSeries
    };
};

// Win-rate / PnL grouped by any key (keyFn may return one key or an array of keys)
const groupStats = (trades, keyFn) => {
    const map = new Map();
    trades.forEach(t => {
        [].concat(keyFn(t)).filter(k => k !== undefined && k !== null && k !== '').forEach(k => {
            const g = map.get(k) || { label: k, trades: 0, wins: 0, pnl: 0 };
            g.trades++;
            if (t.result === 'Win') g.wins++;
            g.pnl += t.pnl;
            map.set(k, g);
        });
    });
    return [...map.values()].map(g => ({ ...g, winRate: g.trades ? (g.wins / g.trades) * 100 : 0, avgPnl: g.trades ? g.pnl / g.trades : 0 }));
};

// "With rule" vs "without rule" win rate for each execution rule
const ruleEdgeStats = (trades) => {
    const scored = trades.filter(t => t.rules && t.rules.length > 0);
    return RULE_NAMES.map(rule => {
        const withR = scored.filter(t => t.rules.includes(rule));
        const withoutR = scored.filter(t => !t.rules.includes(rule));
        const wr = (arr) => arr.length ? (arr.filter(t => t.result === 'Win').length / arr.length) * 100 : null;
        const withWR = wr(withR), withoutWR = wr(withoutR);
        return { label: rule, withN: withR.length, withoutN: withoutR.length, withWR, withoutWR, edge: (withWR !== null && withoutWR !== null) ? withWR - withoutWR : null };
    });
};

// CSV helpers (cells starting with = + - @ are prefixed so Excel never runs them as formulas)
const csvCell = (v) => {
    let t = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
};

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------
function StatTile({ label, value, sub, tone = 'neutral', isDark }) {
    const toneCls = { good: 'text-emerald-400', bad: 'text-rose-400', warn: 'text-amber-400', neutral: isDark ? 'text-white' : 'text-slate-900' }[tone];
    return (
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
            <span className="text-slate-400 uppercase tracking-wider text-[10px] block font-semibold">{label}</span>
            <span className={`text-lg font-black mt-1 block ${toneCls}`}>{value}</span>
            {sub && <span className="text-[10px] text-slate-500 block mt-0.5">{sub}</span>}
        </div>
    );
}

function BreakdownCard({ title, subtitle, rows, isDark }) {
    return (
        <div className={`p-5 rounded-2xl border space-y-3 ${isDark ? 'bg-[#141B30]/70 border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
            <div>
                <h4 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h4>
                {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
            </div>
            {rows.length === 0 ? (
                <p className="text-xs text-slate-500">Not enough data yet.</p>
            ) : rows.map(r => (
                <div key={r.label} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={`font-semibold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{r.label}</span>
                        <span className="text-slate-400 whitespace-nowrap">
                            {r.trades} trade{r.trades === 1 ? '' : 's'} · <b className={r.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}>{r.winRate.toFixed(0)}%</b> · <b className={r.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtSigned(r.pnl)}</b>
                        </span>
                    </div>
                    <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-slate-200'}`}>
                        <div className={`h-full rounded-full ${r.winRate >= 50 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(2, r.winRate)}%` }}></div>
                    </div>
                    {r.trades < 5 && <span className="text-[10px] italic text-slate-500">low sample (under 5 trades)</span>}
                </div>
            ))}
        </div>
    );
}

function RuleEdgeCard({ rows, isDark }) {
    const hasData = rows.some(r => r.withN > 0);
    return (
        <div className={`p-5 rounded-2xl border space-y-3 ${isDark ? 'bg-[#141B30]/70 border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
            <div>
                <h4 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Edge per Execution Rule</h4>
                <p className="text-[11px] text-slate-500">Win rate when the rule was followed vs not followed</p>
            </div>
            {!hasData ? <p className="text-xs text-slate-500">Not enough data yet.</p> : rows.map(r => (
                <div key={r.label} className="space-y-0.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                        <span className={`font-semibold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{r.label}</span>
                        {r.edge !== null
                            ? <b className={r.edge >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{r.edge >= 0 ? '+' : ''}{r.edge.toFixed(0)}% edge</b>
                            : <span className="text-slate-500">n/a</span>}
                    </div>
                    <div className="text-[11px] text-slate-400">
                        With: {r.withWR !== null ? `${r.withWR.toFixed(0)}%` : '-'} ({r.withN}) · Without: {r.withoutWR !== null ? `${r.withoutWR.toFixed(0)}%` : '-'} ({r.withoutN})
                    </div>
                </div>
            ))}
        </div>
    );
}

// "Underwater" curve: how far below the equity peak the account was after every trade
function DrawdownChart({ series, isDark }) {
    const w = 600, h = 150, pad = 8;
    const min = Math.min(0, ...series);
    const n = series.length;
    if (n < 2 || min === 0) {
        return <p className="text-xs text-slate-500 py-10 text-center">No drawdown yet. The account has been at its equity peak after every trade.</p>;
    }
    const x = (i) => pad + (i / (n - 1)) * (w - 2 * pad);
    const y = (v) => pad + (v / min) * (h - 2 * pad);
    const line = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `M ${x(0).toFixed(1)},${y(0).toFixed(1)} L ${line.replace(/ /g, ' L ')} L ${x(n - 1).toFixed(1)},${y(0).toFixed(1)} Z`;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40" preserveAspectRatio="none" role="img" aria-label="Drawdown curve">
            <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'} strokeDasharray="4 4" />
            <path d={area} fill="rgba(239,68,68,0.18)" />
            <polyline points={line} fill="none" stroke="#F43F5E" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

// ---------------------------------------------------------------------------
// UI helpers: icons, count-up numbers, loading splash
// ---------------------------------------------------------------------------
// Backend base URL: leave empty to use the Vite proxy, or set VITE_API_URL for a deployed API
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';

// ---------------------------------------------------------------------------
// AI performance report modal (self-contained; wrapped so its helper names cannot clash with this file)
// ---------------------------------------------------------------------------
const AiReportModal = (() => {

// ---------------------------------------------------------------------------
// Period helpers (local dates, weeks start on Monday)
// ---------------------------------------------------------------------------
const PERIODS = [
    { key: 'week', label: 'This week' },
    { key: 'last_week', label: 'Last week' },
    { key: 'month', label: 'This month' },
    { key: 'last_month', label: 'Last month' },
    { key: 'last_30', label: 'Last 30 days' },
    { key: 'all', label: 'All time' }
];
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const FAR = '9999-12-31';

// Returns the date range of a period plus the range of the period before it (only for complete periods,
// so "this week so far" is never compared with a full week).
function periodRange(key, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monday = addDays(today, -((today.getDay() + 6) % 7));
    const range = (from, to) => ({ from: dkey(from), to: dkey(to) });
    if (key === 'week') return { cur: { from: dkey(monday), to: FAR }, prev: null };
    if (key === 'last_week') return { cur: range(addDays(monday, -7), addDays(monday, -1)), prev: range(addDays(monday, -14), addDays(monday, -8)) };
    if (key === 'month') return { cur: { from: dkey(new Date(today.getFullYear(), today.getMonth(), 1)), to: FAR }, prev: null };
    if (key === 'last_month') {
        const first = new Date(today.getFullYear(), today.getMonth() - 1, 1), last = new Date(today.getFullYear(), today.getMonth(), 0);
        return { cur: range(first, last), prev: range(new Date(today.getFullYear(), today.getMonth() - 2, 1), new Date(today.getFullYear(), today.getMonth() - 1, 0)) };
    }
    if (key === 'last_30') return { cur: range(addDays(today, -29), today), prev: range(addDays(today, -59), addDays(today, -30)) };
    return { cur: { from: '0000-01-01', to: FAR }, prev: null };
}
const inRange = (t, r) => !!r && t.date && t.date !== 'N/A' && t.date >= r.from && t.date <= r.to;

const toPayload = (t) => ({ date: t.date, pair: t.pair, direction: t.direction, session: t.session, rules: t.rules || [], psych: t.psych || [], pnl: t.pnl, result: t.result, lot: t.lotSize, note: (t.rawNote || '').trim() });

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const moneySigned = (v) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const compact = (v) => { const a = Math.abs(v); const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : String(Math.round(a)); return `${v < 0 ? '-' : ''}$${s}`; };
const SOURCE_LABEL = {
    ai: (m) => `Written by AI from verified metrics${m ? ` (${m})` : ''}`,
    'ai+rules': (m) => `AI commentary plus rule-based analysis${m ? ` (${m})` : ''}`,
    rules: () => 'Rule-based analysis (AI was not used)'
};

// ---------------------------------------------------------------------------
// Charts (plain SVG, no dependencies)
// ---------------------------------------------------------------------------
function SeriesChart({ series, isDark, kind, label }) {
    const w = 600, h = 170, padL = 46, padR = 8, padT = 10, padB = 10;
    const n = series.length;
    if (n < 2) return <p className="text-xs text-slate-500 py-8 text-center">Not enough trades to draw a curve yet.</p>;
    const min = Math.min(0, ...series), max = Math.max(0, ...series), span = max - min || 1;
    const x = (i) => padL + (i / (n - 1)) * (w - padL - padR);
    const y = (v) => padT + (1 - (v - min) / span) * (h - padT - padB);
    const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const area = `M${x(0).toFixed(1)},${y(0).toFixed(1)} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} Z`;
    const up = series[n - 1] >= 0;
    const color = kind === 'dd' ? '#F43F5E' : up ? '#10B981' : '#F43F5E';
    const grid = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.2)';
    const txt = isDark ? '#94A3B8' : '#64748B';
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label={label}>
            <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} stroke={grid} strokeDasharray="4 4" />
            <path d={area} fill={color} opacity="0.14" />
            <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
            <text x={padL - 6} y={y(max) + 4} textAnchor="end" fontSize="11" fill={txt}>{compact(max)}</text>
            <text x={padL - 6} y={y(0) + 4} textAnchor="end" fontSize="11" fill={txt}>$0</text>
            {min < 0 && <text x={padL - 6} y={y(min) + 4} textAnchor="end" fontSize="11" fill={txt}>{compact(min)}</text>}
        </svg>
    );
}

function DailyBars({ days, isDark }) {
    if (!days || days.length < 2) return <p className="text-xs text-slate-500 py-6 text-center">Not enough trading days yet.</p>;
    const w = 600, h = 120, pad = 8;
    const maxAbs = Math.max(...days.map((d) => Math.abs(d.pnl)), 1);
    const bw = (w - 2 * pad) / days.length, mid = h / 2;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Daily profit and loss">
            <line x1={pad} x2={w - pad} y1={mid} y2={mid} stroke={isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.2)'} />
            {days.map((d, i) => {
                const bh = Math.max(1.5, (Math.abs(d.pnl) / maxAbs) * (mid - 6));
                return <rect key={d.date} x={pad + i * bw + 1} y={d.pnl >= 0 ? mid - bh : mid} width={Math.max(1, bw - 2)} height={bh} rx="1.5" fill={d.pnl >= 0 ? '#10B981' : '#F43F5E'}><title>{`${d.date}: ${moneySigned(d.pnl)} (${d.n} trade${d.n === 1 ? '' : 's'})`}</title></rect>;
            })}
        </svg>
    );
}

function NetBars({ rows, isDark }) {
    if (!rows.length) return <p className="text-xs text-slate-500">Not enough data yet.</p>;
    const maxAbs = Math.max(...rows.map((r) => Math.abs(r.net)), 1);
    return (
        <div className="space-y-2.5">
            {rows.map((r) => (
                <div key={r.label} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className={`font-semibold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{r.label}</span>
                        <span className="text-slate-400 whitespace-nowrap">{r.n} trade{r.n === 1 ? '' : 's'}, {r.winRate.toFixed(0)}% wins, <b className={r.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{moneySigned(r.net)}</b></span>
                    </div>
                    <div className={`h-1.5 rounded-full ${isDark ? 'bg-white/10' : 'bg-slate-200'}`}>
                        <div className={`h-full rounded-full ${r.net >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(3, (Math.abs(r.net) / maxAbs) * 100)}%` }} />
                    </div>
                    {r.lowSample && <span className="text-[11px] italic text-slate-500">Low sample (under 5 trades)</span>}
                </div>
            ))}
        </div>
    );
}

function RuleEdgeBars({ rows, isDark }) {
    const usable = rows.filter((r) => r.withN && r.withoutN);
    if (!usable.length) return <p className="text-xs text-slate-500">Log execution rules on more trades to see which ones carry your edge.</p>;
    return (
        <div className="space-y-3">
            {usable.map((r) => (
                <div key={r.label} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className={`font-semibold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{r.label}</span>
                        <b className={r.edge >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{r.edge >= 0 ? '+' : ''}{r.edge.toFixed(0)} pts</b>
                    </div>
                    {[['With rule', r.withWR, r.withN, 'bg-violet-500'], ['Without', r.withoutWR, r.withoutN, 'bg-slate-500']].map(([name, wr, n, cls]) => (
                        <div key={name} className="flex items-center gap-2 text-[11px] text-slate-400">
                            <span className="w-16 shrink-0">{name}</span>
                            <div className={`flex-1 h-1.5 rounded-full ${isDark ? 'bg-white/10' : 'bg-slate-200'}`}><div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.max(2, wr)}%` }} /></div>
                            <span className="w-20 text-right">{wr.toFixed(0)}% ({n})</span>
                        </div>
                    ))}
                    {(r.withN < 5 || r.withoutN < 5) && <span className="text-[11px] italic text-slate-500">Low sample</span>}
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Report view
// ---------------------------------------------------------------------------
function Card({ title, sub, isDark, children, className = '' }) {
    return (
        <section className={`p-5 rounded-2xl border space-y-3 ${isDark ? 'bg-[#141B30]/70 border-[#232C45]' : 'bg-slate-50 border-slate-200'} ${className}`}>
            {title && <div><h4 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h4>{sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}</div>}
            {children}
        </section>
    );
}

function Kpi({ label, value, sub, tone, isDark }) {
    const cls = { good: 'text-emerald-400', bad: 'text-rose-400', neutral: isDark ? 'text-white' : 'text-slate-900' }[tone || 'neutral'];
    return (
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
            <span className="text-slate-400 text-[11px] block font-semibold">{label}</span>
            <span className={`text-xl font-black mt-1 block ${cls}`}>{value}</span>
            {sub && <span className="text-[11px] text-slate-500 block mt-0.5">{sub}</span>}
        </div>
    );
}

function InsightList({ items, kind, factMap, isDark }) {
    const accent = kind === 'good' ? 'border-l-emerald-500' : 'border-l-rose-500';
    const sevCls = { high: 'bg-rose-500/15 text-rose-400', medium: 'bg-amber-500/15 text-amber-400', low: 'bg-slate-500/15 text-slate-400' };
    if (!items.length) return <p className="text-xs text-slate-500">Nothing stands out yet. More logged trades will sharpen this.</p>;
    return (
        <ul className="space-y-3">
            {items.map((it, i) => (
                <li key={i} className={`pl-3 border-l-2 ${accent} space-y-1`}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{it.title}</span>
                        {it.severity && <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${sevCls[it.severity]}`}>{it.severity} priority</span>}
                    </div>
                    <p className={`text-[13px] leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{it.insight}</p>
                    <details className="text-[11px] text-slate-500">
                        <summary className="cursor-pointer select-none hover:text-violet-400">Evidence</summary>
                        <ul className="mt-1 space-y-0.5 list-disc pl-4">{it.evidence.map((id) => <li key={id}>{factMap[id] || id}</li>)}</ul>
                    </details>
                </li>
            ))}
        </ul>
    );
}

function ReportView({ report, isDark }) {
    const { metrics: m, insights: ins, facts, warnings } = report;
    const o = m.overview, r = m.risk;
    const factMap = useMemo(() => Object.fromEntries(facts.map((f) => [f.id, f.text])), [facts]);
    const checks = facts.filter((f) => /^(risk|behavior|quality)\./.test(f.id));
    const dot = { good: 'bg-emerald-500', bad: 'bg-rose-500', neutral: 'bg-slate-500' };
    const strong = isDark ? 'text-white' : 'text-slate-900';
    return (
        <div className="space-y-5">
            <Card isDark={isDark}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-violet-400">{(SOURCE_LABEL[report.source] || SOURCE_LABEL.rules)(report.model)}{report.cached ? ', saved result' : ''}</span>
                    <span className="text-[11px] text-slate-500">{report.meta.n} trades, {report.meta.from} to {report.meta.to}</span>
                </div>
                <p className={`text-base font-semibold leading-snug ${strong}`}>{ins.verdict}</p>
            </Card>

            {warnings.length > 0 && (
                <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300 space-y-1">
                    {warnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Kpi isDark={isDark} label="Net P&L" value={moneySigned(o.net)} tone={o.net > 0 ? 'good' : o.net < 0 ? 'bad' : 'neutral'} sub={`${o.wins} wins, ${o.losses} losses`} />
                <Kpi isDark={isDark} label="Win rate" value={`${o.winRate.toFixed(1)}%`} tone={o.breakEvenWR !== null ? (o.winRate > o.breakEvenWR ? 'good' : 'bad') : 'neutral'} sub={o.ci ? `95% range ${o.ci[0].toFixed(0)}% to ${o.ci[1].toFixed(0)}%` : null} />
                <Kpi isDark={isDark} label="Profit factor" value={o.profitFactor !== null ? o.profitFactor.toFixed(2) : 'n/a'} tone={o.profitFactor === null ? 'neutral' : o.profitFactor >= 1.3 ? 'good' : o.profitFactor < 1 ? 'bad' : 'neutral'} sub="Gross profit / gross loss" />
                <Kpi isDark={isDark} label="Expectancy" value={o.expectancyR !== null ? `${o.expectancyR >= 0 ? '+' : ''}${o.expectancyR.toFixed(2)}R` : moneySigned(o.expectancy)} tone={o.expectancy > 0 ? 'good' : o.expectancy < 0 ? 'bad' : 'neutral'} sub={`${moneySigned(o.expectancy)} per trade`} />
                <Kpi isDark={isDark} label="Max drawdown" value={money(r.maxDD)} tone={r.maxDDPct !== null && r.maxDDPct >= 8 ? 'bad' : 'neutral'} sub={r.maxDDPct !== null ? `${r.maxDDPct.toFixed(1)}% of balance` : `${money(r.currentDD)} below peak now`} />
                <Kpi isDark={isDark} label="Payoff ratio" value={o.payoff !== null ? o.payoff.toFixed(2) : 'n/a'} tone="neutral" sub={o.breakEvenWR !== null ? `Break-even win rate ${o.breakEvenWR.toFixed(0)}%` : null} />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                <Card isDark={isDark} title="Equity curve" sub="Cumulative P&L after each trade"><SeriesChart series={m.series.equity} isDark={isDark} kind="equity" label="Equity curve" /></Card>
                <Card isDark={isDark} title="Drawdown" sub="Distance below the equity peak"><SeriesChart series={m.series.drawdown} isDark={isDark} kind="dd" label="Drawdown curve" /></Card>
            </div>
            <Card isDark={isDark} title="Daily P&L" sub="Last 60 trading days in the period"><DailyBars days={m.series.daily} isDark={isDark} /></Card>

            <div className="grid md:grid-cols-2 gap-4">
                <Card isDark={isDark} title="What is working"><InsightList items={ins.strengths} kind="good" factMap={factMap} isDark={isDark} /></Card>
                <Card isDark={isDark} title="What is costing you"><InsightList items={ins.weaknesses} kind="bad" factMap={factMap} isDark={isDark} /></Card>
            </div>

            <Card isDark={isDark} title="Action plan" sub="Most important first">
                <ol className="space-y-3 list-decimal pl-5">
                    {ins.actionPlan.map((a, i) => (
                        <li key={i} className="space-y-0.5">
                            <p className={`text-sm font-semibold ${strong}`}>{a.action}</p>
                            {a.why && <p className="text-[13px] text-slate-400">{a.why}</p>}
                            <details className="text-[11px] text-slate-500">
                                <summary className="cursor-pointer select-none hover:text-violet-400">Evidence</summary>
                                <ul className="mt-1 space-y-0.5 list-disc pl-4">{a.evidence.map((id) => <li key={id}>{factMap[id] || id}</li>)}</ul>
                            </details>
                        </li>
                    ))}
                </ol>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
                <Card isDark={isDark} title="Edge per execution rule" sub="Win rate when the rule was followed vs not"><RuleEdgeBars rows={m.ruleEdge} isDark={isDark} /></Card>
                <Card isDark={isDark} title="By session" sub="Net P&L"><NetBars rows={m.groups.session} isDark={isDark} /></Card>
                <Card isDark={isDark} title="By weekday" sub="Net P&L"><NetBars rows={m.groups.weekday} isDark={isDark} /></Card>
                <Card isDark={isDark} title="By pair" sub="Net P&L"><NetBars rows={m.groups.pair} isDark={isDark} /></Card>
                {m.groups.psych.length > 0 && <Card isDark={isDark} title="By psychological state" sub="Net P&L"><NetBars rows={m.groups.psych} isDark={isDark} /></Card>}
                <Card isDark={isDark} title="Risk and behaviour checks" sub="Computed from your trade sequence">
                    <ul className="space-y-2">
                        {checks.map((f) => (
                            <li key={f.id} className="flex gap-2 text-[13px]">
                                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dot[f.tone]}`} aria-hidden="true" />
                                <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{f.text}</span>
                            </li>
                        ))}
                    </ul>
                </Card>
            </div>

            {ins.confidenceNotes.length > 0 && (
                <Card isDark={isDark} title="How far to trust this">
                    <ul className="space-y-1 list-disc pl-5 text-[13px] text-slate-400">{ins.confidenceNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </Card>
            )}
            <p className="text-[11px] text-slate-500">All numbers are calculated from your journal by code. The AI only explains them. This is feedback on process and risk, not financial advice.</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
function AiReportModal({ open, onClose, isDark, trades, activeDatabase, activeAcc, risk, apiBase = '' }) {
    const [period, setPeriod] = useState('month');
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');
    const abortRef = useRef(null);
    const printRef = useRef(null); // hidden light-theme copy of the report, used for the PDF

    const scopeKey = `${activeDatabase}|${activeAcc ? activeAcc.id : ''}`;
    useEffect(() => { setReport(null); setError(''); }, [scopeKey]);
    useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

    const slices = useMemo(() => {
        const { cur, prev } = periodRange(period);
        return { current: trades.filter((t) => inRange(t, cur)), previous: prev ? trades.filter((t) => inRange(t, prev)) : [] };
    }, [trades, period]);

    if (!open) return null;

    const accountName = activeDatabase === 'live' ? (activeAcc ? activeAcc.name : 'Live account') : 'Backtest';
    const periodLabel = PERIODS.find((p) => p.key === period).label;

    const generate = async (refresh = false) => {
        if (loading) return;
        if (!slices.current.length) { setError(`There are no trades in "${periodLabel}". Pick a longer period.`); return; }
        if (abortRef.current) abortRef.current.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const timer = setTimeout(() => ctrl.abort(), 60000);
        setLoading(true); setError('');
        try {
            const res = await fetch(`${apiBase}/api/ai-report`, {
                method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trades: slices.current.map(toPayload), prevTrades: slices.previous.map(toPayload),
                    accountName, periodLabel, refresh,
                    startBalance: risk ? risk.startBal : 0, riskPct: risk ? risk.riskPct : 0, dailyLimit: risk ? risk.dailyLimit : 0
                })
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data || !data.success) throw new Error((data && data.error) || `Server returned ${res.status}`);
            setReport(data);
        } catch (e) {
            setError(e.name === 'AbortError' ? 'The request took too long. Try again in a moment.' : `Could not build the report: ${e.message}`);
        } finally {
            clearTimeout(timer); setLoading(false);
        }
    };

    // Opens the complete report (KPIs, all charts, insights, evidence) in a clean white page and starts the
    // print dialog; choose "Save as PDF" as the destination.
    const savePdf = () => {
        if (!report || !printRef.current) return;
        const body = printRef.current.innerHTML.replace(/<details/g, '<details open');
        const head = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((el) => (el.tagName === 'LINK' ? `<link rel="stylesheet" href="${el.href}">` : el.outerHTML)).join('\n');
        const title = `MintPip AI Trade Coach - ${accountName} - ${periodLabel}`.replace(/[<>&"]/g, '');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}
<style>
  html,body{background:#fff!important;color:#0f172a}
  body{margin:0;padding:18px;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  section,li{break-inside:avoid}
  @page{size:A4;margin:10mm}
</style></head><body>
<h1 style="font-size:22px;font-weight:800;color:#6d28d9;margin:0">AI Trade Coach</h1>
<p style="font-size:12px;color:#64748b;margin:2px 0 14px">${accountName.replace(/[<>&"]/g, '')} &middot; ${periodLabel} &middot; ${new Date().toLocaleDateString()}</p>
${body}
<script>window.onload=function(){setTimeout(function(){window.print()},600)}<\/script>
</body></html>`;
        const w = window.open('', '_blank');
        if (!w) { setError('Your browser blocked the pop-up. Allow pop-ups for this site and press Save as PDF again.'); return; }
        w.document.open(); w.document.write(html); w.document.close();
    };

    const panel = isDark ? 'bg-[#0E1426] border-white/15 text-slate-200' : 'bg-white border-slate-200 text-slate-800';
    const field = isDark ? 'bg-[#141B30] border-[#232C45] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800';

    return (
        <div onClick={onClose} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4">
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="AI Trade Coach" className={`p-5 sm:p-7 rounded-2xl border max-w-5xl w-full relative shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto ${panel}`}>
                <div className="flex items-center justify-between gap-3 border-b pb-4 border-slate-700/40">
                    <div>
                        <h3 className="text-lg font-black text-[#A78BFA]">AI Trade Coach</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{accountName}. Numbers are calculated by code, the AI explains them.</p>
                    </div>
                    <button onClick={onClose} aria-label="Close report" className="w-9 h-9 rounded-xl bg-slate-800/60 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">✕</button>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-xs text-slate-400 space-y-1">
                        <span className="block font-semibold">Period</span>
                        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`px-3 py-2.5 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500 ${field}`}>
                            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                        </select>
                    </label>
                    <span className="text-xs text-slate-500 pb-3">{slices.current.length} trade{slices.current.length === 1 ? '' : 's'} in this period</span>
                    <div className="flex-1" />
                    <button onClick={() => generate(false)} disabled={loading} className="px-5 py-2.5 rounded-xl bg-[#7C3AED] text-white text-sm font-bold hover:bg-[#6D28D9] disabled:opacity-60 disabled:cursor-wait transition focus:outline-none focus:ring-2 focus:ring-violet-400">
                        {loading ? 'Building report...' : report ? 'Rebuild report' : 'Generate report'}
                    </button>
                </div>

                {error && <div role="alert" className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-300">{error}</div>}

                {loading && (
                    <div className="py-10 text-center space-y-2" aria-live="polite">
                        <div className="mx-auto w-8 h-8 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
                        <p className="text-sm text-slate-400">Calculating metrics, then asking the AI to explain them. This can take up to 45 seconds.</p>
                    </div>
                )}

                {!loading && report && <ReportView report={report} isDark={isDark} />}

                {report && (
                    <div ref={printRef} aria-hidden="true" style={{ position: 'fixed', left: '-10000px', top: 0, width: '720px', pointerEvents: 'none' }}>
                        <ReportView report={report} isDark={false} />
                    </div>
                )}

                {!loading && !report && !error && (
                    <div className="py-10 text-center text-sm text-slate-500 space-y-1">
                        <p>Choose a period and generate the report.</p>
                        <p className="text-xs">You get KPIs, equity and drawdown curves, rule edge, session and weekday breakdowns, and an evidence-backed action plan.</p>
                    </div>
                )}

                {report && !loading && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 border-slate-700/40">
                        <div className="flex gap-2">
                            <button onClick={savePdf} className="px-4 py-2 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[#A78BFA] hover:bg-[#8B5CF6]/20 transition text-xs font-bold">Save as PDF</button>
                            <button onClick={() => generate(true)} className="px-4 py-2 rounded-xl border border-slate-600/40 text-slate-400 hover:text-violet-400 transition text-xs font-bold">Ask the AI again</button>
                        </div>
                        <button onClick={onClose} className="px-5 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 transition">Close</button>
                    </div>
                )}
            </div>
        </div>
    );
}

return AiReportModal;
})();


const ICONS = {
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
    trash: 'M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14M10 11v6M14 11v6',
    left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6', x: 'M18 6L6 18M6 6l12 12', check: 'M20 6L9 17l-5-5',
    alert: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    search: 'M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z'
};
const Ico = ({ n, className = 'w-4 h-4' }) => (
    <svg className={`${className} inline-block shrink-0 align-[-2px]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[n]} /></svg>
);

const BOOT_T = typeof performance !== 'undefined' ? performance.now() : 0;
function CountUp({ value }) {
    const str = String(value ?? '');
    const [shown, setShown] = useState(str);
    useEffect(() => {
        const m = str.match(/\d[\d,]*\.?\d*/);
        const target = m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
        if (!Number.isFinite(target)) { setShown(str); return; }
        const dec = (m[0].split('.')[1] || '').length, grouped = m[0].includes(',');
        const pre = str.slice(0, m.index), post = str.slice(m.index + m[0].length);
        let raf, t0, tm;
        const step = (t) => {
            t0 = t0 || t;
            const p = Math.min((t - t0) / 2800, 1), e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
            setShown(pre + (target * e).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: grouped }) + post);
            if (p < 1) raf = requestAnimationFrame(step);
        };
        const wait = Math.max(0, 3000 - (performance.now() - BOOT_T)); // start after the splash fades
        tm = setTimeout(() => { raf = requestAnimationFrame(step); }, wait);
        return () => { clearTimeout(tm); cancelAnimationFrame(raf); };
    }, [str]);
    return <>{shown}</>;
}

function Splash({ done }) {
    const [gone, setGone] = useState(false);
    useEffect(() => { if (done) { const id = setTimeout(() => setGone(true), 1300); return () => clearTimeout(id); } }, [done]);
    if (gone) return null;
    return (
        <div className={`mp-splash ${done ? 'mp-splash-out' : ''}`}>
            <div className="mp-splash-core">
                <span className="mp-ring mp-r1"></span><span className="mp-ring mp-r2"></span>
                <div className="mp-logo">
                    <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
            </div>
            <div className="mp-splash-title">MintPip</div>
            <div className="mp-splash-sub">Preparing your dashboard</div>
            <div className="mp-bar"><i></i></div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Funded-account tracking (stored in this browser; trades are matched to an account by date range)
// ---------------------------------------------------------------------------
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fm = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const HEALTH = {
    safe: { label: 'Safe', color: '#22C55E' }, caution: { label: 'Caution', color: '#F59E0B' },
    danger: { label: 'Danger', color: '#F97316' }, breach: { label: 'Breach risk', color: '#F43F5E' }
};

function computeAccount(acc, allTrades) {
    const B0 = Number(acc.startBalance) || 0;
    const list = allTrades; // already scoped to this account
    let bal = B0, peak = B0;
    const byDay = {};
    list.forEach(t => { bal += t.pnl; peak = Math.max(peak, bal); byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
    const dd = B0 * (Number(acc.maxDDPct) || 0) / 100;
    const floor = acc.ddType === 'trailing' ? peak - dd : acc.ddType === 'locked' ? Math.min(B0, peak - dd) : B0 - dd;
    const dailyLimit = B0 * (Number(acc.dailyLossPct) || 0) / 100;
    const todayPnl = byDay[todayKey()] || 0;
    const dailyUsed = Math.max(0, -todayPnl);
    const target = B0 * (Number(acc.targetPct) || 0) / 100;
    const profit = bal - B0;
    const bestDay = Math.max(0, ...Object.values(byDay));
    const dailyRatio = dailyLimit ? dailyUsed / dailyLimit : 0;
    const ddRatio = dd ? 1 - (bal - floor) / dd : 0;
    const worst = Math.max(dailyRatio, ddRatio);
    return {
        B0, list, bal, peak, floor, dd, dailyLimit, todayPnl, dailyUsed, dailyLeft: dailyLimit - dailyUsed, ddLeft: bal - floor,
        dailyRatio, ddRatio, target, profit, days: Object.keys(byDay).length, bestDay,
        consPct: profit > 0 ? (bestDay / profit) * 100 : 0,
        targetProgress: target ? Math.max(0, Math.min(100, (profit / target) * 100)) : 0,
        health: worst >= 1 ? 'breach' : worst >= 0.75 ? 'danger' : worst >= 0.5 ? 'caution' : 'safe'
    };
}

function AccountGuard({ account, trades }) {
    if (!account) return null;
    const m = computeAccount(account, trades);
    if (m.health === 'safe') return null;
    const h = HEALTH[m.health];
    return (
        <div className="flex items-start gap-3 p-4 rounded-2xl border text-xs font-bold" style={{ background: `${h.color}1A`, borderColor: `${h.color}66`, color: h.color }}>
            <Ico n="alert" className="w-4 h-4 mt-0.5" />
            <span>{account.name}: {h.label} — daily loss {Math.round(m.dailyRatio * 100)}% used ({fm(Math.max(0, m.dailyLeft))} left today), drawdown {Math.round(Math.max(0, m.ddRatio) * 100)}% used ({fm(Math.max(0, m.ddLeft))} above the floor).</span>
        </div>
    );
}

const ACC_FIELDS = [
    ['name', 'Account name', 'text'], ['firm', 'Firm', 'text'], ['startBalance', 'Starting balance ($)', 'number'], ['startDate', 'Start date', 'date'],
    ['endDate', 'End date (optional)', 'date'], ['dailyLossPct', 'Daily loss limit (%)', 'number'], ['maxDDPct', 'Max drawdown (%)', 'number'],
    ['targetPct', 'Profit target (%, 0 = none)', 'number'], ['minDays', 'Min trading days', 'number'],
    ['consistencyPct', 'Consistency: best day ≤ % of profit (0 = off)', 'number'], ['profitSplit', 'Profit split (%)', 'number'], ['fee', 'Challenge fee ($)', 'number']
];
const ACC_EMPTY = { name: '', firm: '', type: 'Challenge', phase: 'Phase 1', status: 'Active', startBalance: '', startDate: todayKey(), endDate: '', dailyLossPct: 5, maxDDPct: 10, ddType: 'static', targetPct: 10, minDays: 0, consistencyPct: 0, profitSplit: 80, fee: 0, payouts: [] };
const accInput = 'w-full px-3 py-2 rounded-xl border text-sm bg-[#141B30] border-[#232C45] text-slate-200';

function Meter({ title, main, sub, ratio, color }) {
    const pct = Math.max(0, Math.min(100, ratio * 100));
    return (
        <div className="p-5 rounded-2xl border bg-[#0E1426] border-[#232C45]">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{title}</div>
            <div className="text-2xl font-black mt-2 text-white">{main}</div>
            <div className="h-2.5 rounded-full mt-3 overflow-hidden" style={{ background: 'rgba(148,163,184,0.18)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 1.2s cubic-bezier(.22,1,.36,1)' }}></div>
            </div>
            <div className="text-[11px] mt-2 text-slate-400">{sub}</div>
        </div>
    );
}

const SectionHead = ({ title, sub, right }) => (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
            <h3 className="text-sm font-black text-white">{title}</h3>
            {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
        {right}
    </div>
);

function AccountsPanel({ accounts, onSave, onDelete, onSelect, activeId, trades, isLive }) {
    const [form, setForm] = useState(null); // null = closed
    const [payout, setPayout] = useState({ date: todayKey(), amount: '' });
    const acc = accounts.find(a => a.id === activeId) || (activeId === '__legacy' ? null : accounts[0]);
    const m = acc ? computeAccount(acc, trades) : null;

    const save = async () => {
        if (!form.name.trim() || !(Number(form.startBalance) > 0)) { alert('Please enter an account name and a starting balance.'); return; }
        await onSave(form);
        setForm(null);
    };
    const remove = async () => {
        if (!window.confirm(`Delete account "${acc.name}"? (Only possible when it has no trades.)`)) return;
        await onDelete(acc);
    };
    const addPayout = () => {
        const amt = parseFloat(payout.amount);
        if (!(amt > 0)) return;
        onSave({ ...acc, payouts: [...(acc.payouts || []), { date: payout.date, amount: amt }] });
        setPayout({ date: todayKey(), amount: '' });
    };

    const sumPayouts = (a) => (a.payouts || []).reduce((s, p) => s + p.amount, 0);
    const totalFees = accounts.reduce((s, a) => s + (Number(a.fee) || 0), 0);
    const totalPayouts = accounts.reduce((s, a) => s + sumPayouts(a), 0);
    const h = m ? HEALTH[m.health] : null;
    const netCls = (v) => v >= 0 ? 'text-emerald-400' : 'text-rose-400';
    const card = 'p-5 rounded-2xl border bg-[#0E1426] border-[#232C45]';
    const lbl = 'text-[10px] font-extrabold uppercase tracking-widest text-slate-400';

    return (
        <div className="space-y-10">
            {!isLive && <div className="p-4 rounded-2xl border text-xs font-bold bg-amber-500/10 border-amber-500/30 text-amber-300">You are viewing the Backtest data. Switch to Forward Test to see funded-account metrics.</div>}

            {form && (
                <section>
                    <SectionHead title={form.id ? 'Edit account' : 'New funded account'} sub="Enter the rules from your firm so MintPip can track the limits for you." />
                    <div className={`${card} space-y-4`}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                            {ACC_FIELDS.map(([k, label, type]) => (
                                <label key={k} className="block"><span className="block font-bold mb-1 text-slate-400">{label}</span>
                                    <input type={type} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={accInput} />
                                </label>
                            ))}
                            {[['type', 'Account type', ['Challenge', 'Instant', 'Funded']], ['phase', 'Phase', ['Phase 1', 'Phase 2', 'Funded']], ['ddType', 'Drawdown type', ['static', 'trailing', 'locked']], ['status', 'Status', ['Active', 'Passed', 'Breached']]].map(([k, label, opts]) => (
                                <label key={k} className="block"><span className="block font-bold mb-1 text-slate-400">{label}{k === 'ddType' ? ' (locked = trails, stops at start balance)' : ''}</span>
                                    <select value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={accInput}>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select>
                                </label>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <button onClick={save} className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#6366F1] text-white">Save account</button>
                            <button onClick={() => setForm(null)} className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-800 text-white">Cancel</button>
                        </div>
                    </div>
                </section>
            )}

            {!acc && !form && accounts.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">Pick an account from the dropdown above to see its rules, limits and payouts.</p>
                    <button onClick={() => setForm({ ...ACC_EMPTY })} className="px-4 py-2 rounded-xl text-xs font-bold bg-[#6366F1] text-white">+ New account</button>
                </div>
            )}

            {!acc && !form && accounts.length === 0 && (
                <div className="p-10 rounded-2xl border text-center bg-[#0E1426] border-[#232C45]">
                    <div className="text-lg font-black text-white">Track your funded accounts</div>
                    <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">Add an account with its firm rules (daily loss, max drawdown, profit target) and MintPip will show how much room you have left, every day.</p>
                    <button onClick={() => setForm({ ...ACC_EMPTY })} className="mt-4 px-5 py-2.5 rounded-xl text-xs font-bold bg-[#6366F1] text-white">+ Add your first account</button>
                </div>
            )}

            {acc && m && (<>
                {/* 1. Who is this account */}
                <section>
                    <SectionHead title="Account details" sub="Identity and current status"
                        right={<button onClick={() => setForm({ ...ACC_EMPTY })} className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#6366F1] text-white">+ New account</button>} />
                    <div className={`${card} flex flex-wrap items-center justify-between gap-4`} style={{ borderLeft: `3px solid ${acc.color || '#6366F1'}` }}>
                        <div>
                            <div className="text-lg font-black text-white">{acc.name}</div>
                            <div className="text-xs text-slate-400 mt-1">{acc.firm || 'No firm set'} · {acc.type} · {acc.phase} · {acc.status} · since {acc.startDate}</div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="px-3 py-1.5 rounded-full text-[11px] font-extrabold" style={{ background: `${h.color}22`, color: h.color, border: `1px solid ${h.color}66` }}>● {h.label}</span>
                            <button onClick={() => setForm({ ...acc })} className="px-3 py-2 rounded-xl text-xs font-bold bg-[#141B30] border border-[#232C45] text-slate-300"><Ico n="edit" /> Edit</button>
                            <button onClick={remove} className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400"><Ico n="trash" /> Delete</button>
                        </div>
                    </div>
                </section>

                {/* 2. Limits and rules */}
                <section>
                    <SectionHead title="Limits & progress" sub="How much room is left under this account's rules" />
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        <Meter title="Daily loss" main={`${fm(m.dailyUsed)} / ${fm(m.dailyLimit)}`} ratio={m.dailyRatio} color={m.dailyRatio >= 0.75 ? '#F43F5E' : m.dailyRatio >= 0.5 ? '#F59E0B' : '#22C55E'}
                            sub={`${fm(Math.max(0, m.dailyLeft))} left today · today ${m.todayPnl >= 0 ? '+' : ''}${fm(m.todayPnl)}`} />
                        <Meter title={`Max drawdown (${acc.ddType})`} main={`${fm(Math.max(0, m.ddLeft))} left`} ratio={Math.max(0, m.ddRatio)} color={m.ddRatio >= 0.75 ? '#F43F5E' : m.ddRatio >= 0.5 ? '#F59E0B' : '#22C55E'}
                            sub={`Floor ${fm(m.floor)} · balance ${fm(m.bal)}`} />
                        <Meter title="Profit target" main={m.target ? `${m.targetProgress.toFixed(0)}%` : 'No target'} ratio={m.targetProgress / 100} color="#6366F1"
                            sub={m.target ? `${fm(m.profit)} of ${fm(m.target)}` : `Profit ${fm(m.profit)}`} />
                        <div className={card}>
                            <div className={lbl}>Rules check</div>
                            <div className="mt-3 space-y-2.5 text-xs text-slate-300">
                                <div className="flex justify-between"><span>Trading days</span><b className={Number(acc.minDays) && m.days < Number(acc.minDays) ? 'text-amber-400' : 'text-emerald-400'}>{m.days}{Number(acc.minDays) ? ` / ${acc.minDays}` : ''}</b></div>
                                {Number(acc.consistencyPct) > 0 ? (
                                    <div className="flex justify-between"><span>Best day / profit</span><b className={m.consPct > Number(acc.consistencyPct) ? 'text-rose-400' : 'text-emerald-400'}>{m.consPct.toFixed(0)}% (max {acc.consistencyPct}%)</b></div>
                                ) : <div className="flex justify-between"><span>Consistency rule</span><b className="text-slate-400">Off</b></div>}
                                <div className="flex justify-between"><span>Best day</span><b className="text-white">{fm(m.bestDay)}</b></div>
                                <div className="flex justify-between"><span>Peak balance</span><b className="text-white">{fm(m.peak)}</b></div>
                            </div>
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed mt-3">
                        Only closed trades saved against this account are counted, so floating loss is not included. Treat these meters as a guide and rely on your firm's own dashboard for the official limits.
                    </p>
                </section>

                {/* 3. Payouts for THIS account */}
                <section>
                    <SectionHead title="Payouts" sub={`Fee and payouts for ${acc.name} only`} />
                    <div className={`${card} space-y-5`}>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div><div className={lbl}>Challenge fee</div><div className="text-white font-black text-xl mt-1">{fm(Number(acc.fee) || 0)}</div></div>
                            <div><div className={lbl}>Payouts received</div><div className="text-emerald-400 font-black text-xl mt-1">{fm(sumPayouts(acc))}</div></div>
                            <div><div className={lbl}>Net for this account</div><div className={`font-black text-xl mt-1 ${netCls(sumPayouts(acc) - (Number(acc.fee) || 0))}`}>{fm(sumPayouts(acc) - (Number(acc.fee) || 0))}</div></div>
                        </div>
                        <div className="pt-5 border-t border-[#232C45]">
                            <div className="text-xs font-bold text-white mb-3">Record a payout</div>
                            <div className="flex flex-wrap items-end gap-2">
                                <label className="text-xs"><span className="block font-bold mb-1 text-slate-400">Payout date</span><input type="date" value={payout.date} onChange={(e) => setPayout({ ...payout, date: e.target.value })} className={accInput} /></label>
                                <label className="text-xs"><span className="block font-bold mb-1 text-slate-400">Amount received ($)</span><input type="number" value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} className={accInput} /></label>
                                <button onClick={addPayout} className="px-4 py-2.5 rounded-xl text-xs font-bold bg-[#6366F1] text-white">Add payout</button>
                            </div>
                            {(acc.payouts || []).length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-4">
                                    {acc.payouts.map(p => (
                                        <span key={p.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                                            {p.date} · {fm(p.amount)}
                                            <button onClick={() => onSave({ ...acc, payouts: acc.payouts.filter(x => x.id !== p.id) })} className="opacity-70 hover:opacity-100" aria-label="Remove payout"><Ico n="x" className="w-3 h-3" /></button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* 4. Portfolio-wide totals, kept apart from the selected account */}
                <section>
                    <SectionHead title="All accounts" sub="Fees and payouts across every account. Click a row to switch to it." />
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                        <div className={card}><div className={lbl}>Fees paid</div><div className="text-white font-black text-xl mt-1">{fm(totalFees)}</div></div>
                        <div className={card}><div className={lbl}>Payouts received</div><div className="text-emerald-400 font-black text-xl mt-1">{fm(totalPayouts)}</div></div>
                        <div className={card}><div className={lbl}>Net (payouts − fees)</div><div className={`font-black text-xl mt-1 ${netCls(totalPayouts - totalFees)}`}>{fm(totalPayouts - totalFees)}</div></div>
                    </div>
                    <div className="rounded-2xl border bg-[#0E1426] border-[#232C45] overflow-x-auto">
                        <table className="w-full text-xs min-w-[520px]">
                            <thead>
                                <tr className="text-left text-slate-400">
                                    <th className="px-5 py-3 font-bold">Account</th>
                                    <th className="px-3 py-3 font-bold">Status</th>
                                    <th className="px-3 py-3 font-bold text-right">Fee</th>
                                    <th className="px-3 py-3 font-bold text-right">Payouts</th>
                                    <th className="px-5 py-3 font-bold text-right">Net</th>
                                </tr>
                            </thead>
                            <tbody>
                                {accounts.map(a => {
                                    const pay = sumPayouts(a), fee = Number(a.fee) || 0;
                                    return (
                                        <tr key={a.id} onClick={() => onSelect && onSelect(a.id)} className={`cursor-pointer border-t border-[#232C45] transition ${a.id === acc.id ? 'bg-indigo-500/10' : 'hover:bg-white/5'}`}>
                                            <td className="px-5 py-3">
                                                <span className="inline-flex items-center gap-2 font-bold text-white"><i style={{ width: 8, height: 8, borderRadius: 99, background: a.color || '#6366F1', display: 'inline-block' }}></i>{a.name}</span>
                                                <span className="text-slate-400"> · {a.type}</span>
                                            </td>
                                            <td className="px-3 py-3 text-slate-300">{a.status}</td>
                                            <td className="px-3 py-3 text-right text-slate-300">{fm(fee)}</td>
                                            <td className="px-3 py-3 text-right text-emerald-400 font-bold">{fm(pay)}</td>
                                            <td className={`px-5 py-3 text-right font-black ${netCls(pay - fee)}`}>{fm(pay - fee)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            </>)}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Per-account risk rules (Analytics tab). Each funded account carries its own limits;
// Backtest / unassigned trades fall back to one browser-saved rule set.
// ---------------------------------------------------------------------------
const effectiveRisk = (acc, g) => {
    if (acc) {
        const B0 = toNum(acc.startBalance);
        return {
            startBal: B0,
            dailyLimit: B0 * toNum(acc.dailyLossPct) / 100,
            weeklyLimit: B0 * toNum(acc.weeklyLossPct) / 100,
            ddLimit: B0 * toNum(acc.maxDDPct) / 100,
            riskPct: toNum(acc.riskTargetPct),
            maxStreak: toNum(acc.maxLossStreak)
        };
    }
    return {
        startBal: toNum(g.startingBalance), dailyLimit: toNum(g.dailyLossLimit), weeklyLimit: toNum(g.weeklyLossLimit),
        ddLimit: 0, riskPct: toNum(g.riskTargetPct), maxStreak: toNum(g.maxLossStreak)
    };
};

const RISK_FIELDS_ACC = [
    ['startBalance', 'Starting balance ($)', 'e.g. 10000'],
    ['dailyLossPct', 'Daily loss limit (% of start)', 'e.g. 5'],
    ['weeklyLossPct', 'Weekly loss limit (% of start)', 'e.g. 8'],
    ['maxDDPct', 'Max drawdown (% of start)', 'e.g. 10'],
    ['riskTargetPct', 'Risk per trade (% of start)', 'e.g. 1'],
    ['maxLossStreak', 'Warn after N losses in a row', 'e.g. 3']
];
const RISK_FIELDS_GLOBAL = [
    ['startingBalance', 'Starting balance ($)', 'e.g. 10000'],
    ['dailyLossLimit', 'Daily loss limit ($)', 'e.g. 300'],
    ['weeklyLossLimit', 'Weekly loss limit ($)', 'e.g. 600'],
    ['riskTargetPct', 'Risk per trade (% of start)', 'e.g. 1'],
    ['maxLossStreak', 'Warn after N losses in a row', 'e.g. 3']
];

function RuleGauge({ label, value, limit, ratio, sub, invert }) {
    const off = !(limit > 0);
    const r = Math.max(0, Math.min(1, ratio || 0));
    const color = off ? '#475569' : r >= 1 ? '#F43F5E' : r >= 0.75 ? '#F97316' : r >= 0.5 ? '#F59E0B' : '#34D399';
    return (
        <div className="p-4 rounded-xl border bg-[#0B1020]/70 border-[#232C45] min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{label}</div>
            <div className="mt-2 text-sm font-black text-white truncate">{off ? <span className="text-slate-500 font-bold">Not set</span> : value}</div>
            <div className="h-1.5 rounded-full mt-2.5 overflow-hidden" style={{ background: 'rgba(148,163,184,0.16)' }}>
                <div className="h-full rounded-full" style={{ width: `${off ? 0 : r * 100}%`, background: color, transition: 'width .8s cubic-bezier(.22,1,.36,1)' }}></div>
            </div>
            <div className="text-[11px] mt-2 text-slate-500 truncate">{off ? 'Open "Edit rules" to enable' : sub}</div>
        </div>
    );
}

function RiskRulesPanel({ acc, global, risk, trades, analytics, isLive, onSaveAccount, onSaveGlobal }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState({});
    const fields = acc ? RISK_FIELDS_ACC : RISK_FIELDS_GLOBAL;
    useEffect(() => { setEditing(false); }, [acc ? acc.id : 'global']); // switching account closes the editor

    const startEdit = () => { const src = acc || global; const d = {}; fields.forEach(([k]) => { d[k] = src[k] ?? ''; }); setDraft(d); setEditing(true); };
    const save = async () => {
        if (acc) {
            if (!(toNum(draft.startBalance) > 0)) { alert('Starting balance must be greater than 0.'); return; }
            const body = { ...acc };
            fields.forEach(([k]) => { body[k] = draft[k] === '' ? 0 : Number(draft[k]); });
            await onSaveAccount(body);
        } else {
            onSaveGlobal({ ...global, ...draft });
        }
        setEditing(false);
    };

    // live usage
    const todayK = localDateKey(), weekK = getWeekStartKey();
    const todayPnl = trades.filter(t => tradeDateKey(t) === todayK).reduce((x, t) => x + t.pnl, 0);
    const weekPnl = trades.filter(t => tradeDateKey(t) >= weekK).reduce((x, t) => x + t.pnl, 0);
    const m = acc ? computeAccount(acc, trades) : null;
    const dailyUsed = Math.max(0, -todayPnl), weeklyUsed = Math.max(0, -weekPnl);
    const lossStreak = analytics.streakType === 'Loss' ? analytics.streakLen : 0;
    const avgLossPct = risk.startBal > 0 ? analytics.avgLoss / risk.startBal * 100 : 0;
    const accent = acc ? (acc.color || '#6366F1') : '#8B5CF6';
    const inp = 'w-full px-3 py-2 rounded-xl border text-sm font-bold bg-[#141B30] border-[#232C45] text-white focus:outline-none focus:border-indigo-500/60';

    return (
        <div className="rounded-2xl border bg-[#141B30]/60 border-[#232C45] overflow-hidden" style={{ borderLeft: `3px solid ${accent}` }}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                    <div className="text-sm font-black text-white flex items-center gap-2">
                        <Ico n="shield" className="w-4 h-4 text-slate-400" />
                        Risk rules{acc ? <span className="text-slate-400 font-bold"> · {acc.name}</span> : <span className="text-slate-400 font-bold"> · {isLive ? 'Unassigned trades' : 'Backtest'}</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                        {acc ? 'Limits belong to this account only and are saved with it.' : 'Shared rule set for trades without a funded account. Saved in this browser.'}
                    </div>
                </div>
                {!editing
                    ? <button onClick={startEdit} className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#0E1426] border border-[#232C45] text-slate-200 hover:bg-[#19223A] transition"><Ico n="edit" /> Edit rules</button>
                    : <div className="flex gap-2">
                        <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition">Cancel</button>
                        <button onClick={save} className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition">Save rules</button>
                    </div>}
            </div>

            {editing ? (
                <div className="px-5 pb-5 border-t border-[#232C45]/70 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {fields.map(([k, label, ph]) => (
                            <label key={k} className="block text-xs">
                                <span className="block font-bold mb-1 text-slate-400">{label}</span>
                                <input type="number" min="0" step="any" placeholder={ph} value={draft[k] ?? ''} onChange={(e) => setDraft(d => ({ ...d, [k]: e.target.value }))} className={inp} />
                            </label>
                        ))}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-3">Leave a field empty or 0 to turn that rule off.{acc ? ' Percentages are calculated from this account\'s starting balance.' : ''}</p>
                </div>
            ) : (
                <div className="px-5 pb-5 grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <RuleGauge label="Daily loss" limit={risk.dailyLimit} value={`${fmtMoney(dailyUsed)} / ${fmtMoney(risk.dailyLimit)}`}
                        ratio={risk.dailyLimit ? dailyUsed / risk.dailyLimit : 0} sub={`${fmtMoney(Math.max(0, risk.dailyLimit - dailyUsed))} left today`} />
                    <RuleGauge label="Weekly loss" limit={risk.weeklyLimit} value={`${fmtMoney(weeklyUsed)} / ${fmtMoney(risk.weeklyLimit)}`}
                        ratio={risk.weeklyLimit ? weeklyUsed / risk.weeklyLimit : 0} sub={`${fmtMoney(Math.max(0, risk.weeklyLimit - weeklyUsed))} left this week`} />
                    {acc
                        ? <RuleGauge label={`Max drawdown (${acc.ddType})`} limit={risk.ddLimit} value={`${fmtMoney(Math.max(0, m.ddLeft))} left`}
                            ratio={m.ddRatio} sub={`Floor ${fmtMoney(m.floor)} · balance ${fmtMoney(m.bal)}`} />
                        : <RuleGauge label="Max drawdown" limit={0} value="" ratio={0} sub="" />}
                    <RuleGauge label="Risk per trade" limit={risk.riskPct} value={`${avgLossPct.toFixed(2)}% avg loss / ${risk.riskPct}%`}
                        ratio={risk.riskPct ? avgLossPct / risk.riskPct : 0} sub="Average losing trade vs your target" />
                    <RuleGauge label="Loss streak alert" limit={risk.maxStreak} value={`${lossStreak} / ${risk.maxStreak} losses`}
                        ratio={risk.maxStreak ? lossStreak / risk.maxStreak : 0} sub={lossStreak ? 'Current run of losses' : 'No active loss streak'} />
                </div>
            )}
        </div>
    );
}


const TAB_META = {
    overview: ['Overview', 'Results and equity growth for the selected account'],
    analytics: ['Analytics', 'Risk, drawdown and where your edge comes from'],
    calendar: ['Calendar & Reports', 'Day-by-day results and reports'],
    accounts: ['Accounts', 'Rules, limits and payouts for each funded account']
};

function AccountDropdown({ accounts, activeId, setActiveId, trades, legacyCount, onManage }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const acc = accounts.find(a => a.id === activeId);
    const isLegacy = activeId === '__legacy';
    const dot = (c) => <i style={{ width: 9, height: 9, borderRadius: 99, background: c, display: 'inline-block', flexShrink: 0 }}></i>;
    const pick = (id) => { setActiveId(id); setOpen(false); };
    const row = (id, color, title, sub) => (
        <button key={id} type="button" role="option" aria-selected={id === activeId} onClick={() => pick(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition ${id === activeId ? 'bg-indigo-500/15' : 'hover:bg-white/5'}`}>
            {dot(color)}
            <span className="flex-1 min-w-0">
                <span className="block text-xs font-bold text-white truncate">{title}</span>
                <span className="block text-[11px] text-slate-400 truncate">{sub}</span>
            </span>
            {id === activeId && <Ico n="check" className="w-4 h-4 text-indigo-400" />}
        </button>
    );

    return (
        <div className="relative" ref={wrapRef}>
            <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
                className="flex items-center gap-3 w-full sm:w-[300px] pl-3.5 pr-3 py-2.5 rounded-xl border bg-[#141B30] border-[#232C45] hover:border-indigo-500/50 transition text-left"
                style={acc ? { borderLeft: `3px solid ${acc.color || '#6366F1'}` } : undefined}>
                <span className="flex-1 min-w-0">
                    <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Account</span>
                    <span className="block text-sm font-black text-white truncate">{isLegacy ? 'Unassigned trades' : acc ? acc.name : 'Select an account'}</span>
                    <span className="block text-[11px] text-slate-400 truncate">{acc ? `${acc.firm || 'No firm set'} · ${acc.type}` : isLegacy ? `${legacyCount} older trades` : 'Choose which account to view'}</span>
                </span>
                <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {open && (
                <div role="listbox" className="absolute right-0 left-0 sm:left-auto sm:w-[340px] mt-2 z-40 rounded-xl border bg-[#0E1426] border-[#232C45] p-1.5 max-h-[70vh] overflow-y-auto" style={{ boxShadow: '0 24px 60px -12px rgba(0,0,0,.55)' }}>
                    <div className="px-3 pt-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Funded accounts</div>
                    {accounts.map(a => row(a.id, a.color || '#6366F1', a.name, `${a.firm || 'No firm set'} · ${a.type} · ${a.status}`))}
                    {legacyCount > 0 && (<>
                        <div className="px-3 pt-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Other</div>
                        {row('__legacy', '#64748B', 'Unassigned trades', `${legacyCount} trades saved before accounts existed`)}
                    </>)}
                    <div className="mt-1.5 pt-1.5 border-t border-[#232C45]">
                        <button type="button" onClick={() => { setOpen(false); onManage(); }} className="w-full px-3 py-2.5 rounded-lg text-left text-xs font-bold text-indigo-400 hover:bg-white/5 transition">Manage accounts</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function PageToolbar({ tab, isLive, accounts, activeId, setActiveId, trades, legacyCount, onManage }) {
    const [title, sub] = TAB_META[tab] || TAB_META.overview;
    const hasAccounts = isLive && accounts.length > 0;
    const acc = hasAccounts ? accounts.find(a => a.id === activeId) : null;
    const m = acc ? computeAccount(acc, trades) : null;
    const h = m ? HEALTH[m.health] : null;
    const showStats = m && (tab === 'overview' || tab === 'analytics');
    const cell = (label, value, cls = 'text-white') => (
        <div className="min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">{label}</div>
            <div className={`text-base font-black mt-1 truncate ${cls}`}>{value}</div>
        </div>
    );
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h2 className="text-xl font-black text-white">{title}</h2>
                    <p className="text-xs text-slate-400 mt-1">{isLive ? sub : 'Backtest data. Not linked to a funded account.'}</p>
                </div>
                {hasAccounts && <AccountDropdown accounts={accounts} activeId={activeId} setActiveId={setActiveId} trades={trades} legacyCount={legacyCount} onManage={onManage} />}
            </div>
            {isLive && accounts.length === 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border bg-[#0E1426] border-[#232C45]">
                    <span className="text-xs font-bold text-slate-300">No funded account yet. Create one so every trade is tracked against its own rules.</span>
                    <button onClick={onManage} className="px-4 py-2 rounded-xl text-xs font-bold bg-[#6366F1] text-white">+ Create account</button>
                </div>
            )}
            {showStats && (
                <div className="px-5 py-4 rounded-2xl border bg-[#0E1426] border-[#232C45] grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-4 items-center">
                    {cell('Balance', fm(m.bal))}
                    {cell('Today', `${m.todayPnl >= 0 ? '+' : ''}${fm(m.todayPnl)}`, m.todayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}
                    {cell('Daily loss left', fm(Math.max(0, m.dailyLeft)))}
                    {cell('Drawdown room', fm(Math.max(0, m.ddLeft)))}
                    <div><span className="inline-flex px-3 py-1.5 rounded-full text-[11px] font-extrabold" style={{ background: `${h.color}22`, color: h.color, border: `1px solid ${h.color}66` }}>● {h.label}</span></div>
                </div>
            )}
            {isLive && activeId === '__legacy' && tab !== 'accounts' && (
                <p className="text-[11px] text-slate-400">Older trades saved before accounts existed. Edit a trade to assign it to an account.</p>
            )}
        </div>
    );
}

const EQ_RANGES = [['7', '7D'], ['30', '1M'], ['90', '3M'], ['all', 'All']];
const rangeTrades = (list, rng) => {
    if (rng === 'all') return list;
    const d = new Date();
    d.setDate(d.getDate() - Number(rng));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return list.filter(t => t.date >= key);
};

export default function App() {
    const [activeDatabase, setActiveDatabase] = useState('live'); // 'live' kinva 'backtest'
    const [trades, setTrades] = useState([]);
    const [currentTimeframeMode, setCurrentTimeframeMode] = useState('weekly');

    const [isDark, setIsDark] = useState(true);
    const [killzoneStatus, setKillzoneStatus] = useState("Checking Sri Lanka Killzone...");
    const [killzoneColor, setKillzoneColor] = useState("text-slate-400");
    const [syncStatus, setSyncStatus] = useState({ text: "Connecting to MongoDB...", dot: "bg-emerald-400", pulse: true });

    // Success / error notification toast state (Top position)
    const [appToast, setAppToast] = useState({ show: false, message: "", type: "success" });

    // 🌟 Advanced Add Trade Modal States
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isSubmittingTrade, setIsSubmittingTrade] = useState(false);

    const [newTradeForm, setNewTradeForm] = useState(getDefaultTradeForm);

    // Calendar States
    const [calMonth, setCalMonth] = useState(new Date().getMonth());
    const [calYear, setCalYear] = useState(new Date().getFullYear());

    // Custom Date Range States for PDF Report
    const [reportMode, setReportMode] = useState('month');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    // Modal States for Date Trades Popup
    const [isDateModalOpen, setIsDateModalOpen] = useState(false);
    const [selectedDateTrades, setSelectedDateTrades] = useState([]);
    const [selectedDateTitle, setSelectedDateTitle] = useState("");

    // Modal States for Trade Details & Charts
    const [isChartOpen, setIsChartOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [selectedTrade, setSelectedTrade] = useState(null);

    // AI report modal (state lives inside <AiReportModal />)
    const [isAiOpen, setIsAiOpen] = useState(false);

    const [activeItems, setActiveItems] = useState([]);
    const [activeImgIndex, setActiveImgIndex] = useState(0);
    const [modalTitle, setModalTitle] = useState("");

    // KPIs & Advanced Metrics
    const [kpiNetProfit, setKpiNetProfit] = useState("$0.00");
    const netNeg = String(kpiNetProfit).startsWith('-'); // red when the net PnL is negative, green otherwise
    const [kpiRMultiple, setKpiRMultiple] = useState("+0.0 R");
    const [kpiWinRate, setKpiWinRate] = useState("0%");
    const [kpiWinLossRatio, setKpiWinLossRatio] = useState("0W / 0L");
    const [kpiProfitFactor, setKpiProfitFactor] = useState("0.00");
    const [donutWins, setDonutWins] = useState(0);
    const [donutLosses, setDonutLosses] = useState(0);
    const [bestMonthName, setBestMonthName] = useState("N/A");
    const [bestMonthPnL, setBestMonthPnL] = useState("$0.00");
    const [monthMode, setMonthMode] = useState("best"); // "best" (a profitable month exists) | "worst" (every month is a loss)

    // Advanced Stats States
    const [statsData, setStatsData] = useState({
        totalWinners: 0, totalLosers: 0,
        bestWin: "$0.00", worstLoss: "$0.00",
        avgWin: "$0.00", avgLoss: "$0.00",
        maxConsecWins: 0, maxConsecLosses: 0,
        buyCount: 0, sellCount: 0, buyWinRate: 0, sellWinRate: 0
    });

    // Chart Refs
    const equityChartRef = useRef(null);
    const donutChartRef = useRef(null);
    const sessionChartRef = useRef(null);
    const timeframeChartRef = useRef(null);
    const sidePieChartRef = useRef(null);

    const equityInstance = useRef(null);
    const donutInstance = useRef(null);
    const sessionInstance = useRef(null);
    const timeframeInstance = useRef(null);
    const sidePieInstance = useRef(null);

    // 🌟 Result popup (save success / error / validation) + helpers for live refresh
    const [resultPopup, setResultPopup] = useState({ show: false, type: 'success', title: '', message: '', items: [] });
    const [formKey, setFormKey] = useState(0); // remounts file inputs after a successful save
    const popupTimerRef = useRef(null);
    const isDarkRef = useRef(true);
    const timeframeModeRef = useRef('weekly');
    const lastDataSigRef = useRef(null);
    const fetchSeqRef = useRef(0);
    isDarkRef.current = isDark;
    timeframeModeRef.current = currentTimeframeMode;

    // <Ico n="edit" /> Edit / <Ico n="trash" /> Delete, ⚙️ settings, 📒 journal filters, 📶 connection state
    const [editingPageId, setEditingPageId] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState({ show: false, trade: null });
    const [isDeleting, setIsDeleting] = useState(false);
    // Funded accounts + which one is selected (declared early: risk rules depend on them)
    const [accounts, setAccounts] = useState([]);
    const [activeAccountId, setActiveAccountId] = useState(() => { try { return localStorage.getItem('mp-active-account') || ''; } catch (e) { return ''; } });
    const [settings, setSettings] = useState(() => {
        try {
            const raw = localStorage.getItem('mintpip_settings');
            return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
        } catch (_) { return DEFAULT_SETTINGS; }
    });
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [syncFailed, setSyncFailed] = useState(false);
    const fetchTradesRef = useRef(null);

    const activeAcc = activeDatabase === 'live' ? (accounts.find(a => a.id === activeAccountId) || null) : null;
    const risk = useMemo(() => effectiveRisk(activeAcc, settings), [activeAcc, settings]);
    const startBal = risk.startBal;
    const analytics = useMemo(() => computeAnalytics(trades, startBal), [trades, startBal]);
    const breakdowns = useMemo(() => ({
        score: groupStats(trades, t => t.rulesCount > 0 ? `${t.rulesCount}/5 rules followed` : '').sort((a, b) => parseInt(b.label) - parseInt(a.label)),
        psych: groupStats(trades, t => t.psych || []).sort((a, b) => b.trades - a.trades),
        session: groupStats(trades, t => t.session).sort((a, b) => b.trades - a.trades),
        pair: groupStats(trades, t => t.pair).sort((a, b) => b.trades - a.trades),
        weekday: groupStats(trades, t => t.day).filter(r => WEEKDAYS.includes(r.label)).sort((a, b) => WEEKDAYS.indexOf(a.label) - WEEKDAYS.indexOf(b.label)),
        fvg: groupStats(trades, t => t.fvgTap ? `15m FVG tap: ${t.fvgTap}` : ''),
        smt: groupStats(trades, t => t.smt ? (t.smt.toUpperCase().startsWith('YES') ? 'SMT divergence: Yes' : 'SMT divergence: No') : ''),
        rules: ruleEdgeStats(trades)
    }), [trades]);

    // 🚨 Daily / weekly loss limits and loss-streak warnings (live database only)
    const limitAlerts = useMemo(() => {
        if (activeDatabase !== 'live') return [];
        const alerts = [];
        const todayKey = localDateKey();
        const weekKey = getWeekStartKey();
        const todayPnL = trades.filter(t => tradeDateKey(t) === todayKey).reduce((a, t) => a + t.pnl, 0);
        const weekPnL = trades.filter(t => tradeDateKey(t) >= weekKey).reduce((a, t) => a + t.pnl, 0);
        const check = (label, pnl, limit, tail) => {
            if (limit > 0 && pnl < 0) {
                const used = -pnl / limit;
                if (used >= 1) alerts.push({ level: 'danger', text: `${label} loss limit reached: ${fmtMoney(pnl)} (limit ${fmtMoney(-limit)}). ${tail}` });
                else if (used >= 0.8) alerts.push({ level: 'warn', text: `${label} loss is at ${(used * 100).toFixed(0)}% of your limit: ${fmtMoney(pnl)} of ${fmtMoney(-limit)}.` });
            }
        };
        check('Daily', todayPnL, risk.dailyLimit, 'Stop trading for today.');
        check('Weekly', weekPnL, risk.weeklyLimit, 'Stop trading for this week.');
        const maxStreak = risk.maxStreak;
        if (maxStreak > 0 && analytics.streakType === 'Loss' && analytics.streakLen >= maxStreak) {
            alerts.push({ level: 'danger', text: `${analytics.streakLen} losses in a row (your limit is ${maxStreak}). Step away and review before the next trade.` });
        }
        return alerts;
    }, [trades, risk, analytics, activeDatabase]);

    // 🗂️ Top tabs (Overview / Analytics / Calendar)
    const [activeTab, setActiveTab] = useState(() => {
        try {
            const v = localStorage.getItem('mintpip_tab');
            return ['overview', 'analytics', 'calendar', 'accounts'].includes(v) ? v : 'overview';
        } catch (_) { return 'overview'; }
    });
    useEffect(() => {
        try { localStorage.setItem('mintpip_tab', activeTab); } catch (_) { }
        if (trades.length > 0) {
            const id = setTimeout(() => renderCharts(trades), 60); // canvases are new elements after a tab switch
            return () => clearTimeout(id);
        }
    }, [activeTab]);

    const closeResultPopup = () => {
        if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
        setResultPopup(prev => ({ ...prev, show: false }));
    };

    // Closing the Add Trade window (any way: X, Cancel, outside click, Esc, after save) clears every input
    // 🧮 Auto-calculate PLANE TARGET (1:2) pips whenever Entry / SL / Pair change
    useEffect(() => {
        const next = buildPlaneTarget(newTradeForm.entryPrice, newTradeForm.slPrice, newTradeForm.pairDirection);
        setNewTradeForm(prev => prev.planeTarget === next ? prev : { ...prev, planeTarget: next });
    }, [newTradeForm.entryPrice, newTradeForm.slPrice, newTradeForm.pairDirection]);

    const closeAddModal = () => {
        setIsAddModalOpen(false);
        setEditingPageId(null);
        setNewTradeForm(getDefaultTradeForm());
        setFormKey(k => k + 1);
    };

    const showResultPopup = (type, title, message, items = [], autoCloseMs = 0) => {
        if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
        setResultPopup({ show: true, type, title, message, items });
        if (autoCloseMs > 0) {
            popupTimerRef.current = setTimeout(() => {
                setResultPopup(prev => ({ ...prev, show: false }));
            }, autoCloseMs);
        }
    };

    const showToast = (message, type = 'success') => {
        setAppToast({ show: true, message, type });
        setTimeout(() => {
            setAppToast(prev => ({ ...prev, show: false }));
        }, 3500);
    };

    const playSound = (type) => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'win') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, ctx.currentTime);
                osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.start();
                osc.stop(ctx.currentTime + 0.4);
            } else {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(150, ctx.currentTime);
                osc.frequency.setValueAtTime(100, ctx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                osc.start();
                osc.stop(ctx.currentTime + 0.3);
            }
        } catch (e) { }
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsChartOpen(false);
                setIsDetailsOpen(false);
                setIsAiOpen(false);
                setIsDateModalOpen(false);
                closeAddModal();
                setResultPopup(prev => ({ ...prev, show: false }));
            }

            if (isChartOpen && activeItems.length > 1) {
                if (e.key === 'ArrowRight') {
                    setActiveImgIndex(prev => (prev === activeItems.length - 1 ? 0 : prev + 1));
                } else if (e.key === 'ArrowLeft') {
                    setActiveImgIndex(prev => (prev === 0 ? activeItems.length - 1 : prev - 1));
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isChartOpen, activeItems.length]);

    useEffect(() => {
        if (localStorage.getItem('theme') === 'light') {
            setIsDark(false);
            document.documentElement.classList.remove('dark');
        } else {
            setIsDark(true);
            document.documentElement.classList.add('dark');
        }

        const timer = setInterval(() => {
            const now = new Date();
            const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
            const lkTime = new Date(utcTime + (3600000 * 5.5));
            const timeNum = lkTime.getHours() + lkTime.getMinutes() / 60;

            if (timeNum >= 12.5 && timeNum < 13.5) {
                setKillzoneStatus("London Silver Bullet Active");
                setKillzoneColor("text-emerald-400 font-bold");
            } else if (timeNum >= 19.5 && timeNum < 20.5) {
                setKillzoneStatus("New York Silver Bullet Active");
                setKillzoneColor("text-emerald-400 font-bold");
            } else {
                setKillzoneStatus("Market Open (Outside Killzone)");
                setKillzoneColor("text-slate-400");
            }
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    // Auto-Refresh (Polling) every 15 seconds + Initial fetch
    useEffect(() => {
        setReportMode('month');
        setCustomStartDate('');
        setCustomEndDate('');
        setCalMonth(new Date().getMonth());
        setCalYear(new Date().getFullYear());

        lastDataSigRef.current = null; // force a fresh parse when switching database
        fetchTrades();

        // 🔄 Live sync: poll every 5s (only while the tab is visible) + refresh instantly when the tab regains focus
        const silentRefresh = () => {
            if (!document.hidden) fetchTrades(true);
        };

        const autoRefreshInterval = setInterval(silentRefresh, 5000);
        window.addEventListener('focus', silentRefresh);
        document.addEventListener('visibilitychange', silentRefresh);

        return () => {
            clearInterval(autoRefreshInterval);
            window.removeEventListener('focus', silentRefresh);
            document.removeEventListener('visibilitychange', silentRefresh);
        };
    }, [activeDatabase]);

    const toggleTheme = () => {
        setIsDark(prevDark => {
            const nextDark = !prevDark;
            if (nextDark) {
                document.documentElement.classList.add('dark');
                localStorage.setItem('theme', 'dark');
            } else {
                document.documentElement.classList.remove('dark');
                localStorage.setItem('theme', 'light');
            }
            return nextDark;
        });
    };

    useEffect(() => {
        if (trades.length > 0) {
            renderCharts(trades);
        }
    }, [isDark]);

    // 📶 Online / offline detection + PWA service worker
    useEffect(() => {
        const goOnline = () => { setIsOnline(true); if (fetchTradesRef.current) fetchTradesRef.current(true); };
        const goOffline = () => setIsOnline(false);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    useEffect(() => {
        if ('serviceWorker' in navigator && import.meta.env.PROD) {
            navigator.serviceWorker.register('/sw.js').catch(() => { });
        }
    }, []);

    // ---- Boot splash + command palette ----
    const [dataReady, setDataReady] = useState(false);
    const [minDone, setMinDone] = useState(false);
    const [failsafe, setFailsafe] = useState(false);
    const [cmdOpen, setCmdOpen] = useState(false);
    const [cmdQ, setCmdQ] = useState('');
    useEffect(() => {
        const a = setTimeout(() => setMinDone(true), 2600);
        const b = setTimeout(() => setFailsafe(true), 9000);
        return () => { clearTimeout(a); clearTimeout(b); };
    }, []);
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdQ(''); setCmdOpen(o => !o); }
            else if (e.key === 'Escape') setCmdOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    const bootDone = (dataReady && minDone) || failsafe;
    // Funded accounts (stored in MongoDB via /api/accounts)
    const ACCOUNT_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6'];
    const [legacyCount, setLegacyCount] = useState(0);
    const rawDocsRef = useRef(null);
    const accountRef = useRef({ id: '', hasAccounts: false });
    accountRef.current = { id: activeAccountId, hasAccounts: accounts.length > 0 };
    const normAcc = (a) => ({ ...a, id: a._id || a.id, payouts: (a.payouts || []).map(p => ({ ...p, id: p._id || p.id || `${p.date}-${p.amount}` })) });
    const scopeDocs = (docs, dbType) => {
        const { id, hasAccounts } = accountRef.current;
        if (dbType !== 'live' || !hasAccounts) return docs;
        return id === '__legacy' ? docs.filter(d => !d.accountId) : docs.filter(d => d.accountId === id);
    };
    const loadAccounts = async () => {
        try {
            const r = await fetch(`${API_BASE}/api/accounts`);
            const d = await r.json();
            if (Array.isArray(d)) setAccounts(d.map(normAcc));
        } catch (e) { /* accounts stay empty */ }
    };
    useEffect(() => { loadAccounts(); }, []);
    useEffect(() => {
        if (accounts.length && activeAccountId !== '__legacy' && !accounts.find(a => a.id === activeAccountId)) setActiveAccountId(accounts[0].id);
        try { localStorage.setItem('mp-active-account', activeAccountId); } catch (e) { }
    }, [accounts, activeAccountId]);
    useEffect(() => { // switching account re-scopes every tab (Overview, Analytics, Calendar, charts)
        const raw = rawDocsRef.current;
        if (raw) { parseMongoData(scopeDocs(raw.list, raw.dbType)); setLegacyCount(raw.dbType === 'live' ? raw.list.filter(d => !d.accountId).length : 0); }
    }, [activeAccountId, accounts]);
    const saveAccount = async (acc) => {
        const body = { ...acc, payouts: (acc.payouts || []).map(p => ({ date: p.date, amount: p.amount })) };
        delete body.id; delete body._id;
        if (!acc.id) body.color = ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length];
        try {
            const res = await fetch(acc.id ? `${API_BASE}/api/accounts/${acc.id}` : `${API_BASE}/api/accounts`, { method: acc.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const d = await res.json();
            if (!res.ok) { alert(d.error || 'Could not save the account.'); return; }
            const saved = normAcc(d.data);
            setAccounts(prev => acc.id ? prev.map(a => a.id === saved.id ? saved : a) : [...prev, saved]);
            if (!acc.id) setActiveAccountId(saved.id);
        } catch (e) { alert('Could not reach the server.'); }
    };
    const deleteAccount = async (acc) => {
        try {
            const res = await fetch(`${API_BASE}/api/accounts/${acc.id}`, { method: 'DELETE' });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) { alert(d.error || 'Could not delete the account.'); return; }
            const rest = accounts.filter(a => a.id !== acc.id);
            setAccounts(rest);
            if (activeAccountId === acc.id) setActiveAccountId(rest[0] ? rest[0].id : '');
        } catch (e) { alert('Could not reach the server.'); }
    };
    const resolveAccountId = () => newTradeForm.accountId ?? (accounts.length === 1 ? accounts[0].id : '');

    // Interface style: 'aurora' (indigo glass) or 'terminal' (flat, amber, monospace)
    const [uiTheme, setUiTheme] = useState(() => { try { return localStorage.getItem('mp-ui-theme') === 'terminal' ? 'terminal' : 'aurora'; } catch (e) { return 'aurora'; } });
    const uiThemeRef = useRef(uiTheme);
    uiThemeRef.current = uiTheme;
    const toggleUiTheme = () => setUiTheme(t => {
        const next = t === 'aurora' ? 'terminal' : 'aurora';
        try { localStorage.setItem('mp-ui-theme', next); } catch (e) { }
        return next;
    });
    const [eqRange, setEqRange] = useState('all'); // equity chart range: 7 / 30 / 90 days or all
    const eqRangeRef = useRef('all');
    eqRangeRef.current = eqRange;
    useEffect(() => { if (trades.length) renderCharts(trades); }, [eqRange]);
    useEffect(() => { if (trades.length) renderCharts(trades); }, [uiTheme]); // re-colour charts on style change
    // Switching Live <-> Backtest always lands on Overview, scrolled to the top
    const dbFirstRun = useRef(true);
    useEffect(() => {
        if (dbFirstRun.current) { dbFirstRun.current = false; return; }
        setActiveTab('overview');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [activeDatabase]);
    const fetchTrades = async (isSilent = false) => {
        try { await fetchTradesCore(isSilent); } finally { setDataReady(true); }
    };

    const fetchTradesCore = async (isSilent = false) => {
        if (!isSilent) {
            setSyncStatus({ text: `Fetching ${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} trades...`, dot: "bg-emerald-400", pulse: true });
        }
        const seq = ++fetchSeqRef.current; // ignore out-of-date responses (e.g. after switching database)
        try {
            const response = await fetch(`${API_BASE}/api/trades?type=${activeDatabase}`);
            if (seq !== fetchSeqRef.current) return;
            if (response.ok) {
                const fetchedData = await response.json();
                const list = Array.isArray(fetchedData) ? fetchedData : (fetchedData && (fetchedData.trades || fetchedData.data || fetchedData.results));
                if (seq !== fetchSeqRef.current) return;
                if (Array.isArray(list)) {
                    setSyncStatus({ text: `${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} MongoDB Connected`, dot: "bg-emerald-400", pulse: true });
                    setSyncFailed(false);

                    // Only re-render when the data really changed (silent background polling)
                    const signature = JSON.stringify(list);
                    const changed = !isSilent || signature !== lastDataSigRef.current;
                    lastDataSigRef.current = signature;
                    if (changed) {
                        rawDocsRef.current = { list, dbType: activeDatabase };
                        setLegacyCount(activeDatabase === 'live' ? list.filter(d => !d.accountId).length : 0);
                        parseMongoData(scopeDocs(list, activeDatabase));
                    }
                    if (!isSilent) {
                        playSound('win');
                        showToast(`MongoDB Connected Successfully! (${activeDatabase.toUpperCase()} Database synced)`, 'success');
                    }
                    return;
                }
            }
        } catch (e) { }

        if (seq === fetchSeqRef.current) setSyncFailed(true);
        if (!isSilent) {
            setSyncStatus({ text: "Database Sync Error", dot: "bg-rose-500", pulse: false });
            playSound('loss');
            showToast(`❌ Database Sync Failed! Please check API connection.`, 'error');
        }
    };

    fetchTradesRef.current = fetchTrades;

    // Reads a readable error message from a failed API response
    const readApiError = async (response) => {
        let msg = `The server responded with status ${response.status}.`;
        try {
            const raw = await response.text();
            try {
                const data = JSON.parse(raw);
                if (data && (data.error || data.message)) msg = data.error || data.message;
            } catch (_) {
                if (raw && !raw.trim().startsWith('<') && raw.length < 300) msg = raw.trim();
            }
        } catch (_) { }
        if (response.status === 404) msg += ' (API route not found: restart the server with the latest index.js.)';
        return msg;
    };

    // ✏️ Open the Add Trade window pre-filled with an existing trade
    const openEditTrade = (t) => {
        if (!t || !t.pageId) return;
        setEditingPageId(t.pageId);
        setNewTradeForm({
            ...getDefaultTradeForm(),
            accountId: t.accountId || '',
            date: tradeDateKey(t) || localDateKey(),
            pairDirection: t.pairTag || '',
            session: t.sessionRaw || '',
            fvgTap: t.fvgTap || '',
            smtDivergence: t.smt || '',
            executionRules: t.rules || [],
            psychologicalState: t.psych || [],
            entryPrice: t.entryPrice !== null && t.entryPrice !== undefined ? formatPrice5(t.entryPrice) : '',
            slPrice: t.slPrice !== null && t.slPrice !== undefined ? formatPrice5(t.slPrice) : '',
            lotSizeRisk: t.lotSize !== null && t.lotSize !== undefined ? String(t.lotSize) : '',
            outcome: t.outcomeRaw || t.result,
            profitAmount: t.profitAmount ? String(t.profitAmount) : '',
            lossAmount: t.lossAmount ? String(t.lossAmount) : '',
            note: t.rawNote || ''
        });
        setFormKey(k => k + 1);
        setIsDetailsOpen(false);
        setIsDateModalOpen(false);
        setIsAddModalOpen(true);
    };

    // 🗑️ Delete a trade from MongoDB
    const handleDeleteTrade = async () => {
        const t = confirmDelete.trade;
        if (!t || !t.pageId) return;
        setIsDeleting(true);
        try {
            const response = await fetch(`${API_BASE}/api/trades/${t.pageId}`, { method: 'DELETE' });
            if (response.ok) {
                setConfirmDelete({ show: false, trade: null });
                setIsDetailsOpen(false);
                setIsDateModalOpen(false);
                playSound('win');
                showResultPopup('success', 'Trade Deleted', 'The trade and its screenshots were permanently removed from your database.', [], 3500);
                fetchTrades(true);
            } else {
                playSound('loss');
                setConfirmDelete({ show: false, trade: null });
                showResultPopup('error', 'Failed to delete trade', await readApiError(response));
            }
        } catch (err) {
            playSound('loss');
            setConfirmDelete({ show: false, trade: null });
            showResultPopup('error', 'Network error', 'Could not reach the server. Please make sure the backend is running, then try again.');
        } finally {
            setIsDeleting(false);
        }
    };

    // ⬇️ Export the (filtered) journal rows as a CSV file
    const exportTradesCSV = (rows) => {
        const header = ['Date', 'Pair', 'Direction', 'Session', 'Setup Score', 'Rules Followed', 'Psychological State', 'Entry', 'SL', 'Lot Size & Risk', 'SL Pips', 'TP Pips', 'PnL', 'Result', 'Note'];
        const lines = rows.map(t => [
            tradeDateKey(t) || t.date, t.pair, t.direction, t.session, t.setupScore, (t.rules || []).join(' | '), (t.psych || []).join(' | '),
            t.entryPrice ?? '', t.slPrice ?? '', t.lotSize ?? '', t.slPips, t.tpPips, t.pnl, t.result, t.rawNote || ''
        ].map(csvCell).join(','));
        const csv = '﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n'); // BOM keeps Sinhala text readable in Excel
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mintpip-${activeDatabase}-trades-${localDateKey()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const saveGlobalRisk = (next) => {
        setSettings(next);
        try { localStorage.setItem('mintpip_settings', JSON.stringify(next)); } catch (_) { }
        showToast('Risk rules saved', 'success');
    };

    // 🌟 Submit new trade to the backend API (MongoDB + Cloudinary)
    const handleSaveNewTrade = async (e) => {
        e.preventDefault();

        // ✅ Validation: Entry Price, SL Price and both chart images are required
        const missing = [];
        if (!newTradeForm.date) missing.push('Date');
        if (!newTradeForm.pairDirection) missing.push('Pair & Direction');
        if (!newTradeForm.session) missing.push('Session & Time');
        if (!newTradeForm.fvgTap) missing.push('15 FVG Tap');
        if (!newTradeForm.smtDivergence) missing.push('SMT Divergence');
        if (!newTradeForm.outcome) missing.push('Outcome');
        if (activeDatabase === 'live' && !resolveAccountId()) missing.push(accounts.length ? 'Account (choose which funded account this trade belongs to)' : 'Account (create one in the Accounts tab first)');
        if (!String(newTradeForm.lotSizeRisk).trim()) missing.push('Lot Size & Risk');
        if (!String(newTradeForm.entryPrice).trim()) missing.push('Entry Price');
        if (!String(newTradeForm.slPrice).trim()) missing.push('SL Price');
        if (!editingPageId && newTradeForm.beforeChartFiles.length === 0 && countLinks(newTradeForm.beforeCharts) === 0) missing.push('Before Chart image (upload a file or paste a link)');
        if (!editingPageId && newTradeForm.afterChartFiles.length === 0 && countLinks(newTradeForm.afterCharts) === 0) missing.push('After Chart image (upload a file or paste a link)');

        if (missing.length > 0) {
            playSound('loss');
            showResultPopup('error', 'Missing required fields', 'Please complete the following before saving this trade:', missing);
            return;
        }

        setIsSubmittingTrade(true);

        // ✏️ Editing an existing trade: update the same MongoDB document (new images are added to the existing ones)
        if (editingPageId) {
            try {
                // multipart/form-data so new Before / After images can be uploaded while editing
                const editData = new FormData();
                ['date', 'pairDirection', 'session', 'fvgTap', 'smtDivergence', 'planeTarget', 'lotSizeRisk', 'outcome', 'profitAmount', 'lossAmount', 'note']
                    .forEach(k => editData.append(k, newTradeForm[k] ?? ''));
                editData.append('executionRules', JSON.stringify(newTradeForm.executionRules));
                editData.append('psychologicalState', JSON.stringify(newTradeForm.psychologicalState));
                editData.append('entryPrice', formatPrice5(newTradeForm.entryPrice));
                editData.append('slPrice', formatPrice5(newTradeForm.slPrice));
                editData.append('accountId', activeDatabase === 'live' ? resolveAccountId() : '');
                editData.append('beforeCharts', newTradeForm.beforeCharts); // optional new image URL(s)
                editData.append('afterCharts', newTradeForm.afterCharts);
                newTradeForm.beforeChartFiles.forEach(file => editData.append('beforeChart', file));
                newTradeForm.afterChartFiles.forEach(file => editData.append('afterChart', file));
                const response = await fetch(`${API_BASE}/api/trades/${editingPageId}`, { method: 'PATCH', body: editData });
                if (response.ok) {
                    playSound('win');
                    closeAddModal();
                    showResultPopup('success', 'Trade Updated!', 'Your changes were saved to MongoDB.', [], 3500);
                    fetchTrades(true);
                } else {
                    playSound('loss');
                    showResultPopup('error', 'Failed to update trade', await readApiError(response));
                }
            } catch (err) {
                playSound('loss');
                showResultPopup('error', 'Network error', 'Could not reach the server. Please make sure the backend is running, then try again.');
            } finally {
                setIsSubmittingTrade(false);
            }
            return;
        }

        try {
            const formData = new FormData();
            formData.append('type', activeDatabase); // 'live' or 'backtest'
            formData.append('accountId', activeDatabase === 'live' ? resolveAccountId() : '');
            formData.append('databaseType', activeDatabase);

            // Text fields
            formData.append('date', newTradeForm.date);
            formData.append('pairDirection', newTradeForm.pairDirection);
            formData.append('session', newTradeForm.session);
            formData.append('fvgTap', newTradeForm.fvgTap);
            formData.append('smtDivergence', newTradeForm.smtDivergence);
            formData.append('entryPrice', formatPrice5(newTradeForm.entryPrice));
            formData.append('slPrice', formatPrice5(newTradeForm.slPrice));
            formData.append('planeTarget', newTradeForm.planeTarget);
            formData.append('lotSizeRisk', newTradeForm.lotSizeRisk);
            formData.append('outcome', newTradeForm.outcome);
            formData.append('profitAmount', newTradeForm.profitAmount);
            formData.append('lossAmount', newTradeForm.lossAmount);
            formData.append('beforeCharts', newTradeForm.beforeCharts); // optional image URL(s)
            formData.append('afterCharts', newTradeForm.afterCharts);   // optional image URL(s)
            formData.append('note', newTradeForm.note);

            // Array fields are sent as JSON strings (use JSON.parse on the backend)
            formData.append('executionRules', JSON.stringify(newTradeForm.executionRules));
            formData.append('psychologicalState', JSON.stringify(newTradeForm.psychologicalState));

            // Image files (only if selected)
            newTradeForm.beforeChartFiles.forEach(file => formData.append('beforeChart', file));
            newTradeForm.afterChartFiles.forEach(file => formData.append('afterChart', file));

            // Do NOT set Content-Type manually: the browser adds the multipart boundary
            const response = await fetch(`${API_BASE}/api/trades/add`, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                playSound('win');
                closeAddModal();
                showResultPopup('success', 'Trade Saved!', `Your ${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} trade was successfully saved to MongoDB (screenshots uploaded to Cloudinary).`, [], 3500);


                fetchTrades(true); // Refresh list immediately (silent, the popup already confirms the save)
            } else {
                let errMsg = `The server responded with status ${response.status}.`;
                try {
                    const rawText = await response.text();
                    let detail = '';
                    try {
                        const errData = JSON.parse(rawText);
                        detail = (errData && (errData.error || errData.message)) || '';
                    } catch (_) {
                        // Not JSON: show plain text only (ignore HTML error pages)
                        if (rawText && !rawText.trim().startsWith('<') && rawText.length < 300) detail = rawText.trim();
                    }
                    if (detail) {
                        errMsg = detail;
                    } else if (response.status >= 500) {
                        errMsg += ' The server gave no details: check the server terminal for the error and make sure the server was restarted with the latest index.js.';
                    }
                } catch (_) { }
                if (response.status === 404) {
                    errMsg += ' (API route not found: check that the server is running and the Vite proxy points to it.)';
                }
                playSound('loss');
                showResultPopup('error', 'Failed to save trade', errMsg);
            }
        } catch (err) {
            playSound('loss');
            showResultPopup('error', 'Network error', 'Could not reach the server. Please make sure the backend is running, then try again.');
        } finally {
            setIsSubmittingTrade(false);
        }
    };

    // Maps MongoDB documents (schema: _id, date, pairDirection, session, fvgTap, smtDivergence, executionRules,
    // entryPrice, slPrice, planeTarget, lotSizeRisk, outcome, profitAmount, lossAmount, psychologicalState,
    // screenshotUrl, note) into the trade objects the whole dashboard works with.
    const parseMongoData = (docs) => {
        const toArr = (v) => {
            if (Array.isArray(v)) return v.filter(Boolean).map(String);
            if (typeof v === 'string' && v.trim()) {
                try { const p = JSON.parse(v); if (Array.isArray(p)) return p.map(String); } catch (_) { }
                return v.split(',').map(s => s.trim()).filter(Boolean);
            }
            return [];
        };
        const toUrls = (v) => {
            if (!v) return [];
            if (Array.isArray(v)) return v.flatMap(toUrls);
            if (typeof v === 'object') return toUrls(v.secure_url || v.url || v.src || '');
            return String(v).split(/[\s,]+/).filter(u => /^https?:\/\//i.test(u));
        };
        const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
        // Cloudinary screenshots -> { before: [...], after: [...] }
        const getShots = (d) => {
            let before = toUrls(d.beforeCharts || d.beforeChart || d.beforeChartUrl);
            let after = toUrls(d.afterCharts || d.afterChart || d.afterChartUrl);
            const s = d.screenshotUrl;
            if (s && typeof s === 'object' && !Array.isArray(s) && (s.before || s.after)) {
                before = before.concat(toUrls(s.before));
                after = after.concat(toUrls(s.after));
            } else if (s) {
                const rest = [];
                toUrls(s).forEach(u => { if (/before/i.test(u)) before.push(u); else if (/after/i.test(u)) after.push(u); else rest.push(u); });
                if (rest.length === 1) before.push(rest[0]);
                else { const half = Math.ceil(rest.length / 2); before.push(...rest.slice(0, half)); after.push(...rest.slice(half)); }
            }
            return { before: [...new Set(before)], after: [...new Set(after)] };
        };

        // Oldest -> newest (by DATE, then by creation time): newest trade is always last
        const sortedResults = [...docs].sort((a, b) => {
            const dA = String(a.date || '').slice(0, 10);
            const dB = String(b.date || '').slice(0, 10);
            if (dA !== dB) return dA < dB ? -1 : 1;
            const cA = String(a.createdAt || '');
            const cB = String(b.createdAt || '');
            if (cA !== cB) return cA < cB ? -1 : 1;
            return 0;
        });

        const parsedTrades = sortedResults.map((item, index) => {
            const dateStr = item.date ? String(item.date).slice(0, 10) : 'N/A';

            let dayOfWeek = 'N/A';
            let monthYearKey = 'N/A';
            if (dateStr !== 'N/A') {
                const d = new Date(`${dateStr}T00:00:00`);
                if (!isNaN(d)) {
                    dayOfWeek = d.toLocaleDateString('en-US', { weekday: 'short' });
                    monthYearKey = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                }
            }

            const pairDirectionTag = item.pairDirection || 'GBP/USD - BUY';
            const pair = pairDirectionTag.includes('-') ? pairDirectionTag.split('-')[0].trim() : pairDirectionTag;

            let direction = 'LONG';
            const tagUpper = pairDirectionTag.toUpperCase();
            if (tagUpper.includes('SELL') || tagUpper.includes('SHORT')) direction = 'SHORT';

            const rawSession = item.session || 'N/A';

            // planeTarget looks like "1:2 (10p : 20p)"
            const targetText = String(item.planeTarget || '');
            const rrMatch = targetText.match(/^\s*1\s*:\s*(\d+(?:\.\d+)?)/);
            const rr = rrMatch ? parseFloat(rrMatch[1]) : 2.0;
            let slPipsVal = '0';
            let tpPipsVal = '0';
            const match = targetText.match(/\(([^)]+)\)/);
            if (match && match[1]) {
                const pipsParts = match[1].split(':');
                if (pipsParts.length === 2) {
                    slPipsVal = pipsParts[0].trim().replace(/p$/i, '');
                    tpPipsVal = pipsParts[1].trim().replace(/p$/i, '');
                }
            }

            const rulesArr = toArr(item.executionRules);
            const psychArr = toArr(item.psychologicalState);

            // Setup score = rules followed out of 5
            let setupScoreVal = 'N/A';
            if (rulesArr.length > 0) {
                const pct = Math.min(100, Math.round((rulesArr.length / 5) * 100));
                const label = pct >= 80 ? '🟢' + ' ' + pct + '% (High Quality)' : pct >= 60 ? '🟡' + ' ' + pct + '% (Medium)' : '🔴' + ' ' + pct + '% (Low)';
                setupScoreVal = label;
            }

            const profitAmt = Number(item.profitAmount) || 0;
            const lossAmt = Number(item.lossAmount) || 0;
            let pnl = 0;
            if (profitAmt > 0) pnl = profitAmt;
            else if (lossAmt > 0) pnl = -Math.abs(lossAmt);

            const outcome = item.outcome || (pnl >= 0 ? 'Win' : 'Loss');
            const rawNoteText = item.note ? String(item.note) : '';
            const shots = getShots(item);

            let normalizedSession = rawSession;
            if (rawSession.toUpperCase().includes('LN') || rawSession.toUpperCase().includes('LONDON')) normalizedSession = 'London Session';
            else if (rawSession.toUpperCase().includes('NY') || rawSession.toUpperCase().includes('NEW YORK')) normalizedSession = 'New York Session';

            return {
                id: index + 1,
                pageId: item._id, // MongoDB _id (used for edit / delete)
                accountId: item.accountId || '',
                pairTag: pairDirectionTag,
                sessionRaw: rawSession === 'N/A' ? '' : rawSession,
                fvgTap: item.fvgTap || '',
                smt: item.smtDivergence || '',
                rules: rulesArr,
                rulesCount: rulesArr.length,
                psych: psychArr,
                entryPrice: num(item.entryPrice),
                slPrice: num(item.slPrice),
                lotSize: num(item.lotSizeRisk),
                profitAmount: num(item.profitAmount),
                lossAmount: num(item.lossAmount),
                outcomeRaw: item.outcome || '',
                rawNote: rawNoteText,
                date: dateStr,
                day: dayOfWeek,
                monthYear: monthYearKey,
                pair: pair,
                session: normalizedSession,
                setupScore: setupScoreVal,
                direction: direction,
                rr: `1:${rr}`,
                slPips: slPipsVal,
                tpPips: tpPipsVal,
                pnl: pnl,
                note: rawNoteText.trim() !== '' ? rawNoteText : 'නෝට් එකක් නොමැත',
                beforeCharts: shots.before,
                afterCharts: shots.after,
                result: String(outcome).toLowerCase().includes('win') ? 'Win' : 'Loss'
            };
        });

        setTrades(parsedTrades);
        calculateKPIs(parsedTrades);
        setTimeout(() => renderCharts(parsedTrades), 50);
    };

    const calculateKPIs = (data) => {
        let totalPnL = 0;
        let wins = 0;
        let losses = 0;
        let totalWinAmount = 0;
        let totalLossAmount = 0;
        let monthlyPnLMap = {};

        let winPnls = [];
        let lossPnls = [];
        let consecWins = 0, maxConsecWins = 0;
        let consecLosses = 0, maxConsecLosses = 0;
        let buyCount = 0, sellCount = 0, buyWins = 0, sellWins = 0;

        data.forEach(t => {
            totalPnL += t.pnl;
            if (t.result === 'Win') {
                wins++;
                totalWinAmount += t.pnl;
                winPnls.push(t.pnl);
                consecWins++;
                consecLosses = 0;
                if (consecWins > maxConsecWins) maxConsecWins = consecWins;
            } else if (t.result === 'Loss') {
                losses++;
                totalLossAmount += Math.abs(t.pnl);
                lossPnls.push(t.pnl);
                consecLosses++;
                consecWins = 0;
                if (consecLosses > maxConsecLosses) maxConsecLosses = consecLosses;
            }

            if (t.direction === 'LONG') {
                buyCount++;
                if (t.result === 'Win') buyWins++;
            } else {
                sellCount++;
                if (t.result === 'Win') sellWins++;
            }

            if (t.monthYear && t.monthYear !== 'N/A') {
                monthlyPnLMap[t.monthYear] = (monthlyPnLMap[t.monthYear] || 0) + t.pnl;
            }
        });

        let bestMonth = 'N/A', highestMonthPnL = -Infinity;
        let worstMonth = 'N/A', lowestMonthPnL = Infinity;
        for (let m in monthlyPnLMap) {
            if (monthlyPnLMap[m] > highestMonthPnL) { highestMonthPnL = monthlyPnLMap[m]; bestMonth = m; }
            if (monthlyPnLMap[m] < lowestMonthPnL) { lowestMonthPnL = monthlyPnLMap[m]; worstMonth = m; }
        }
        const fmtMonthPnL = (v) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        if (bestMonth !== 'N/A' && highestMonthPnL > 0) {
            // at least one profitable month: show the best one
            setMonthMode('best');
            setBestMonthName(bestMonth);
            setBestMonthPnL(fmtMonthPnL(highestMonthPnL));
        } else if (worstMonth !== 'N/A') {
            // no profitable month at all: show the month with the biggest loss instead
            setMonthMode('worst');
            setBestMonthName(worstMonth);
            setBestMonthPnL(fmtMonthPnL(lowestMonthPnL));
        } else {
            setMonthMode('best');
            setBestMonthName('N/A');
            setBestMonthPnL('$0.00');
        }

        const totalTrades = data.length;
        const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;
        const profitFactor = totalLossAmount > 0 ? (totalWinAmount / totalLossAmount).toFixed(2) : totalWinAmount.toFixed(2);
        const rMultiple = (totalPnL / 150).toFixed(1);

        setKpiNetProfit(`${totalPnL >= 0 ? '+' : '-'}$${Math.abs(totalPnL).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        setKpiRMultiple(`${rMultiple >= 0 ? '+' : ''}${rMultiple} R`);
        setKpiWinRate(`${winRate}%`);
        setKpiWinLossRatio(`${wins}W / ${losses}L`);
        setKpiProfitFactor(profitFactor);
        setDonutWins(wins);
        setDonutLosses(losses);

        setStatsData({
            totalWinners: wins,
            totalLosers: losses,
            bestWin: winPnls.length > 0 ? `+$${Math.max(...winPnls).toFixed(2)}` : '$0.00',
            worstLoss: lossPnls.length > 0 ? `-$${Math.abs(Math.min(...lossPnls)).toFixed(2)}` : '$0.00',
            avgWin: winPnls.length > 0 ? `+$${(totalWinAmount / wins).toFixed(2)}` : '$0.00',
            avgLoss: lossPnls.length > 0 ? `-$${(totalLossAmount / losses).toFixed(2)}` : '$0.00',
            maxConsecWins: maxConsecWins,
            maxConsecLosses: maxConsecLosses,
            buyCount: buyCount,
            sellCount: sellCount,
            buyWinRate: buyCount > 0 ? ((buyWins / buyCount) * 100).toFixed(1) : 0,
            sellWinRate: sellCount > 0 ? ((sellWins / sellCount) * 100).toFixed(1) : 0
        });
    };

    const renderCharts = (data) => {
        const isDark = isDarkRef.current; // always use the latest theme (polling closures can be stale)
        const k = chartKit(isDark);
        const T = uiThemeRef.current === 'terminal';
        const A = T
            ? { line: '#F5A524', f0: 'rgba(245,165,36,0.30)', f1: 'rgba(245,165,36,0.07)', f2: 'rgba(245,165,36,0)', hov: '#F5A524', cross: 'rgba(245,165,36,0.5)', pie: ['#F5A524', '#7C8596'] }
            : { line: '#818CF8', f0: 'rgba(99, 102, 241, 0.34)', f1: 'rgba(99, 102, 241, 0.08)', f2: 'rgba(99, 102, 241, 0)', hov: '#6366F1', cross: 'rgba(129,140,248,0.5)', pie: ['#6366F1', '#A78BFA'] };
        if (T) k.tooltip = { ...k.tooltip, borderColor: 'rgba(245,165,36,0.4)' };
        const sortedTrades = rangeTrades([...data], eqRangeRef.current); // already oldest -> newest, limited to the selected range

        let cumulative = 0;
        const eqLabels = ['Start', ...sortedTrades.map((_, i) => `T-${i + 1}`)];
        const eqData = [0, ...sortedTrades.map(t => { cumulative += t.pnl; return cumulative; })];

        if (equityInstance.current) equityInstance.current.destroy();
        if (equityChartRef.current) {
            const ctx = equityChartRef.current.getContext('2d');
            const gradient = ctx.createLinearGradient(0, 0, 0, 320);
            gradient.addColorStop(0, A.f0);
            gradient.addColorStop(0.6, A.f1);
            gradient.addColorStop(1, A.f2);

            equityInstance.current = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: eqLabels,
                    datasets: [{
                        data: eqData,
                        borderColor: A.line,
                        borderWidth: 3,
                        borderCapStyle: 'round',
                        fill: true,
                        backgroundColor: gradient,
                        tension: 0.38,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: A.hov,
                        pointHoverBorderWidth: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            ...k.tooltip,
                            displayColors: false,
                            callbacks: {
                                label: function (context) {
                                    const index = context.dataIndex;
                                    const balance = context.parsed.y;
                                    if (index === 0) return `Starting Balance: $${balance.toFixed(2)}`;
                                    const trade = sortedTrades[index - 1];
                                    if (!trade) return `Balance: $${balance.toFixed(2)}`;
                                    const pnl = trade.pnl;
                                    const pnlStr = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
                                    return [`Balance: $${balance.toFixed(2)}`, `Trade PnL: ${pnlStr} (${trade.pair})`];
                                }
                            }
                        }
                    },
                    scales: axes(k, true)
                },
                plugins: [{
                    id: 'crosshair',
                    afterDatasetsDraw(c) {
                        const a = c.tooltip && c.tooltip.getActiveElements ? c.tooltip.getActiveElements() : [];
                        if (!a.length) return;
                        const { ctx: g, chartArea: { top, bottom } } = c;
                        g.save();
                        g.strokeStyle = A.cross;
                        g.setLineDash([4, 4]);
                        g.beginPath(); g.moveTo(a[0].element.x, top); g.lineTo(a[0].element.x, bottom); g.stroke();
                        g.restore();
                    }
                }]
            });
        }

        const wins = data.filter(t => t.result === 'Win').length;
        const losses = data.filter(t => t.result === 'Loss').length;

        if (donutInstance.current) donutInstance.current.destroy();
        if (donutChartRef.current) {
            donutInstance.current = new Chart(donutChartRef.current.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Wins', 'Losses'],
                    datasets: [{ data: [wins, losses], backgroundColor: [C.up, C.down], borderWidth: 0, borderRadius: 10, spacing: 4, hoverOffset: 6 }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: k.tooltip }, cutout: '80%' }
            });
        }

        const lonWins = data.filter(t => t.session.includes('London') && t.result === 'Win').length;
        const lonLoss = data.filter(t => t.session.includes('London') && t.result === 'Loss').length;
        const nyWins = data.filter(t => t.session.includes('New York') && t.result === 'Win').length;
        const nyLoss = data.filter(t => t.session.includes('New York') && t.result === 'Loss').length;

        if (sessionInstance.current) sessionInstance.current.destroy();
        if (sessionChartRef.current) {
            const ax = axes(k, false);
            sessionInstance.current = new Chart(sessionChartRef.current.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['London Session', 'New York Session'],
                    datasets: [
                        { label: 'Wins', data: [lonWins, nyWins], backgroundColor: C.up, borderRadius: 8, borderSkipped: false, maxBarThickness: 30 },
                        { label: 'Losses', data: [lonLoss, nyLoss], backgroundColor: C.down, borderRadius: 8, borderSkipped: false, maxBarThickness: 30 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { align: 'end', labels: { color: k.text, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, font: { size: 11, weight: '600' } } },
                        tooltip: k.tooltip
                    },
                    scales: { x: ax.x, y: { ...ax.y, ticks: { ...ax.y.ticks, precision: 0 } } }
                }
            });
        }

        const buyCount = data.filter(t => t.direction === 'LONG').length;
        const sellCount = data.filter(t => t.direction === 'SHORT').length;

        if (sidePieInstance.current) sidePieInstance.current.destroy();
        if (sidePieChartRef.current) {
            sidePieInstance.current = new Chart(sidePieChartRef.current.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Buy (Long)', 'Sell (Short)'],
                    datasets: [{ data: [buyCount, sellCount], backgroundColor: A.pie, borderWidth: 0, borderRadius: 10, spacing: 4, hoverOffset: 6 }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: k.tooltip }, cutout: '76%' }
            });
        }

        renderTimeframeChart(data, timeframeModeRef.current);
    };

    const renderTimeframeChart = (data, mode) => {
        const isDark = isDarkRef.current;
        const k = chartKit(isDark);

        let labels = [];
        let values = [];

        if (mode === 'weekly') {
            labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
            values = labels.map(day => data.filter(t => t.day === day).reduce((acc, curr) => acc + curr.pnl, 0));
        } else {
            let monthMap = {};
            data.forEach(t => {
                if (t.monthYear && t.monthYear !== 'N/A') {
                    monthMap[t.monthYear] = (monthMap[t.monthYear] || 0) + t.pnl;
                }
            });
            labels = Object.keys(monthMap);
            values = Object.values(monthMap);
            if (labels.length === 0) { labels = ['No Data']; values = [0]; }
        }

        if (timeframeInstance.current) timeframeInstance.current.destroy();
        if (timeframeChartRef.current) {
            timeframeInstance.current = new Chart(timeframeChartRef.current.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: values.map(v => v >= 0 ? C.up : C.down),
                        borderRadius: 8,
                        borderSkipped: false,
                        maxBarThickness: 36
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { ...k.tooltip, displayColors: false, callbacks: { label: (c) => `PnL: ${c.parsed.y >= 0 ? '+' : '-'}$${Math.abs(c.parsed.y).toFixed(2)}` } } },
                    scales: axes(k, true)
                }
            });
        }
    };

    const switchTimeframe = (mode) => {
        setCurrentTimeframeMode(mode);
        renderTimeframeChart(trades, mode);
    };

    const exportCustomPDFReport = () => {
        let filteredTrades = [];
        let reportTitleKey = '';
        let startKey = '', endKey = '';

        if (reportMode === 'month') {
            const monthName = monthNames[calMonth];
            reportTitleKey = `${monthName} ${calYear}`;
            const mm = String(calMonth + 1).padStart(2, '0');
            startKey = `${calYear}-${mm}-01`;
            endKey = `${calYear}-${mm}-31`;
        } else {
            if (!customStartDate || !customEndDate) {
                alert("⚠️ Please select both a From date and a To date.");
                return;
            }
            startKey = customStartDate <= customEndDate ? customStartDate : customEndDate;
            endKey = customStartDate <= customEndDate ? customEndDate : customStartDate;
            reportTitleKey = `${startKey} to ${endKey}`;
        }
        // Plain YYYY-MM-DD comparison (no timezone shifts); trades are already scoped to the active account
        filteredTrades = trades.filter(t => { const k = tradeDateKey(t); return k && k >= startKey && k <= endKey; });
        filteredTrades.sort((a, b) => (tradeDateKey(a) < tradeDateKey(b) ? -1 : tradeDateKey(a) > tradeDateKey(b) ? 1 : 0));

        if (filteredTrades.length === 0) {
            alert(`⚠️ No trades found for ${reportTitleKey}.`);
            return;
        }

        // Open the print window right now (inside the click) so popup blockers allow it
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert("The print window was blocked by your popup blocker. Please allow popups and try again.");
            return;
        }
        printWindow.document.write('<!DOCTYPE html><html><body style="font-family:Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#475569"><div>Generating your report…</div></body></html>');

        // ---------- Metrics ----------
        const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const usd = (v) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const sgn = (v) => `${v < 0 ? '-' : '+'}${usd(v)}`;
        const cls = (v) => (v >= 0 ? 'pos' : 'neg');

        const n = filteredTrades.length;
        const fWins = filteredTrades.filter(t => t.result === 'Win').length;
        const fLosses = n - fWins;
        const winRateNum = (fWins / n) * 100;
        const winRate = winRateNum.toFixed(1);
        const totalPeriodPnL = filteredTrades.reduce((a, t) => a + t.pnl, 0);
        const grossProfit = filteredTrades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
        const grossLoss = Math.abs(filteredTrades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
        const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '0.00');
        const winsArr = filteredTrades.filter(t => t.result === 'Win');
        const lossArr = filteredTrades.filter(t => t.result === 'Loss');
        const avgWin = winsArr.length ? winsArr.reduce((a, t) => a + t.pnl, 0) / winsArr.length : 0;
        const avgLoss = lossArr.length ? lossArr.reduce((a, t) => a + t.pnl, 0) / lossArr.length : 0;
        const expectancy = totalPeriodPnL / n;
        const rrOf = (t) => parseFloat(String(t.rr).split(':')[1]) || 2;
        const netR = filteredTrades.reduce((a, t) => a + (t.result === 'Win' ? rrOf(t) : -1), 0);
        const best = filteredTrades.reduce((a, t) => (t.pnl > a.pnl ? t : a), filteredTrades[0]);
        const worst = filteredTrades.reduce((a, t) => (t.pnl < a.pnl ? t : a), filteredTrades[0]);

        let cum = 0, peak = 0, maxDD = 0;
        const eqVals = [0, ...filteredTrades.map(t => { cum += t.pnl; peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum); return cum; })];
        const eqLbls = ['Start', ...filteredTrades.map((_, i) => `T-${i + 1}`)];

        let curW = 0, curL = 0, maxW = 0, maxL = 0;
        filteredTrades.forEach(t => {
            if (t.result === 'Win') { curW++; curL = 0; } else { curL++; curW = 0; }
            maxW = Math.max(maxW, curW); maxL = Math.max(maxL, curL);
        });

        const groupBy = (keyFn) => {
            const m = {};
            filteredTrades.forEach(t => { const k = keyFn(t); (m[k] = m[k] || []).push(t); });
            return Object.entries(m).map(([k, arr]) => {
                const w = arr.filter(t => t.result === 'Win').length;
                return { k, n: arr.length, w, l: arr.length - w, wr: (w / arr.length) * 100, pnl: arr.reduce((a, t) => a + t.pnl, 0) };
            }).sort((a, b) => b.pnl - a.pnl);
        };
        const bySession = groupBy(t => t.session || 'N/A');
        const byDirection = groupBy(t => t.direction === 'SHORT' ? 'Short (Sell)' : 'Long (Buy)');
        const byPair = groupBy(t => t.pair || 'N/A');
        const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const dayStats = weekdays.map(d => {
            const arr = filteredTrades.filter(t => t.day === d);
            return { d, n: arr.length, w: arr.filter(t => t.result === 'Win').length, pnl: arr.reduce((a, t) => a + t.pnl, 0) };
        });
        const maxAbsDay = Math.max(1, ...dayStats.map(x => Math.abs(x.pnl)));
        const maxAbsSess = Math.max(1, ...bySession.map(x => Math.abs(x.pnl)));

        const repAcc = activeDatabase === 'live' ? accounts.find(a => a.id === activeAccountId) : null;
        const accountName = activeDatabase === 'backtest' ? 'Backtest Account' : (repAcc ? esc(repAcc.name) : (activeAccountId === '__legacy' ? 'Legacy trades (no account)' : 'Live Account'));
        const accountColor = activeDatabase === 'backtest' ? '#8B5CF6' : (repAcc && repAcc.color ? repAcc.color : '#10B981');
        // Read-only account / payout / fee summary for the report (does not touch the Accounts tab logic)
        const accStart = repAcc ? Number(repAcc.startBalance) || 0 : 0;
        const accFee = repAcc ? Number(repAcc.fee) || 0 : 0;
        const accPayoutsAll = repAcc ? (repAcc.payouts || []) : [];
        const accPayoutsPeriod = accPayoutsAll.filter(p => p.date && String(p.date).slice(0, 10) >= startKey && String(p.date).slice(0, 10) <= endKey);
        const sumPayouts = (arr) => arr.reduce((s2, p) => s2 + (Number(p.amount) || 0), 0);
        const periodPayoutTotal = sumPayouts(accPayoutsPeriod);
        const allPayoutTotal = sumPayouts(accPayoutsAll);
        const accountBlock = repAcc ? `
    <div class="section">Account &amp; Payouts <small>${esc(repAcc.firm || '')} ${esc(repAcc.type || '')} · ${esc(repAcc.phase || '')} · ${esc(repAcc.status || '')}</small></div>
    <div class="stats" style="grid-template-columns:repeat(5,1fr)">
        <div class="stat"><div class="l">Start Balance</div><div class="v">${usd(accStart)}</div></div>
        <div class="stat"><div class="l">Period Return</div><div class="v ${cls(totalPeriodPnL)}">${accStart > 0 ? `${totalPeriodPnL >= 0 ? '+' : '-'}${Math.abs((totalPeriodPnL / accStart) * 100).toFixed(2)}%` : '—'}</div></div>
        <div class="stat"><div class="l">Account Fee</div><div class="v">${usd(accFee)}</div></div>
        <div class="stat"><div class="l">Payouts (period)</div><div class="v pos">${usd(periodPayoutTotal)}</div></div>
        <div class="stat"><div class="l">Payouts (all time)</div><div class="v pos">${usd(allPayoutTotal)}</div></div>
    </div>` : '';
        const firstDate = filteredTrades[0].date, lastDate = filteredTrades[n - 1].date;
        const now = new Date();
        const reportId = `MP-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const generatedAt = now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

        // ---------- High-resolution charts (rendered off-screen, embedded as images) ----------
        const FONT = "'Segoe UI', Inter, Arial, sans-serif";
        const tick = { color: '#64748B', font: { size: 20, family: FONT } };
        const baseScales = (money) => ({
            x: { grid: { display: false }, border: { display: false }, ticks: { ...tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            y: {
                border: { display: false },
                grid: { color: (c) => (c.tick && c.tick.value === 0 ? 'rgba(15,23,42,0.35)' : 'rgba(15,23,42,0.07)'), lineWidth: (c) => (c.tick && c.tick.value === 0 ? 2 : 1) },
                ticks: { ...tick, padding: 10, callback: money ? (v) => `$${Number(v).toLocaleString('en-US')}` : undefined }
            }
        });
        const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
        const common = { responsive: false, animation: false, devicePixelRatio: 1 };

        const eqCanvas = mkCanvas(1400, 540);
        const eqCtx = eqCanvas.getContext('2d');
        const eqGrad = eqCtx.createLinearGradient(0, 0, 0, 540);
        eqGrad.addColorStop(0, 'rgba(99,102,241,0.35)');
        eqGrad.addColorStop(1, 'rgba(99,102,241,0)');
        const eqChart = new Chart(eqCtx, {
            type: 'line',
            data: { labels: eqLbls, datasets: [{ data: eqVals, borderColor: '#6366F1', borderWidth: 5, fill: true, backgroundColor: eqGrad, tension: 0.35, pointRadius: eqVals.length > 40 ? 0 : 6, pointBackgroundColor: '#fff', pointBorderColor: '#6366F1', pointBorderWidth: 3 }] },
            options: { ...common, plugins: { legend: { display: false } }, scales: baseScales(true) }
        });

        const donutCanvas = mkCanvas(560, 560);
        const donutChart = new Chart(donutCanvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['Wins', 'Losses'], datasets: [{ data: [fWins, fLosses], backgroundColor: ['#22C55E', '#F43F5E'], borderWidth: 0, borderRadius: 14, spacing: 6 }] },
            options: { ...common, cutout: '76%', plugins: { legend: { display: false } } },
            plugins: [{
                id: 'centerText',
                afterDraw(c) {
                    const { ctx, chartArea: { left, right, top, bottom } } = c;
                    const x = (left + right) / 2, y = (top + bottom) / 2;
                    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#0F172A'; ctx.font = `800 84px ${FONT}`; ctx.fillText(`${winRate}%`, x, y - 12);
                    ctx.fillStyle = '#64748B'; ctx.font = `700 26px ${FONT}`; ctx.fillText('WIN RATE', x, y + 52);
                    ctx.restore();
                }
            }]
        });

        setTimeout(() => {
            const equityUrl = eqCanvas.toDataURL('image/png');
            const donutUrl = donutCanvas.toDataURL('image/png');
            [eqChart, donutChart].forEach(c => c.destroy());

            const kpi = (title, value, sub, color, accent) => `
                <div class="kpi" style="--accent:${accent}">
                    <div class="kpi-title">${title}</div>
                    <div class="kpi-val ${color || ''}">${value}</div>
                    <div class="kpi-sub">${sub}</div>
                </div>`;
            const breakdown = (rows) => rows.map(r => `
                <tr>
                    <td><b>${esc(r.k)}</b></td>
                    <td class="num">${r.n}</td>
                    <td class="num">${r.w}W / ${r.l}L</td>
                    <td><div class="bar"><i style="width:${r.wr.toFixed(0)}%"></i></div><span class="barlbl">${r.wr.toFixed(0)}%</span></td>
                    <td class="num ${cls(r.pnl)}">${sgn(r.pnl)}</td>
                </tr>`).join('');
            const breakdownTable = (title, rows, firstCol) => `
                <div class="card">
                    <div class="card-title">${title}</div>
                    <table class="mini">
                        <thead><tr><th>${firstCol}</th><th class="num">Trades</th><th class="num">W / L</th><th>Win Rate</th><th class="num">Net PnL</th></tr></thead>
                        <tbody>${breakdown(rows)}</tbody>
                    </table>
                </div>`;

            const dayTiles = dayStats.map(x => {
                const a = x.n ? Math.min(0.4, 0.1 + (Math.abs(x.pnl) / maxAbsDay) * 0.3) : 0;
                const bg = !x.n ? '#f8fafc' : x.pnl >= 0 ? `rgba(34,197,94,${a})` : `rgba(244,63,94,${a})`;
                return `<div class="tile" style="background:${bg}"><div class="tile-d">${x.d}</div><div class="tile-v ${x.n ? cls(x.pnl) : 'muted'}">${x.n ? sgn(x.pnl) : '—'}</div><div class="tile-n">${x.n ? `${x.n} trade${x.n === 1 ? '' : 's'} · ${Math.round((x.w / x.n) * 100)}% WR` : 'No trades'}</div></div>`;
            }).join('');
            const sessBars = bySession.map(x => {
                const w = Math.max(2, (Math.abs(x.pnl) / maxAbsSess) * 50);
                const left = x.pnl >= 0 ? 50 : 50 - w;
                return `<div class="dv"><div class="dv-top"><b>${esc(x.k)}</b><span class="${cls(x.pnl)}"><b>${sgn(x.pnl)}</b></span></div><div class="dv-track"><i class="axis"></i><i class="fill ${x.pnl >= 0 ? 'g' : 'r'}" style="left:${left}%;width:${w}%"></i></div><div class="dv-sub">${x.n} trade${x.n === 1 ? '' : 's'} · ${x.wr.toFixed(0)}% win rate</div></div>`;
            }).join('');

            const rowsHtml = filteredTrades.map((t, i) => {
                const hasNote = t.note && t.note !== 'නෝට් එකක් නොමැත';
                return `
                <tbody class="trade ${t.result === 'Win' ? 'w' : 'l'}">
                    <tr class="main ${hasNote ? '' : 'solo'}">
                        <td class="idx">${i + 1}</td>
                        <td class="nowrap">${esc(t.date)}<div class="muted">${esc(t.day)}</div></td>
                        <td><b>${esc(t.pair)}</b><div class="dir ${t.direction === 'SHORT' ? 'short' : 'long'}">${t.direction === 'SHORT' ? 'SHORT' : 'LONG'}</div></td>
                        <td>${esc(t.session)}</td>
                        <td class="nowrap">${esc(t.setupScore)}</td>
                        <td class="num">${esc(t.rr)}</td>
                        <td class="num nowrap">${esc(t.slPips)}p / ${esc(t.tpPips)}p</td>
                        <td class="num ${cls(t.pnl)}"><b>${sgn(t.pnl)}</b></td>
                        <td><span class="pill ${t.result === 'Win' ? 'win' : 'loss'}">${t.result}</span></td>
                    </tr>
                    ${hasNote ? `<tr class="note"><td></td><td colspan="8"><div class="nbox"><div class="nlabel"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>Lesson</div><div class="ntext">${esc(t.note)}</div></div></td></tr>` : ''}
                </tbody>`;
            }).join('');

            const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>MintPip Performance Report - ${esc(reportTitleKey)}</title>
<style>
    @page { margin: 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: ${FONT}; color: #0f172a; margin: 0; padding: 28px; background: #fff; font-size: 12px; }
    .pos { color: #16a34a; } .neg { color: #e11d48; }
    .muted { color: #94a3b8; font-size: 10px; } .nowrap { white-space: nowrap; } .num { text-align: right; }
    .toolbar { position: fixed; top: 14px; right: 14px; z-index: 10; }
    .toolbar { display: flex; gap: 8px; }
    .toolbar button.alt { background: #fff; color: #4f46e5; border: 1px solid #c7d2fe; box-shadow: none; }
    .toolbar button.alt.on { background: #eef2ff; border-color: #6366F1; }
    .toolbar button { background: linear-gradient(135deg, #6366F1, #8B5CF6); color: #fff; border: 0; padding: 10px 18px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: 0 8px 20px -8px rgba(99,102,241,.7); }

    .hero { position: relative; overflow: hidden; border-radius: 18px; padding: 26px 30px; color: #fff; background: linear-gradient(135deg, #1e1b4b 0%, #3730a3 55%, #6d28d9 100%); display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
    .hero::after { content: ""; position: absolute; right: -60px; top: -80px; width: 260px; height: 260px; border-radius: 50%; background: rgba(255,255,255,.08); }
    .brand { display: flex; align-items: center; gap: 12px; }
    .mark { width: 42px; height: 42px; border-radius: 12px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.3); display: flex; align-items: center; justify-content: center; }
    .brand-name { font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
    .brand-sub { font-size: 10px; letter-spacing: .18em; text-transform: uppercase; opacity: .75; margin-top: 2px; }
    .title { margin-top: 20px; font-size: 20px; font-weight: 800; letter-spacing: -.01em; }
    .period { margin-top: 4px; font-size: 12px; opacity: .85; }
    .meta { text-align: right; font-size: 10.5px; line-height: 1.8; position: relative; z-index: 1; }
    .meta b { font-weight: 700; }
    .acct { display: inline-flex; align-items: center; gap: 7px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.28); padding: 5px 12px; border-radius: 99px; font-weight: 700; font-size: 11px; margin-bottom: 8px; }
    .acct i { width: 8px; height: 8px; border-radius: 50%; background: ${accountColor}; box-shadow: 0 0 0 3px rgba(255,255,255,.25); }

    .section { margin: 26px 0 12px; display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 800; letter-spacing: -.01em; }
    .section::before { content: ""; width: 4px; height: 16px; border-radius: 4px; background: linear-gradient(#6366F1, #8B5CF6); }
    .section small { margin-left: auto; font-weight: 600; font-size: 10.5px; color: #94a3b8; }

    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .kpi { position: relative; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px 16px 13px; overflow: hidden; }
    .kpi::before { content: ""; position: absolute; left: 0; top: 0; right: 0; height: 3px; background: var(--accent); }
    .kpi-title { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; color: #64748b; text-transform: uppercase; }
    .kpi-val { font-size: 21px; font-weight: 800; margin-top: 6px; letter-spacing: -.02em; }
    .kpi-sub { font-size: 10px; color: #94a3b8; margin-top: 3px; }

    .grid-2-1 { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
    .grid-1-1 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; break-inside: avoid; page-break-inside: avoid; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
    .card-title { font-size: 11.5px; font-weight: 800; color: #334155; margin-bottom: 4px; }
    .card-sub { font-size: 10px; color: #94a3b8; margin-bottom: 8px; }
    .card img { width: 100%; display: block; }
    .donut-wrap { display: flex; flex-direction: column; align-items: center; }
    .donut-wrap img { width: 190px; margin: 6px 0 10px; }
    .legend { display: flex; gap: 16px; font-size: 10.5px; font-weight: 700; color: #475569; }
    .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 5px; }

    .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; margin-top: 12px; break-inside: avoid; }
    .stat { padding: 12px 14px; border-right: 1px solid #e2e8f0; background: #fff; }
    .stat:last-child { border-right: 0; }
    .stat .l { font-size: 9px; font-weight: 800; letter-spacing: .08em; color: #64748b; text-transform: uppercase; }
    .stat .v { font-size: 14px; font-weight: 800; margin-top: 4px; }

    table { width: 100%; border-collapse: collapse; }
    table.mini { font-size: 10.5px; margin-top: 6px; }
    table.mini th { text-align: left; font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: #64748b; padding: 6px 4px; border-bottom: 1px solid #e2e8f0; }
    table.mini td { padding: 7px 4px; border-bottom: 1px solid #f1f5f9; }
    table.mini th.num, table.mini td.num { text-align: right; }
    .bar { display: inline-block; width: 52px; height: 6px; border-radius: 99px; background: #e2e8f0; vertical-align: middle; overflow: hidden; }
    .bar i { display: block; height: 100%; background: linear-gradient(90deg, #6366F1, #8B5CF6); }
    .barlbl { margin-left: 6px; font-weight: 700; color: #475569; }

    table.log { width: 100%; border-collapse: separate; border-spacing: 0 12px; font-size: 10px; margin-top: -2px; }
    table.log thead { display: table-header-group; }
    table.log th { background: #0f172a; color: #e2e8f0; text-align: left; font-size: 8.5px; letter-spacing: .07em; text-transform: uppercase; padding: 9px 7px; }
    table.log th:first-child { border-radius: 10px 0 0 10px; } table.log th:last-child { border-radius: 0 10px 10px 0; }
    table.log th.num { text-align: right; }
    table.log tbody.trade { break-inside: avoid; page-break-inside: avoid; }
    table.log tr.main td { background: #fff; border-top: 1px solid #dfe5f3; padding: 11px 7px 8px; vertical-align: top; }
    table.log tr.main td:first-child { border-left: 1px solid #dfe5f3; border-top-left-radius: 12px; }
    table.log tr.main td:last-child { border-right: 1px solid #dfe5f3; border-top-right-radius: 12px; }
    table.log tr.main.solo td { border-bottom: 1px solid #dfe5f3; padding-bottom: 11px; }
    table.log tr.main.solo td:first-child { border-bottom-left-radius: 12px; } table.log tr.main.solo td:last-child { border-bottom-right-radius: 12px; }
    table.log tr.note td { background: #fff; border-bottom: 1px solid #dfe5f3; padding: 2px 10px 12px 7px; }
    table.log tr.note td:first-child { border-left: 1px solid #dfe5f3; border-bottom-left-radius: 12px; padding: 0; }
    table.log tr.note td:last-child { border-right: 1px solid #dfe5f3; border-bottom-right-radius: 12px; }
    table.log tbody.w tr td:first-child { border-left: 4px solid #22c55e; }
    table.log tbody.l tr td:first-child { border-left: 4px solid #f43f5e; }
    table.log td.idx { color: #6366F1; font-weight: 800; width: 22px; }
    .nbox { display: flex; align-items: stretch; background: #f8faff; border: 1px solid #e3e8f6; border-radius: 10px; overflow: hidden; }
    .nlabel { flex: 0 0 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px 4px; background: linear-gradient(180deg, #eef2ff, #ebe5ff); color: #4f46e5; font-size: 7.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; border-right: 1px solid #e0e7ff; }
    .ntext { flex: 1; padding: 10px 14px; font-size: 10px; line-height: 1.75; color: #1e293b; white-space: pre-line; word-break: break-word; }
    .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin-top: 6px; }
    .tile { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 6px; text-align: center; }
    .tile-d { font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #475569; }
    .tile-v { font-size: 13px; font-weight: 800; margin-top: 8px; letter-spacing: -.01em; }
    .tile-n { font-size: 8px; color: #64748b; margin-top: 5px; line-height: 1.4; }
    .dv { padding: 9px 0; border-bottom: 1px solid #f1f5f9; } .dv:last-child { border-bottom: 0; }
    .dv-top { display: flex; justify-content: space-between; font-size: 11px; }
    .dv-track { position: relative; height: 12px; margin: 8px 0 5px; border-radius: 99px; background: #f1f5f9; overflow: hidden; }
    .dv-track .axis { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #94a3b8; z-index: 2; }
    .dv-track .fill { position: absolute; top: 0; bottom: 0; border-radius: 99px; }
    .dv-track .fill.g { background: linear-gradient(90deg, #86efac, #22c55e); } .dv-track .fill.r { background: linear-gradient(90deg, #f43f5e, #fda4af); }
    .dv-sub { font-size: 9px; color: #94a3b8; }
    .pill { display: inline-block; padding: 3px 10px; border-radius: 99px; font-weight: 800; font-size: 9.5px; }
    .pill.win { background: #dcfce7; color: #15803d; } .pill.loss { background: #ffe4e6; color: #be123c; }
    .dir { font-weight: 800; font-size: 9.5px; letter-spacing: .04em; } .dir.long { color: #4f46e5; } .dir.short { color: #7c3aed; }

    .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; font-size: 9.5px; color: #94a3b8; }
    .footer b { color: #64748b; }
    .disclaimer { max-width: 62%; line-height: 1.6; }
    @media print { body { padding: 0; } .toolbar { display: none; } }
</style>
</head>
<body>
    <style id="pg"></style>
    <div class="toolbar"><button class="alt" id="bp" onclick="setO('portrait')">Portrait</button><button class="alt" id="bl" onclick="setO('landscape')">Landscape</button><button onclick="window.print()">Print / Save as PDF</button></div>
    <script>function setO(o){document.getElementById('pg').textContent='@page{size:A4 '+o+';margin:12mm}';document.getElementById('bp').className='alt'+(o==='portrait'?' on':'');document.getElementById('bl').className='alt'+(o==='landscape'?' on':'');}</script>

    <div class="hero">
        <div>
            <div class="brand">
                <div class="mark"><svg width="22" height="22" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg></div>
                <div><div class="brand-name">MintPip</div><div class="brand-sub">Institutional Analytics</div></div>
            </div>
            <div class="title">Performance &amp; Analytics Report</div>
            <div class="period">Reporting period: <b>${esc(reportTitleKey)}</b> &nbsp;·&nbsp; ${esc(firstDate)} to ${esc(lastDate)}</div>
        </div>
        <div class="meta">
            <div class="acct"><i></i>${accountName}</div><br/>
            Report ID: <b>${reportId}</b><br/>
            Generated: <b>${generatedAt}</b><br/>
            Trades analysed: <b>${n}</b>
        </div>
    </div>

    <div class="section">Executive Summary <small>${esc(reportTitleKey)}</small></div>
    <div class="kpis">
        ${kpi('Net PnL', sgn(totalPeriodPnL), `Gross ${usd(grossProfit)} profit · ${usd(grossLoss)} loss`, cls(totalPeriodPnL), totalPeriodPnL >= 0 ? '#22C55E' : '#F43F5E')}
        ${kpi('Win Rate', `${winRate}%`, `${fWins} wins · ${fLosses} losses`, '', '#6366F1')}
        ${kpi('Profit Factor', profitFactor, 'Gross profit ÷ gross loss', '', '#8B5CF6')}
        ${kpi('Net R-Multiple', `${netR >= 0 ? '+' : '-'}${Math.abs(netR).toFixed(1)} R`, `${(netR / n).toFixed(2)} R per trade`, cls(netR), '#0EA5E9')}
        ${kpi('Expectancy', sgn(expectancy), 'Average PnL per trade', cls(expectancy), '#14B8A6')}
        ${kpi('Max Drawdown', maxDD > 0 ? `-${usd(maxDD)}` : '$0.00', 'Peak-to-trough in period', maxDD > 0 ? 'neg' : '', '#F43F5E')}
        ${kpi('Best Trade', sgn(best.pnl), `${esc(best.pair)} · ${esc(best.date)}`, cls(best.pnl), '#22C55E')}
        ${kpi('Worst Trade', sgn(worst.pnl), `${esc(worst.pair)} · ${esc(worst.date)}`, cls(worst.pnl), '#F59E0B')}
    </div>

    <div class="section">Performance Charts <small>Equity, outcome mix, weekday &amp; session PnL</small></div>
    <div class="grid-2-1">
        <div class="card">
            <div class="card-title">Cumulative Equity Growth</div>
            <div class="card-sub">Running net PnL across the period (start = $0)</div>
            <img src="${equityUrl}" alt="Equity growth" />
        </div>
        <div class="card donut-wrap">
            <div class="card-title" style="align-self:flex-start">Win / Loss Distribution</div>
            <img src="${donutUrl}" alt="Win loss" />
            <div class="legend"><span><i style="background:#22C55E"></i>Wins ${fWins}</span><span><i style="background:#F43F5E"></i>Losses ${fLosses}</span></div>
        </div>
    </div>
    <div class="grid-1-1" style="margin-top:12px">
        <div class="card">
            <div class="card-title">Weekday Performance</div>
            <div class="card-sub">Net PnL per trading day · darker tile = bigger result</div>
            <div class="tiles">${dayTiles}</div>
        </div>
        <div class="card">
            <div class="card-title">Session Performance</div>
            <div class="card-sub">Net PnL per session · bars grow right for profit, left for loss</div>
            ${sessBars}
        </div>
    </div>

    <div class="stats">
        <div class="stat"><div class="l">Average Win</div><div class="v pos">${avgWin ? sgn(avgWin) : '$0.00'}</div></div>
        <div class="stat"><div class="l">Average Loss</div><div class="v neg">${avgLoss ? sgn(avgLoss) : '$0.00'}</div></div>
        <div class="stat"><div class="l">Max Win Streak</div><div class="v">${maxW}</div></div>
        <div class="stat"><div class="l">Max Loss Streak</div><div class="v">${maxL}</div></div>
        <div class="stat"><div class="l">Gross Profit</div><div class="v pos">${usd(grossProfit)}</div></div>
        <div class="stat"><div class="l">Gross Loss</div><div class="v neg">${usd(grossLoss)}</div></div>
    </div>
    ${accountBlock}

    <div class="section">Performance Breakdown <small>Where the edge is coming from</small></div>
    <div class="grid-3">
        ${breakdownTable('By Session', bySession, 'Session')}
        ${breakdownTable('By Direction', byDirection, 'Direction')}
    </div>
    <div style="margin-top:12px">${breakdownTable('By Currency Pair', byPair, 'Pair')}</div>

    <div class="section">Trade Log <small>${n} executed trades · oldest to newest</small></div>
    <table class="log">
        <thead>
            <tr><th>#</th><th>Date</th><th>Pair / Side</th><th>Session</th><th>Setup Score</th><th class="num">R:R</th><th class="num">SL / TP</th><th class="num">PnL</th><th>Result</th></tr>
        </thead>
        ${rowsHtml}
    </table>

    <div class="footer">
        <div class="disclaimer"><b>MintPip Trading Journal &amp; Analytics Hub.</b> This report is generated from your own recorded trades for the selected period and account. Figures are for personal performance review only and do not constitute financial advice. Past performance does not guarantee future results.</div>
        <div style="text-align:right">${accountName}<br/>${reportId}<br/>${generatedAt}</div>
    </div>
</body>
</html>`;

            printWindow.document.open();
            printWindow.document.write(htmlContent);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
                printWindow.print();
            }, 900);
        }, 300);
    };

    const getDaysInMonth = (month, year) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (month, year) => {
        let day = new Date(year, month, 1).getDay();
        return day === 0 ? 6 : day - 1;
    };

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const daysInCurrentMonth = getDaysInMonth(calMonth, calYear);
    const firstDayIndex = getFirstDayOfMonth(calMonth, calYear);

    const tradesByDateMap = {};
    trades.forEach(t => {
        if (t.date && t.date !== 'N/A') {
            const dKey = t.date.split(' ')[0];
            if (!tradesByDateMap[dKey]) tradesByDateMap[dKey] = [];
            tradesByDateMap[dKey].push(t);
        }
    });

    const handleCalendarDateClick = (dateKey) => {
        const dayTrades = tradesByDateMap[dateKey] || [];
        if (dayTrades.length > 0) {
            setSelectedDateTrades(dayTrades);
            setSelectedDateTitle(`Trades Executed on ${dateKey}`);
            setIsDateModalOpen(true);
        }
    };

    return (
        <div style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }} className={`mp-root mp-t-${uiTheme} ${bootDone ? 'mp-ready' : ''} min-h-screen flex flex-col antialiased [font-variant-numeric:tabular-nums] transition-colors duration-300 ${isDark ? 'mp-dark bg-[#070B16] text-slate-200' : 'mp-light bg-[#F4F6FB] text-slate-800'}`}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
                @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');
                .mp-dark{background-image:radial-gradient(900px 480px at 10% -8%,rgba(99,102,241,.17),transparent 60%),radial-gradient(760px 420px at 100% 0%,rgba(139,92,246,.10),transparent 55%);background-attachment:fixed}
                .mp-root h1,.mp-root h2,.mp-root h3{letter-spacing:-.015em}
                .mp-root header{backdrop-filter:blur(14px) saturate(1.4)}
                .mp-root ::selection{background:rgba(99,102,241,.4)}
                .mp-root *::-webkit-scrollbar{width:10px;height:10px}
                .mp-root *::-webkit-scrollbar-thumb{background:rgba(129,140,248,.3);border-radius:99px;border:2px solid transparent;background-clip:padding-box}
                .mp-root :focus-visible{outline:2px solid #818CF8;outline-offset:2px}
                .mp-root input:focus,.mp-root select:focus,.mp-root textarea:focus{outline:none;border-color:#6366F1!important;box-shadow:0 0 0 3px rgba(99,102,241,.22)}
                .mp-root button{transition:transform .15s,box-shadow .2s,background-color .2s,border-color .2s,color .2s}
                .mp-root button:active{transform:scale(.97)}
                .mp-dark [class*="bg-[#0E1426]"].rounded-2xl,.mp-dark [class*="bg-[#0E1426]"].rounded-3xl{background-image:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,0) 60%);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 18px 40px -22px rgba(0,0,0,.75)}
                .mp-light [class*="bg-white"].rounded-2xl{box-shadow:0 1px 2px rgba(15,23,42,.04),0 14px 32px -20px rgba(15,23,42,.18)}
                .mp-root [class~="bg-[#6366F1]"].text-white{background-image:linear-gradient(135deg,#6366F1,#8B5CF6);box-shadow:0 8px 20px -8px rgba(99,102,241,.7)}
                /* ---------- Glassmorphism ---------- */
                .mp-root{isolation:isolate}
                .mp-dark::before,.mp-dark::after{content:"";position:fixed;z-index:-1;pointer-events:none;border-radius:50%;filter:blur(90px);will-change:transform}
                .mp-dark::before{width:520px;height:520px;top:-140px;left:-120px;background:rgba(99,102,241,.32);animation:mp-float-a 22s ease-in-out infinite alternate}
                .mp-dark::after{width:460px;height:460px;bottom:-160px;right:-100px;background:rgba(139,92,246,.26);animation:mp-float-b 26s ease-in-out infinite alternate}
                .mp-dark [class*="rounded-2xl"][class*="bg-[#0E1426]"],.mp-dark [class*="rounded-3xl"][class*="bg-[#0E1426]"],.mp-dark [class*="rounded-2xl"][class*="bg-[#141B30]"]{background-color:rgba(20,27,48,.52)!important;backdrop-filter:blur(18px) saturate(1.6);-webkit-backdrop-filter:blur(18px) saturate(1.6);border-color:rgba(255,255,255,.09)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 20px 50px -24px rgba(0,0,0,.8)}
                .mp-dark [class*="bg-[#141B30]"]:not([class*="rounded-2xl"]){background-color:rgba(20,27,48,.5)!important;border-color:rgba(255,255,255,.08)!important}
                .mp-dark header{background-color:rgba(7,11,22,.55)!important;border-color:rgba(255,255,255,.08)!important}
                .mp-dark .fixed.inset-0{backdrop-filter:blur(10px) saturate(1.2)}
                .mp-light{background-image:radial-gradient(700px 420px at 8% -5%,rgba(99,102,241,.14),transparent 60%),radial-gradient(600px 380px at 100% 0%,rgba(139,92,246,.12),transparent 55%)}
                .mp-light [class*="rounded-2xl"][class*="bg-white"]{background-color:rgba(255,255,255,.66)!important;backdrop-filter:blur(16px) saturate(1.5);border-color:rgba(99,102,241,.16)!important;box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 16px 40px -22px rgba(79,70,229,.28)}
                .mp-light header{background-color:rgba(255,255,255,.6)!important}
                /* ---------- Animation ---------- */
                @keyframes mp-float-a{to{transform:translate(160px,120px) scale(1.15)}}
                @keyframes mp-float-b{to{transform:translate(-140px,-110px) scale(1.2)}}
                @keyframes mp-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
                @keyframes mp-pop{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
                @keyframes mp-fade{from{opacity:0}to{opacity:1}}
                @keyframes mp-toast{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:none}}
                @keyframes mp-glow{0%,100%{box-shadow:0 8px 20px -8px rgba(99,102,241,.6)}50%{box-shadow:0 8px 30px -6px rgba(139,92,246,.95)}}
                .mp-root:not(.mp-ready) main [class*="rounded-2xl"]{opacity:0}
                .mp-ready main [class*="rounded-2xl"]{animation:mp-rise 1.7s cubic-bezier(.22,1,.36,1) backwards}
                .mp-root main [class*="rounded-2xl"]{transition:transform .8s cubic-bezier(.22,1,.36,1),border-color .7s ease,box-shadow .7s ease}
                .mp-root main [class*="rounded-2xl"]:nth-child(2){animation-delay:.18s}
                .mp-root main [class*="rounded-2xl"]:nth-child(3){animation-delay:.36s}
                .mp-root main [class*="rounded-2xl"]:nth-child(4){animation-delay:.54s}
                .mp-root main [class*="rounded-2xl"]:nth-child(5){animation-delay:.72s}
                .mp-root main [class*="rounded-2xl"]:nth-child(n+6){animation-delay:.9s}
                .mp-root .fixed.inset-0{animation:mp-fade .6s ease both}
                .mp-root .fixed.inset-0>div{animation:mp-pop .8s cubic-bezier(.22,1,.36,1) both}
                .mp-root .fixed.bottom-6.right-6{animation:mp-toast .8s cubic-bezier(.22,1,.36,1) both}
                .mp-root main [class*="rounded-2xl"]:hover{border-color:rgba(129,140,248,.55)!important;box-shadow:0 0 0 1px rgba(129,140,248,.25),0 18px 44px -26px rgba(99,102,241,.5)}
                .mp-root main .mp-kpi>[class*="rounded-2xl"]:hover{transform:translateY(-4px)}
                .mp-root [class~="bg-[#6366F1]"].text-white{background-size:200% 100%;transition:background-position 1s ease,transform .3s,box-shadow .4s}
                .mp-root [class~="bg-[#6366F1]"].text-white:hover{background-position:100% 0;transform:translateY(-1px)}
                .mp-root header [class~="bg-[#6366F1]"].text-white{animation:mp-glow 3.2s ease-in-out infinite}
                .mp-root tbody tr{transition:background-color .2s}
                .mp-root tbody tr:hover{background-color:rgba(99,102,241,.08)}
                @media (prefers-reduced-motion:reduce){.mp-root *,.mp-root::before,.mp-root::after{animation:none!important;transition:none!important}}
                /* ---------- Splash ---------- */
                .mp-splash{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(600px 420px at 50% 42%,rgba(99,102,241,.28),transparent 65%),#050816;color:#fff;transition:opacity 1.2s ease,transform 1.2s ease,visibility 1.2s}
                .mp-splash-out{opacity:0;transform:scale(1.06);visibility:hidden;pointer-events:none}
                .mp-splash-core{position:relative;width:132px;height:132px;display:flex;align-items:center;justify-content:center}
                .mp-ring{position:absolute;inset:0;border-radius:50%;border:2px solid transparent}
                .mp-r1{border-top-color:#818CF8;border-right-color:rgba(129,140,248,.25);animation:mp-spin 1.2s linear infinite}
                .mp-r2{inset:14px;border-bottom-color:#A78BFA;border-left-color:rgba(167,139,250,.25);animation:mp-spin 1.8s linear infinite reverse}
                .mp-logo{width:64px;height:64px;border-radius:20px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(135deg,#6366F1,#8B5CF6);animation:mp-breathe 1.8s ease-in-out infinite}
                .mp-splash-title{margin-top:28px;font-size:26px;font-weight:800;letter-spacing:-.02em}
                .mp-splash-sub{margin-top:6px;font-size:12px;color:#94A3B8;animation:mp-fade 1.2s ease infinite alternate}
                .mp-bar{margin-top:26px;width:170px;height:3px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
                .mp-bar i{display:block;height:100%;width:40%;border-radius:99px;background:linear-gradient(90deg,#6366F1,#A78BFA);animation:mp-slide 1.3s ease-in-out infinite}
                @keyframes mp-spin{to{transform:rotate(360deg)}}
                @keyframes mp-breathe{0%,100%{transform:scale(1);box-shadow:0 0 30px rgba(99,102,241,.5)}50%{transform:scale(1.08);box-shadow:0 0 60px rgba(139,92,246,.85)}}
                @keyframes mp-slide{0%{transform:translateX(-110%)}100%{transform:translateX(330%)}}
                /* ---------- Command palette ---------- */
                .mp-cmd-wrap{position:fixed;inset:0;z-index:90;display:flex;justify-content:center;align-items:flex-start;padding-top:14vh;background:rgba(3,6,18,.6);backdrop-filter:blur(8px);animation:mp-fade .2s ease both}
                .mp-cmd{width:min(620px,92vw);border-radius:20px;overflow:hidden;background:rgba(14,20,38,.88);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px -20px rgba(0,0,0,.8);animation:mp-pop .6s cubic-bezier(.22,1,.36,1) both;color:#E2E8F0}
                .mp-cmd-input{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
                .mp-cmd-input input{flex:1;background:transparent;border:0;outline:0;font-size:14px;color:#fff;box-shadow:none!important}
                .mp-cmd-input kbd{font-size:10px;padding:2px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.15);color:#94A3B8}
                .mp-cmd-list{max-height:340px;overflow:auto;padding:8px}
                .mp-cmd-list button{display:flex;width:100%;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;font-size:13px;font-weight:600;text-align:left}
                .mp-cmd-list button:hover{background:rgba(99,102,241,.18)}
                .mp-cmd-meta{font-size:11px;color:#94A3B8;font-weight:500}
                .mp-cmd-empty{padding:18px;text-align:center;font-size:12px;color:#94A3B8}
                /* ---------- Light mode repairs (dark-only classes that leaked into light theme) ---------- */
                .mp-light [class*="bg-slate-800"]:not(.text-white),.mp-light [class*="bg-slate-900"]:not(.text-white),.mp-light [class*="bg-[#0E1426]"],.mp-light [class*="bg-[#141B30]"],.mp-light [class*="bg-[#19223A]"],.mp-light [class*="bg-[#070B16]"],.mp-light [class*="bg-[#0B1020]"]{background-color:#EEF2F9!important;border-color:rgba(15,23,42,.1)!important;color:#334155}
                .mp-light [class~="bg-white/5"],.mp-light [class~="bg-white/10"],.mp-light [class~="hover:bg-white/5"]:hover,.mp-light [class~="hover:bg-white/10"]:hover{background-color:rgba(15,23,42,.05)!important}
                .mp-light [class*="border-white/"],.mp-light [class*="border-[#232C45]"]{border-color:rgba(15,23,42,.1)!important}
                .mp-light [class*="divide-white"]>*{border-color:rgba(15,23,42,.08)!important}
                .mp-light .text-white{color:#0F172A}
                .mp-light [class~="bg-[#6366F1]"] .text-white,.mp-light [class*="bg-[#8B5CF6]"] .text-white,.mp-light [class*="bg-indigo-"] .text-white,.mp-light [class*="bg-emerald-"] .text-white,.mp-light [class*="bg-rose-"] .text-white,.mp-light [class*="bg-black"] .text-white,
                .mp-light [class~="bg-[#6366F1]"].text-white,.mp-light [class*="bg-[#8B5CF6]"].text-white,.mp-light [class*="bg-indigo-"].text-white,.mp-light [class*="bg-emerald-"].text-white,.mp-light [class*="bg-rose-"].text-white,.mp-light [class*="bg-black"].text-white{color:#fff}
                .mp-light .text-slate-100,.mp-light .text-slate-200,.mp-light .text-slate-300{color:#334155}
                .mp-light .text-slate-400{color:#64748B}
                .mp-light input,.mp-light select,.mp-light textarea{color:#0F172A}
                .mp-light input::placeholder,.mp-light textarea::placeholder{color:#94A3B8}
                .mp-light .mp-cmd-input input{color:#fff}
                .mp-light .mp-cmd .text-slate-400{color:#94A3B8}
                /* ---------- Light mode: solid modals, readable headings & buttons ---------- */
                .mp-light .fixed.inset-0{background-color:rgba(15,23,42,.5)!important;backdrop-filter:blur(8px)}
                .mp-light .fixed.inset-0 [class*="rounded-2xl"]{background-color:#F8FAFC!important;border-color:#E2E8F0!important;backdrop-filter:none!important;box-shadow:0 1px 2px rgba(15,23,42,.05)!important}
                .mp-light .fixed.inset-0>div[class*="rounded-2xl"]{background-color:#FFFFFF!important;border-color:#E2E8F0!important;box-shadow:0 40px 90px -30px rgba(15,23,42,.55)!important}
                .mp-light [class*="bg-slate-8"].text-white{background-color:#1E293B!important;color:#fff!important;border-color:transparent!important}
                .mp-light [class*="bg-slate-8"].text-white:hover{background-color:#334155!important}
                .mp-light .text-amber-300,.mp-light .text-amber-400,.mp-light .text-amber-500{color:#4338CA}
                .mp-light .text-slate-500{color:#475569}
                .mp-light [class*="text-[#6366F1]"]{color:#4F46E5}
                .mp-light thead th,.mp-light thead td{color:#475569}
                /* ---------- Form controls: selects, dropdown lists, checkboxes, date ---------- */
                .mp-dark select,.mp-dark input[type="date"],.mp-dark input[type="time"]{color-scheme:dark}
                .mp-light select,.mp-light input[type="date"],.mp-light input[type="time"]{color-scheme:light}
                .mp-root select{-webkit-appearance:none;appearance:none;cursor:pointer;padding-right:2.6rem!important;background-repeat:no-repeat;background-position:right .95rem center;background-size:16px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23A5B4FC' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");transition:border-color .3s ease,box-shadow .3s ease}
                .mp-light select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234F46E5' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")}
                .mp-root select:hover{border-color:rgba(129,140,248,.55)!important}
                .mp-dark select option,.mp-dark select optgroup{background-color:#0E1426;color:#E2E8F0;padding:10px 12px}
                .mp-dark select option[value=""]{color:#94A3B8}
                .mp-dark select option:checked,.mp-dark select option:hover{background:#4F46E5 linear-gradient(#4F46E5,#4F46E5);color:#fff}
                .mp-light select option{background-color:#fff;color:#0F172A}
                .mp-light select option:checked{background:#4F46E5 linear-gradient(#4F46E5,#4F46E5);color:#fff}
                .mp-root input[type="checkbox"]{-webkit-appearance:none;appearance:none;width:18px;height:18px;flex-shrink:0;border-radius:6px;border:1.5px solid rgba(148,163,184,.55);background-color:rgba(148,163,184,.08);display:inline-grid;place-content:center;cursor:pointer;transition:background-color .3s ease,border-color .3s ease,box-shadow .3s ease}
                .mp-root input[type="checkbox"]:hover{border-color:#818CF8}
                .mp-root input[type="checkbox"]:checked{background-image:linear-gradient(135deg,#6366F1,#8B5CF6);border-color:transparent;box-shadow:0 4px 12px -3px rgba(99,102,241,.7)}
                .mp-root input[type="checkbox"]:checked::after{content:"";width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg) translate(-1px,-1px)}
                .mp-light input[type="checkbox"]{border-color:#94A3B8;background-color:#fff}
                .mp-root input[type="date"]{cursor:pointer}
                /* ---------- Interface style switch button ---------- */
                .mp-theme-fab{position:fixed;left:16px;bottom:16px;z-index:60;display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:99px;font-size:11px;font-weight:700;cursor:pointer;color:#E2E8F0;background:rgba(14,20,38,.82);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(12px);box-shadow:0 12px 30px -12px rgba(0,0,0,.7)}
                .mp-theme-fab:hover{border-color:rgba(129,140,248,.6)}
                .mp-light .mp-theme-fab{color:#334155;background:rgba(255,255,255,.9);border-color:#CBD5E1}
                /* ---------- TERMINAL PRO style (Bloomberg / TradingView inspired) ---------- */
                .mp-t-terminal{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace!important}
                .mp-t-terminal [class*="rounded-"]:not([class*="rounded-full"]){border-radius:5px!important}
                .mp-t-terminal h1,.mp-t-terminal h2,.mp-t-terminal h3{letter-spacing:0}
                .mp-t-terminal.mp-dark{background-image:none!important;background-color:#08090B!important}
                .mp-t-terminal.mp-dark::before,.mp-t-terminal.mp-dark::after{display:none}
                .mp-t-terminal.mp-dark [class*="bg-[#0E1426]"],.mp-t-terminal.mp-dark [class*="bg-[#141B30]"]{background-image:none!important;backdrop-filter:none!important;box-shadow:none!important}
                .mp-t-terminal.mp-dark [class*="bg-[#0E1426]"]{background-color:#0F1115!important;border-color:#23262D!important}
                .mp-t-terminal.mp-dark [class*="bg-[#141B30]"]{background-color:#14171C!important;border-color:#2A2E36!important}
                .mp-t-terminal.mp-dark header{background-color:#0B0C0F!important;border-color:#23262D!important;backdrop-filter:none}
                .mp-t-terminal.mp-dark .fixed.inset-0{background-color:rgba(0,0,0,.72)!important}
                .mp-t-terminal.mp-dark .text-slate-400{color:#8B93A3}
                .mp-t-terminal main [class*="rounded-2xl"]:hover{border-color:rgba(245,165,36,.55)!important;box-shadow:none!important}
                .mp-t-terminal main .mp-kpi>[class*="rounded-2xl"]:hover{transform:none}
                .mp-t-terminal [class*="text-indigo"],.mp-t-terminal [class*="text-violet"],.mp-t-terminal [class*="text-[#6366F1]"],.mp-t-terminal [class*="text-[#8B5CF6]"],.mp-t-terminal [class*="text-[#A78BFA]"],.mp-t-terminal [class*="text-[#C4B5FD]"],.mp-t-terminal [class*="text-[#4F46E5]"]{color:#F5A524!important}
                .mp-t-terminal.mp-light [class*="text-indigo"],.mp-t-terminal.mp-light [class*="text-violet"],.mp-t-terminal.mp-light [class*="text-[#6366F1]"],.mp-t-terminal.mp-light [class*="text-[#4F46E5]"]{color:#B45309!important}
                .mp-t-terminal [class*="bg-indigo-"],.mp-t-terminal [class*="bg-violet-"],.mp-t-terminal [class*="bg-[#6366F1]/"],.mp-t-terminal [class*="bg-[#8B5CF6]/"]{background-color:rgba(245,165,36,.13)!important;border-color:rgba(245,165,36,.35)!important}
                .mp-t-terminal [class*="bg-indigo-500"]:not([class*="/"]){background-color:#F5A524!important}
                .mp-t-terminal [class*="border-indigo"],.mp-t-terminal [class*="border-violet"],.mp-t-terminal [class*="border-[#6366F1]"]{border-color:rgba(245,165,36,.5)!important}
                .mp-t-terminal [class~="bg-[#6366F1]"],.mp-t-terminal [class~="bg-[#7C3AED]"],.mp-t-terminal [class~="bg-[#8B5CF6]"],.mp-t-terminal [class*="bg-indigo-"].text-white,.mp-t-terminal [class*="bg-violet-"].text-white{background-image:none!important;background-color:#F5A524!important;color:#0B0C0F!important;box-shadow:none!important;animation:none!important}
                .mp-t-terminal [class*="file:bg-[#7C3AED]"]::file-selector-button{background:#F5A524!important;color:#0B0C0F!important}
                .mp-t-terminal input:focus,.mp-t-terminal select:focus,.mp-t-terminal textarea:focus{border-color:#F5A524!important;box-shadow:0 0 0 2px rgba(245,165,36,.2)!important}
                .mp-t-terminal input[type="checkbox"]:checked{background-image:none!important;background-color:#F5A524;box-shadow:none}
                .mp-t-terminal input[type="checkbox"]:checked::after{border-color:#0B0C0F}
                .mp-t-terminal ::selection{background:rgba(245,165,36,.35)}
                .mp-t-terminal :focus-visible{outline-color:#F5A524}
                .mp-t-terminal *::-webkit-scrollbar-thumb{background:rgba(245,165,36,.3)}
                .mp-t-terminal .mp-theme-fab{border-color:rgba(245,165,36,.45);color:#F5A524}
                .mp-t-terminal.mp-dark select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23F5A524' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")}
                .mp-t-terminal.mp-dark select option:checked,.mp-t-terminal.mp-dark select option:hover{background:#F5A524 linear-gradient(#F5A524,#F5A524);color:#0B0C0F}
                .mp-t-terminal .mp-splash{background:#08090B}
                .mp-t-terminal .mp-logo{background:#F5A524;color:#0B0C0F}
                .mp-t-terminal .mp-r1{border-top-color:#F5A524}.mp-t-terminal .mp-r2{border-bottom-color:#FDE68A}
                .mp-t-terminal .mp-bar i{background:#F5A524}
                .mp-light .text-emerald-300, .mp-light .text-emerald-400, .mp-light .text-emerald-500 { color: #047857; }
                .mp-light .text-rose-300, .mp-light .text-rose-400, .mp-light .text-rose-500 { color: #be123c; }
                .mp-light .text-amber-300, .mp-light .text-amber-400, .mp-light .text-amber-500 { color: #92400e; }
                .mp-light .text-indigo-300, .mp-light .text-indigo-400, .mp-light .text-indigo-500 { color: #4338ca; }
                .mp-light .text-\\[\\#A78BFA\\], .mp-light .text-\\[\\#8B5CF6\\], .mp-light .text-\\[\\#C4B5FD\\] { color: #6d28d9; }
            `}</style>


            <Splash done={bootDone} />

            {cmdOpen && (() => {
                const q = cmdQ.trim().toLowerCase();
                const nav = [
                    { label: 'Switch interface style (Aurora / Terminal Pro)', run: toggleUiTheme },
                    { label: 'Go to Overview', run: () => setActiveTab('overview') },
                    { label: 'Go to Analytics', run: () => setActiveTab('analytics') },
                    { label: 'Go to Calendar & Reports', run: () => setActiveTab('calendar') },
                    { label: 'Go to Funded Accounts', run: () => setActiveTab('accounts') },
                    { label: 'Switch to Forward Test data', run: () => setActiveDatabase('live') },
                    { label: 'Switch to Backtest data', run: () => setActiveDatabase('backtest') }
                ].filter(i => !q || i.label.toLowerCase().includes(q));
                const found = q ? trades.filter(t => `${t.pair} ${t.date} ${t.session} ${t.direction}`.toLowerCase().includes(q)).slice(0, 8) : [];
                const pick = (fn) => { fn(); setCmdOpen(false); };
                return (
                    <div className="mp-cmd-wrap" onClick={() => setCmdOpen(false)}>
                        <div className="mp-cmd" onClick={(e) => e.stopPropagation()}>
                            <div className="mp-cmd-input"><Ico n="search" className="w-4 h-4 text-slate-400" />
                                <input autoFocus value={cmdQ} onChange={(e) => setCmdQ(e.target.value)} placeholder="Search trades by pair, date, session… or jump to a page" />
                                <kbd>Esc</kbd>
                            </div>
                            <div className="mp-cmd-list">
                                {nav.map(i => <button key={i.label} onClick={() => pick(i.run)}>{i.label}</button>)}
                                {found.map((t, idx) => (
                                    <button key={idx} onClick={() => pick(() => { setSelectedTrade(t); setIsDetailsOpen(true); })}>
                                        <span>{t.pair} · {t.direction}</span><span className="mp-cmd-meta">{t.date} · {fmtSigned(t.pnl)}</span>
                                    </button>
                                ))}
                                {!nav.length && !found.length && <p className="mp-cmd-empty">No match. Try a pair name like EURUSD.</p>}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Top notification toast pop-up */}
            {appToast.show && (
                <div className="fixed bottom-6 right-6 z-50">
                    <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border text-xs font-bold ${appToast.type === 'success'
                            ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200 shadow-black/30'
                            : 'bg-rose-950/95 border-rose-500/40 text-rose-200 shadow-black/30'
                        }`}>
                        <span className="text-base">{appToast.type === 'success' ? <Ico n="check" className="w-5 h-5" /> : <Ico n="alert" className="w-5 h-5" />}</span>
                        <span>{appToast.message}</span>
                    </div>
                </div>
            )}

            {/* 🌟 Save Result Popup (success / error / validation) */}
            {resultPopup.show && (
                <div onClick={closeResultPopup} className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className={`relative w-full max-w-md rounded-2xl border p-8 text-center shadow-2xl ${isDark ? 'bg-[#0E1426] text-slate-200' : 'bg-white text-slate-800'} ${resultPopup.type === 'success' ? 'border-emerald-500/40 shadow-black/20' : 'border-rose-500/40 shadow-rose-500/20'}`}
                    >
                        <div className={`mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center border-2 ${resultPopup.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-rose-500/10 border-rose-500/40 text-rose-400'}`}>
                            {resultPopup.type === 'success' ? (
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                </svg>
                            ) : (
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            )}
                        </div>

                        <h3 className={`text-xl font-black tracking-tight ${resultPopup.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {resultPopup.title}
                        </h3>
                        <p className={`mt-2 text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                            {resultPopup.message}
                        </p>

                        {resultPopup.items && resultPopup.items.length > 0 && (
                            <ul className={`mt-4 text-left text-xs font-semibold space-y-2 p-4 rounded-2xl border ${isDark ? 'bg-rose-500/5 border-rose-500/20 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                                {resultPopup.items.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-2">
                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <button
                            onClick={closeResultPopup}
                            className={`mt-6 w-full px-5 py-3 rounded-xl text-white text-sm font-bold transition active:scale-95 shadow-md ${resultPopup.type === 'success' ? 'bg-indigo-600 hover:bg-indigo-500 shadow-black/20' : 'bg-rose-600 hover:bg-rose-500 shadow-rose-500/20'}`}
                        >
                            {resultPopup.type === 'success' ? 'Great!' : 'OK, got it'}
                        </button>
                    </div>
                </div>
            )}

            {/* Top Bar */}
            <header className={`sticky top-0 z-30 px-6 lg:px-12 py-3 border-b transition-all duration-300 ${isDark ? 'bg-[#070B16]/80 border-white/15 shadow-2xl shadow-black/40' : 'bg-white/85 border-slate-200/80 shadow-sm'}`}>
                <div className="w-full flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center space-x-6">
                        <div className="flex items-center space-x-3 group cursor-pointer">
                            <div className="relative">
                                
                                <div className="relative w-10 h-10 rounded-2xl bg-[#0E1426] border border-indigo-500/30 flex items-center justify-center text-white font-black text-lg shadow-inner">
                                    <svg className="w-5 h-5 text-[#6366F1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                            </div>
                            <div>
                                <h1 className={`text-lg font-black tracking-tight leading-none ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                    MintPip
                                </h1>
                                <p className={`text-[11px] font-medium tracking-wide mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                    Institutional Analytics Hub
                                </p>
                            </div>
                        </div>

                        <div className={`flex items-center p-1 rounded-xl border ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-slate-100 border-slate-200'}`}>
                            <button
                                onClick={() => setActiveDatabase('live')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeDatabase === 'live'
                                    ? 'bg-[#6366F1] text-white shadow-md'
                                    : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                                    }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${activeDatabase === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`}></span>
                                Forword Test
                            </button>
                            <button
                                onClick={() => setActiveDatabase('backtest')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeDatabase === 'backtest'
                                    ? 'bg-[#6366F1] text-white shadow-md'
                                    : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                                    }`}
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                Backtest Data
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center space-x-2.5">
                        {/* 🌟 Add New Trade Button */}
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-sm active:scale-95"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                            </svg>
                            <span>Add Trade</span>
                        </button>

                        <div className={`hidden xl:flex items-center space-x-2.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold shadow-inner ${isDark ? 'bg-[#0E1426]/80 border-white/10' : 'bg-slate-100/80 border-slate-200'}`}>
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6366F1] opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#6366F1]"></span>
                            </span>
                            <span className={killzoneColor}>{killzoneStatus}</span>
                        </div>

                        <button
                            onClick={() => {
                                setIsAiOpen(true);
                            }}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#A78BFA] text-white text-xs font-bold transition shadow-sm active:scale-95"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>AI Coach</span>
                        </button>

                        <button
                            onClick={toggleUiTheme}
                            className={`h-9 px-3 rounded-xl border transition-all duration-200 flex items-center justify-center gap-2 text-xs font-bold shadow-sm ${uiTheme === 'terminal'
                                ? 'bg-amber-500/15 border-amber-500/50 text-amber-400'
                                : isDark ? 'bg-[#0E1426] hover:bg-[#19223A] border-white/10 text-slate-300' : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'}`}
                            title={uiTheme === 'terminal' ? 'Interface style: Terminal Pro (click for Aurora)' : 'Interface style: Aurora (click for Terminal Pro)'}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M4 17l6-6-6-6M12 19h8" /></svg>
                            <span className="hidden md:inline">{uiTheme === 'terminal' ? 'Terminal' : 'Aurora'}</span>
                        </button>

                        <button
                            onClick={toggleTheme}
                            className={`w-9 h-9 rounded-xl border transition-all duration-200 flex items-center justify-center text-sm shadow-sm ${isDark
                                ? 'bg-[#0E1426] hover:bg-[#19223A] border-white/10 text-amber-400'
                                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                                }`}
                            title="Toggle Theme"
                        >
                            {isDark ? (
                                <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                                </svg>
                            )}
                        </button>

                        <button
                            onClick={() => fetchTrades(false)}
                            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all duration-200 flex items-center gap-2 text-xs shadow-md shadow-indigo-500/20 active:scale-95"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span className="hidden sm:inline">Refresh</span>
                        </button>
                    </div>
                </div>
                <nav className="w-full flex items-center gap-1 mt-3 -mb-3 overflow-x-auto" aria-label="Dashboard sections">
                    {[
                        { id: 'overview', label: 'Overview' },
                        { id: 'analytics', label: 'Analytics' },
                        { id: 'calendar', label: 'Calendar & Reports' },
                            { id: 'accounts', label: 'Accounts' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-2.5 text-xs font-bold border-b-2 whitespace-nowrap transition ${activeTab === tab.id
                                ? 'border-indigo-400 text-indigo-400'
                                : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </header>

            {/* Main Container */}
            <main className="flex-1 w-full px-6 lg:px-12 py-6 space-y-6">

                {/* 📡 Offline / connection-lost banner */}
                {(!isOnline || syncFailed) && (
                    <div className={`flex flex-wrap items-center gap-3 p-4 rounded-2xl border text-xs font-semibold ${isDark ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                        <span className="text-base">📡</span>
                        <div className="flex-1 min-w-[220px]">
                            <b>{!isOnline ? 'You are offline.' : "Can't reach the server / database right now."}</b> Showing the last loaded data. The dashboard keeps retrying and will refresh by itself once the connection is back.
                        </div>
                        <button onClick={() => fetchTrades(false)} className="px-3 py-1.5 rounded-lg bg-amber-500 text-black font-bold hover:bg-amber-400 transition">Retry now</button>
                    </div>
                )}

                {/* 🚨 Loss-limit / loss-streak warnings */}
                {limitAlerts.map((alert, i) => (
                    <div key={i} className={`flex items-start gap-3 p-4 rounded-2xl border text-xs font-bold ${alert.level === 'danger'
                        ? (isDark ? 'bg-rose-500/10 border-rose-500/40 text-rose-300' : 'bg-rose-50 border-rose-300 text-rose-700')
                        : (isDark ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800')}`}>
                        <span className="text-base">{alert.level === 'danger' ? '🛑' : '⚠️'}</span>
                        <span>{alert.text}</span>
                    </div>
                ))}

                <PageToolbar tab={activeTab} isLive={activeDatabase === 'live'} accounts={accounts} activeId={activeAccountId} setActiveId={setActiveAccountId} trades={trades} legacyCount={legacyCount} onManage={() => setActiveTab('accounts')} />

                {activeTab === 'overview' && activeDatabase === 'live' && <AccountGuard account={accounts.find(a => a.id === activeAccountId) || accounts[0]} trades={trades} />}

                {activeTab === 'accounts' && (
                    <AccountsPanel accounts={accounts} onSave={saveAccount} onDelete={deleteAccount} onSelect={setActiveAccountId} activeId={activeAccountId} trades={trades} isLive={activeDatabase === 'live'} />
                )}

                {activeTab === 'overview' && (<>
                {/* KPI Cards Grid */}
                <section className="mp-kpi grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className={`relative p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] group transition-all duration-300 overflow-hidden ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <span className={`absolute inset-x-0 top-0 h-0.5 transition-colors duration-500 ${netNeg ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Total Net PnL ({activeDatabase.toUpperCase()})</span>
                            <div className={`p-2.5 rounded-2xl border shadow-inner transition-colors duration-500 ${netNeg ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline space-x-2 relative z-10">
                            <span className={`text-2xl lg:text-3xl font-black tracking-tight transition-colors duration-500 ${netNeg ? 'text-rose-400' : 'text-emerald-400'}`}><CountUp value={kpiNetProfit} /></span>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border shadow-sm ${netNeg ? 'text-rose-300 bg-rose-500/15 border-rose-500/30' : 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'}`}>{kpiRMultiple}</span>
                        </div>
                    </div>

                    <div className={`relative p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] group transition-all duration-300 overflow-hidden ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <span className="absolute inset-x-0 top-0 h-0.5 bg-indigo-500"></span>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Win Rate</span>
                            <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-[#6366F1] shadow-inner">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline justify-between relative z-10">
                            <span className={`text-2xl lg:text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}><CountUp value={kpiWinRate} /></span>
                            <span className={`text-xs font-semibold px-2.5 py-1 rounded-xl border shadow-sm ${isDark ? 'bg-white/5 border-white/10 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>{kpiWinLossRatio}</span>
                        </div>
                    </div>

                    <div className={`relative p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] group transition-all duration-300 overflow-hidden ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <span className="absolute inset-x-0 top-0 h-0.5 bg-[#8B5CF6]"></span>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Profit Factor & R:R</span>
                            <div className="p-2.5 rounded-2xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 text-[#A78BFA] shadow-inner">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline justify-between relative z-10">
                            <div>
                                <span className="text-2xl lg:text-3xl font-black text-[#A78BFA] tracking-tight ">{kpiProfitFactor}</span>
                                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mt-0.5">Profit Factor</p>
                            </div>
                            <div className="text-right">
                                <span className={`text-lg font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>1:2.0</span>
                                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mt-0.5">Target R:R</p>
                            </div>
                        </div>
                    </div>

                    <div className={`relative p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] group transition-all duration-300 overflow-hidden ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <span className="absolute inset-x-0 top-0 h-0.5 bg-[#8B5CF6]/60"></span>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">{monthMode === 'worst' ? 'Worst Performance Month' : 'Best Performance Month'}</span>
                            <div className={`p-2.5 rounded-2xl border shadow-inner ${monthMode === 'worst' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={monthMode === 'worst' ? "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" : "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"} />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline justify-between mt-1 relative z-10">
                            <div>
                                <span className={`text-xl lg:text-2xl font-black tracking-tight  ${isDark ? 'text-white' : 'text-slate-900'}`}>{bestMonthName === 'N/A' ? <span className="text-slate-500">No data yet</span> : bestMonthName}</span>
                                {bestMonthName !== 'N/A' && <p className={`text-xs font-extrabold mt-0.5 px-2 py-0.5 rounded-lg border inline-block ${monthMode === 'worst' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'}`}>{bestMonthPnL}</p>}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Charts Section */}
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className={`p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] lg:col-span-2 flex flex-col justify-between transition-all duration-300 ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                    <svg className="w-5 h-5 text-[#6366F1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                                    </svg>
                                    Cumulative Equity Growth ({activeDatabase.toUpperCase()})
                                </h2>
                                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Account balance progression over executions</p>
                            </div>
                            {(() => {
                                const rt = rangeTrades(trades, eqRange);
                                const net = rt.reduce((a, t) => a + t.pnl, 0);
                                let c = 0, pk = 0, dd = 0;
                                rt.forEach(t => { c += t.pnl; pk = Math.max(pk, c); dd = Math.max(dd, pk - c); });
                                return (
                                    <div className="flex flex-col items-end gap-2">
                                        <div className="inline-flex p-1 rounded-xl border bg-[#141B30] border-[#232C45]">
                                            {EQ_RANGES.map(([k, label]) => (
                                                <button key={k} onClick={() => setEqRange(k)} className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${eqRange === k ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>
                                            ))}
                                        </div>
                                        <div className="text-[11px] text-slate-400">{rt.length} trades · net <b className={net >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{net >= 0 ? '+' : '-'}${Math.abs(net).toFixed(2)}</b> · max drawdown <b className="text-slate-200">${dd.toFixed(2)}</b></div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="relative h-72 w-full">
                            <canvas ref={equityChartRef}></canvas>
                        </div>
                    </div>

                    <div className={`p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] flex flex-col justify-between transition-all duration-300 ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                                    </svg>
                                    Win / Loss Distribution
                                </h2>
                                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Trade outcome breakdown</p>
                            </div>
                        </div>
                        <div className="relative h-52 w-full flex items-center justify-center">
                            <canvas ref={donutChartRef}></canvas>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-4 text-center text-xs">
                            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner">
                                <span className="block text-emerald-400 font-black text-base">{donutWins}</span>
                                <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Wins</span>
                            </div>
                            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 shadow-inner">
                                <span className="block text-rose-400 font-black text-base">{donutLosses}</span>
                                <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Losses</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Winners and Losers & Performance by Side */}
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className={`p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] lg:col-span-2 space-y-4 ${isDark ? 'bg-[#0E1426]/80 border-white/10' : 'bg-white border-slate-200'}`}>
                        <div>
                            <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                Winners and Losers Breakdown
                            </h2>
                            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Detailed institutional win/loss metrics</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                                    <span className="text-xs font-black text-emerald-400 uppercase tracking-wider">Winners</span>
                                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-xs">{statsData.totalWinners}</span>
                                </div>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-slate-400">Best Win:</span><span className="font-bold text-emerald-400">{statsData.bestWin}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-400">Average Win:</span><span className="font-bold text-emerald-300">{statsData.avgWin}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-400">Max Consecutive Wins:</span><span className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{statsData.maxConsecWins}</span></div>
                                </div>
                            </div>

                            <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-3">
                                <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
                                    <span className="text-xs font-black text-rose-400 uppercase tracking-wider">Losers</span>
                                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold text-xs">{statsData.totalLosers}</span>
                                </div>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-slate-400">Worst Loss:</span><span className="font-bold text-rose-400">{statsData.worstLoss}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-400">Average Loss:</span><span className="font-bold text-rose-300">{statsData.avgLoss}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-400">Max Consecutive Losses:</span><span className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{statsData.maxConsecLosses}</span></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={`p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] flex flex-col justify-between ${isDark ? 'bg-[#0E1426]/80 border-white/10' : 'bg-white border-slate-200'}`}>
                        <div>
                            <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                </svg>
                                Performance by Side
                            </h2>
                            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Buy vs Sell distribution</p>
                        </div>
                        <div className="relative h-44 w-full flex items-center justify-center my-2">
                            <canvas ref={sidePieChartRef}></canvas>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-center text-xs">
                            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                <span className="block text-emerald-400 font-bold">{statsData.buyCount} Trades</span>
                                <span className="text-[10px] text-slate-400">Buy Win Rate: {statsData.buyWinRate}%</span>
                            </div>
                            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                                <span className="block text-[#6366F1] font-bold">{statsData.sellCount} Trades</span>
                                <span className="text-[10px] text-slate-400">Sell Win Rate: {statsData.sellWinRate}%</span>
                            </div>
                        </div>
                    </div>
                </section>

                </>)}

                {activeTab === 'analytics' && (<>
                {/* Secondary Analytics Section */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className={`p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] flex flex-col justify-between transition-all duration-300 ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                    Performance by Session
                                </h2>
                                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>London vs New York Executions</p>
                            </div>
                        </div>
                        <div className="relative h-64 w-full">
                            <canvas ref={sessionChartRef}></canvas>
                        </div>
                    </div>

                    <div className={`p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] flex flex-col justify-between transition-all duration-300 ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                    <svg className="w-5 h-5 text-[#A78BFA]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {currentTimeframeMode === 'weekly' ? 'PnL by Day of the Week' : 'PnL by Month'}
                                </h2>
                                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Identify your most profitable periods</p>
                            </div>
                            <div className={`flex items-center border rounded-2xl p-1 text-xs shadow-inner ${isDark ? 'bg-[#0E1426] border-[#232C45]' : 'bg-slate-100 border-slate-200'}`}>
                                <button onClick={() => switchTimeframe('weekly')} className={`px-3 py-1.5 rounded-xl font-bold transition ${currentTimeframeMode === 'weekly' ? 'bg-[#6366F1] text-white shadow-md' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>Weekly</button>
                                <button onClick={() => switchTimeframe('monthly')} className={`px-3 py-1.5 rounded-xl font-bold transition ${currentTimeframeMode === 'monthly' ? 'bg-[#6366F1] text-white shadow-md' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>Monthly</button>
                            </div>
                        </div>
                        <div className="relative h-64 w-full">
                            <canvas ref={timeframeChartRef}></canvas>
                        </div>
                    </div>
                </section>

                {/* 📊 Advanced Analytics */}
                <section className={`p-6 sm:p-8 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] space-y-6 ${isDark ? 'bg-[#0E1426]/85 border-white/10' : 'bg-white border-slate-200'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 border-slate-700/40">
                        <div>
                            <h2 className={`text-base font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Advanced Analytics</h2>
                            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Risk, drawdown and where your edge really comes from ({activeDatabase === 'live' ? 'Forward Test' : 'Backtest'})</p>
                        </div>
                        <button
                            onClick={() => exportTradesCSV(trades)}
                            disabled={trades.length === 0}
                            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition"
                        >
                            ⬇ Export CSV
                        </button>
                    </div>

                    <RiskRulesPanel
                        acc={activeAcc} global={settings} risk={risk} trades={trades} analytics={analytics} isLive={activeDatabase === 'live'}
                        onSaveAccount={saveAccount} onSaveGlobal={saveGlobalRisk}
                    />

                    {trades.length === 0 ? (
                        <p className="text-xs text-slate-500">No trades loaded yet.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <StatTile isDark={isDark}
                                    label={startBal > 0 ? 'Account Balance' : 'Net PnL'}
                                    value={startBal > 0 ? fmtMoney(analytics.equity) : fmtSigned(analytics.net)}
                                    sub={startBal > 0 ? `Start ${fmtMoney(startBal)} · ${(analytics.net / startBal * 100).toFixed(1)}% return` : 'Set a starting balance in Risk rules'}
                                    tone={analytics.net >= 0 ? 'good' : 'bad'} />
                                <StatTile isDark={isDark}
                                    label="Max Drawdown"
                                    value={fmtMoney(analytics.maxDD)}
                                    sub={startBal > 0 ? `${analytics.maxDDPct.toFixed(1)}% from equity peak` : 'Set a starting balance for %'}
                                    tone={analytics.maxDD > 0 ? 'bad' : 'good'} />
                                <StatTile isDark={isDark}
                                    label="Current Drawdown"
                                    value={fmtMoney(analytics.currentDD)}
                                    sub={analytics.currentDD > 0 && startBal > 0 ? `${analytics.currentDDPct.toFixed(1)}% below peak` : analytics.currentDD > 0 ? 'Below your equity peak' : 'At equity peak'}
                                    tone={analytics.currentDD > 0 ? 'warn' : 'good'} />
                                <StatTile isDark={isDark}
                                    label="Expectancy"
                                    value={fmtSigned(analytics.expectancy)}
                                    sub="Average result per trade"
                                    tone={analytics.expectancy >= 0 ? 'good' : 'bad'} />
                                <StatTile isDark={isDark}
                                    label="Payoff Ratio"
                                    value={analytics.payoff.toFixed(2)}
                                    sub={`Avg win ${fmtMoney(analytics.avgWin)} / avg loss ${fmtMoney(analytics.avgLoss)}`}
                                    tone={analytics.payoff >= 1 ? 'good' : 'warn'} />
                                <StatTile isDark={isDark}
                                    label="Recovery Factor"
                                    value={analytics.recovery.toFixed(2)}
                                    sub="Net profit / max drawdown"
                                    tone={analytics.recovery >= 1 ? 'good' : 'warn'} />
                                <StatTile isDark={isDark}
                                    label="Current Streak"
                                    value={`${analytics.streakLen} ${analytics.streakType === 'Win' ? (analytics.streakLen === 1 ? 'win' : 'wins') : (analytics.streakLen === 1 ? 'loss' : 'losses')}`}
                                    sub={`Best ${statsData.maxConsecWins}W · worst ${statsData.maxConsecLosses}L in a row`}
                                    tone={analytics.streakType === 'Win' ? 'good' : 'bad'} />
                                <StatTile isDark={isDark}
                                    label="Avg Loss vs Risk Target"
                                    value={startBal > 0 ? `${(analytics.avgLoss / startBal * 100).toFixed(2)}%` : '-'}
                                    sub={startBal > 0 ? (risk.riskPct > 0 ? `Target ${risk.riskPct}% of starting balance` : 'Set your risk % target in Risk rules') : 'Set starting balance & risk % in Risk rules'}
                                    tone={startBal > 0 && risk.riskPct > 0 ? ((analytics.avgLoss / startBal * 100) > risk.riskPct ? 'bad' : 'good') : 'neutral'} />
                            </div>

                            <div className={`p-5 rounded-2xl border ${isDark ? 'bg-[#141B30]/70 border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                                <h4 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Drawdown Curve</h4>
                                <p className="text-[11px] text-slate-500 mb-2">How far below your equity peak you were after each trade (lower = deeper drawdown)</p>
                                <DrawdownChart series={analytics.ddSeries} isDark={isDark} />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                <BreakdownCard isDark={isDark} title="By Setup Score" subtitle="Does following more rules win more?" rows={breakdowns.score} />
                                <RuleEdgeCard isDark={isDark} rows={breakdowns.rules} />
                                <BreakdownCard isDark={isDark} title="By Psychological State" subtitle="Win rate and PnL for each mindset" rows={breakdowns.psych} />
                                <BreakdownCard isDark={isDark} title="By Session" rows={breakdowns.session} />
                                <BreakdownCard isDark={isDark} title="By Pair" rows={breakdowns.pair} />
                                <BreakdownCard isDark={isDark} title="By Day of the Week" rows={breakdowns.weekday} />
                                <BreakdownCard isDark={isDark} title="15m FVG Tap" rows={breakdowns.fvg} />
                                <BreakdownCard isDark={isDark} title="SMT Divergence" rows={breakdowns.smt} />
                            </div>
                        </>
                    )}
                </section>

                </>)}

                {activeTab === 'calendar' && (<>
                {/* Performance Calendar & PDF Report Generator */}
                <section className={`p-6 sm:p-8 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] space-y-6 ${isDark ? 'bg-[#0E1426]/85 border-white/10' : 'bg-white border-slate-200'}`}>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-4 border-slate-700/40">
                        <div>
                            <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                Performance Calendar & PDF Report Generator
                            </h2>
                            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Select Month or Custom Date Range, then click PDF Report to export filtered trades and analytics charts.</p>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                            <div className={`flex items-center p-1 rounded-xl border ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-100 border-slate-200'}`}>
                                <button
                                    onClick={() => {
                                        setReportMode('month');
                                        setCustomStartDate('');
                                        setCustomEndDate('');
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${reportMode === 'month' ? 'bg-[#6366F1] text-white shadow-md' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
                                >
                                    Monthly Mode
                                </button>
                                <button
                                    onClick={() => {
                                        setReportMode('custom');
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${reportMode === 'custom' ? 'bg-[#6366F1] text-white shadow-md' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
                                >
                                    Custom Date Range
                                </button>
                            </div>

                            {reportMode === 'month' ? (
                                <div className="flex items-center gap-2">
                                    <select
                                        value={calMonth}
                                        onChange={(e) => setCalMonth(parseInt(e.target.value))}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#141B30] border-[#232C45] text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                    >
                                        {monthNames.map((m, idx) => (
                                            <option key={idx} value={idx}>{m}</option>
                                        ))}
                                    </select>

                                    <select
                                        value={calYear}
                                        onChange={(e) => setCalYear(parseInt(e.target.value))}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#141B30] border-[#232C45] text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                    >
                                        <option value={2025}>2025</option>
                                        <option value={2026}>2026</option>
                                        <option value={2027}>2027</option>
                                    </select>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <div className="flex flex-col">
                                        <span className={`text-[9px] font-bold uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>From Date</span>
                                        <input
                                            type="date"
                                            value={customStartDate}
                                            onChange={(e) => setCustomStartDate(e.target.value)}
                                            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch (_) { } }}
                                            style={{ cursor: 'pointer' }}
                                            className={`py-1.5 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#141B30] border-[#232C45] text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                        />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`text-[9px] font-bold uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>To Date</span>
                                        <input
                                            type="date"
                                            value={customEndDate}
                                            onChange={(e) => setCustomEndDate(e.target.value)}
                                            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch (_) { } }}
                                            style={{ cursor: 'pointer' }}
                                            className={`py-1.5 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#141B30] border-[#232C45] text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                        />
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={exportCustomPDFReport}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-indigo-600 text-white transition text-xs font-bold shadow-sm active:scale-95"
                                title="Export filtered trades and charts as a professional PDF report"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                <span>PDF Report ({reportMode === 'month' ? monthNames[calMonth] : 'Custom'})</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                    </div>

                    <div className="grid grid-cols-7 gap-2">
                        {Array.from({ length: firstDayIndex }).map((_, i) => (
                            <div key={`empty-${i}`} className={`h-24 rounded-2xl border opacity-30 ${isDark ? 'bg-[#141B30]/40 border-white/5' : 'bg-slate-100 border-slate-200'}`}></div>
                        ))}

                        {Array.from({ length: daysInCurrentMonth }).map((_, i) => {
                            const dayNum = i + 1;
                            const formattedMonth = String(calMonth + 1).padStart(2, '0');
                            const formattedDay = String(dayNum).padStart(2, '0');
                            const dateKey = `${calYear}-${formattedMonth}-${formattedDay}`;

                            const dayTrades = tradesByDateMap[dateKey] || [];
                            const hasTrades = dayTrades.length > 0;
                            const dayTotalPnL = dayTrades.reduce((acc, t) => acc + t.pnl, 0);
                            const isProfitable = hasTrades && dayTotalPnL >= 0;

                            return (
                                <div
                                    key={`day-${dayNum}`}
                                    onClick={() => handleCalendarDateClick(dateKey)}
                                    className={`h-24 p-3 rounded-2xl border flex flex-col justify-between transition-all duration-200 ${hasTrades
                                            ? isProfitable
                                                ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)] cursor-pointer transform hover:scale-[1.02]'
                                                : 'bg-rose-500/10 border-rose-500/30 hover:border-rose-400 shadow-[0_0_15px_rgba(239,68,68,0.1)] cursor-pointer transform hover:scale-[1.02]'
                                            : isDark ? 'bg-[#141B30]/70 border-[#232C45] text-slate-500' : 'bg-slate-50 border-slate-200 text-slate-400'
                                        }`}
                                    title={hasTrades ? "Click to view trades for this date" : ""}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{dayNum}</span>
                                        {hasTrades && (
                                            <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border ${isProfitable ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30'}`}>
                                                {dayTrades.length} {dayTrades.length === 1 ? 'trade' : 'trades'}
                                            </span>
                                        )}
                                    </div>

                                    {hasTrades ? (
                                        <div>
                                            <span className={`text-sm font-black block tracking-tight ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {isProfitable ? '+' : ''}${dayTotalPnL.toFixed(2)}
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="text-[10px] text-slate-500 font-medium">No trades</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
                </>)}
            </main>

            
{/* 🌟 FULL ADVANCED ADD TRADE MODAL */}
            {isAddModalOpen && (
                <div onClick={() => closeAddModal()} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
                    <div onClick={(e) => e.stopPropagation()} className={`p-6 sm:p-8 rounded-2xl border max-w-2xl w-full relative shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto ${isDark ? 'bg-[#0E1426] border-white/15 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}>
                        <div className="flex items-center justify-between border-b pb-4 border-slate-700/40">
                            <h3 className="text-lg font-black flex items-center gap-2 text-emerald-400">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                                </svg>
                                {editingPageId ? 'Edit Trade' : 'Add Trade'} ({activeDatabase.toUpperCase()})
                            </h3>
                            <button onClick={() => closeAddModal()} className="w-9 h-9 rounded-xl bg-slate-800/60 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveNewTrade} noValidate className="space-y-4 text-xs">
                            {activeDatabase === 'live' && (
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">ACCOUNT <span className="text-rose-400">*</span></label>
                                    {accounts.length === 0 ? (
                                        <div className="p-3 rounded-xl border text-xs font-bold bg-amber-500/10 border-amber-500/30 text-amber-300">No accounts yet. Create one in the Accounts tab first.</div>
                                    ) : (
                                        <select value={resolveAccountId()} onChange={(e) => setNewTradeForm({ ...newTradeForm, accountId: e.target.value })} className="w-full px-3 py-3 rounded-xl border bg-[#141B30] border-[#232C45] text-slate-200 font-bold">
                                            <option value="">Select account…</option>
                                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.firm || a.type} · {a.phase}</option>)}
                                        </select>
                                    )}
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">DATE</label>
                                    <input 
                                        type="date" 
                                        required
                                        value={newTradeForm.date} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, date: e.target.value})}
                                        onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch (_) { } }}
                                        style={{ cursor: 'pointer' }}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">PAIR & DIRECTION <span className="text-rose-400">*</span></label>
                                    <select 
                                        value={newTradeForm.pairDirection} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, pairDirection: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    >
                                        <option value="" disabled>Select pair & direction...</option>
                                        <option value="GBP/USD - SELL">GBP/USD - SELL</option>
                                        <option value="GBP/USD - BUY">GBP/USD - BUY</option>
                                        <option value="EUR/USD - SELL">EUR/USD - SELL</option>
                                        <option value="EUR/USD - BUY">EUR/USD - BUY</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">SESSION & TIME <span className="text-rose-400">*</span></label>
                                    <select 
                                        value={newTradeForm.session} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, session: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    >
                                        <option value="" disabled>Select session...</option>
                                        <option value="LN SILVER BULLET">LN SILVER BULLET</option>
                                        <option value="NY SILVER BULLET">NY SILVER BULLET</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">15 FVG TAP <span className="text-rose-400">*</span></label>
                                    <select 
                                        value={newTradeForm.fvgTap} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, fvgTap: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    >
                                        <option value="" disabled>Select...</option>
                                        <option value="YES">YES</option>
                                        <option value="NO">NO</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">OUTCOME <span className="text-rose-400">*</span></label>
                                    <select 
                                        value={newTradeForm.outcome} 
                                        onChange={(e) => { const v = e.target.value; setNewTradeForm({...newTradeForm, outcome: v, ...(v === 'Win' ? { lossAmount: '' } : v === 'Loss' ? { profitAmount: '' } : {}) }); }}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    >
                                        <option value="" disabled>Select outcome...</option>
                                        <option value="Win">Win</option>
                                        <option value="Loss">Loss</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block font-bold mb-1 text-slate-400">SMT DIVERGENCE <span className="text-rose-400">*</span></label>
                                <select 
                                    value={newTradeForm.smtDivergence} 
                                    onChange={(e) => setNewTradeForm({...newTradeForm, smtDivergence: e.target.value})}
                                    className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                >
                                    <option value="" disabled>Select SMT divergence...</option>
                                        <option value="NO SMT">NO SMT</option>
                                    <option value="YES (GU HH & EU LH)">YES (GU HH & EU LH)</option>
                                    <option value="YES (GU LH & EU HH)">YES (GU LH & EU HH)</option>
                                    <option value="YES (GU HL & EU LL)">YES (GU HL & EU LL)</option>
                                    <option value="YES (GU LL & EU HL)">YES (GU LL & EU HL)</option>
                                </select>
                            </div>

                            {/* Execution Rules Checkboxes (Setup Score is calculated automatically) */}
                            <div>
                                <label className="block font-bold mb-1 text-slate-400">EXECUTION RULES (Select to calculate Setup Score)</label>
                                <div className={`p-3 rounded-xl border grid grid-cols-1 sm:grid-cols-2 gap-2 ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                                    {[
                                        '1min MSS & FVG Entry',
                                        'SMT Divergence',
                                        'HTF Context (15min FVG)',
                                        'Time Filter',
                                        'Daily Bias Alignment'
                                    ].map(rule => (
                                        <label key={rule} className="flex items-center gap-2 cursor-pointer font-semibold">
                                            <input 
                                                type="checkbox"
                                                checked={newTradeForm.executionRules.includes(rule)}
                                                onChange={(e) => {
                                                    const updated = e.target.checked 
                                                        ? [...newTradeForm.executionRules, rule]
                                                        : newTradeForm.executionRules.filter(r => r !== rule);
                                                    setNewTradeForm({...newTradeForm, executionRules: updated});
                                                }}
                                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <span>{rule}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">ENTRY PRICE <span className="text-rose-400">*</span></label>
                                    <input 
                                        type="number" 
                                        step="0.00001"
                                        placeholder="1.27450"
                                        value={newTradeForm.entryPrice} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, entryPrice: e.target.value})}
                                        onBlur={() => setNewTradeForm(prev => ({ ...prev, entryPrice: formatPrice5(prev.entryPrice) }))}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">SL PRICE <span className="text-rose-400">*</span></label>
                                    <input 
                                        type="number" 
                                        step="0.00001"
                                        placeholder="1.27600"
                                        value={newTradeForm.slPrice} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, slPrice: e.target.value})}
                                        onBlur={() => setNewTradeForm(prev => ({ ...prev, slPrice: formatPrice5(prev.slPrice) }))}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">LOT SIZE & RISK <span className="text-rose-400">*</span></label>
                                    <input 
                                        type="text" 
                                        placeholder="e.g. 1.0"
                                        value={newTradeForm.lotSizeRisk} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, lotSizeRisk: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">PLANE TARGET <span className="text-slate-500 font-semibold">(auto 1:2)</span></label>
                                    <input 
                                        type="text" 
                                        placeholder="1:2 (0p : 0p)"
                                        value={newTradeForm.planeTarget} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, planeTarget: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                                <div className={`transition-all duration-500 ${newTradeForm.outcome === 'Loss' ? 'opacity-35 blur-[2px] pointer-events-none select-none' : ''}`} aria-disabled={newTradeForm.outcome === 'Loss'}>
                                    <label className="block font-bold mb-1 text-slate-400">PROFIT AMOUNT ($)</label>
                                    <input 
                                        type="number" 
                                        step="0.01"
                                        placeholder="e.g. 150"
                                        disabled={newTradeForm.outcome === 'Loss'}
                                        value={newTradeForm.profitAmount} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, profitAmount: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                                <div className={`transition-all duration-500 ${newTradeForm.outcome === 'Win' ? 'opacity-35 blur-[2px] pointer-events-none select-none' : ''}`} aria-disabled={newTradeForm.outcome === 'Win'}>
                                    <label className="block font-bold mb-1 text-slate-400">LOSS AMOUNT ($)</label>
                                    <input 
                                        type="number" 
                                        step="0.01"
                                        placeholder="e.g. 0"
                                        disabled={newTradeForm.outcome === 'Win'}
                                        value={newTradeForm.lossAmount} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, lossAmount: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                            </div>

                            {/* Psychological State */}
                            <div>
                                <label className="block font-bold mb-1 text-slate-400">PSYCHOLOGICAL STATE</label>
                                <div className={`p-3 rounded-xl border grid grid-cols-3 gap-2 ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                                    {['CALM', 'PATIENT', 'FOMO', 'HESITANT', 'ANGREE', 'MOOD'].map(state => (
                                        <label key={state} className="flex items-center gap-2 cursor-pointer font-semibold">
                                            <input 
                                                type="checkbox"
                                                checked={newTradeForm.psychologicalState.includes(state)}
                                                onChange={(e) => {
                                                    const updated = e.target.checked 
                                                        ? [...newTradeForm.psychologicalState, state]
                                                        : newTradeForm.psychologicalState.filter(s => s !== state);
                                                    setNewTradeForm({...newTradeForm, psychologicalState: updated});
                                                }}
                                                className="w-4 h-4 rounded text-[#7C3AED] focus:ring-[#8B5CF6]"
                                            />
                                            <span>{state}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <>
                            {/* Multi-Image URLs for Before & After Charts */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">BEFORE CHART LINKS (one or more, comma separated)</label>
                                    <input 
                                        type="text"
                                        placeholder="https://imgur.com/img1.png, https://imgur.com/img2.png"
                                        value={newTradeForm.beforeCharts} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, beforeCharts: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">AFTER CHART LINKS (one or more, comma separated)</label>
                                    <input 
                                        type="text"
                                        placeholder="https://imgur.com/img1.png, https://imgur.com/img2.png"
                                        value={newTradeForm.afterCharts} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, afterCharts: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                            </div>

                            {/* Direct image file uploads from computer (multiple images allowed) */}
                            <div className="grid grid-cols-2 gap-4">
                                {[
                                    { id: 'before', label: 'BEFORE CHART (Upload Images)', field: 'beforeChartFiles', btn: 'file:bg-[#7C3AED]' },
                                    { id: 'after', label: 'AFTER CHART (Upload Images)', field: 'afterChartFiles', btn: 'file:bg-[#7C3AED]' }
                                ].map(({ id, label, field, btn }) => (
                                    <div key={id}>
                                        <label className="block font-bold mb-1 text-slate-400">
                                            {label} {newTradeForm[field].length > 0 && <span className="text-emerald-400">({newTradeForm[field].length})</span>}
                                        </label>
                                        <input
                                            key={`${id}-file-${formKey}`}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onChange={(e) => {
                                                const picked = Array.from(e.target.files || []);
                                                if (picked.length > 0) {
                                                    setNewTradeForm(prev => ({ ...prev, [field]: [...prev[field], ...picked].slice(0, MAX_IMAGES_PER_CHART) }));
                                                }
                                                e.target.value = ''; // lets you pick more images (or the same one) again
                                            }}
                                            className={`w-full p-2.5 rounded-xl border font-bold file:mr-3 file:px-3 file:py-1 file:rounded-lg file:border-0 ${btn} file:text-white file:text-xs file:font-bold file:cursor-pointer ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                        />
                                        {newTradeForm[field].length > 0 && (
                                            <ul className="mt-2 space-y-1">
                                                {newTradeForm[field].map((file, i) => (
                                                    <li key={`${file.name}-${i}`} className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold ${isDark ? 'bg-[#141B30] border-[#232C45] text-emerald-400' : 'bg-slate-50 border-slate-200 text-emerald-600'}`}>
                                                        <span className="truncate">✓ {file.name}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setNewTradeForm(prev => ({ ...prev, [field]: prev[field].filter((_, idx) => idx !== i) }))}
                                                            className="text-slate-400 hover:text-rose-400 font-bold"
                                                            title="Remove this image"
                                                        >
                                                            ✕
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        <p className="mt-1 text-[10px] text-slate-500">You can add up to {MAX_IMAGES_PER_CHART} images (select several at once, or pick again to add more).</p>
                                    </div>
                                ))}
                            </div>
                            </>

                            <p className="text-[11px] font-semibold text-rose-400">
                                {editingPageId ? 'Editing an existing trade. Images already saved stay as they are, and any images you upload or link here are added to them. All fields marked * are still required.' : '* Required: Pair, Session, FVG Tap, SMT, Outcome, Entry Price, SL Price, Lot Size & Risk, and a Before + After chart image (upload a file or paste a link for each).'}
                            </p>

                            <div>
                                <label className="block font-bold mb-1 text-slate-400">LESSON / MISTAKE (Note)</label>
                                <textarea 
                                    rows="2"
                                    value={newTradeForm.note} 
                                    onChange={(e) => setNewTradeForm({...newTradeForm, note: e.target.value})}
                                    placeholder="Write your execution review or mistakes here..."
                                    className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                ></textarea>
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button 
                                    type="button" 
                                    onClick={() => closeAddModal()} 
                                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold hover:bg-slate-700 transition"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    disabled={isSubmittingTrade}
                                    className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition shadow-sm"
                                >
                                    {isSubmittingTrade ? 'Saving...' : (editingPageId ? 'Update Trade' : 'Save Trade')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 🗑️ Delete confirmation */}
            {confirmDelete.show && confirmDelete.trade && (
                <div onClick={() => !isDeleting && setConfirmDelete({ show: false, trade: null })} className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div onClick={(e) => e.stopPropagation()} className={`w-full max-w-md rounded-2xl border p-8 text-center shadow-2xl ${isDark ? 'bg-[#0E1426] text-slate-200 border-rose-500/40' : 'bg-white text-slate-800 border-rose-300'}`}>
                        <div className="mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center text-3xl bg-rose-500/10 border-2 border-rose-500/40">🗑️</div>
                        <h3 className="text-xl font-black text-rose-400">Delete this trade?</h3>
                        <p className={`mt-2 text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                            {confirmDelete.trade.pair} · {tradeDateKey(confirmDelete.trade) || confirmDelete.trade.date} · {fmtSigned(confirmDelete.trade.pnl)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">This permanently deletes the trade and cannot be undone.</p>
                        <div className="mt-6 flex gap-3">
                            <button disabled={isDeleting} onClick={() => setConfirmDelete({ show: false, trade: null })} className="flex-1 px-4 py-3 rounded-xl bg-slate-800 text-slate-200 text-sm font-bold hover:bg-slate-700 transition">Cancel</button>
                            <button disabled={isDeleting} onClick={handleDeleteTrade} className="flex-1 px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold transition shadow-md shadow-rose-500/20">
                                {isDeleting ? 'Deleting...' : 'Yes, delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Calendar Date Click Trades Modal */}
            {isDateModalOpen && (
                <div onClick={() => setIsDateModalOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div onClick={(e) => e.stopPropagation()} className={`p-6 sm:p-8 rounded-2xl border max-w-6xl w-full relative shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto ${isDark ? 'bg-[#0E1426] border-white/15 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}>

                        <div className="flex items-center justify-between border-b pb-4 border-slate-700/40">
                            <div>
                                <h3 className="text-lg font-black flex items-center gap-2.5 text-amber-400">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {selectedDateTitle}
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">Click any trade row below to inspect full advanced execution details, notes & charts.</p>
                            </div>
                            <button onClick={() => setIsDateModalOpen(false)} className="w-9 h-9 rounded-xl bg-slate-800/60 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">
                                ✕
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse whitespace-nowrap">
                                <thead>
                                    <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-[#232C45] text-slate-400 bg-[#141B30]/80' : 'border-slate-200 text-slate-500 bg-slate-50'}`}>
                                        <th className="py-3 px-4">Pair</th>
                                        <th className="py-3 px-4">Session</th>
                                        <th className="py-3 px-4 text-center">Setup Score</th>
                                        <th className="py-3 px-4">Direction</th>
                                        <th className="py-3 px-4">R:R</th>
                                        <th className="py-3 px-4 text-center">SL / TP</th>
                                        <th className="py-3 px-4">PnL ($)</th>
                                        <th className="py-3 px-4 text-center">Result</th>
                                    </tr>
                                </thead>
                                <tbody className={`divide-y text-xs ${isDark ? 'divide-[#232C45]/40 text-slate-300' : 'divide-slate-100 text-slate-700'}`}>
                                    {selectedDateTrades.map((trade) => {
                                        const isWin = trade.result === 'Win';
                                        return (
                                            <tr
                                                key={trade.id}
                                                onClick={() => { setSelectedTrade(trade); setIsDetailsOpen(true); }}
                                                className={`transition cursor-pointer ${isDark ? 'hover:bg-[#19223A]' : 'hover:bg-blue-50/50'}`}
                                                title="Click anywhere on this row to view full trade details & charts"
                                            >
                                                <td className={`py-3.5 px-4 font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{trade.pair}</td>
                                                <td className="py-3.5 px-4"><span className={`px-2.5 py-1 rounded-lg border text-[11px] ${isDark ? 'bg-[#0E1426] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>{trade.session}</span></td>
                                                <td className="py-3.5 px-4 text-center font-bold text-amber-400 text-[11px]">{trade.setupScore}</td>
                                                <td className={`py-3.5 px-4 font-semibold ${trade.direction === 'LONG' ? 'text-[#6366F1]' : 'text-[#A78BFA]'}`}>{trade.direction}</td>
                                                <td className="py-3.5 px-4 text-slate-400">{trade.rr}</td>
                                                <td className="py-3.5 px-4 text-center">
                                                    <span className="text-rose-400">{trade.slPips}p</span> / <span className="text-emerald-400">{trade.tpPips}p</span>
                                                </td>
                                                <td className={`py-3.5 px-4 font-semibold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                                                    {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                                                </td>
                                                <td className="py-3.5 px-4 text-center">
                                                    <span className={`px-2.5 py-1 rounded-full border text-[10px] font-bold ${isWin ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                                                        {trade.result}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            <span className="text-xs text-slate-400">Tip: Click on any trade row to view lesson notes, PnL, and before/after charts.</span>
                            <button onClick={() => setIsDateModalOpen(false)} className="px-5 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 transition">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* AI performance report (server-side analytics + AI narrative) */}
            <AiReportModal
                open={isAiOpen}
                onClose={() => setIsAiOpen(false)}
                isDark={isDark}
                trades={trades}
                activeDatabase={activeDatabase}
                activeAcc={activeAcc}
                risk={risk}
                apiBase={API_BASE}
            />

            {/* Advanced Trade Details Popup Modal */}
            {isDetailsOpen && selectedTrade && (
                <div onClick={() => setIsDetailsOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
                    <div onClick={(e) => e.stopPropagation()} className={`p-6 sm:p-8 rounded-2xl border max-w-3xl w-full relative shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto ${isDark ? 'bg-[#0E1426] border-white/15 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}>

                        <div className="flex items-center justify-between border-b pb-4 border-slate-700/40">
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black border ${selectedTrade.result === 'Win' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                                    {selectedTrade.result === 'Win' ? 'WIN' : 'LOSS'}
                                </div>
                                <div>
                                    <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                                        {selectedTrade.pair}
                                        <span className={`text-xs px-2.5 py-0.5 rounded-lg border font-bold uppercase ${selectedTrade.direction === 'LONG' ? 'bg-indigo-500/10 text-[#6366F1] border-indigo-500/30' : 'bg-[#8B5CF6]/10 text-[#A78BFA] border-[#8B5CF6]/30'}`}>
                                            {selectedTrade.direction}
                                        </span>
                                    </h2>
                                    <p className="text-xs text-slate-400 mt-0.5">Execution Date: <b>{selectedTrade.date}</b> ({selectedTrade.day})</p>
                                </div>
                            </div>
                            <button onClick={() => setIsDetailsOpen(false)} className="w-9 h-9 rounded-xl bg-slate-800/60 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">
                                ✕
                            </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                                <span className="text-slate-400 uppercase tracking-wider text-[10px] block font-semibold">Net PnL</span>
                                <span className={`text-base font-black mt-1 block ${selectedTrade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                                    {selectedTrade.pnl >= 0 ? '+' : ''}${selectedTrade.pnl.toFixed(2)}
                                </span>
                            </div>
                            <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                                <span className="text-slate-400 uppercase tracking-wider text-[10px] block font-semibold">Session</span>
                                <span className={`text-sm font-bold mt-1 block ${isDark ? 'text-white' : 'text-slate-900'}`}>{selectedTrade.session}</span>
                            </div>
                            <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                                <span className="text-slate-400 uppercase tracking-wider text-[10px] block font-semibold">Setup Score</span>
                                <span className="text-sm font-bold mt-1 block text-amber-400">{selectedTrade.setupScore}</span>
                            </div>
                            <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                                <span className="text-slate-400 uppercase tracking-wider text-[10px] block font-semibold">Planned R:R</span>
                                <span className={`text-sm font-bold mt-1 block ${isDark ? 'text-white' : 'text-slate-900'}`}>{selectedTrade.rr}</span>
                            </div>
                        </div>

                        <div className={`p-5 rounded-2xl border space-y-3 ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Risk & Target Parameters</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                                <div className="flex justify-between items-center p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                                    <span className="text-slate-400">Stop Loss (SL):</span>
                                    <span className="font-bold text-rose-400">{selectedTrade.slPips} pips</span>
                                </div>
                                <div className="flex justify-between items-center p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                    <span className="text-slate-400">Take Profit (TP):</span>
                                    <span className="font-bold text-emerald-400">{selectedTrade.tpPips} pips</span>
                                </div>
                            </div>
                        </div>

                        <div className={`p-5 rounded-2xl border space-y-2 ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                            <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#A78BFA] flex items-center gap-1.5">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Lesson / Mistalke (Trade Note)
                            </h4>
                            <p className={`text-xs leading-relaxed whitespace-pre-wrap font-medium ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>
                                {selectedTrade.note}
                            </p>
                        </div>

                        {(selectedTrade.entryPrice !== null || selectedTrade.slPrice !== null || selectedTrade.lotSize !== null || (selectedTrade.rules && selectedTrade.rules.length > 0) || (selectedTrade.psych && selectedTrade.psych.length > 0)) && (
                            <div className={`p-5 rounded-2xl border space-y-3 ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Execution Details</h4>
                                <div className="grid grid-cols-3 gap-3 text-xs">
                                    <div><span className="text-slate-400 block text-[10px] uppercase font-semibold">Entry</span><b>{selectedTrade.entryPrice !== null ? formatPrice5(selectedTrade.entryPrice) : '-'}</b></div>
                                    <div><span className="text-slate-400 block text-[10px] uppercase font-semibold">SL</span><b>{selectedTrade.slPrice !== null ? formatPrice5(selectedTrade.slPrice) : '-'}</b></div>
                                    <div><span className="text-slate-400 block text-[10px] uppercase font-semibold">Lot size & risk</span><b>{selectedTrade.lotSize !== null ? selectedTrade.lotSize : '-'}</b></div>
                                </div>
                                {(selectedTrade.fvgTap || selectedTrade.smt) && (
                                    <div className="text-xs text-slate-400">15m FVG tap: <b className={isDark ? 'text-slate-200' : 'text-slate-800'}>{selectedTrade.fvgTap || '-'}</b> · SMT: <b className={isDark ? 'text-slate-200' : 'text-slate-800'}>{selectedTrade.smt || '-'}</b></div>
                                )}
                                {selectedTrade.rules && selectedTrade.rules.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedTrade.rules.map(r => <span key={r} className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">✓ {r}</span>)}
                                    </div>
                                )}
                                {selectedTrade.psych && selectedTrade.psych.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedTrade.psych.map(x => <span key={x} className="px-2.5 py-1 rounded-lg bg-[#8B5CF6]/10 text-[#A78BFA] border border-[#8B5CF6]/20 text-[10px] font-bold">{x}</span>)}
                                    </div>
                                )}
                            </div>
                        )}

                        {(selectedTrade.beforeCharts.length > 0 || selectedTrade.afterCharts.length > 0) && (
                            <div className="space-y-3">
                                <h4 className="text-xs font-extrabold uppercase tracking-wider text-indigo-400">Execution Screenshots (Before & After)</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {(() => {
                                        const combinedCharts = [
                                            ...selectedTrade.beforeCharts.map((url, idx) => ({ url, type: `Before Chart ${idx + 1}` })),
                                            ...selectedTrade.afterCharts.map((url, idx) => ({ url, type: `After Chart ${idx + 1}` }))
                                        ];

                                        return (
                                            <>
                                                {selectedTrade.beforeCharts.map((url, i) => (
                                                    <div
                                                        key={`before-${i}`}
                                                        className="relative rounded-2xl overflow-hidden border border-white/10 group cursor-pointer"
                                                        onClick={() => {
                                                            setActiveItems(combinedCharts);
                                                            setActiveImgIndex(i);
                                                            setModalTitle(`${selectedTrade.pair} - Execution Gallery`);
                                                            setIsChartOpen(true);
                                                        }}
                                                    >
                                                        <img src={url} alt="Before Chart" className="w-full h-36 object-cover group-hover:scale-105 transition duration-300" />
                                                        <span className="absolute bottom-2 left-2 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md text-[10px] font-bold text-indigo-400 border border-white/10">Before Chart {i + 1}</span>
                                                    </div>
                                                ))}

                                                {selectedTrade.afterCharts.map((url, i) => (
                                                    <div
                                                        key={`after-${i}`}
                                                        className="relative rounded-2xl overflow-hidden border border-white/10 group cursor-pointer"
                                                        onClick={() => {
                                                            setActiveItems(combinedCharts);
                                                            setActiveImgIndex(selectedTrade.beforeCharts.length + i);
                                                            setModalTitle(`${selectedTrade.pair} - Execution Gallery`);
                                                            setIsChartOpen(true);
                                                        }}
                                                    >
                                                        <img src={url} alt="After Chart" className="w-full h-36 object-cover group-hover:scale-105 transition duration-300" />
                                                        <span className="absolute bottom-2 left-2 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md text-[10px] font-bold text-[#A78BFA] border border-white/10">After Chart {i + 1}</span>
                                                    </div>
                                                ))}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                            <div className="flex items-center gap-2">
                                {selectedTrade.pageId && (
                                    <>
                                        <button onClick={() => openEditTrade(selectedTrade)} className="px-4 py-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-bold hover:bg-amber-500/20 transition">
                                            ✏️ Edit
                                        </button>
                                        <button onClick={() => setConfirmDelete({ show: true, trade: selectedTrade })} className="px-4 py-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30 text-xs font-bold hover:bg-rose-500/20 transition">
                                            🗑️ Delete
                                        </button>
                                    </>
                                )}
                            </div>
                            <button onClick={() => setIsDetailsOpen(false)} className="px-5 py-2.5 rounded-xl bg-[#6366F1] text-white text-xs font-bold hover:bg-indigo-600 transition shadow-md shadow-indigo-500/20">
                                Close Details
                            </button>
                        </div>

                    </div>
                </div>
            )}

            {/* Full-Screen Image Gallery Modal with Keyboard & On-screen Arrow Support */}
            {isChartOpen && activeItems.length > 0 && (
                <div onClick={() => setIsChartOpen(false)} className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-6 cursor-pointer">
                    <div onClick={(e) => e.stopPropagation()} className={`p-4 sm:p-6 rounded-2xl border max-w-6xl w-full relative shadow-2xl flex flex-col space-y-4 cursor-default ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[#232C45] gap-3">
                            <div className="flex items-center gap-3">
                                <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                    <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {modalTitle}
                                </h3>
                                <span className={`text-[11px] px-3 py-1 rounded-full font-extrabold uppercase tracking-wider border ${activeItems[activeImgIndex].type.includes('Before')
                                    ? 'bg-indigo-500/10 text-[#6366F1] border-indigo-500/30'
                                    : 'bg-[#8B5CF6]/10 text-[#A78BFA] border-[#8B5CF6]/30'
                                    }`}>
                                    {activeItems[activeImgIndex].type}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                {activeItems.length > 1 && (
                                    <div className={`flex items-center border rounded-2xl p-1 text-xs ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-100 border-slate-200'}`}>
                                        <button
                                            onClick={() => setActiveImgIndex(prev => (prev === 0 ? activeItems.length - 1 : prev - 1))}
                                            className={`px-3 py-1.5 rounded-xl transition font-semibold ${isDark ? 'bg-[#0E1426] hover:bg-[#6366F1] text-white' : 'bg-white hover:bg-slate-200 text-slate-800 shadow-sm'}`}>
                                            <Ico n="left" /> Prev
                                        </button>
                                        <span className={`px-3 font-bold text-xs ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>
                                            {activeImgIndex + 1} / {activeItems.length}
                                        </span>
                                        <button
                                            onClick={() => setActiveImgIndex(prev => (prev === activeItems.length - 1 ? 0 : prev + 1))}
                                            className={`px-3 py-1.5 rounded-xl transition font-semibold ${isDark ? 'bg-[#0E1426] hover:bg-[#6366F1] text-white' : 'bg-white hover:bg-slate-200 text-slate-800 shadow-sm'}`}>
                                            Next <Ico n="right" />
                                        </button>
                                    </div>
                                )}
                                <button onClick={() => setIsChartOpen(false)} className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition text-xs font-bold">
                                    <Ico n="x" /> Close
                                </button>
                            </div>
                        </div>

                        {activeItems.length > 1 && (
                            <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
                                <div className="flex items-center gap-2">
                                    {activeItems.map((item, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setActiveImgIndex(idx)}
                                            className={`px-3 py-1 rounded-xl border font-medium transition whitespace-nowrap ${activeImgIndex === idx
                                                ? 'bg-[#6366F1] text-white border-[#6366F1]'
                                                : isDark ? 'bg-[#141B30] text-slate-400 border-[#232C45] hover:text-white' : 'bg-slate-100 text-slate-600 border-slate-200 hover:text-slate-900'
                                                }`}
                                        >
                                            {item.type}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[10px] text-slate-400 hidden md:inline">Use <b>◀ Left</b> / <b>Right ▶</b> Arrow Keys to shift</span>
                            </div>
                        )}

                        <div className={`relative flex-1 overflow-auto flex items-center justify-center rounded-2xl p-2 min-h-[450px] ${isDark ? 'bg-black/60' : 'bg-slate-100'}`}>
                            {activeItems.length > 1 && (
                                <>
                                    <button
                                        onClick={() => setActiveImgIndex(prev => (prev === 0 ? activeItems.length - 1 : prev - 1))}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/80 text-white transition backdrop-blur-md border border-white/20 shadow-lg"
                                        title="Previous Image (Left Arrow)"
                                    >
                                        <Ico n="left" />
                                    </button>
                                    <button
                                        onClick={() => setActiveImgIndex(prev => (prev === activeItems.length - 1 ? 0 : prev + 1))}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/80 text-white transition backdrop-blur-md border border-white/20 shadow-lg"
                                        title="Next Image (Right Arrow)"
                                    >
                                        <Ico n="right" />
                                    </button>
                                </>
                            )}
                            <img src={activeItems[activeImgIndex].url} alt="Trade Chart" className="max-h-[78vh] w-full object-contain rounded-lg shadow-2xl" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}