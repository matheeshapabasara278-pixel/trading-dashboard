import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function App() {
    const [activeDatabase, setActiveDatabase] = useState('live'); // 'live' හෝ 'backtest'
    const [trades, setTrades] = useState([]);
    const [filteredTradesList, setFilteredTradesList] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 15;
    const [currentTimeframeMode, setCurrentTimeframeMode] = useState('weekly');

    const [isDark, setIsDark] = useState(true);
    const [killzoneStatus, setKillzoneStatus] = useState("Checking Sri Lanka Killzone...");
    const [killzoneColor, setKillzoneColor] = useState("text-gray-400");
    const [syncStatus, setSyncStatus] = useState({ text: "Fetching Notion...", dot: "bg-emerald-400", pulse: true });

    // Modal States
    const [isCalcOpen, setIsCalcOpen] = useState(false);
    const [isChartOpen, setIsChartOpen] = useState(false);
    const [activeItems, setActiveItems] = useState([]);
    const [activeImgIndex, setActiveImgIndex] = useState(0);
    const [modalTitle, setModalTitle] = useState("");

    // Calculator States
    const [calcBal, setCalcBal] = useState(10000);
    const [calcRiskPct, setCalcRiskPct] = useState(1);
    const [calcSLPips, setCalcSLPips] = useState(15);

    // Filter States
    const [searchVal, setSearchVal] = useState("");
    const [sessionVal, setSessionVal] = useState("ALL");
    const [resultVal, setResultVal] = useState("ALL");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");

    // KPIs & Best Month
    const [kpiNetProfit, setKpiNetProfit] = useState("$0.00");
    const [kpiRMultiple, setKpiRMultiple] = useState("+0.0 R");
    const [kpiWinRate, setKpiWinRate] = useState("0%");
    const [kpiWinLossRatio, setKpiWinLossRatio] = useState("0W / 0L");
    const [kpiProfitFactor, setKpiProfitFactor] = useState("0.00");
    const [donutWins, setDonutWins] = useState(0);
    const [donutLosses, setDonutLosses] = useState(0);
    const [bestMonthName, setBestMonthName] = useState("N/A");
    const [bestMonthPnL, setBestMonthPnL] = useState("$0.00");

    // Chart Refs
    const equityChartRef = useRef(null);
    const donutChartRef = useRef(null);
    const sessionChartRef = useRef(null);
    const timeframeChartRef = useRef(null);

    const equityInstance = useRef(null);
    const donutInstance = useRef(null);
    const sessionInstance = useRef(null);
    const timeframeInstance = useRef(null);

    // Audio Alert helper using Web Audio API
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

    // Keyboard Arrow Navigation for Modal Images
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!isChartOpen) return;
            if (e.key === 'ArrowRight') {
                setActiveImgIndex(prev => (prev === activeItems.length - 1 ? 0 : prev + 1));
            } else if (e.key === 'ArrowLeft') {
                setActiveImgIndex(prev => (prev === 0 ? activeItems.length - 1 : prev - 1));
            } else if (e.key === 'Escape') {
                setIsChartOpen(false);
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

    // Database tab එක මාරු වන විට Notion Data අලුතින් Fetch කිරීම
    useEffect(() => {
        fetchNotionData();
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
        if (filteredTradesList.length > 0 || trades.length > 0) {
            renderCharts(filteredTradesList.length > 0 ? filteredTradesList : trades);
        }
    }, [isDark]);

    const fetchNotionData = async () => {
        setSyncStatus({ text: `Fetching ${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} Notion...`, dot: "bg-emerald-400", pulse: true });
        try {
            const response = await fetch(`/api/notion?type=${activeDatabase}`);
            if (response.ok) {
                const fetchedData = await response.json();
                if (fetchedData && fetchedData.results) {
                    setSyncStatus({ text: `${activeDatabase === 'live' ? 'Forward Test' : 'Backtest'} Notion Connected`, dot: "bg-emerald-400", pulse: true });
                    parseNotionData(fetchedData.results);
                    playSound('win');
                    return;
                }
            }
        } catch (e) { }
        setSyncStatus({ text: "Notion Sync Error", dot: "bg-rose-500", pulse: false });
        playSound('loss');
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

            const beforeFiles = props['BEFORE CHART']?.files || props['Before Chart']?.files || [];
            const afterFiles = props['AFTER CHART']?.files || props['After Chart']?.files || [];

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
                beforeCharts: beforeFiles.map(f => f?.file?.url || f?.external?.url).filter(Boolean),
                afterCharts: afterFiles.map(f => f?.file?.url || f?.external?.url).filter(Boolean),
                result: outcome.toLowerCase().includes('win') ? 'Win' : 'Loss'
            };
        });

        setTrades(parsedTrades);
        setFilteredTradesList(parsedTrades);
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

        data.forEach(t => {
            totalPnL += t.pnl;
            if (t.result === 'Win') { wins++; totalWinAmount += t.pnl; }
            else if (t.result === 'Loss') { losses++; totalLossAmount += Math.abs(t.pnl); }

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
    };

    const renderCharts = (data) => {
        const ultraSubtleGridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
        const textColor = isDark ? '#64748B' : '#94A3B8';

        let cumulative = 0;
        const eqLabels = ['Start', ...data.map((_, i) => `T-${i + 1}`)];
        const eqData = [0, ...data.map(t => { cumulative += t.pnl; return cumulative; })];

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
                    plugins: { legend: { display: false } },
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
        renderTimeframeChart(filteredTradesList, mode);
    };

    useEffect(() => {
        let result = trades.filter(t => {
            const matchesSearch = t.pair.toLowerCase().includes(searchVal.toLowerCase()) || String(t.setupScore).toLowerCase().includes(searchVal.toLowerCase());
            let matchesSession = true;
            if (sessionVal === 'London') matchesSession = t.session.includes('London');
            if (sessionVal === 'NY') matchesSession = t.session.includes('New York');

            const matchesResult = resultVal === 'ALL' || t.result === resultVal;
            let matchesDate = true;
            if (t.date !== 'N/A') {
                if (startDate && t.date < startDate) matchesDate = false;
                if (endDate && t.date > endDate) matchesDate = false;
            }
            return matchesSearch && matchesSession && matchesResult && matchesDate;
        });
        setFilteredTradesList(result);
        setCurrentPage(1);
        renderCharts(result);
    }, [searchVal, sessionVal, resultVal, startDate, endDate, trades]);

    const totalItems = filteredTradesList.length;
    const totalPages = Math.ceil(totalItems / rowsPerPage) || 1;
    const startIndex = (currentPage - 1) * rowsPerPage;
    const currentTableData = filteredTradesList.slice(startIndex, startIndex + rowsPerPage);

    const exportToCSV = () => {
        let csvContent = "data:text/csv;charset=utf-8,Date,Day,Pair,Session,SetupScore,Direction,RR,SL(pips),TP(pips),PnL,Result\n";
        filteredTradesList.forEach(t => {
            csvContent += `"${t.date}","${t.day}","${t.pair}","${t.session}","${t.setupScore}","${t.direction}","${t.rr}","${t.slPips}","${t.tpPips}","${t.pnl}","${t.result}"\n`;
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `MintPip_${activeDatabase.toUpperCase()}_Trade_Journal.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const riskAmt = calcBal * (calcRiskPct / 100);
    const lotSize = riskAmt / (calcSLPips * 10);

    return (
        <div className={`min-h-screen flex flex-col antialiased transition-colors duration-300 ${isDark ? 'bg-[#07090E] text-[#E5E7EB]' : 'bg-[#F4F6F9] text-[#1E293B]'}`}>

            {/* Top Bar */}
            <header className={`sticky top-0 z-30 px-6 lg:px-12 py-3 border-b backdrop-blur-xl transition-all duration-300 ${isDark ? 'bg-[#090D16]/80 border-white/15 shadow-2xl shadow-black/40' : 'bg-white/85 border-gray-200/80 shadow-sm'}`}>
                <div className="w-full flex items-center justify-between gap-4 flex-wrap">

                    {/* Left Branding */}
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
                                    Analytics & Execution Hub
                                </p>
                            </div>
                        </div>

                        {/* Database Toggle Switcher (Live / Backtest) */}
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
                                {/* Modern Analytics/Chart SVG Icon */}
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                Backtest Data
                            </button>
                        </div>
                    </div>

                    {/* Right Controls */}
                    <div className="flex items-center space-x-2.5">

                        {/* Killzone Status */}
                        <div className={`hidden xl:flex items-center space-x-2.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold shadow-inner ${isDark ? 'bg-[#0E1526]/80 border-white/10' : 'bg-gray-100/80 border-gray-200'}`}>
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3874FF] opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3874FF]"></span>
                            </span>
                            <span className={killzoneColor}>{killzoneStatus}</span>
                        </div>

                        {/* Risk Calculator Button */}
                        <button
                            onClick={() => setIsCalcOpen(true)}
                            className={`hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all duration-200 ${isDark
                                    ? 'bg-[#0E1526] hover:bg-[#152038] border-white/10 text-gray-200 hover:border-[#3874FF]/50 shadow-sm'
                                    : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700 shadow-sm'
                                }`}
                        >
                            <svg className="w-4 h-4 text-[#3874FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span>Risk Calculator</span>
                        </button>

                        {/* Theme Toggle Button */}
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

                        {/* Sync Status Badge */}
                        <div className={`hidden lg:flex items-center space-x-2 px-3.5 py-2 rounded-xl border text-xs font-medium shadow-sm ${isDark ? 'bg-[#0E1526] border-white/10 text-gray-300' : 'bg-white border-gray-200 text-gray-700'}`}>
                            <span className="relative flex h-2 w-2">
                                {syncStatus.pulse && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${syncStatus.dot}`}></span>
                            </span>
                            <span>{syncStatus.text}</span>
                        </div>

                        {/* Refresh Button */}
                        <button
                            onClick={fetchNotionData}
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

                    {/* Card 1: Total Net PnL */}
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

                    {/* Card 2: Win Rate */}
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

                    {/* Card 3: Profit Factor & R:R */}
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

                    {/* Card 4: Best Performance Month */}
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

                    {/* Cumulative Equity Growth Chart */}
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

                    {/* Win / Loss Distribution Donut Chart */}
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

                {/* Secondary Analytics Section */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                    {/* Performance by Session */}
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

                    {/* PnL by Day / Month */}
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

                {/* Live Trade Journal Section */}
                <section className={`p-6 rounded-3xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl overflow-hidden ${isDark ? 'bg-[#0D111A]/75 border-white/10' : 'bg-white border-gray-200'}`}>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                        <div>
                            <h2 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                </svg>
                                Notion Trade Journal Executions ({activeDatabase.toUpperCase()})
                            </h2>
                            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Data fetched directly from Notion Database</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <div className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-xl text-xs ${isDark ? 'bg-[#0D111A] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                                <span className="text-gray-400 text-[11px]">From:</span>
                                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`bg-transparent focus:outline-none ${isDark ? 'text-gray-200' : 'text-gray-800'}`} />
                                <span className="text-gray-400 text-[11px]">To:</span>
                                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={`bg-transparent focus:outline-none ${isDark ? 'text-gray-200' : 'text-gray-800'}`} />
                            </div>

                            <div className="relative">
                                <input type="text" value={searchVal} onChange={e => setSearchVal(e.target.value)} placeholder="Search pair..." className={`px-3 py-2 rounded-xl border text-xs focus:outline-none focus:border-[#3874FF] w-36 transition ${isDark ? 'bg-[#0D111A] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`} />
                            </div>

                            <select value={sessionVal} onChange={e => setSessionVal(e.target.value)} className={`py-2 px-3 rounded-xl border text-xs focus:outline-none ${isDark ? 'bg-[#0D111A] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
                                <option value="ALL">All Sessions</option>
                                <option value="London">London Session</option>
                                <option value="NY">NY Session</option>
                            </select>

                            <select value={resultVal} onChange={e => setResultVal(e.target.value)} className={`py-2 px-3 rounded-xl border text-xs focus:outline-none ${isDark ? 'bg-[#0D111A] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
                                <option value="ALL">All Results</option>
                                <option value="Win">Wins Only</option>
                                <option value="Loss">Losses Only</option>
                            </select>

                            <button onClick={exportToCSV} className="py-2 px-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[#3874FF] hover:bg-blue-500/20 transition text-xs font-semibold flex items-center gap-1.5 shadow-sm">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Export
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse whitespace-nowrap">
                            <thead>
                                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-[#1E2638] text-gray-400 bg-[#131926]/80' : 'border-gray-200 text-gray-500 bg-gray-50'}`}>
                                    <th className="py-4 px-5">Date & Day</th>
                                    <th className="py-4 px-5">Pair</th>
                                    <th className="py-4 px-5">Session</th>
                                    <th className="py-4 px-5 text-center">Setup Score</th>
                                    <th className="py-4 px-5">Direction</th>
                                    <th className="py-4 px-5">R:R</th>
                                    <th className="py-4 px-5 text-center">SL / TP (Pips)</th>
                                    <th className="py-4 px-5">PnL ($)</th>
                                    <th className="py-4 px-5 text-center">Result</th>
                                    <th className="py-4 px-5 text-center">Charts</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y text-xs ${isDark ? 'divide-[#1E2638]/40 text-gray-300' : 'divide-gray-100 text-gray-700'}`}>
                                {currentTableData.map((trade) => {
                                    const isWin = trade.result === 'Win';
                                    const combinedItems = [
                                        ...trade.beforeCharts.map((url, i) => ({ url, type: `Before Chart ${i + 1}` })),
                                        ...trade.afterCharts.map((url, i) => ({ url, type: `After Chart ${i + 1}` }))
                                    ];
                                    return (
                                        <tr key={trade.id} className={`transition ${isDark ? 'hover:bg-[#131926]/70' : 'hover:bg-gray-50'}`}>
                                            <td className="py-4 px-5 font-medium">{trade.date} <span className="text-[10px] text-gray-400">({trade.day})</span></td>
                                            <td className={`py-4 px-5 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{trade.pair}</td>
                                            <td className="py-4 px-5"><span className={`px-3 py-1 rounded-lg border text-[11px] ${isDark ? 'bg-[#0D111A] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>{trade.session}</span></td>
                                            <td className="py-4 px-5 text-center font-bold text-amber-400 text-[11px]">{trade.setupScore}</td>
                                            <td className={`py-4 px-5 font-semibold ${trade.direction === 'LONG' ? 'text-[#3874FF]' : 'text-purple-400'}`}>{trade.direction}</td>
                                            <td className="py-4 px-5 text-gray-400">{trade.rr}</td>
                                            <td className="py-4 px-5 text-center">
                                                <span className="text-rose-400">{trade.slPips} pips</span> / <span className="text-emerald-400">{trade.tpPips} pips</span>
                                            </td>
                                            <td className={`py-4 px-5 font-semibold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                                                {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                                            </td>
                                            <td className="py-4 px-5 text-center">
                                                <span className={`px-3 py-1 rounded-full border text-[10px] font-bold ${isWin ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                                                    {trade.result}
                                                </span>
                                            </td>
                                            <td className="py-4 px-5 text-center">
                                                {combinedItems.length > 0 ? (
                                                    <button onClick={() => { setActiveItems(combinedItems); setActiveImgIndex(0); setModalTitle(`${trade.pair} - ${trade.date}`); setIsChartOpen(true); }} className="px-3 py-1.5 rounded-xl bg-blue-500/10 text-[#3874FF] border border-blue-500/20 hover:bg-blue-500/20 transition text-xs font-semibold shadow-sm flex items-center gap-1.5 mx-auto">
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                        </svg>
                                                        View Chart
                                                    </button>
                                                ) : <span className="text-gray-500 text-[11px]">N/A</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className={`flex items-center justify-between mt-6 pt-4 border-t text-xs ${isDark ? 'border-[#1E2638] text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                        <div>Showing <b>{totalItems > 0 ? startIndex + 1 : 0}</b> to <b>{Math.min(startIndex + rowsPerPage, totalItems)}</b> of <b>{totalItems}</b> trades</div>
                        <div className="flex items-center space-x-2">
                            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className={`px-3.5 py-2 rounded-xl border disabled:opacity-40 transition ${isDark ? 'bg-[#0D111A] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>Prev</button>
                            <span className={`px-3 font-semibold ${isDark ? 'text-gray-300' : 'text-gray-800'}`}>Page {currentPage} of {totalPages}</span>
                            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className={`px-3.5 py-2 rounded-xl border disabled:opacity-40 transition ${isDark ? 'bg-[#0D111A] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>Next</button>
                        </div>
                    </div>
                </section>
            </main>

            {/* Risk Calculator Modal */}
            {isCalcOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className={`p-6 rounded-3xl border max-w-md w-full relative shadow-2xl ${isDark ? 'bg-[#0D111A] border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-base font-bold flex items-center gap-2">
                                <svg className="w-5 h-5 text-[#3874FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                Lot Size Risk Calculator
                            </h3>
                            <button onClick={() => setIsCalcOpen(false)} className="text-gray-400 hover:text-white">✖</button>
                        </div>
                        <div className="space-y-4 text-xs">
                            <div>
                                <label className="block text-gray-400 mb-1.5 font-medium">Account Balance ($)</label>
                                <input type="number" value={calcBal} onChange={e => setCalcBal(parseFloat(e.target.value) || 0)} className={`w-full p-3 rounded-xl border focus:outline-none ${isDark ? 'bg-[#131926] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`} />
                            </div>
                            <div>
                                <label className="block text-gray-400 mb-1.5 font-medium">Risk Percentage (%)</label>
                                <input type="number" value={calcRiskPct} onChange={e => setCalcRiskPct(parseFloat(e.target.value) || 0)} className={`w-full p-3 rounded-xl border focus:outline-none ${isDark ? 'bg-[#131926] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`} />
                            </div>
                            <div>
                                <label className="block text-gray-400 mb-1.5 font-medium">Stop Loss (Pips)</label>
                                <input type="number" value={calcSLPips} onChange={e => setCalcSLPips(parseFloat(e.target.value) || 1)} className={`w-full p-3 rounded-xl border focus:outline-none ${isDark ? 'bg-[#131926] border-[#1E2638] text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`} />
                            </div>
                            <div className={`p-3.5 rounded-2xl border space-y-1.5 ${isDark ? 'bg-[#131926] border-[#1E2638]' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="flex justify-between"><span className="text-gray-400">Risk Amount:</span><span className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>${riskAmt.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">Lot Size:</span><span className="font-bold text-emerald-400">{lotSize.toFixed(2)} Lots</span></div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Clean Full-Screen Image Gallery Modal */}
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
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
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
                        )}

                        <div className={`flex-1 overflow-auto flex items-center justify-center rounded-2xl p-2 min-h-[450px] ${isDark ? 'bg-black/60' : 'bg-gray-100'}`}>
                            <img src={activeItems[activeImgIndex].url} alt="Trade Chart" className="max-h-[78vh] w-full object-contain rounded-lg shadow-2xl" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}