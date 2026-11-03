import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';

// Default (empty) state of the Add Trade form
const getDefaultTradeForm = () => ({
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
const ICONS = {
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

export default function App() {
    const [activeDatabase, setActiveDatabase] = useState('live'); // 'live' kinva 'backtest'
    const [trades, setTrades] = useState([]);
    const [currentTimeframeMode, setCurrentTimeframeMode] = useState('weekly');

    const [isDark, setIsDark] = useState(true);
    const [killzoneStatus, setKillzoneStatus] = useState("Checking Sri Lanka Killzone...");
    const [killzoneColor, setKillzoneColor] = useState("text-slate-400");
    const [syncStatus, setSyncStatus] = useState({ text: "Fetching Notion...", dot: "bg-emerald-400", pulse: true });

    // Notion Success Notification Toast State (Top position)
    const [notionToast, setNotionToast] = useState({ show: false, message: "", type: "success" });

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

    // OpenRouter AI Modal States
    const [isAiOpen, setIsAiOpen] = useState(false);
    const [aiAnalysisText, setAiAnalysisText] = useState("");
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [aiTimeframe, setAiTimeframe] = useState('month');
    const [aiLang, setAiLang] = useState('sinhala');
    const [copyBtnText, setCopyBtnText] = useState('Copy Report');

    const [activeItems, setActiveItems] = useState([]);
    const [activeImgIndex, setActiveImgIndex] = useState(0);
    const [modalTitle, setModalTitle] = useState("");

    // KPIs & Advanced Metrics
    const [kpiNetProfit, setKpiNetProfit] = useState("$0.00");
    const [kpiRMultiple, setKpiRMultiple] = useState("+0.0 R");
    const [kpiWinRate, setKpiWinRate] = useState("0%");
    const [kpiWinLossRatio, setKpiWinLossRatio] = useState("0W / 0L");
    const [kpiProfitFactor, setKpiProfitFactor] = useState("0.00");
    const [donutWins, setDonutWins] = useState(0);
    const [donutLosses, setDonutLosses] = useState(0);
    const [bestMonthName, setBestMonthName] = useState("N/A");
    const [bestMonthPnL, setBestMonthPnL] = useState("$0.00");

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
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [settings, setSettings] = useState(() => {
        try {
            const raw = localStorage.getItem('mintpip_settings');
            return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
        } catch (_) { return DEFAULT_SETTINGS; }
    });
    const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [syncFailed, setSyncFailed] = useState(false);
    const fetchNotionRef = useRef(null);

    const startBal = toNum(settings.startingBalance);
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
        check('Daily', todayPnL, toNum(settings.dailyLossLimit), 'Stop trading for today.');
        check('Weekly', weekPnL, toNum(settings.weeklyLossLimit), 'Stop trading for this week.');
        const maxStreak = toNum(settings.maxLossStreak);
        if (maxStreak > 0 && analytics.streakType === 'Loss' && analytics.streakLen >= maxStreak) {
            alerts.push({ level: 'danger', text: `${analytics.streakLen} losses in a row (your limit is ${maxStreak}). Step away and review before the next trade.` });
        }
        return alerts;
    }, [trades, settings, analytics, activeDatabase]);

    // 🗂️ Top tabs (Overview / Analytics / Calendar)
    const [activeTab, setActiveTab] = useState(() => {
        try {
            const v = localStorage.getItem('mintpip_tab');
            return ['overview', 'analytics', 'calendar'].includes(v) ? v : 'overview';
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
        setNotionToast({ show: true, message, type });
        setTimeout(() => {
            setNotionToast(prev => ({ ...prev, show: false }));
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
        fetchNotionData();

        // 🔄 Live sync: poll every 5s (only while the tab is visible) + refresh instantly when the tab regains focus
        const silentRefresh = () => {
            if (!document.hidden) fetchNotionData(true);
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
        const goOnline = () => { setIsOnline(true); if (fetchNotionRef.current) fetchNotionRef.current(true); };
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
    // Switching Live <-> Backtest always lands on Overview, scrolled to the top
    const dbFirstRun = useRef(true);
    useEffect(() => {
        if (dbFirstRun.current) { dbFirstRun.current = false; return; }
        setActiveTab('overview');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [activeDatabase]);
    const fetchNotionData = async (isSilent = false) => {
        try { await fetchNotionDataCore(isSilent); } finally { setDataReady(true); }
    };

    const fetchNotionDataCore = async (isSilent = false) => {
        if (!isSilent) {
            setSyncStatus({ text: `Fetching ${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} Notion...`, dot: "bg-emerald-400", pulse: true });
        }
        const seq = ++fetchSeqRef.current; // ignore out-of-date responses (e.g. after switching database)
        try {
            const response = await fetch(`/api/notion?type=${activeDatabase}`);
            if (seq !== fetchSeqRef.current) return;
            if (response.ok) {
                const fetchedData = await response.json();
                if (seq !== fetchSeqRef.current) return;
                if (fetchedData && fetchedData.results) {
                    setSyncStatus({ text: `${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} Notion Connected`, dot: "bg-emerald-400", pulse: true });
                    setSyncFailed(false);

                    // Only re-render when something really changed in Notion (signed file URLs change on every request, so they are ignored)
                    const signature = JSON.stringify(fetchedData.results, (key, value) => (key === 'url' || key === 'expiry_time') ? undefined : value);
                    const changed = !isSilent || signature !== lastDataSigRef.current;
                    lastDataSigRef.current = signature;
                    if (changed) parseNotionData(fetchedData.results);
                    if (!isSilent) {
                        playSound('win');
                        showToast(`Notion Connected Successfully! (${activeDatabase.toUpperCase()} Database synced)`, 'success');
                    }
                    return;
                }
            }
        } catch (e) { }

        if (seq === fetchSeqRef.current) setSyncFailed(true);
        if (!isSilent) {
            setSyncStatus({ text: "Notion Sync Error", dot: "bg-rose-500", pulse: false });
            playSound('loss');
            showToast(`❌ Notion Sync Failed! Please check API connection.`, 'error');
        }
    };

    fetchNotionRef.current = fetchNotionData;

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

    // 🗑️ Delete (archive) a trade in Notion
    const handleDeleteTrade = async () => {
        const t = confirmDelete.trade;
        if (!t || !t.pageId) return;
        setIsDeleting(true);
        try {
            const response = await fetch(`/api/notion/delete/${t.pageId}`, { method: 'DELETE' });
            if (response.ok) {
                setConfirmDelete({ show: false, trade: null });
                setIsDetailsOpen(false);
                setIsDateModalOpen(false);
                playSound('win');
                showResultPopup('success', 'Trade Deleted', "The trade was moved to Notion's Trash (you can restore it there for 30 days).", [], 3500);
                fetchNotionData(true);
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

    const saveSettings = () => {
        setSettings(settingsDraft);
        try { localStorage.setItem('mintpip_settings', JSON.stringify(settingsDraft)); } catch (_) { }
        setIsSettingsOpen(false);
        showToast('⚙️ Settings saved', 'success');
    };

    // 🌟 Submit new trade to backend API to save in Notion
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

        // ✏️ Editing an existing trade: update the same Notion page (images are left untouched)
        if (editingPageId) {
            try {
                const response = await fetch(`/api/notion/update/${editingPageId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        date: newTradeForm.date,
                        pairDirection: newTradeForm.pairDirection,
                        session: newTradeForm.session,
                        fvgTap: newTradeForm.fvgTap,
                        smtDivergence: newTradeForm.smtDivergence,
                        executionRules: newTradeForm.executionRules,
                        psychologicalState: newTradeForm.psychologicalState,
                        entryPrice: formatPrice5(newTradeForm.entryPrice),
                        slPrice: formatPrice5(newTradeForm.slPrice),
                        planeTarget: newTradeForm.planeTarget,
                        lotSizeRisk: newTradeForm.lotSizeRisk,
                        outcome: newTradeForm.outcome,
                        profitAmount: newTradeForm.profitAmount,
                        lossAmount: newTradeForm.lossAmount,
                        note: newTradeForm.note
                    })
                });
                if (response.ok) {
                    playSound('win');
                    closeAddModal();
                    showResultPopup('success', 'Trade Updated!', 'Your changes were saved to Notion.', [], 3500);
                    fetchNotionData(true);
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
            formData.append('databaseType', activeDatabase); // 'live' or 'backtest'

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
            const response = await fetch('/api/notion/add', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                playSound('win');
                closeAddModal();
                showResultPopup('success', 'Trade Saved!', `Your ${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} trade was successfully saved to Notion.`, [], 3500);


                fetchNotionData(true); // Refresh list immediately (silent, the popup already confirms the save)
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

    const parseNotionData = (results) => {
        // Oldest -> newest (by DATE, then by the time it was added to Notion): newest trade is always last
        const sortedResults = [...results].sort((a, b) => {
            const dA = a.properties?.['DATE']?.date?.start || a.properties?.['Date']?.date?.start || '';
            const dB = b.properties?.['DATE']?.date?.start || b.properties?.['Date']?.date?.start || '';
            if (dA !== dB) return dA < dB ? -1 : 1;
            const cA = a.created_time || '';
            const cB = b.created_time || '';
            if (cA !== cB) return cA < cB ? -1 : 1;
            return 0;
        });

        const parsedTrades = sortedResults.map((item, index) => {
            const props = item.properties;
            const dateStr = props['DATE']?.date?.start || props['Date']?.date?.start || 'N/A';

            let dayOfWeek = 'N/A';
            let monthYearKey = 'N/A';
            if (dateStr !== 'N/A') {
                const d = new Date(dateStr);
                if (!isNaN(d)) {
                    dayOfWeek = d.toLocaleDateString('en-US', { weekday: 'short' });
                    monthYearKey = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                }
            }

            const pairDirectionTag = props['PAIR & DIRECTION']?.select?.name || props['PAIR / ASSET']?.select?.name || props['Pair']?.select?.name || 'GBP/USD - BUY';
            const pair = pairDirectionTag.includes('-') ? pairDirectionTag.split('-')[0].trim() : pairDirectionTag;

            let direction = 'LONG';
            const tagUpper = pairDirectionTag.toUpperCase();
            if (tagUpper.includes('SELL') || tagUpper.includes('SHORT')) direction = 'SHORT';

            const rawSession = props['SESSION & TIME']?.select?.name || props['Session']?.select?.name || 'N/A';
            const rr = props['PLANNED R:R']?.number || props['RR']?.number || 2.0;

            const setupScoreProp = props['SETUP SCORE'] || props['Setup Score'] || props['EXECUTION RULES'];
            let setupScoreVal = 'N/A';
            if (setupScoreProp) {
                if (setupScoreProp.formula) setupScoreVal = setupScoreProp.formula.string || setupScoreProp.formula.number || 'N/A';
                else if (setupScoreProp.select) setupScoreVal = setupScoreProp.select.name;
                else if (setupScoreProp.rich_text) setupScoreVal = setupScoreProp.rich_text.map(t => t.plain_text).join('') || 'N/A';
            }

            const targetProp = props['PLANE TARGET (RR & PIPS)'] || props['SL / TP Pips'] || props['Target'];
            let slPipsVal = '0';
            let tpPipsVal = '0';
            if (targetProp) {
                let targetText = targetProp.formula?.string || targetProp.rich_text?.map(t => t.plain_text).join('') || '';
                const match = targetText.match(/\(([^)]+)\)/);
                if (match && match[1]) {
                    const pipsParts = match[1].split(':');
                    if (pipsParts.length === 2) {
                        slPipsVal = pipsParts[0].trim().replace(/p$/i, '');
                        tpPipsVal = pipsParts[1].trim().replace(/p$/i, '');
                    }
                }
            }

            const rulesArr = (props['EXECUTION RULES']?.multi_select || []).map(o => o.name);
            const psychArr = (props['PSYCHOLOGICAL STATE']?.multi_select || []).map(o => o.name);
            if (setupScoreVal === 'N/A' && rulesArr.length > 0) setupScoreVal = `${rulesArr.length}/5`;
            const numProp = (k) => (typeof props[k]?.number === 'number' ? props[k].number : null);

            const profitAmt = props['PROFITE AMOUNT']?.number || props['Profit Amount']?.number || 0;
            const lossAmt = props['LOSS AMOUNT']?.number || props['Loss Amount']?.number || 0;
            const genericPnL = props['PROFIT/LOSS AMOUNT']?.number || props['PnL']?.number || 0;

            let pnl = genericPnL;
            if (profitAmt > 0) pnl = profitAmt;
            else if (lossAmt > 0) pnl = -Math.abs(lossAmt);

            const outcome = props['OUTCOME']?.select?.name || props['Outcome']?.select?.name || (pnl >= 0 ? 'Win' : 'Loss');

            const beforeFiles = props['BEFORE CHART']?.files || props['Before Chart']?.files || props['Before Images']?.files || props['Before']?.files || [];
            const afterFiles = props['AFTER CHART']?.files || props['After Chart']?.files || props['After Images']?.files || props['After']?.files || [];

            const noteProp = props['LESSON / MISTALKE'] || props['Lesson / Mistalke'] || props['NOTE'] || props['Notes'] || props['NOTE / COMMENT'] || props['Comment'] || props['Description'];
            let noteText = 'නෝට් එකක් නොමැත';
            if (noteProp) {
                if (noteProp.rich_text && noteProp.rich_text.length > 0) {
                    noteText = noteProp.rich_text.map(t => t.plain_text).join('');
                } else if (noteProp.title && noteProp.title.length > 0) {
                    noteText = noteProp.title.map(t => t.plain_text).join('');
                }
            }

            const rawNoteText = (noteProp?.rich_text || noteProp?.title || []).map(t => t.plain_text).join('');

            let normalizedSession = rawSession;
            if (rawSession.toUpperCase().includes('LN') || rawSession.toUpperCase().includes('LONDON')) normalizedSession = 'London Session';
            else if (rawSession.toUpperCase().includes('NY') || rawSession.toUpperCase().includes('NEW YORK')) normalizedSession = 'New York Session';

            return {
                id: index + 1,
                pageId: item.id,
                pairTag: pairDirectionTag,
                sessionRaw: rawSession === 'N/A' ? '' : rawSession,
                fvgTap: props['15 FVG TAP']?.select?.name || '',
                smt: props['SMT DIVERGENCE']?.select?.name || '',
                rules: rulesArr,
                rulesCount: rulesArr.length,
                psych: psychArr,
                entryPrice: numProp('ENTRY PRICE'),
                slPrice: numProp('SL PRICE'),
                lotSize: numProp('LOT SIZE & RISK'),
                profitAmount: numProp('PROFITE AMOUNT'),
                lossAmount: numProp('LOSS AMOUNT'),
                outcomeRaw: props['OUTCOME']?.select?.name || '',
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
                note: noteText.trim() !== '' ? noteText : 'නෝට් එකක් නොමැත',
                beforeCharts: beforeFiles.map(f => f?.file?.url || f?.external?.url).filter(Boolean),
                afterCharts: afterFiles.map(f => f?.file?.url || f?.external?.url).filter(Boolean),
                result: outcome.toLowerCase().includes('win') ? 'Win' : 'Loss'
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

        let bestMonth = 'N/A';
        let highestMonthPnL = -Infinity;
        for (let m in monthlyPnLMap) {
            if (monthlyPnLMap[m] > highestMonthPnL) {
                highestMonthPnL = monthlyPnLMap[m];
                bestMonth = m;
            }
        }

        if (bestMonth !== 'N/A') {
            setBestMonthName(bestMonth);
            setBestMonthPnL(`${highestMonthPnL >= 0 ? '+' : ''}$${highestMonthPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        } else {
            setBestMonthName('N/A');
            setBestMonthPnL('$0.00');
        }

        const totalTrades = data.length;
        const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;
        const profitFactor = totalLossAmount > 0 ? (totalWinAmount / totalLossAmount).toFixed(2) : totalWinAmount.toFixed(2);
        const rMultiple = (totalPnL / 150).toFixed(1);

        setKpiNetProfit(`${totalPnL >= 0 ? '+' : ''}$${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
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
        const sortedTrades = [...data]; // already oldest -> newest

        let cumulative = 0;
        const eqLabels = ['Start', ...sortedTrades.map((_, i) => `T-${i + 1}`)];
        const eqData = [0, ...sortedTrades.map(t => { cumulative += t.pnl; return cumulative; })];

        if (equityInstance.current) equityInstance.current.destroy();
        if (equityChartRef.current) {
            const ctx = equityChartRef.current.getContext('2d');
            const gradient = ctx.createLinearGradient(0, 0, 0, 320);
            gradient.addColorStop(0, 'rgba(99, 102, 241, 0.34)');
            gradient.addColorStop(0.6, 'rgba(99, 102, 241, 0.08)');
            gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

            equityInstance.current = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: eqLabels,
                    datasets: [{
                        data: eqData,
                        borderColor: '#818CF8',
                        borderWidth: 3,
                        borderCapStyle: 'round',
                        fill: true,
                        backgroundColor: gradient,
                        tension: 0.38,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: '#6366F1',
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
                        g.strokeStyle = 'rgba(129,140,248,0.5)';
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
                    datasets: [{ data: [buyCount, sellCount], backgroundColor: ['#6366F1', '#A78BFA'], borderWidth: 0, borderRadius: 10, spacing: 4, hoverOffset: 6 }]
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

        if (reportMode === 'month') {
            const monthName = monthNames[calMonth];
            reportTitleKey = `${monthName} ${calYear}`;
            filteredTrades = trades.filter(t => {
                if (!t.date || t.date === 'N/A') return false;
                const d = new Date(t.date);
                return !isNaN(d) && d.getMonth() === calMonth && d.getFullYear() === calYear;
            });
        } else {
            if (!customStartDate || !customEndDate) {
                alert("⚠️ कृपया From Date आणि To Date दोन्ही नीट निवडा.");
                return;
            }
            reportTitleKey = `${customStartDate} to ${customEndDate}`;
            const sDate = new Date(customStartDate);
            const eDate = new Date(customEndDate);
            eDate.setHours(23, 59, 59, 999);

            filteredTrades = trades.filter(t => {
                if (!t.date || t.date === 'N/A') return false;
                const d = new Date(t.date);
                return !isNaN(d) && d >= sDate && d <= eDate;
            });
        }

        if (filteredTrades.length === 0) {
            alert(`⚠️ ${reportTitleKey} कालावधीसाठी कोणतीही ट्रेड सापडली नाही!`);
            return;
        }

        const tempEquityCanvas = document.createElement('canvas');
        tempEquityCanvas.width = 600;
        tempEquityCanvas.height = 300;
        const sortedFiltered = [...filteredTrades]; // already oldest -> newest
        let cum = 0;
        const eqLbls = ['Start', ...sortedFiltered.map((_, i) => `T-${i + 1}`)];
        const eqVals = [0, ...sortedFiltered.map(t => { cum += t.pnl; return cum; })];

        const eqChart = new Chart(tempEquityCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: eqLbls,
                datasets: [{
                    data: eqVals,
                    borderColor: '#6366F1',
                    borderWidth: 2.5,
                    fill: true,
                    backgroundColor: 'rgba(20, 184, 166, 0.15)',
                    tension: 0.3,
                    pointRadius: 2
                }]
            },
            options: {
                responsive: false,
                animation: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#64748B', font: { size: 9 } } },
                    y: { grid: { color: 'rgba(0,0,0,0.08)' }, ticks: { color: '#64748B', font: { size: 9 } } }
                }
            }
        });

        const tempDonutCanvas = document.createElement('canvas');
        tempDonutCanvas.width = 300;
        tempDonutCanvas.height = 300;
        const fWins = filteredTrades.filter(t => t.result === 'Win').length;
        const fLosses = filteredTrades.filter(t => t.result === 'Loss').length;

        const donutChart = new Chart(tempDonutCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Wins', 'Losses'],
                datasets: [{
                    data: [fWins, fLosses],
                    backgroundColor: ['#22C55E', '#F43F5E'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: false,
                animation: false,
                plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 10 } } } },
                cutout: '75%'
            }
        });

        setTimeout(() => {
            const equityUrl = tempEquityCanvas.toDataURL('image/png');
            const donutUrl = tempDonutCanvas.toDataURL('image/png');

            eqChart.destroy();
            donutChart.destroy();

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                alert("Popup blocker मुळे print window उघडली नाही. कृपया Popups allow करा.");
                return;
            }

            const totalPeriodPnL = filteredTrades.reduce((acc, t) => acc + t.pnl, 0);
            const winRate = ((fWins / filteredTrades.length) * 100).toFixed(1);

            let htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>MintPip Filtered Trade Report - ${reportTitleKey}</title>
                    <style>
                        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; padding: 30px; margin: 0; background: #fff; }
                        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #6366F1; padding-bottom: 15px; margin-bottom: 25px; }
                        .logo { font-size: 24px; font-weight: 900; color: #6366F1; letter-spacing: -0.5px; }
                        .subtitle { font-size: 13px; color: #64748b; margin-top: 3px; }
                        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px; }
                        .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; }
                        .kpi-title { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }
                        .kpi-val { font-size: 18px; font-weight: 900; margin-top: 5px; color: #0f172a; }
                        .section-title { font-size: 15px; font-weight: 800; border-left: 4px solid #6366F1; padding-left: 10px; margin: 30px 0 15px 0; color: #0f172a; }
                        .analytics-charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 30px; page-break-inside: avoid; }
                        .chart-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; text-align: center; }
                        .chart-card img { max-width: 100%; height: 180px; object-fit: contain; margin-top: 10px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
                        th { background: #f1f5f9; color: #475569; font-weight: bold; text-align: left; padding: 10px; border-bottom: 2px solid #cbd5e1; }
                        td { padding: 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
                        .win { color: #22C55E; font-weight: bold; }
                        .loss { color: #F43F5E; font-weight: bold; }
                        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
                        @media print { body { padding: 15px; } .analytics-charts-grid { break-inside: avoid; } }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div>
                            <div class="logo">MintPip Institutional Analytics</div>
                            <div class="subtitle">Filtered Performance & Analytics Report — <b>${reportTitleKey}</b></div>
                        </div>
                        <div style="text-align: right; font-size: 11px; color: #64748b;">
                            Generated: ${new Date().toLocaleDateString()}
                        </div>
                    </div>

                    <div class="kpi-grid">
                        <div class="kpi-card">
                            <div class="kpi-title">Period Net PnL</div>
                            <div class="kpi-val" style="color: ${totalPeriodPnL >= 0 ? '#22C55E' : '#F43F5E'}">${totalPeriodPnL >= 0 ? '+' : ''}$${totalPeriodPnL.toFixed(2)}</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-title">Total Trades</div>
                            <div class="kpi-val">${filteredTrades.length}</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-title">Win Rate</div>
                            <div class="kpi-val">${winRate}% (${fWins}W / ${fLosses}L)</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-title">Database Mode</div>
                            <div class="kpi-val" style="text-transform: uppercase; font-size: 14px; color: #6366F1;">${activeDatabase}</div>
                        </div>
                    </div>

                    <div class="section-title">Analytics Charts (${reportTitleKey} Trades Only)</div>
                    <div class="analytics-charts-grid">
                        <div class="chart-card">
                            <div style="font-size: 12px; font-weight: bold; color: #334155; text-align: left;">Cumulative Equity Growth (Line Chart)</div>
                            <img src="${equityUrl}" alt="Equity Growth" />
                        </div>
                        <div class="chart-card">
                            <div style="font-size: 12px; font-weight: bold; color: #334155; text-align: left;">Win / Loss Distribution</div>
                            <img src="${donutUrl}" alt="Win Loss Distribution" />
                        </div>
                    </div>

                    <div class="section-title">Executed Trades Summary Table & Details</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Pair</th>
                                <th>Session</th>
                                <th>Setup Score</th>
                                <th>Direction</th>
                                <th>R:R</th>
                                <th>SL / TP</th>
                                <th>PnL ($)</th>
                                <th>Result</th>
                                <th>Lesson / Notes</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            filteredTrades.forEach(t => {
                htmlContent += `
                    <tr>
                        <td>${t.date}</td>
                        <td><b>${t.pair}</b></td>
                        <td>${t.session}</td>
                        <td>${t.setupScore}</td>
                        <td>${t.direction}</td>
                        <td>${t.rr}</td>
                        <td>${t.slPips}p / ${t.tpPips}p</td>
                        <td class="${t.pnl >= 0 ? 'win' : 'loss'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</td>
                        <td class="${t.result === 'Win' ? 'win' : 'loss'}">${t.result}</td>
                        <td style="font-size: 10px; color: #475569; max-width: 180px;">${t.note}</td>
                    </tr>
                `;
            });

            htmlContent += `
                        </tbody>
                    </table>
                    <div class="footer">
                        MintPip Trading Journal & Analytics Hub — Filtered Performance Report
                    </div>
                </body>
                </html>
            `;

            printWindow.document.write(htmlContent);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
                printWindow.print();
            }, 600);
        }, 300);
    };

    const generateAiReport = async () => {
        setIsAiLoading(true);
        setAiAnalysisText("");

        const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
        if (!apiKey) {
            setAiAnalysisText("⚠️ OpenRouter API Key .env.local file madhye sapadli nahi. कृपया VITE_OPENROUTER_API_KEY set kara.");
            setIsAiLoading(false);
            return;
        }

        const now = new Date();
        let targetTrades = trades;

        if (aiTimeframe === 'week') {
            const weekKey = getWeekStartKey(now);
            targetTrades = trades.filter(t => tradeDateKey(t) >= weekKey);
        } else if (aiTimeframe === 'last_week') {
            const thisWeekKey = getWeekStartKey(now);
            const prevWeek = new Date(now);
            prevWeek.setDate(prevWeek.getDate() - 7);
            const lastWeekKey = getWeekStartKey(prevWeek);
            targetTrades = trades.filter(t => tradeDateKey(t) >= lastWeekKey && tradeDateKey(t) < thisWeekKey);
        } else if (aiTimeframe === 'month') {
            const currentMonthKey = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            targetTrades = trades.filter(t => t.monthYear === currentMonthKey);
        } else if (aiTimeframe === 'last_month') {
            const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastMonthKey = lastMonthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            targetTrades = trades.filter(t => t.monthYear === lastMonthKey);
        }

        const tradesSummary = targetTrades.slice(-25) /* latest 25 trades */.map(t => ({
            date: t.date,
            pair: t.pair,
            direction: t.direction,
            session: t.session,
            setupScore: t.setupScore,
            rulesFollowed: t.rules,
            psychology: t.psych,
            pnl: t.pnl,
            result: t.result,
            lesson: t.note
        }));

        const languageInstruction = aiLang === 'sinhala'
            ? "Provide a concise, highly practical performance audit in Sinhala (with English key trading terms like ICT, FVG, MSS, Killzone)."
            : "Provide a concise, highly practical performance audit entirely in professional English.";

        const prompt = `You are a Senior Institutional Forex Analyst. Analyze the following trade journal data for a Forex trader (${aiTimeframe.toUpperCase()} timeframe):

Total Trades Analyzed: ${targetTrades.length}
Trades Data: ${JSON.stringify(tradesSummary)}

${languageInstruction} Structure it as follows:
1. 🎯 **Strengths / ප්‍රධාන ශක්තීන්**:
2. ⚠️ **Weaknesses & Risk Management / කළ වැරදි සහ අවදානම්**:
3. 💡 **Trading Psychology & Execution Advice / වැඩිදියුණු කරගත යුතු උපදෙස්**:`;

        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey.trim()}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": window.location.origin,
                    "X-Title": "MintPip Trading Journal"
                },
                body: JSON.stringify({
                    model: "deepseek/deepseek-chat:free",
                    messages: [{ role: "user", content: prompt }]
                })
            });

            if (response.ok) {
                const data = await response.json();
                const aiOutput = data.choices[0]?.message?.content || "AI analysis milali nahi.";
                setAiAnalysisText(aiOutput);
            } else {
                const errorData = await response.json();
                setAiAnalysisText(`⚠️ AI Error (${response.status}): ${errorData?.error?.message || "API request yashaswi zali nahi."}`);
            }
        } catch (error) {
            setAiAnalysisText("⚠️ Network/CORS Error aali ahe.");
        } finally {
            setIsAiLoading(false);
        }
    };

    const copyReportToClipboard = () => {
        navigator.clipboard.writeText(aiAnalysisText);
        setCopyBtnText('Copied! ✓');
        setTimeout(() => setCopyBtnText('Copy Report'), 2000);
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
        <div style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }} className={`mp-root ${bootDone ? 'mp-ready' : ''} min-h-screen flex flex-col antialiased [font-variant-numeric:tabular-nums] transition-colors duration-300 ${isDark ? 'mp-dark bg-[#070B16] text-slate-200' : 'mp-light bg-[#F4F6FB] text-slate-800'}`}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
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
                .mp-light [class*="bg-slate-800"]:not(.text-white),.mp-light [class*="bg-slate-900"]:not(.text-white),.mp-light [class*="bg-[#0E1426]"],.mp-light [class*="bg-[#141B30]"],.mp-light [class*="bg-[#19223A]"],.mp-light [class*="bg-[#070B16]"]{background-color:#EEF2F9!important;border-color:rgba(15,23,42,.1)!important;color:#334155}
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
                    { label: 'Go to Overview', run: () => setActiveTab('overview') },
                    { label: 'Go to Analytics', run: () => setActiveTab('analytics') },
                    { label: 'Go to Calendar & Reports', run: () => setActiveTab('calendar') },
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

            {/* Top Notion Notification Toast Pop-up */}
            {notionToast.show && (
                <div className="fixed bottom-6 right-6 z-50">
                    <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border text-xs font-bold ${notionToast.type === 'success'
                            ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200 shadow-black/30'
                            : 'bg-rose-950/95 border-rose-500/40 text-rose-200 shadow-black/30'
                        }`}>
                        <span className="text-base">{notionToast.type === 'success' ? <Ico n="check" className="w-5 h-5" /> : <Ico n="alert" className="w-5 h-5" />}</span>
                        <span>{notionToast.message}</span>
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
                                setAiAnalysisText("");
                                setIsAiOpen(true);
                            }}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#A78BFA] text-white text-xs font-bold transition shadow-sm active:scale-95"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>AI Report</span>
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
                            onClick={() => fetchNotionData(false)}
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
                        { id: 'calendar', label: 'Calendar & Reports' }
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
                            <b>{!isOnline ? 'You are offline.' : "Can't reach the server / Notion right now."}</b> Showing the last loaded data. The dashboard keeps retrying and will refresh by itself once the connection is back.
                        </div>
                        <button onClick={() => fetchNotionData(false)} className="px-3 py-1.5 rounded-lg bg-amber-500 text-black font-bold hover:bg-amber-400 transition">Retry now</button>
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

                {activeTab === 'overview' && (<>
                {/* KPI Cards Grid */}
                <section className="mp-kpi grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className={`relative p-6 rounded-2xl border shadow-[0_1px_2px_rgba(0,0,0,0.3)] group transition-all duration-300 overflow-hidden ${isDark ? 'bg-[#0E1426] border-white/10' : 'bg-white border-slate-200'}`}>
                        <span className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500"></span>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Total Net PnL ({activeDatabase.toUpperCase()})</span>
                            <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-inner">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline space-x-2 relative z-10">
                            <span className="text-2xl lg:text-3xl font-black text-emerald-400 tracking-tight "><CountUp value={kpiNetProfit} /></span>
                            <span className="text-[11px] text-emerald-300 font-bold bg-emerald-500/15 px-2 py-0.5 rounded-lg border border-emerald-500/30 shadow-sm">{kpiRMultiple}</span>
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
                            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Best Performance Month</span>
                            <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline justify-between mt-1 relative z-10">
                            <div>
                                <span className={`text-xl lg:text-2xl font-black tracking-tight  ${isDark ? 'text-white' : 'text-slate-900'}`}>{bestMonthName}</span>
                                <p className="text-xs text-emerald-400 font-extrabold mt-0.5 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20 inline-block">{bestMonthPnL}</p>
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
                            onClick={() => { setSettingsDraft(settings); setIsSettingsOpen(true); }}
                            className={`px-4 py-2 rounded-xl border text-xs font-bold transition ${isDark ? 'bg-[#141B30] border-[#232C45] text-slate-200 hover:bg-[#19223A]' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'}`}
                        >
                            ⚙️ Account & Risk Settings
                        </button>
                        <button
                            onClick={() => exportTradesCSV(trades)}
                            disabled={trades.length === 0}
                            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition"
                        >
                            ⬇ Export CSV
                        </button>
                    </div>

                    {trades.length === 0 ? (
                        <p className="text-xs text-slate-500">No trades loaded yet.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <StatTile isDark={isDark}
                                    label={startBal > 0 ? 'Account Balance' : 'Net PnL'}
                                    value={startBal > 0 ? fmtMoney(analytics.equity) : fmtSigned(analytics.net)}
                                    sub={startBal > 0 ? `Start ${fmtMoney(startBal)} · ${(analytics.net / startBal * 100).toFixed(1)}% return` : 'Set a starting balance in Settings'}
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
                                    sub={startBal > 0 ? (toNum(settings.riskTargetPct) > 0 ? `Target ${toNum(settings.riskTargetPct)}% of starting balance` : 'Set your risk % target in Settings') : 'Set starting balance & risk % in Settings'}
                                    tone={startBal > 0 && toNum(settings.riskTargetPct) > 0 ? ((analytics.avgLoss / startBal * 100) > toNum(settings.riskTargetPct) ? 'bad' : 'good') : 'neutral'} />
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
                                {editingPageId ? 'Edit Trade' : 'Add Trade to Notion'} ({activeDatabase.toUpperCase()})
                            </h3>
                            <button onClick={() => closeAddModal()} className="w-9 h-9 rounded-xl bg-slate-800/60 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveNewTrade} noValidate className="space-y-4 text-xs">
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
                                        onChange={(e) => setNewTradeForm({...newTradeForm, outcome: e.target.value})}
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

                            {/* Execution Rules Checkboxes (Auto-calculates Setup Score in Notion via Formula) */}
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
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">PROFIT AMOUNT ($)</label>
                                    <input 
                                        type="number" 
                                        step="0.01"
                                        placeholder="e.g. 150"
                                        value={newTradeForm.profitAmount} 
                                        onChange={(e) => setNewTradeForm({...newTradeForm, profitAmount: e.target.value})}
                                        className={`w-full p-2.5 rounded-xl border font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1 text-slate-400">LOSS AMOUNT ($)</label>
                                    <input 
                                        type="number" 
                                        step="0.01"
                                        placeholder="e.g. 0"
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

                            {!editingPageId && (
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
                            )}

                            <p className="text-[11px] font-semibold text-rose-400">
                                {editingPageId ? 'Editing an existing trade. Chart images stay as they are (change images directly in Notion). All fields marked * are still required.' : '* Required: Pair, Session, FVG Tap, SMT, Outcome, Entry Price, SL Price, Lot Size & Risk, and a Before + After chart image (upload a file or paste a link for each).'}
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
                                    {isSubmittingTrade ? 'Saving to Notion...' : (editingPageId ? 'Update Trade' : 'Save Trade to Notion')}
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
                        <p className="mt-1 text-xs text-slate-500">It will be moved to Notion's Trash. You can restore it there within 30 days.</p>
                        <div className="mt-6 flex gap-3">
                            <button disabled={isDeleting} onClick={() => setConfirmDelete({ show: false, trade: null })} className="flex-1 px-4 py-3 rounded-xl bg-slate-800 text-slate-200 text-sm font-bold hover:bg-slate-700 transition">Cancel</button>
                            <button disabled={isDeleting} onClick={handleDeleteTrade} className="flex-1 px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold transition shadow-md shadow-rose-500/20">
                                {isDeleting ? 'Deleting...' : 'Yes, delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ⚙️ Account & Risk Settings */}
            {isSettingsOpen && (
                <div onClick={() => setIsSettingsOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div onClick={(e) => e.stopPropagation()} className={`p-6 sm:p-8 rounded-2xl border max-w-lg w-full shadow-2xl space-y-5 ${isDark ? 'bg-[#0E1426] border-white/15 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}>
                        <div className="flex items-center justify-between border-b pb-4 border-slate-700/40">
                            <h3 className="text-lg font-black">⚙️ Account & Risk Settings</h3>
                            <button onClick={() => setIsSettingsOpen(false)} className="w-9 h-9 rounded-xl bg-slate-800/60 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/10 transition font-bold text-sm">✕</button>
                        </div>
                        <p className="text-xs text-slate-500">Used for drawdown %, balance, risk checks and the stop-trading warnings. Saved in this browser only. Leave a field empty to turn it off.</p>
                        {[
                            { key: 'startingBalance', label: 'STARTING BALANCE ($)', ph: 'e.g. 10000' },
                            { key: 'riskTargetPct', label: 'RISK PER TRADE TARGET (% of starting balance)', ph: 'e.g. 1' },
                            { key: 'dailyLossLimit', label: 'DAILY LOSS LIMIT ($)', ph: 'e.g. 300' },
                            { key: 'weeklyLossLimit', label: 'WEEKLY LOSS LIMIT ($)', ph: 'e.g. 600' },
                            { key: 'maxLossStreak', label: 'WARN AFTER THIS MANY LOSSES IN A ROW', ph: 'e.g. 3' }
                        ].map(f => (
                            <div key={f.key}>
                                <label className="block text-xs font-bold mb-1 text-slate-400">{f.label}</label>
                                <input
                                    type="number" min="0" step="any" placeholder={f.ph}
                                    value={settingsDraft[f.key]}
                                    onChange={(e) => setSettingsDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                                    className={`w-full p-2.5 rounded-xl border text-sm font-bold ${isDark ? 'bg-[#141B30] border-[#232C45] text-white' : 'bg-slate-50 border-slate-200'}`}
                                />
                            </div>
                        ))}
                        <div className="flex justify-end gap-3 pt-2">
                            <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition">Cancel</button>
                            <button onClick={saveSettings} className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-sm">Save settings</button>
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

            {/* AI Performance Audit Modal */}
            {isAiOpen && (
                <div onClick={() => setIsAiOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div onClick={(e) => e.stopPropagation()} className={`p-6 sm:p-8 rounded-2xl border max-w-3xl w-full relative shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto ${isDark ? 'bg-[#0E1426] border-white/15 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}>

                        <div className="flex items-center justify-between border-b pb-4 border-slate-700/40">
                            <h3 className="text-lg font-black flex items-center gap-2.5 text-[#A78BFA]">
                                <div className="p-2 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 text-[#A78BFA]">
                                    <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                AI Performance Audit & Insights
                            </h3>
                            <button onClick={() => setIsAiOpen(false)} className="w-9 h-9 rounded-xl bg-slate-800/60 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">
                                ✕
                            </button>
                        </div>

                        <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 ${isDark ? 'bg-[#141B30] border-[#232C45]' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Timeframe</span>
                                    <select
                                        value={aiTimeframe}
                                        onChange={(e) => setAiTimeframe(e.target.value)}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#0E1426] border-[#8B5CF6]/30 text-[#C4B5FD]' : 'bg-white border-[#C4B5FD] text-[#6D28D9]'}`}
                                    >
                                        <option value="week">This Week</option>
                                        <option value="last_week">Last Week</option>
                                        <option value="month">This Month</option>
                                        <option value="last_month">Last Month</option>
                                        <option value="all">All Trades</option>
                                    </select>
                                </div>

                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Language</span>
                                    <select
                                        value={aiLang}
                                        onChange={(e) => setAiLang(e.target.value)}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#0E1426] border-[#8B5CF6]/30 text-[#C4B5FD]' : 'bg-white border-[#C4B5FD] text-[#6D28D9]'}`}
                                    >
                                        <option value="sinhala">සිංහල (Sinhala)</option>
                                        <option value="english">English</option>
                                    </select>
                                </div>
                            </div>

                            <button
                                onClick={generateAiReport}
                                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#A78BFA] text-white text-xs font-bold transition shadow-sm active:scale-95 flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                Generate Report
                            </button>
                        </div>

                        {isAiLoading ? (
                            <div className="flex flex-col items-center justify-center py-16 space-y-4">
                                <div className="w-12 h-12 border-4 border-[#8B5CF6] border-t-transparent rounded-full animate-spin"></div>
                                <p className="text-xs text-[#A78BFA] font-bold animate-pulse tracking-wide">AI is analyzing your trades for the selected period...</p>
                            </div>
                        ) : (
                            <div className={`p-6 rounded-2xl border text-xs sm:text-sm leading-relaxed space-y-4 shadow-inner min-h-[220px] ${isDark ? 'bg-[#141B30]/90 border-[#232C45] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                                {aiAnalysisText ? (
                                    aiAnalysisText.split('\n').map((line, idx) => {
                                        const trimmed = line.trim();
                                        if (!trimmed) return null;

                                        if (trimmed.startsWith('**1.') || trimmed.startsWith('**2.') || trimmed.startsWith('**3.') || trimmed.match(/^\*\*?\d+\./)) {
                                            return (
                                                <h4 key={idx} className="text-sm sm:text-base font-black text-[#A78BFA] mt-4 mb-2 flex items-center gap-2 border-b border-[#8B5CF6]/20 pb-2">
                                                    {trimmed.replace(/\*\*/g, '')}
                                                </h4>
                                            );
                                        }

                                        if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
                                            const content = trimmed.replace(/^[-*•]\s*/, '');
                                            const parts = content.split('**');
                                            return (
                                                <div key={idx} className="flex items-start gap-2.5 my-2.5 pl-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[#A78BFA] mt-2 shrink-0"></span>
                                                    <div className="flex-1">
                                                        {parts.length >= 3 ? (
                                                            <span>
                                                                <strong className="text-white font-extrabold">{parts[1]}</strong>
                                                                {parts.slice(2).join('')}
                                                            </span>
                                                        ) : (
                                                            <span>{content.replace(/\*\*/g, '')}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <p key={idx} className="my-1.5 text-slate-300">
                                                {trimmed.replace(/\*\*/g, '')}
                                            </p>
                                        );
                                    })
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <svg className="w-10 h-10 text-[#A78BFA]/40 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2v-6l9-11h-7z" />
                                        </svg>
                                        <p className="text-slate-400 text-xs font-medium">Select your preferred Timeframe and Language above, then click <b>"Generate Report"</b> to start analysis.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex items-center justify-between pt-2">
                            {aiAnalysisText ? (
                                <button onClick={copyReportToClipboard} className="px-4 py-2 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[#A78BFA] hover:bg-[#8B5CF6]/20 transition text-xs font-bold flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2v0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                    </svg>
                                    {copyBtnText}
                                </button>
                            ) : <div></div>}

                            <button onClick={() => setIsAiOpen(false)} className="px-6 py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold hover:bg-[#6D28D9] transition shadow-lg shadow-[#8B5CF6]/20">
                                Close Audit
                            </button>
                        </div>

                    </div>
                </div>
            )}

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