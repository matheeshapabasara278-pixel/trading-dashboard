import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function App() {
    const [activeDatabase, setActiveDatabase] = useState('live'); // 'live' kinva 'backtest'
    const [trades, setTrades] = useState([]);
    const [currentTimeframeMode, setCurrentTimeframeMode] = useState('weekly');

    const [isDark, setIsDark] = useState(true);
    const [killzoneStatus, setKillzoneStatus] = useState("Checking Sri Lanka Killzone...");
    const [killzoneColor, setKillzoneColor] = useState("text-gray-400");
    const [syncStatus, setSyncStatus] = useState({ text: "Fetching Notion...", dot: "bg-emerald-400", pulse: true });
    
    // 🌟 Notion Success Notification Toast State (Top position)
    const [notionToast, setNotionToast] = useState({ show: false, message: "", type: "success" });

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

    // Keyboard Arrow Keys & Escape Key Event Listener
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsChartOpen(false);
                setIsDetailsOpen(false);
                setIsAiOpen(false);
                setIsDateModalOpen(false);
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
                setKillzoneColor("text-gray-400");
            }
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    // 🌟 Auto-Refresh (Polling) every 15 seconds to fetch latest trades from Notion without manual refresh
    useEffect(() => {
        setReportMode('month');
        setCustomStartDate('');
        setCustomEndDate('');
        setCalMonth(new Date().getMonth());
        setCalYear(new Date().getFullYear());
        
        fetchNotionData(); // Initial fetch

        const autoRefreshInterval = setInterval(() => {
            fetchNotionData(true); // Silent background fetch
        }, 15000); // 15 seconds

        return () => clearInterval(autoRefreshInterval);
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

    const fetchNotionData = async (isSilent = false) => {
        if (!isSilent) {
            setSyncStatus({ text: `Fetching ${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} Notion...`, dot: "bg-emerald-400", pulse: true });
        }
        try {
            const response = await fetch(`/api/notion?type=${activeDatabase}`);
            if (response.ok) {
                const fetchedData = await response.json();
                if (fetchedData && fetchedData.results) {
                    setSyncStatus({ text: `${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} Notion Connected`, dot: "bg-emerald-400", pulse: true });
                    parseNotionData(fetchedData.results);
                    if (!isSilent) {
                        playSound('win');
                        showToast(`✅ Notion Connected Successfully! (${activeDatabase.toUpperCase()} Database synced)`, 'success');
                    }
                    return;
                }
            }
        } catch (e) { }
        
        if (!isSilent) {
            setSyncStatus({ text: "Notion Sync Error", dot: "bg-rose-500", pulse: false });
            playSound('loss');
            showToast(`❌ Notion Sync Failed! Please check API connection.`, 'error');
        }
    };

    const parseNotionData = (results) => {
        const parsedTrades = results.map((item, index) => {
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
                        slPipsVal = pipsParts[0].trim();
                        tpPipsVal = pipsParts[1].trim();
                    }
                }
            }

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

            let normalizedSession = rawSession;
            if (rawSession.toUpperCase().includes('LN') || rawSession.toUpperCase().includes('LONDON')) normalizedSession = 'London Session';
            else if (rawSession.toUpperCase().includes('NY') || rawSession.toUpperCase().includes('NEW YORK')) normalizedSession = 'New York Session';

            return {
                id: index + 1,
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
        const ultraSubtleGridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
        const textColor = isDark ? '#64748B' : '#94A3B8';

        const sortedTrades = [...data].reverse();

        let cumulative = 0;
        const eqLabels = ['Start', ...sortedTrades.map((_, i) => `T-${i + 1}`)];
        const eqData = [0, ...sortedTrades.map(t => { cumulative += t.pnl; return cumulative; })];

        if (equityInstance.current) equityInstance.current.destroy();
        if (equityChartRef.current) {
            const ctx = equityChartRef.current.getContext('2d');
            const gradient = ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, 'rgba(56, 116, 255, 0.25)');
            gradient.addColorStop(1, 'rgba(56, 116, 255, 0.0)');

            equityInstance.current = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: eqLabels,
                    datasets: [{
                        data: eqData,
                        borderColor: '#3874FF',
                        borderWidth: 2.5,
                        fill: true,
                        backgroundColor: gradient,
                        tension: 0.3,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#3874FF'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: isDark ? '#0E1526' : '#ffffff',
                            titleColor: isDark ? '#ffffff' : '#111827',
                            bodyColor: isDark ? '#34D399' : '#059669',
                            borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb',
                            borderWidth: 1,
                            padding: 12,
                            callbacks: {
                                label: function(context) {
                                    const index = context.dataIndex;
                                    const balance = context.parsed.y;
                                    if (index === 0) {
                                        return `Starting Balance: $${balance.toFixed(2)}`;
                                    }
                                    const trade = sortedTrades[index - 1];
                                    if (!trade) return `Balance: $${balance.toFixed(2)}`;

                                    const pnl = trade.pnl;
                                    const sign = pnl >= 0 ? '+' : '';
                                    const pnlStr = `${sign}$${pnl.toFixed(2)}`;
                                    
                                    return [
                                        `Balance: $${balance.toFixed(2)}`,
                                        `Trade PnL: ${pnlStr} (${trade.pair})`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: textColor, font: { size: 10 }, maxRotation: 45 }
                        },
                        y: {
                            grid: { color: ultraSubtleGridColor, lineWidth: 1, drawTicks: false },
                            ticks: { color: textColor, font: { size: 10 } }
                        }
                    }
                }
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
                    datasets: [{
                        data: [wins, losses],
                        backgroundColor: ['#10B981', '#EF4444'],
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    cutout: '78%'
                }
            });
        }

        const lonWins = data.filter(t => t.session.includes('London') && t.result === 'Win').length;
        const lonLoss = data.filter(t => t.session.includes('London') && t.result === 'Loss').length;
        const nyWins = data.filter(t => t.session.includes('New York') && t.result === 'Win').length;
        const nyLoss = data.filter(t => t.session.includes('New York') && t.result === 'Loss').length;

        if (sessionInstance.current) sessionInstance.current.destroy();
        if (sessionChartRef.current) {
            sessionInstance.current = new Chart(sessionChartRef.current.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['London Session', 'New York Session'],
                    datasets: [
                        { label: 'Wins', data: [lonWins, nyWins], backgroundColor: '#10B981', borderRadius: 6, barThickness: 28 },
                        { label: 'Losses', data: [lonLoss, nyLoss], backgroundColor: '#EF4444', borderRadius: 6, barThickness: 28 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: textColor, font: { size: 11 } }
                        },
                        y: {
                            grid: { color: ultraSubtleGridColor, lineWidth: 1, drawTicks: false },
                            ticks: { color: textColor, font: { size: 10 } }
                        }
                    }
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
                    datasets: [{
                        data: [buyCount, sellCount],
                        backgroundColor: ['#10B981', '#3874FF'],
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    cutout: '72%'
                }
            });
        }

        renderTimeframeChart(data, currentTimeframeMode);
    };

    const renderTimeframeChart = (data, mode) => {
        const ultraSubtleGridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
        const textColor = isDark ? '#64748B' : '#94A3B8';

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
                        backgroundColor: values.map(v => v >= 0 ? '#10B981' : '#EF4444'),
                        borderRadius: 6,
                        barThickness: 32
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: textColor, font: { size: 11 } }
                        },
                        y: {
                            grid: { color: ultraSubtleGridColor, lineWidth: 1, drawTicks: false },
                            ticks: { color: textColor, font: { size: 10 } }
                        }
                    }
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
        const sortedFiltered = [...filteredTrades].reverse();
        let cum = 0;
        const eqLbls = ['Start', ...sortedFiltered.map((_, i) => `T-${i + 1}`)];
        const eqVals = [0, ...sortedFiltered.map(t => { cum += t.pnl; return cum; })];

        const eqChart = new Chart(tempEquityCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: eqLbls,
                datasets: [{
                    data: eqVals,
                    borderColor: '#3874FF',
                    borderWidth: 2.5,
                    fill: true,
                    backgroundColor: 'rgba(56, 116, 255, 0.15)',
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
                    backgroundColor: ['#10B981', '#EF4444'],
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
                        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #3874FF; padding-bottom: 15px; margin-bottom: 25px; }
                        .logo { font-size: 24px; font-weight: 900; color: #3874FF; letter-spacing: -0.5px; }
                        .subtitle { font-size: 13px; color: #64748b; margin-top: 3px; }
                        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px; }
                        .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; }
                        .kpi-title { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }
                        .kpi-val { font-size: 18px; font-weight: 900; margin-top: 5px; color: #0f172a; }
                        .section-title { font-size: 15px; font-weight: 800; border-left: 4px solid #3874FF; padding-left: 10px; margin: 30px 0 15px 0; color: #0f172a; }
                        .analytics-charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 30px; page-break-inside: avoid; }
                        .chart-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; text-align: center; }
                        .chart-card img { max-width: 100%; height: 180px; object-fit: contain; margin-top: 10px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
                        th { background: #f1f5f9; color: #475569; font-weight: bold; text-align: left; padding: 10px; border-bottom: 2px solid #cbd5e1; }
                        td { padding: 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
                        .win { color: #10b981; font-weight: bold; }
                        .loss { color: #ef4444; font-weight: bold; }
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
                            <div class="kpi-val" style="color: ${totalPeriodPnL >= 0 ? '#10b981' : '#ef4444'}">${totalPeriodPnL >= 0 ? '+' : ''}$${totalPeriodPnL.toFixed(2)}</div>
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
                            <div class="kpi-val" style="text-transform: uppercase; font-size: 14px; color: #3874FF;">${activeDatabase}</div>
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
            const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
            targetTrades = trades.filter(t => t.date !== 'N/A' && new Date(t.date) >= startOfWeek);
        } else if (aiTimeframe === 'last_week') {
            const lastWeekStart = new Date(now.setDate(now.getDate() - now.getDay() - 7));
            const lastWeekEnd = new Date(now.setDate(now.getDate() - now.getDay()));
            targetTrades = trades.filter(t => t.date !== 'N/A' && new Date(t.date) >= lastWeekStart && new Date(t.date) < lastWeekEnd);
        } else if (aiTimeframe === 'month') {
            const currentMonthKey = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            targetTrades = trades.filter(t => t.monthYear === currentMonthKey);
        } else if (aiTimeframe === 'last_month') {
            const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastMonthKey = lastMonthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            targetTrades = trades.filter(t => t.monthYear === lastMonthKey);
        }

        const tradesSummary = targetTrades.slice(0, 25).map(t => ({
            date: t.date,
            pair: t.pair,
            direction: t.direction,
            session: t.session,
            setupScore: t.setupScore,
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
        <div className={`min-h-screen flex flex-col antialiased transition-colors duration-300 ${isDark ? 'bg-[#07090E] text-[#E5E7EB]' : 'bg-[#F4F6F9] text-[#1E293B]'}`}>

            {/* 🌟 Top Notion Notification Toast Pop-up */}
            {notionToast.show && (
                <div className="fixed top-6 right-6 z-50 animate-bounce">
                    <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border backdrop-blur-xl text-xs font-bold ${
                        notionToast.type === 'success' 
                            ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300 shadow-emerald-500/20' 
                            : 'bg-rose-950/90 border-rose-500/40 text-rose-300 shadow-rose-500/20'
                    }`}>
                        <span className="text-base">{notionToast.type === 'success' ? '🎉' : '⚠️'}</span>
                        <span>{notionToast.message}</span>
                    </div>
                </div>
            )}

            {/* Top Bar */}
            <header className={`sticky top-0 z-30 px-6 lg:px-12 py-3 border-b backdrop-blur-xl transition-all duration-300 ${isDark ? 'bg-[#090D16]/80 border-white/15 shadow-2xl shadow-black/40' : 'bg-white/85 border-gray-200/80 shadow-sm'}`}>
                <div className="w-full flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center space-x-6">
                        <div className="flex items-center space-x-3 group cursor-pointer">
                            <div className="relative">
                                <div className="absolute -inset-1 bg-gradient-to-r from-[#3874FF] to-indigo-500 rounded-2xl blur-sm opacity-60 group-hover:opacity-100 transition duration-300"></div>
                                <div className="relative w-10 h-10 rounded-2xl bg-[#0D1322] border border-blue-500/30 flex items-center justify-center text-white font-black text-lg shadow-inner">
                                    <svg className="w-5 h-5 text-[#3874FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                            </div>
                            <div>
                                <h1 className={`text-lg font-black tracking-tight leading-none ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                    MintPip
                                </h1>
                                <p className={`text-[11px] font-medium tracking-wide mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Institutional Analytics Hub
                                </p>
                            </div>
                        </div>

                        <div className={`flex items-center p-1 rounded-xl border ${isDark ? 'bg-[#0E1526] border-white/10' : 'bg-gray-100 border-gray-200'}`}>
                            <button
                                onClick={() => setActiveDatabase('live')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeDatabase === 'live'
                                        ? 'bg-[#3874FF] text-white shadow-md'
                                        : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                                    }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${activeDatabase === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'}`}></span>
                                Forword Test
                            </button>
                            <button
                                onClick={() => setActiveDatabase('backtest')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeDatabase === 'backtest'
                                        ? 'bg-[#3874FF] text-white shadow-md'
                                        : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
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
                        <div className={`hidden xl:flex items-center space-x-2.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold shadow-inner ${isDark ? 'bg-[#0E1526]/80 border-white/10' : 'bg-gray-100/80 border-gray-200'}`}>
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3874FF] opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3874FF]"></span>
                            </span>
                            <span className={killzoneColor}>{killzoneStatus}</span>
                        </div>

                        <button
                            onClick={() => {
                                setAiAnalysisText("");
                                setIsAiOpen(true);
                            }}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold hover:opacity-90 transition shadow-md shadow-purple-500/20 active:scale-95"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>AI Report</span>
                        </button>

                        <button
                            onClick={toggleTheme}
                            className={`w-9 h-9 rounded-xl border transition-all duration-200 flex items-center justify-center text-sm shadow-sm ${isDark
                                    ? 'bg-[#0E1526] hover:bg-[#152038] border-white/10 text-amber-400'
                                    : 'bg-white hover:bg-gray-50 border-gray-200 text-slate-700'
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
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#3874FF] to-blue-600 hover:from-blue-600 hover:to-indigo-600 text-white font-semibold transition-all duration-200 flex items-center gap-2 text-xs shadow-md shadow-blue-500/20 active:scale-95"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span className="hidden sm:inline">Refresh</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Container */}
            <main className="flex-1 w-full px-6 lg:px-12 py-6 space-y-6">

                {/* KPI Cards Grid */}
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className={`relative p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl group hover:border-emerald-400 hover:shadow-[0_0_25px_rgba(16,185,129,0.2)] transition-all duration-300 transform hover:-translate-y-1.5 overflow-hidden ${isDark ? 'bg-gradient-to-br from-[#0D111A] via-[#0E1525] to-[#0A0E17] border-emerald-500/30' : 'bg-gradient-to-br from-white via-gray-50 to-emerald-50/30 border-emerald-500/30'}`}>
                        <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all"></div>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-extrabold text-emerald-500">Total Net PnL ({activeDatabase.toUpperCase()})</span>
                            <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-inner">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline space-x-2 relative z-10">
                            <span className="text-2xl lg:text-3xl font-black text-emerald-400 tracking-tight drop-shadow-[0_2px_10px_rgba(16,185,129,0.3)]">{kpiNetProfit}</span>
                            <span className="text-[11px] text-emerald-300 font-bold bg-emerald-500/15 px-2 py-0.5 rounded-lg border border-emerald-500/30 shadow-sm">{kpiRMultiple}</span>
                        </div>
                    </div>

                    <div className={`relative p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl group hover:border-[#3874FF] hover:shadow-[0_0_25px_rgba(56,116,255,0.2)] transition-all duration-300 transform hover:-translate-y-1.5 overflow-hidden ${isDark ? 'bg-gradient-to-br from-[#0D111A] via-[#0E1525] to-[#0A0E17] border-[#3874FF]/30' : 'bg-gradient-to-br from-white via-gray-50 to-blue-50/30 border-blue-500/30'}`}>
                        <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-extrabold text-blue-500">Win Rate</span>
                            <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-[#3874FF] shadow-inner">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline justify-between relative z-10">
                            <span className={`text-2xl lg:text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>{kpiWinRate}</span>
                            <span className={`text-xs font-semibold px-2.5 py-1 rounded-xl border shadow-sm ${isDark ? 'bg-white/5 border-white/10 text-gray-300' : 'bg-gray-100 border-gray-200 text-gray-700'}`}>{kpiWinLossRatio}</span>
                        </div>
                    </div>

                    <div className={`relative p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl group hover:border-purple-400 hover:shadow-[0_0_25px_rgba(168,85,247,0.2)] transition-all duration-300 transform hover:-translate-y-1.5 overflow-hidden ${isDark ? 'bg-gradient-to-br from-[#0D111A] via-[#0E1525] to-[#0A0E17] border-purple-500/30' : 'bg-gradient-to-br from-white via-gray-50 to-purple-50/30 border-purple-500/30'}`}>
                        <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-purple-500/10 rounded-full blur-2xl group-hover:bg-purple-500/20 transition-all"></div>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-extrabold text-purple-500">Profit Factor & R:R</span>
                            <div className="p-2.5 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 shadow-inner">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline justify-between relative z-10">
                            <div>
                                <span className="text-2xl lg:text-3xl font-black text-purple-400 tracking-tight drop-shadow-[0_2px_10px_rgba(168,85,247,0.3)]">{kpiProfitFactor}</span>
                                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mt-0.5">Profit Factor</p>
                            </div>
                            <div className="text-right">
                                <span className={`text-lg font-black tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>1:2.0</span>
                                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mt-0.5">Target R:R</p>
                            </div>
                        </div>
                    </div>

                    <div className={`relative p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl group hover:border-amber-400 hover:shadow-[0_0_25px_rgba(245,158,11,0.25)] transition-all duration-300 transform hover:-translate-y-1.5 overflow-hidden ${isDark ? 'bg-gradient-to-br from-[#0D111A] via-[#0E1525] to-[#0A0E17] border-amber-500/40' : 'bg-gradient-to-br from-white via-gray-50 to-amber-50/30 border-amber-500/40'}`}>
                        <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/25 transition-all"></div>
                        <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="text-xs uppercase tracking-wider font-extrabold text-amber-500">Best Performance Month</span>
                            <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-baseline justify-between mt-1 relative z-10">
                            <div>
                                <span className={`text-xl lg:text-2xl font-black tracking-tight drop-shadow-[0_2px_10px_rgba(245,158,11,0.3)] ${isDark ? 'text-white' : 'text-gray-900'}`}>{bestMonthName}</span>
                                <p className="text-xs text-emerald-400 font-extrabold mt-0.5 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20 inline-block">{bestMonthPnL}</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Charts Section */}
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className={`p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl lg:col-span-2 flex flex-col justify-between transition-all duration-300 hover:shadow-[0_0_25px_rgba(56,116,255,0.15)] ${isDark ? 'bg-gradient-to-br from-[#0D111A] via-[#0E1525] to-[#0A0E17] border-white/10' : 'bg-gradient-to-br from-white via-gray-50 to-blue-50/20 border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                    <svg className="w-5 h-5 text-[#3874FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                                    </svg>
                                    Cumulative Equity Growth ({activeDatabase.toUpperCase()})
                                </h2>
                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Account balance progression over executions</p>
                            </div>
                        </div>
                        <div className="relative h-72 w-full">
                            <canvas ref={equityChartRef}></canvas>
                        </div>
                    </div>

                    <div className={`p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl flex flex-col justify-between transition-all duration-300 hover:shadow-[0_0_25px_rgba(16,185,129,0.15)] ${isDark ? 'bg-gradient-to-br from-[#0D111A] via-[#0E1525] to-[#0A0E17] border-white/10' : 'bg-gradient-to-br from-white via-gray-50 to-emerald-50/20 border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                                    </svg>
                                    Win / Loss Distribution
                                </h2>
                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Trade outcome breakdown</p>
                            </div>
                        </div>
                        <div className="relative h-52 w-full flex items-center justify-center">
                            <canvas ref={donutChartRef}></canvas>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-4 text-center text-xs">
                            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner">
                                <span className="block text-emerald-400 font-black text-base">{donutWins}</span>
                                <span className="text-gray-400 font-semibold uppercase tracking-wider text-[10px]">Wins</span>
                            </div>
                            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 shadow-inner">
                                <span className="block text-rose-400 font-black text-base">{donutLosses}</span>
                                <span className="text-gray-400 font-semibold uppercase tracking-wider text-[10px]">Losses</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Winners and Losers & Performance by Side */}
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className={`p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl lg:col-span-2 space-y-4 ${isDark ? 'bg-[#0D111A]/80 border-white/10' : 'bg-white border-gray-200'}`}>
                        <div>
                            <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                Winners and Losers Breakdown
                            </h2>
                            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Detailed institutional win/loss metrics</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                                    <span className="text-xs font-black text-emerald-400 uppercase tracking-wider">Winners</span>
                                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-xs">{statsData.totalWinners}</span>
                                </div>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-400">Best Win:</span><span className="font-bold text-emerald-400">{statsData.bestWin}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Average Win:</span><span className="font-bold text-emerald-300">{statsData.avgWin}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Max Consecutive Wins:</span><span className="font-bold text-white">{statsData.maxConsecWins}</span></div>
                                </div>
                            </div>

                            <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-3">
                                <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
                                    <span className="text-xs font-black text-rose-400 uppercase tracking-wider">Losers</span>
                                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold text-xs">{statsData.totalLosers}</span>
                                </div>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-400">Worst Loss:</span><span className="font-bold text-rose-400">{statsData.worstLoss}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Average Loss:</span><span className="font-bold text-rose-300">{statsData.avgLoss}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Max Consecutive Losses:</span><span className="font-bold text-white">{statsData.maxConsecLosses}</span></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={`p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl flex flex-col justify-between ${isDark ? 'bg-[#0D111A]/80 border-white/10' : 'bg-white border-gray-200'}`}>
                        <div>
                            <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                </svg>
                                Performance by Side
                            </h2>
                            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Buy vs Sell distribution</p>
                        </div>
                        <div className="relative h-44 w-full flex items-center justify-center my-2">
                            <canvas ref={sidePieChartRef}></canvas>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-center text-xs">
                            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                <span className="block text-emerald-400 font-bold">{statsData.buyCount} Trades</span>
                                <span className="text-[10px] text-gray-400">Buy Win Rate: {statsData.buyWinRate}%</span>
                            </div>
                            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                                <span className="block text-[#3874FF] font-bold">{statsData.sellCount} Trades</span>
                                <span className="text-[10px] text-gray-400">Sell Win Rate: {statsData.sellWinRate}%</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Secondary Analytics Section */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className={`p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl flex flex-col justify-between transition-all duration-300 hover:shadow-[0_0_25px_rgba(16,185,129,0.15)] ${isDark ? 'bg-gradient-to-br from-[#0D111A] via-[#0E1525] to-[#0A0E17] border-white/10' : 'bg-gradient-to-br from-white via-gray-50 to-emerald-50/20 border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                    Performance by Session
                                </h2>
                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>London vs New York Executions</p>
                            </div>
                        </div>
                        <div className="relative h-64 w-full">
                            <canvas ref={sessionChartRef}></canvas>
                        </div>
                    </div>

                    <div className={`p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl flex flex-col justify-between transition-all duration-300 hover:shadow-[0_0_25px_rgba(168,85,247,0.15)] ${isDark ? 'bg-gradient-to-br from-[#0D111A] via-[#0E1525] to-[#0A0E17] border-white/10' : 'bg-gradient-to-br from-white via-gray-50 to-purple-50/20 border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {currentTimeframeMode === 'weekly' ? 'PnL by Day of the Week' : 'PnL by Month'}
                                </h2>
                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Identify your most profitable periods</p>
                            </div>
                            <div className={`flex items-center border rounded-2xl p-1 text-xs shadow-inner ${isDark ? 'bg-[#0D111A] border-[#1E2638]' : 'bg-gray-100 border-gray-200'}`}>
                                <button onClick={() => switchTimeframe('weekly')} className={`px-3 py-1.5 rounded-xl font-bold transition ${currentTimeframeMode === 'weekly' ? 'bg-[#3874FF] text-white shadow-md' : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}>Weekly</button>
                                <button onClick={() => switchTimeframe('monthly')} className={`px-3 py-1.5 rounded-xl font-bold transition ${currentTimeframeMode === 'monthly' ? 'bg-[#3874FF] text-white shadow-md' : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}>Monthly</button>
                            </div>
                        </div>
                        <div className="relative h-64 w-full">
                            <canvas ref={timeframeChartRef}></canvas>
                        </div>
                    </div>
                </section>

                {/* Performance Calendar & PDF Report Generator */}
                <section className={`p-6 sm:p-8 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl space-y-6 ${isDark ? 'bg-[#0D111A]/85 border-white/10' : 'bg-white border-gray-200'}`}>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-4 border-gray-700/40">
                        <div>
                            <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                Performance Calendar & PDF Report Generator
                            </h2>
                            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Select Month or Custom Date Range, then click PDF Report to export filtered trades and analytics charts.</p>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                            <div className={`flex items-center p-1 rounded-xl border ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-100 border-gray-200'}`}>
                                <button 
                                    onClick={() => {
                                        setReportMode('month');
                                        setCustomStartDate('');
                                        setCustomEndDate('');
                                    }} 
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${reportMode === 'month' ? 'bg-[#3874FF] text-white shadow-md' : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                                >
                                    Monthly Mode
                                </button>
                                <button 
                                    onClick={() => {
                                        setReportMode('custom');
                                    }} 
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${reportMode === 'custom' ? 'bg-[#3874FF] text-white shadow-md' : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                                >
                                    Custom Date Range
                                </button>
                            </div>

                            {reportMode === 'month' ? (
                                <div className="flex items-center gap-2">
                                    <select 
                                        value={calMonth} 
                                        onChange={(e) => setCalMonth(parseInt(e.target.value))}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#131926] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                                    >
                                        {monthNames.map((m, idx) => (
                                            <option key={idx} value={idx}>{m}</option>
                                        ))}
                                    </select>

                                    <select 
                                        value={calYear} 
                                        onChange={(e) => setCalYear(parseInt(e.target.value))}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#131926] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                                    >
                                        <option value={2025}>2025</option>
                                        <option value={2026}>2026</option>
                                        <option value={2027}>2027</option>
                                    </select>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <div className="flex flex-col">
                                        <span className={`text-[9px] font-bold uppercase ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>From Date</span>
                                        <input 
                                            type="date" 
                                            value={customStartDate} 
                                            onChange={(e) => setCustomStartDate(e.target.value)}
                                            className={`py-1.5 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#131926] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                                        />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`text-[9px] font-bold uppercase ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>To Date</span>
                                        <input 
                                            type="date" 
                                            value={customEndDate} 
                                            onChange={(e) => setCustomEndDate(e.target.value)}
                                            className={`py-1.5 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#131926] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                                        />
                                    </div>
                                </div>
                            )}

                            <button 
                                onClick={exportCustomPDFReport}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white transition text-xs font-bold shadow-md shadow-emerald-500/20 active:scale-95"
                                title="Export filtered trades and charts as a professional PDF report"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                <span>PDF Report ({reportMode === 'month' ? monthNames[calMonth] : 'Custom'})</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                    </div>

                    <div className="grid grid-cols-7 gap-2">
                        {Array.from({ length: firstDayIndex }).map((_, i) => (
                            <div key={`empty-${i}`} className={`h-24 rounded-2xl border opacity-30 ${isDark ? 'bg-[#131926]/40 border-white/5' : 'bg-gray-100 border-gray-200'}`}></div>
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
                                    className={`h-24 p-3 rounded-2xl border flex flex-col justify-between transition-all duration-200 ${
                                        hasTrades 
                                            ? isProfitable 
                                                ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)] cursor-pointer transform hover:scale-[1.02]' 
                                                : 'bg-rose-500/10 border-rose-500/30 hover:border-rose-400 shadow-[0_0_15px_rgba(239,68,68,0.1)] cursor-pointer transform hover:scale-[1.02]'
                                            : isDark ? 'bg-[#131926]/70 border-[#1E2638] text-gray-500' : 'bg-gray-50 border-gray-200 text-gray-400'
                                    }`}
                                    title={hasTrades ? "Click to view trades for this date" : ""}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className={`text-xs font-bold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{dayNum}</span>
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
                                        <span className="text-[10px] text-gray-500 font-medium">No trades</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            </main>

            {/* Calendar Date Click Trades Modal */}
            {isDateModalOpen && (
                <div onClick={() => setIsDateModalOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div onClick={(e) => e.stopPropagation()} className={`p-6 sm:p-8 rounded-3xl border max-w-6xl w-full relative shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto ${isDark ? 'bg-[#0D111A] border-white/15 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
                        
                        <div className="flex items-center justify-between border-b pb-4 border-gray-700/40">
                            <div>
                                <h3 className="text-lg font-black flex items-center gap-2.5 text-amber-400">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {selectedDateTitle}
                                </h3>
                                <p className="text-xs text-gray-400 mt-0.5">Click any trade row below to inspect full advanced execution details, notes & charts.</p>
                            </div>
                            <button onClick={() => setIsDateModalOpen(false)} className="w-9 h-9 rounded-xl bg-gray-800/60 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">
                                ✕
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse whitespace-nowrap">
                                <thead>
                                    <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-[#1E2638] text-gray-400 bg-[#131926]/80' : 'border-gray-200 text-gray-500 bg-gray-50'}`}>
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
                                <tbody className={`divide-y text-xs ${isDark ? 'divide-[#1E2638]/40 text-gray-300' : 'divide-gray-100 text-gray-700'}`}>
                                    {selectedDateTrades.map((trade) => {
                                        const isWin = trade.result === 'Win';
                                        return (
                                            <tr 
                                                key={trade.id} 
                                                onClick={() => { setSelectedTrade(trade); setIsDetailsOpen(true); }}
                                                className={`transition cursor-pointer ${isDark ? 'hover:bg-[#151D2F]' : 'hover:bg-blue-50/50'}`}
                                                title="Click anywhere on this row to view full trade details & charts"
                                            >
                                                <td className={`py-3.5 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{trade.pair}</td>
                                                <td className="py-3.5 px-4"><span className={`px-2.5 py-1 rounded-lg border text-[11px] ${isDark ? 'bg-[#0D111A] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>{trade.session}</span></td>
                                                <td className="py-3.5 px-4 text-center font-bold text-amber-400 text-[11px]">{trade.setupScore}</td>
                                                <td className={`py-3.5 px-4 font-semibold ${trade.direction === 'LONG' ? 'text-[#3874FF]' : 'text-purple-400'}`}>{trade.direction}</td>
                                                <td className="py-3.5 px-4 text-gray-400">{trade.rr}</td>
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
                            <span className="text-xs text-gray-400">Tip: Click on any trade row to view lesson notes, PnL, and before/after charts.</span>
                            <button onClick={() => setIsDateModalOpen(false)} className="px-5 py-2.5 rounded-xl bg-gray-800 text-white text-xs font-bold hover:bg-gray-700 transition">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* AI Performance Audit Modal */}
            {isAiOpen && (
                <div onClick={() => setIsAiOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div onClick={(e) => e.stopPropagation()} className={`p-6 sm:p-8 rounded-3xl border max-w-3xl w-full relative shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto ${isDark ? 'bg-[#0D111A] border-white/15 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
                        
                        <div className="flex items-center justify-between border-b pb-4 border-gray-700/40">
                            <h3 className="text-lg font-black flex items-center gap-2.5 text-purple-400">
                                <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                                    <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                AI Performance Audit & Insights
                            </h3>
                            <button onClick={() => setIsAiOpen(false)} className="w-9 h-9 rounded-xl bg-gray-800/60 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">
                                ✕
                            </button>
                        </div>

                        <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                            <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Timeframe</span>
                                    <select 
                                        value={aiTimeframe} 
                                        onChange={(e) => setAiTimeframe(e.target.value)}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#0D111A] border-purple-500/30 text-purple-300' : 'bg-white border-purple-300 text-purple-700'}`}
                                    >
                                        <option value="week">This Week</option>
                                        <option value="last_week">Last Week</option>
                                        <option value="month">This Month</option>
                                        <option value="last_month">Last Month</option>
                                        <option value="all">All Trades</option>
                                    </select>
                                </div>

                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Language</span>
                                    <select 
                                        value={aiLang} 
                                        onChange={(e) => setAiLang(e.target.value)}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold focus:outline-none ${isDark ? 'bg-[#0D111A] border-purple-500/30 text-purple-300' : 'bg-white border-purple-300 text-purple-700'}`}
                                    >
                                        <option value="sinhala">සිංහල (Sinhala)</option>
                                        <option value="english">English</option>
                                    </select>
                                </div>
                            </div>

                            <button 
                                onClick={generateAiReport}
                                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold hover:opacity-90 transition shadow-md shadow-purple-500/20 active:scale-95 flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                Generate Report
                            </button>
                        </div>

                        {isAiLoading ? (
                            <div className="flex flex-col items-center justify-center py-16 space-y-4">
                                <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                                <p className="text-xs text-purple-400 font-bold animate-pulse tracking-wide">AI is analyzing your trades for the selected period...</p>
                            </div>
                        ) : (
                            <div className={`p-6 rounded-2xl border text-xs sm:text-sm leading-relaxed space-y-4 shadow-inner min-h-[220px] ${isDark ? 'bg-[#131926]/90 border-[#1E2638] text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                                {aiAnalysisText ? (
                                    aiAnalysisText.split('\n').map((line, idx) => {
                                        const trimmed = line.trim();
                                        if (!trimmed) return null;

                                        if (trimmed.startsWith('**1.') || trimmed.startsWith('**2.') || trimmed.startsWith('**3.') || trimmed.match(/^\*\*?\d+\./)) {
                                            return (
                                                <h4 key={idx} className="text-sm sm:text-base font-black text-purple-400 mt-4 mb-2 flex items-center gap-2 border-b border-purple-500/20 pb-2">
                                                    {trimmed.replace(/\*\*/g, '')}
                                                </h4>
                                            );
                                        }

                                        if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
                                            const content = trimmed.replace(/^[-*•]\s*/, '');
                                            const parts = content.split('**');
                                            return (
                                                <div key={idx} className="flex items-start gap-2.5 my-2.5 pl-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2 shrink-0"></span>
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
                                            <p key={idx} className="my-1.5 text-gray-300">
                                                {trimmed.replace(/\*\*/g, '')}
                                            </p>
                                        );
                                    })
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <svg className="w-10 h-10 text-purple-400/40 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2v-6l9-11h-7z" />
                                        </svg>
                                        <p className="text-gray-400 text-xs font-medium">Select your preferred Timeframe and Language above, then click <b>"Generate Report"</b> to start analysis.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex items-center justify-between pt-2">
                            {aiAnalysisText ? (
                                <button onClick={copyReportToClipboard} className="px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition text-xs font-bold flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2v0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                    </svg>
                                    {copyBtnText}
                                </button>
                            ) : <div></div>}

                            <button onClick={() => setIsAiOpen(false)} className="px-6 py-2.5 rounded-xl bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 transition shadow-lg shadow-purple-500/20">
                                Close Audit
                            </button>
                        </div>

                    </div>
                </div>
            )}

            {/* Advanced Trade Details Popup Modal */}
            {isDetailsOpen && selectedTrade && (
                <div onClick={() => setIsDetailsOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
                    <div onClick={(e) => e.stopPropagation()} className={`p-6 sm:p-8 rounded-3xl border max-w-3xl w-full relative shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto ${isDark ? 'bg-[#0D111A] border-white/15 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
                        
                        <div className="flex items-center justify-between border-b pb-4 border-gray-700/40">
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black border ${selectedTrade.result === 'Win' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                                    {selectedTrade.result === 'Win' ? 'WIN' : 'LOSS'}
                                </div>
                                <div>
                                    <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                                        {selectedTrade.pair} 
                                        <span className={`text-xs px-2.5 py-0.5 rounded-lg border font-bold uppercase ${selectedTrade.direction === 'LONG' ? 'bg-blue-500/10 text-[#3874FF] border-blue-500/30' : 'bg-purple-500/10 text-purple-400 border-purple-500/30'}`}>
                                            {selectedTrade.direction}
                                        </span>
                                    </h2>
                                    <p className="text-xs text-gray-400 mt-0.5">Execution Date: <b>{selectedTrade.date}</b> ({selectedTrade.day})</p>
                                </div>
                            </div>
                            <button onClick={() => setIsDetailsOpen(false)} className="w-9 h-9 rounded-xl bg-gray-800/60 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 border border-white/10 transition flex items-center justify-center font-bold text-sm">
                                ✕
                            </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-gray-400 uppercase tracking-wider text-[10px] block font-semibold">Net PnL</span>
                                <span className={`text-base font-black mt-1 block ${selectedTrade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                                    {selectedTrade.pnl >= 0 ? '+' : ''}${selectedTrade.pnl.toFixed(2)}
                                </span>
                            </div>
                            <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-gray-400 uppercase tracking-wider text-[10px] block font-semibold">Session</span>
                                <span className={`text-sm font-bold mt-1 block ${isDark ? 'text-white' : 'text-gray-900'}`}>{selectedTrade.session}</span>
                            </div>
                            <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-gray-400 uppercase tracking-wider text-[10px] block font-semibold">Setup Score</span>
                                <span className="text-sm font-bold mt-1 block text-amber-400">{selectedTrade.setupScore}</span>
                            </div>
                            <div className={`p-4 rounded-2xl border ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-gray-400 uppercase tracking-wider text-[10px] block font-semibold">Planned R:R</span>
                                <span className={`text-sm font-bold mt-1 block ${isDark ? 'text-white' : 'text-gray-900'}`}>{selectedTrade.rr}</span>
                            </div>
                        </div>

                        <div className={`p-5 rounded-2xl border space-y-3 ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                            <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">Risk & Target Parameters</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                                <div className="flex justify-between items-center p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                                    <span className="text-gray-400">Stop Loss (SL):</span>
                                    <span className="font-bold text-rose-400">{selectedTrade.slPips} pips</span>
                                </div>
                                <div className="flex justify-between items-center p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                    <span className="text-gray-400">Take Profit (TP):</span>
                                    <span className="font-bold text-emerald-400">{selectedTrade.tpPips} pips</span>
                                </div>
                            </div>
                        </div>

                        <div className={`p-5 rounded-2xl border space-y-2 ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                            <h4 className="text-xs font-extrabold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Lesson / Mistalke (Trade Note)
                            </h4>
                            <p className={`text-xs leading-relaxed whitespace-pre-wrap font-medium ${isDark ? 'text-gray-300' : 'text-gray-800'}`}>
                                {selectedTrade.note}
                            </p>
                        </div>

                        {(selectedTrade.beforeCharts.length > 0 || selectedTrade.afterCharts.length > 0) && (
                            <div className="space-y-3">
                                <h4 className="text-xs font-extrabold uppercase tracking-wider text-blue-400">Execution Screenshots (Before & After)</h4>
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
                                                        <span className="absolute bottom-2 left-2 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md text-[10px] font-bold text-blue-400 border border-white/10">Before Chart {i + 1}</span>
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
                                                        <span className="absolute bottom-2 left-2 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md text-[10px] font-bold text-purple-400 border border-white/10">After Chart {i + 1}</span>
                                                    </div>
                                                ))}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}

                        <div className="text-right pt-2">
                            <button onClick={() => setIsDetailsOpen(false)} className="px-5 py-2.5 rounded-xl bg-[#3874FF] text-white text-xs font-bold hover:bg-blue-600 transition shadow-md shadow-blue-500/20">
                                Close Details
                            </button>
                        </div>

                    </div>
                </div>
            )}

            {/* Full-Screen Image Gallery Modal with Keyboard & On-screen Arrow Support */}
            {isChartOpen && activeItems.length > 0 && (
                <div onClick={() => setIsChartOpen(false)} className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-6 cursor-pointer">
                    <div onClick={(e) => e.stopPropagation()} className={`p-4 sm:p-6 rounded-3xl border max-w-6xl w-full relative shadow-2xl flex flex-col space-y-4 cursor-default ${isDark ? 'bg-[#0D111A] border-white/10' : 'bg-white border-gray-200'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[#1E2638] gap-3">
                            <div className="flex items-center gap-3">
                                <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                    <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {modalTitle}
                                </h3>
                                <span className={`text-[11px] px-3 py-1 rounded-full font-extrabold uppercase tracking-wider border ${activeItems[activeImgIndex].type.includes('Before')
                                        ? 'bg-blue-500/10 text-[#3874FF] border-blue-500/30'
                                        : 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                                    }`}>
                                    {activeItems[activeImgIndex].type}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                {activeItems.length > 1 && (
                                    <div className={`flex items-center border rounded-2xl p-1 text-xs ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-100 border-gray-200'}`}>
                                        <button
                                            onClick={() => setActiveImgIndex(prev => (prev === 0 ? activeItems.length - 1 : prev - 1))}
                                            className={`px-3 py-1.5 rounded-xl transition font-semibold ${isDark ? 'bg-[#0D111A] hover:bg-[#3874FF] text-white' : 'bg-white hover:bg-gray-200 text-gray-800 shadow-sm'}`}>
                                            ◀ Prev
                                        </button>
                                        <span className={`px-3 font-bold text-xs ${isDark ? 'text-gray-300' : 'text-gray-800'}`}>
                                            {activeImgIndex + 1} / {activeItems.length}
                                        </span>
                                        <button
                                            onClick={() => setActiveImgIndex(prev => (prev === activeItems.length - 1 ? 0 : prev + 1))}
                                            className={`px-3 py-1.5 rounded-xl transition font-semibold ${isDark ? 'bg-[#0D111A] hover:bg-[#3874FF] text-white' : 'bg-white hover:bg-gray-200 text-gray-800 shadow-sm'}`}>
                                            Next ▶
                                        </button>
                                    </div>
                                )}
                                <button onClick={() => setIsChartOpen(false)} className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition text-xs font-bold">
                                    ✖ Close
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
                                                    ? 'bg-[#3874FF] text-white border-[#3874FF]'
                                                    : isDark ? 'bg-[#131926] text-gray-400 border-[#1E2638] hover:text-white' : 'bg-gray-100 text-gray-600 border-gray-200 hover:text-gray-900'
                                                }`}
                                        >
                                            {item.type}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[10px] text-gray-400 hidden md:inline">Use <b>◀ Left</b> / <b>Right ▶</b> Arrow Keys to shift</span>
                            </div>
                        )}

                        <div className={`relative flex-1 overflow-auto flex items-center justify-center rounded-2xl p-2 min-h-[450px] ${isDark ? 'bg-black/60' : 'bg-gray-100'}`}>
                            {activeItems.length > 1 && (
                                <>
                                    <button 
                                        onClick={() => setActiveImgIndex(prev => (prev === 0 ? activeItems.length - 1 : prev - 1))}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/80 text-white transition backdrop-blur-md border border-white/20 shadow-lg"
                                        title="Previous Image (Left Arrow)"
                                    >
                                        ◀
                                    </button>
                                    <button 
                                        onClick={() => setActiveImgIndex(prev => (prev === activeItems.length - 1 ? 0 : prev + 1))}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/80 text-white transition backdrop-blur-md border border-white/20 shadow-lg"
                                        title="Next Image (Right Arrow)"
                                    >
                                        ▶
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