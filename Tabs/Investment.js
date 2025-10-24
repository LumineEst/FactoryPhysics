const drawInvestmentPanel = (function () {
    const investmentState = {
        analysisPeriod: 5,
        marr: 12.0,
        taxRate: 25.0,
        workingDays: [], // Now an array of date strings
        mfgOverhead: 250000,
        sgaExpenses: 350000,
        freightExpense: 300000,
        costPerFootStraight: 225,
        costPerBend: 450,
        installationCost: 10000,
        salvageValue: 10000,
        runExpansionCase: false,
        std: 6750,
        cv: 15.0,
        ciLevel: 95,
        p90Demand: 58696,
        p50Demand: 45360,
        p10Demand: 32024,
        currentYear: new Date().getFullYear(),
        isCalendarInitialized: false
    };
    const MACRS_RATES = {
        '5-year': [0.2000, 0.3200, 0.1920, 0.1152, 0.1152, 0.0576]
    };
    const Z_SCORE_P90 = 1.28155;
    const CI_Z_SCORES = { 90: 1.645, 95: 1.960, 99: 2.576 };
    let analysisDebounceTimer;
    function formatNumberWithCommas(num) { return (num === null || num === undefined) ? '' : num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
    function parseFormattedNumber(str) { return (typeof str !== 'string') ? str : (parseFloat(str.replace(/,/g, '')) || 0); }
    function toIsoDateString(date) {
        if (date instanceof Date && !isNaN(date)) {
            return date.toISOString().split('T')[0];
        }
        console.error("Invalid date passed to toIsoDateString:", date);
        return null;
    }
    function getEasterSunday(year) {
        const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
        const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day);
    }
    function getUsFederalHolidays(year) {
        const holidays = new Set();
        const addHolidaySafe = (month, day) => { try { const d = new Date(year, month, day); if(!isNaN(d)) { const ds = toIsoDateString(d); if(ds) holidays.add(ds); } } catch(e){} };
        const addAdjustedSafe = (month, day) => { try { const d = new Date(year, month, day); if(!isNaN(d)) { const dow = d.getDay(); if (dow === 0) d.setDate(d.getDate() + 1); else if (dow === 6) d.setDate(d.getDate() - 1); const ds = toIsoDateString(d); if(ds) holidays.add(ds); } } catch(e){} };
        const addNthDayOfMonthSafe = (month, dayOfWeek, n) => { try { const d = new Date(year, month, 1); if(!isNaN(d)){ const fd = d.getDay(); let off = (dayOfWeek + 7 - fd) % 7; if (off === 0 && dayOfWeek !== fd) off=7; const dayN = 1+off+(n-1)*7; const cd = new Date(year, month, dayN); if (!isNaN(cd) && cd.getMonth() === month) addHolidaySafe(month, dayN); } } catch(e){} };
        addAdjustedSafe(0, 1); // NYD
        const easterDate = getEasterSunday(year); if (easterDate) { const eds = toIsoDateString(easterDate); if (eds) holidays.add(eds); }
        try { const lastDayMay = new Date(year, 5, 0); if(!isNaN(lastDayMay)) {const lastDow = lastDayMay.getDay(); lastDayMay.setDate(lastDayMay.getDate()-(lastDow===0?6:lastDow-1)); addHolidaySafe(4,lastDayMay.getDate());} } catch(e){} // Memorial
        addAdjustedSafe(5, 19); // Juneteenth
        addAdjustedSafe(6, 4); // Independence
        addNthDayOfMonthSafe(8, 1, 1); // Labor
        addNthDayOfMonthSafe(10, 4, 4); // Thanksgiving
        addAdjustedSafe(11, 24); // Xmas Eve
        addAdjustedSafe(11, 25); // Xmas Day
        addAdjustedSafe(11, 31); // NYE
        return holidays; // Return Set
    }
    function initializeDefaultWorkingDays(year) {
        const workingDays = [];
        const holidays = getUsFederalHolidays(year);
        const date = new Date(year, 0, 1);
        while (date.getFullYear() === year) {
            const dayOfWeek = date.getDay();
            const dateString = toIsoDateString(date);
            if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(dateString)) {
                if (dateString) workingDays.push(dateString);
            }
            date.setDate(date.getDate() + 1);
        }
        investmentState.workingDays = workingDays;
        investmentState.isCalendarInitialized = true;
        investmentState.currentYear = year;
    }
    function createCalendarModalOnce() {
        if (document.getElementById("inv-calendar-modal")) return;
        const modal = document.createElement('div');
        modal.id = 'inv-calendar-modal';
        modal.className = 'inv-calendar-modal';
        const content = document.createElement('div');
        content.className = 'inv-calendar-content';
        content.id = 'inv-calendar-content-target';
        modal.appendChild(content);
        document.body.appendChild(modal);
    }
    function drawCalendarModal(container, year) {
        container.html("");
        if(investmentState.currentYear !== year || !investmentState.isCalendarInitialized) {
             initializeDefaultWorkingDays(year);
        }
        const workingDaysSet = new Set(investmentState.workingDays);
        const holidays = getUsFederalHolidays(year);
        const header = container.append("div").attr("class", "inv-calendar-header");
        const yearSelectorGroup = header.append("div").style("display", "flex").style("align-items", "center");
        yearSelectorGroup.append("h4").text(`Select Working Days for `).style("margin-right", "10px");
        const yearSelect = yearSelectorGroup.append("select").attr("id", "calendar-year-select").style("font-size", "1em").style("padding", "3px");
        for (let y = 2025; y <= 2035; y++) {
            yearSelect.append("option").attr("value", y).text(y).property("selected", y === year);
        }
        yearSelect.on("change", function() {
            const selectedYear = parseInt(this.value);
            initializeDefaultWorkingDays(selectedYear);
            drawCalendarModal(container, selectedYear);
        });
        header.append("button").attr("class", "close-btn").html("&times;")
            .on("click", () => { const modal = document.getElementById("inv-calendar-modal"); if (modal) modal.style.display = "none"; });
        const grid = container.append("div").attr("class", "calendar-grid-container");
        const daysOfWeek = ["S", "M", "T", "W", "T", "F", "S"];
        for (let month = 0; month < 12; month++) {
            const monthContainer = grid.append("div").attr("class", "calendar-month");
            monthContainer.append("h5").text(new Date(year, month).toLocaleString('default', { month: 'long' }));
            const table = monthContainer.append("table");
            const thead = table.append("thead");
            const tbody = table.append("tbody");
            thead.append("tr").selectAll("th")
                .data(daysOfWeek).join("th").attr("class", "day-header").attr("data-day-index", (d, i) => i).text(d => d)
                .on("click", function() {
                    const dayIndex = parseInt(d3.select(this).attr("data-day-index"));
                    const cellsToToggle = d3.select(this.closest('.calendar-month')).select('tbody').selectAll(`td[data-day-index="${dayIndex}"]:not(.not-current-month)`);
                    const firstCell = cellsToToggle.node(); const shouldAdd = firstCell ? !firstCell.classList.contains('working-day') : false;
                    cellsToToggle.each(function() {
                        const cell = d3.select(this); const dateStr = cell.attr("data-date");
                        if (dateStr) { if (shouldAdd) { cell.classed("working-day", true); workingDaysSet.add(dateStr); } else { cell.classed("working-day", false); workingDaysSet.delete(dateStr); } }
                    });
                });
            const firstDay = new Date(year, month, 1); const lastDay = new Date(year, month + 1, 0); const date = new Date(firstDay); date.setDate(date.getDate() - firstDay.getDay());
            let done = false;
            while (!done) {
                const row = tbody.append("tr");
                for (let i = 0; i < 7; i++) {
                    const cell = row.append("td").text(date.getDate());
                    const dateString = toIsoDateString(date);
                    if (date.getMonth() === month && dateString) {
                        cell.attr("data-date", dateString).attr("data-day-index", i).classed("working-day", workingDaysSet.has(dateString)).classed("holiday", holidays.has(dateString))
                            .on("click", function() {
                                const clickedDateStr = d3.select(this).attr("data-date");
                                if (workingDaysSet.has(clickedDateStr)) { workingDaysSet.delete(clickedDateStr); d3.select(this).classed("working-day", false); }
                                else { workingDaysSet.add(clickedDateStr); d3.select(this).classed("working-day", true); }
                            });
                    } else { cell.classed("not-current-month", true); }
                    if (date.getTime() === lastDay.getTime()) done = true;
                    date.setDate(date.getDate() + 1);
                }
            }
        }
        const controls = container.append("div").attr("class", "calendar-controls");
        controls.append("button").text("Toggle Holidays").on("click", () => {
            const holidayCells = grid.selectAll("td.holiday"); const shouldAdd = holidayCells.nodes().some(node => { const dateStr = node.getAttribute('data-date'); return dateStr && !workingDaysSet.has(dateStr); });
            holidayCells.each(function() {
                const cell = d3.select(this); const dateStr = cell.attr("data-date");
                if (dateStr) { if (shouldAdd) { cell.classed("working-day", true); workingDaysSet.add(dateStr); } else { cell.classed("working-day", false); workingDaysSet.delete(dateStr); } }
            });
        });
        controls.append("button").text("Reset to Default").on("click", () => {
             const selectedYear = parseInt(d3.select("#calendar-year-select").property("value"));
             initializeDefaultWorkingDays(selectedYear); drawCalendarModal(container, selectedYear);
        });
        controls.append("button").attr("class", "apply-btn").text("Apply").on("click", () => {
            investmentState.workingDays = Array.from(workingDaysSet).sort();
            const newCount = investmentState.workingDays.length;
            const hiddenInput = d3.select("#inv-workingDays");
            if (!hiddenInput.empty()) { hiddenInput.property("value", newCount).attr("data-working-days-list", JSON.stringify(investmentState.workingDays)); hiddenInput.node().dispatchEvent(new Event('change', { bubbles: true })); }
            d3.select("#inv-workingDays-button")?.text(`${newCount}`);
            const modal = document.getElementById("inv-calendar-modal"); if (modal) modal.style.display = "none";
            runFullAnalysis();
        });
    }
    function updateDemandUI() {
        document.getElementById('inv-std')?.setAttribute('value', formatNumberWithCommas(Math.round(investmentState.std)));
        document.getElementById('inv-cv')?.setAttribute('value', investmentState.cv.toFixed(1));
        document.getElementById('inv-p90Demand')?.setAttribute('value', formatNumberWithCommas(Math.round(investmentState.p90Demand)));
        const p50El = document.getElementById('inv-p50Demand'); if (p50El) p50El.textContent = formatNumberWithCommas(Math.round(investmentState.p50Demand));
        document.getElementById('inv-p10Demand')?.setAttribute('value', formatNumberWithCommas(Math.round(investmentState.p10Demand)));
    }
    function updateProbabilisticValues(driver) {
        const dailyDemandEl = document.getElementById('dailyDemand');
        const dailyDemandVal = dailyDemandEl ? (parseFloat(dailyDemandEl.value) || 180) : 180;
        const meanDemand = dailyDemandVal * investmentState.workingDays.length;
        investmentState.p50Demand = meanDemand;
        let std;
        if (driver === 'p90') {
            const p90InputVal = document.getElementById('inv-p90Demand')?.value ? parseFormattedNumber(document.getElementById('inv-p90Demand').value) : investmentState.p90Demand;
            investmentState.p90Demand = Math.max(meanDemand, Math.round(p90InputVal));
            std = (investmentState.p90Demand - meanDemand) / Z_SCORE_P90;
            investmentState.std = std > 0 ? Math.round(std) : 0; // Round std calculated from p90
            investmentState.cv = meanDemand > 0 ? (investmentState.std / meanDemand) * 100 : 0;
        } else if (driver === 'p10') {
            const p10InputVal = document.getElementById('inv-p10Demand')?.value ? parseFormattedNumber(document.getElementById('inv-p10Demand').value) : investmentState.p10Demand;
            investmentState.p10Demand = Math.min(meanDemand, Math.round(p10InputVal));
            std = (meanDemand - investmentState.p10Demand) / Z_SCORE_P90;
            investmentState.std = std > 0 ? Math.round(std) : 0; // Round std calculated from p10
            investmentState.cv = meanDemand > 0 ? (investmentState.std / meanDemand) * 100 : 0;
        } else {
            if (driver === 'std') {
                 const stdInputVal = document.getElementById('inv-std')?.value ? parseFormattedNumber(document.getElementById('inv-std').value) : investmentState.std;
                 investmentState.std = Math.round(stdInputVal);
                 std = investmentState.std;
                investmentState.cv = meanDemand > 0 ? (std / meanDemand) * 100 : 0;
            } else { // 'cv' or 'mean'
                 std = (investmentState.cv / 100) * meanDemand;
                investmentState.std = Math.round(std);
            }
            const z = CI_Z_SCORES[investmentState.ciLevel] || 1.960;
            const halfWidth = z * investmentState.std;
            investmentState.p90Demand = Math.round(meanDemand + halfWidth);
            investmentState.p10Demand = Math.round(meanDemand - halfWidth);
        }
        updateDemandUI();
        clearTimeout(analysisDebounceTimer);
        analysisDebounceTimer = setTimeout(runFullAnalysis, 0);
    }
    function calculateNPV(cashFlows, rate) { return cashFlows.reduce((acc, val, i) => acc + val / Math.pow(1 + rate, i), 0); }
    function calculateIRR(cashFlows, maxIter = 100, tolerance = 1e-6) {
        if (!cashFlows || cashFlows.length === 0 || cashFlows[0] >= 0) { return NaN; }
        let lowRate = -0.99, highRate = 9999999.0, midRate = 0, npvLow = calculateNPV(cashFlows, lowRate), npvHigh = calculateNPV(cashFlows, highRate);
        if (npvLow * npvHigh > 0) return NaN;
        for (let i = 0; i < maxIter; i++) { midRate = (lowRate + highRate) / 2; const npvMid = calculateNPV(cashFlows, midRate); if (Math.abs(npvMid) < tolerance) return midRate; if (npvLow * npvMid < 0) { highRate = midRate; } else { lowRate = midRate; } }
        return midRate;
    }
    function calculatePaybackPeriod(cashFlows) {
        if (!cashFlows || cashFlows.length < 2 || cashFlows[0] >= 0) return 0;
        const initialInvestment = Math.abs(cashFlows[0]); let cumulativeCashFlow = 0;
        for (let t = 1; t < cashFlows.length; t++) { const lastCumulative = cumulativeCashFlow; cumulativeCashFlow += cashFlows[t]; if (cumulativeCashFlow >= initialInvestment) { return (cashFlows[t] <= 0) ? t : (t - 1) + ((initialInvestment - lastCumulative) / cashFlows[t]); } }
        return Infinity;
    }
    function calculateFinancialScenario(annualUnitDemand) {
        const { analysisPeriod, marr, taxRate, runExpansionCase, salvageValue, installationCost } = investmentState;
        const workingDaysCount = investmentState.workingDays.length;
        const laborCostEl = document.getElementById('laborCost'); const superSellEl = document.getElementById('superSell'); const superCogsEl = document.getElementById('superCogs'); const ultraSellEl = document.getElementById('ultraSell'); const ultraCogsEl = document.getElementById('ultraCogs'); const megaSellEl = document.getElementById('megaSell'); const megaCogsEl = document.getElementById('megaCogs'); const numEmployeesEl = document.getElementById('numEmployees'); const opHoursEl = document.getElementById('opHours');
        const finInputs = { laborCost: laborCostEl ? parseFloat(laborCostEl.value) || 25.0 : 25.0, superSell: superSellEl ? parseFloat(superSellEl.value) || 400 : 400, superCogs: superCogsEl ? parseFloat(superCogsEl.value) || 375 : 375, ultraSell: ultraSellEl ? parseFloat(ultraSellEl.value) || 650 : 650, ultraCogs: ultraCogsEl ? parseFloat(ultraCogsEl.value) || 590 : 590, megaSell: megaSellEl ? parseFloat(megaSellEl.value) || 1000 : 1000, megaCogs: megaCogsEl ? parseFloat(megaCogsEl.value) || 960 : 960, };
        const buildRatios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.333, ultra: 0.333, mega: 0.334 }; const avgPrice = (finInputs.superSell * buildRatios.super) + (finInputs.ultraSell * buildRatios.ultra) + (finInputs.megaSell * buildRatios.mega);
        let unitsToProduce = 0, configForReport = {}, initialInvestment = 0, equipmentCostForDepreciation = 0; const currentEmployees = numEmployeesEl ? parseInt(numEmployeesEl.value) || 8 : 8; const baseOpHours = opHoursEl ? parseFloat(opHoursEl.value) || 15.0 : 15.0;
        if (typeof calculateMetrics !== 'function' || typeof ASSEMBLY_LINE_LENGTH === 'undefined') { console.error("Missing core function/data: calculateMetrics or ASSEMBLY_LINE_LENGTH"); return { /* error object */ }; }
        if (!runExpansionCase) {
            const metrics = calculateMetrics({ dailyDemand: 9999, opHours: baseOpHours, numEmployees: currentEmployees }, {}); const maxAnnualCapacity = (metrics?.throughputUnitsPerDay || 0) * workingDaysCount; unitsToProduce = Math.min(annualUnitDemand, maxAnnualCapacity); configForReport = { name: `${currentEmployees} Workers, ${baseOpHours} hrs/day`, empCount: currentEmployees, opHours: baseOpHours }; equipmentCostForDepreciation = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0))) + installationCost; initialInvestment = -equipmentCostForDepreciation;
        } else {
            const optimalConfigResult = findOptimalNPVConfig(annualUnitDemand, finInputs); const optimalConfig = { name: `${optimalConfigResult.emp} Workers, ${optimalConfigResult.hrs.toFixed(2)} hrs/day`, empCount: optimalConfigResult.emp, opHours: optimalConfigResult.hrs }; unitsToProduce = annualUnitDemand; configForReport = optimalConfig; const oldLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0))); const newLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * optimalConfig.empCount) - (optimalConfig.empCount % 2 === 0 ? 2 : 0))); const adjustment = newLineCost < oldLineCost ? -(salvageValue * ((oldLineCost - newLineCost) / oldLineCost)) : (newLineCost - oldLineCost); equipmentCostForDepreciation = newLineCost < oldLineCost ? 0 : adjustment + installationCost; initialInvestment = -(installationCost + adjustment);
        }
        const cashFlows = [initialInvestment]; const scaledMfgOverhead = investmentState.mfgOverhead * (configForReport.opHours > baseOpHours ? configForReport.opHours / baseOpHours : 1); const scaledSgaExpenses = investmentState.sgaExpenses * (configForReport.opHours > baseOpHours ? configForReport.opHours / baseOpHours : 1); const macrsSchedule = MACRS_RATES['5-year'];
        for (let t = 1; t <= analysisPeriod; t++) { const revenue = unitsToProduce * avgPrice; const totalMaterialCost = unitsToProduce * ((finInputs.superCogs * buildRatios.super) + (finInputs.ultraCogs * buildRatios.ultra) + (finInputs.megaCogs * buildRatios.mega)); const laborCost = configForReport.empCount * configForReport.opHours * finInputs.laborCost * workingDaysCount; const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0; const ebit = revenue - (totalMaterialCost + laborCost + scaledMfgOverhead + investmentState.freightExpense + scaledSgaExpenses + taxDepreciation); const nopat = ebit - (ebit > 0 ? ebit * (taxRate / 100) : 0); cashFlows.push(nopat + taxDepreciation); }
        if (equipmentCostForDepreciation > 0 && analysisPeriod > 0) { cashFlows[analysisPeriod] += salvageValue * (1 - (taxRate / 100)); } const npv = calculateNPV(cashFlows, marr / 100), irr = calculateIRR(cashFlows), payback = calculatePaybackPeriod(cashFlows);
        return { annualUnitDemand, requiredConfig: configForReport, metrics: { npv, irr, payback, initialInvestment }, cashFlows };
    }
    function runFullAnalysis() {
        const resultsDisplay = d3.select("#inv-results-display"); const resultsColumn = d3.select(".inv-results-column"); const placeholder = d3.select("#inv-results-placeholder");
        if (!resultsDisplay.empty()) resultsDisplay.style("display", "none"); if (!placeholder.empty()) placeholder.html(`<p>Calculating...</p>`).style("display", "block");
        setTimeout(() => {
            try {
                 const dailyDemandEl = document.getElementById('dailyDemand'); const dailyDemandVal = dailyDemandEl ? (parseFloat(dailyDemandEl.value) || 180) : 180; investmentState.p50Demand = Math.round(dailyDemandVal * investmentState.workingDays.length);
                 const std = (investmentState.cv / 100) * investmentState.p50Demand; investmentState.std = Math.round(std); const z = CI_Z_SCORES[investmentState.ciLevel] || 1.960; const halfWidth = z * investmentState.std; investmentState.p90Demand = Math.round(investmentState.p50Demand + halfWidth); investmentState.p10Demand = Math.round(investmentState.p50Demand - halfWidth); updateDemandUI();
                const results = Object.fromEntries(Object.entries({ 'P90 (Optimistic)': investmentState.p90Demand, 'P50 (Most Likely)': investmentState.p50Demand, 'P10 (Conservative)': investmentState.p10Demand }).map(([name, demand]) => [name, calculateFinancialScenario(demand)]));
                 if (!placeholder.empty()) placeholder.style("display", "none"); if (!resultsDisplay.empty()) resultsDisplay.style("display", "block");
                renderInvestmentResults(results);
            } catch (error) { console.error("Error during investment analysis:", error); if (!placeholder.empty()) placeholder.html(`<p class="error">An error occurred: ${error.message}</p>`).style("display", "block"); if (!resultsDisplay.empty()) resultsDisplay.style("display", "none"); }
        }, 50);
    }
    function findOptimalNPVConfig(annualUnitDemand, finInputs) {
        let maxNPV = -Infinity; let bestConfig = { emp: 0, hrs: 0 }; const workingDaysCount = investmentState.workingDays.length; const dailyDemand = workingDaysCount > 0 ? Math.ceil(annualUnitDemand / workingDaysCount) : 0; const currentEmployeesEl = document.getElementById('numEmployees'); const currentEmployees = currentEmployeesEl ? parseInt(currentEmployeesEl.value) || 8 : 8; const maxDemandMap = new Map(WORKSTATION_CAPACITIES.map(c => [c.ws, c.maxDemand]));
        if (typeof calculateWorkstationDetails !== 'function' || typeof calculateMetrics !== 'function' || typeof originalConfigData === 'undefined' || typeof ASSEMBLY_LINE_LENGTH === 'undefined' || typeof state === 'undefined') { console.error("Missing core functions/data needed for findOptimalNPVConfig"); return bestConfig; }
        for (let numEmployees = 3; numEmployees <= 13; numEmployees++) {
            if (dailyDemand > (maxDemandMap.get(numEmployees) || 0)) continue;
            const tempConfig = JSON.parse(JSON.stringify(state.configData)); state.configData = originalConfigData; const { bottleneckTime, fastestTime } = calculateWorkstationDetails(numEmployees); state.configData = tempConfig;
            if (bottleneckTime <= 0 || !isFinite(fastestTime) || fastestTime <= 0) continue;
            const productSpacing = fastestTime * 15; const throughputTime = productSpacing > 0 ? (ASSEMBLY_LINE_LENGTH / productSpacing) * bottleneckTime : Infinity; if(!isFinite(throughputTime)) continue;
            const totalRequiredMinutes = (dailyDemand > 1 ? (dailyDemand - 1) * bottleneckTime : 0) + throughputTime; const minRequiredHours = totalRequiredMinutes / 60; if (minRequiredHours > 24) continue;
            let optimalOpHours = -1;
            for (let opHours = roundUpToQuarter(minRequiredHours); opHours <= 24; opHours += 0.25) { const metrics = calculateMetrics({ dailyDemand, opHours, numEmployees }, finInputs); if (metrics && metrics.throughputUnitsPerDay >= dailyDemand) { optimalOpHours = opHours; break; } } if (optimalOpHours === -1) continue;
            const configForAnalysis = { empCount: numEmployees, opHours: optimalOpHours }; const { analysisPeriod, marr, taxRate, salvageValue, installationCost } = investmentState; const oldLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0))); const newLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * configForAnalysis.empCount) - (configForAnalysis.empCount % 2 === 0 ? 2 : 0))); const adjustment = newLineCost < oldLineCost ? -(salvageValue * ((oldLineCost - newLineCost) / oldLineCost)) : (newLineCost - oldLineCost); const equipmentCostForDepreciation = newLineCost < oldLineCost ? 0 : adjustment + installationCost; const initialInvestment = -(installationCost + adjustment); const cashFlows = [initialInvestment];
            const buildRatios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.333, ultra: 0.333, mega: 0.334 }; const avgPrice = (finInputs.superSell * buildRatios.super) + (finInputs.ultraSell * buildRatios.ultra) + (finInputs.megaSell * buildRatios.mega); const scaledMfgOverhead = investmentState.mfgOverhead * (configForAnalysis.opHours > 15 ? configForAnalysis.opHours / 15 : 1); const scaledSgaExpenses = investmentState.sgaExpenses * (configForAnalysis.opHours > 15 ? configForAnalysis.opHours / 15 : 1); const macrsSchedule = MACRS_RATES['5-year'];
            for (let t = 1; t <= analysisPeriod; t++) { const revenue = annualUnitDemand * avgPrice; const totalMaterialCost = annualUnitDemand * ((finInputs.superCogs * buildRatios.super) + (finInputs.ultraCogs * buildRatios.ultra) + (finInputs.megaCogs * buildRatios.mega)); const laborCost = configForAnalysis.empCount * configForAnalysis.opHours * finInputs.laborCost * workingDaysCount; const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0; const ebit = revenue - (totalMaterialCost + laborCost + scaledMfgOverhead + investmentState.freightExpense + scaledSgaExpenses + taxDepreciation); const nopat = ebit - (ebit > 0 ? ebit * (taxRate / 100) : 0); cashFlows.push(nopat + taxDepreciation); }
            if (equipmentCostForDepreciation > 0 && analysisPeriod > 0) { cashFlows[analysisPeriod] += salvageValue * (1 - (taxRate / 100)); } const currentNPV = calculateNPV(cashFlows, marr / 100); if (currentNPV > maxNPV) { maxNPV = currentNPV; bestConfig = { emp: numEmployees, hrs: optimalOpHours }; }
        }
        return bestConfig;
    }
    function renderInvestmentResults(results) {
        const p50Result = results['P50 (Most Likely)']; if (!p50Result) return;
        const scorecardData = [
            { label: 'Net Present Value (NPV)', value: p50Result.metrics.npv.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}), isError: p50Result.metrics.npv < 0 },
            { label: 'Internal Rate of Return (IRR)', value: isNaN(p50Result.metrics.irr) ? "N/A" : `${(p50Result.metrics.irr*100).toFixed(1)}%`, isError: isNaN(p50Result.metrics.irr) || p50Result.metrics.irr*100 < investmentState.marr },
            { label: 'Payback Period', value: isFinite(p50Result.metrics.payback) ? `${Math.ceil(p50Result.metrics.payback*365.2425)} Days` : "Never", isError: !isFinite(p50Result.metrics.payback) }
        ];
        const scorecards = d3.select(".inv-scorecard-container")?.html("")?.selectAll(".inv-scorecard")?.data(scorecardData)?.join("div")?.attr("class", "inv-scorecard"); scorecards?.append("div")?.attr("class", "inv-scorecard-label")?.text(d => d.label); scorecards?.append("div")?.attr("class", "inv-scorecard-value")?.style("color", d => d.isError ? 'var(--failure-color)' : null)?.text(d => d.value);
        const chartContainer = d3.select(".inv-chart-container"); if(chartContainer.empty()) return; chartContainer.html(""); const chartNode = chartContainer.node(); if (!chartNode) return; const scorecardHeight = d3.select(".inv-scorecard-container")?.node()?.offsetHeight || 95; const resultsCol = d3.select('.inv-results-column').node(); if (!resultsCol) return; const chartContainerHeight = resultsCol.clientHeight - scorecardHeight - 15; chartContainer.style('height', `${chartContainerHeight > 0 ? chartContainerHeight : 0}px`); const margin={top:20,right:30,bottom:60,left:80}; const width=chartNode.getBoundingClientRect().width-margin.left-margin.right; const height=chartNode.getBoundingClientRect().height-margin.top-margin.bottom; if(width<=0||height<=0) return;
        const chartSvg=chartContainer.append("svg").attr("viewBox",`0 0 ${width+margin.left+margin.right} ${height+margin.top+margin.bottom}`); const chartG=chartSvg.append("g").attr("transform",`translate(${margin.left},${margin.top})`); const cumulativeData=Object.entries(results).map(([name,data])=>({name,values:data.cashFlows.map((cf,i)=>({year:i,value:data.cashFlows.slice(0,i+1).reduce((a,b)=>a+b,0)}))})); const x=d3.scaleLinear().domain([0,investmentState.analysisPeriod]).range([0,width]); const allVals=cumulativeData.flatMap(d=>d.values.map(v=>v.value)); const yMin=d3.min(allVals); const yMax=d3.max(allVals); const y=d3.scaleLinear().domain([yMin,yMax]).nice().range([height,0]);
        chartG.append("g").attr("class","inv-axis").attr("transform",`translate(0,${height})`).call(d3.axisBottom(x).ticks(investmentState.analysisPeriod).tickFormat(d3.format("d"))).selectAll("text").style("font-size",'14px'); chartG.append("g").attr("class","inv-axis").call(d3.axisLeft(y).tickFormat(d3.format("$,.2s"))).selectAll("text").style("font-size",'14px'); const p90Data=cumulativeData.find(d=>d.name.includes('P90'))?.values; const p50Data=cumulativeData.find(d=>d.name.includes('P50'))?.values; const p10Data=cumulativeData.find(d=>d.name.includes('P10'))?.values;
        if(p90Data&&p50Data&&p10Data){chartG.append("path").datum(p90Data).attr("fill",root?getComputedStyle(root).getPropertyValue('--primary'):'#4e79a7').attr("class","inv-area").attr("d",d3.area().x(d=>x(d.year)).y0(d=>y(p50Data[d.year]?.value??yMin)).y1(d=>y(d.value))); chartG.append("path").datum(p50Data).attr("fill",root?getComputedStyle(root).getPropertyValue('--secondary2'):'#f28e2b').attr("class","inv-area").attr("d",d3.area().x(d=>x(d.year)).y0(d=>y(p10Data[d.year]?.value??yMin)).y1(d=>y(d.value)));}
        const line=d3.line().x(d=>x(d.year)).y(d=>y(d.value)); chartG.selectAll(".inv-line").data(cumulativeData).join("path").attr("class","inv-line").attr("d",d=>line(d.values)).style("stroke",d=>d3.scaleOrdinal().domain(['P90 (Optimistic)','P50 (Most Likely)','P10 (Conservative)']).range([root?getComputedStyle(root).getPropertyValue('--primary'):'#4e79a7',root?getComputedStyle(root).getPropertyValue('--secondary1'):'#e15759',root?getComputedStyle(root).getPropertyValue('--secondary2'):'#f28e2b'])(d.name)).style("stroke-width",d=>d.name.includes('P50')?'6px':'2px');
        chartSvg.append("text").attr("class","inv-axis-label").attr("text-anchor","middle").attr("x",margin.left+width/2).attr("y",height+margin.top+40).text("Analysis Period (Years)").style("font-size","16px").style("font-family","Arial"); chartSvg.append("text").attr("class","inv-axis-label").attr("transform","rotate(-90)").attr("text-anchor","middle").attr("y",margin.left/4).attr("x",-(margin.top+height/2)).text("Cumulative Free Cash Flow").style("font-size","16px").style("font-family","Arial"); chartG.append("line").attr("class","inv-break-even").attr("x1",0).attr("x2",width).attr("y1",y(0)).attr("y2",y(0));
        const tooltip=createTooltip("inv-tooltip"); if(!tooltip) return; chartG.selectAll(".inv-hitbox").data(cumulativeData).join("path").attr("class","inv-hitbox").attr("d",d=>line(d.values)).on("mouseover",(event,d)=>{tooltip.transition().duration(200).style("opacity",1); const sR=results[d.name];if(!sR)return; const irr=isNaN(sR.metrics.irr)?"N/A":`${(sR.metrics.irr*100).toFixed(1)}%`; const pb=isFinite(sR.metrics.payback)?`${Math.ceil(sR.metrics.payback*365.2425)} Days`:"Never"; tooltip.html(`<div class="tooltip-header">${d.name}</div><div class="tooltip-row"><span>NPV:</span><strong>${sR.metrics.npv.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})}</strong></div><div class="tooltip-row"><span>IRR:</span><strong>${irr}</strong></div><div class="tooltip-row"><span>Payback:</span><strong>${pb}</strong></div><hr><div class="tooltip-row"><span>Config:</span><strong>${sR.requiredConfig.name}</strong></div><div class="tooltip-row"><span>Ann Demand:</span><strong>${sR.annualUnitDemand.toFixed(0).toLocaleString('en-US')} U</strong></div>`); const tN=tooltip.node();if(!tN)return;const{width:tW,height:tH}=tN.getBoundingClientRect();const pad=15;let l=event.pageX+pad,t=event.pageY-tH-pad;if(l+tW>window.innerWidth)l=event.pageX-tW-pad;if(t<0)t=event.pageY+pad;tooltip.style("left",`${l}px`).style("top",`${t}px`);}).on("mousemove",(event)=>{const tN=tooltip.node();if(!tN)return;const{width:tW,height:tH}=tN.getBoundingClientRect();const pad=15;let l=event.pageX+pad,t=event.pageY-tH-pad;if(l+tW>window.innerWidth)l=event.pageX-tW-pad;if(t<0)t=event.pageY+pad;tooltip.style("left",`${l}px`).style("top",`${t}px`);}).on("mouseout",()=>tooltip.transition().duration(500).style("opacity",0));
    }
    return async function draw() {
        initializeDefaultWorkingDays(investmentState.currentYear);
        createCalendarModalOnce();
        const svg = d3.select("#investment-panel"); if (svg.empty()) return; svg.selectAll("*").remove();
        const container = svg.append("foreignObject").attr("width", "100%").attr("height", "100%").append("xhtml:div").attr("class", "inv-container");
        const inputColumn = container.append("div").attr("class", "inv-input-column"); inputColumn.append("h3").attr("class", "inv-column-title").text("Economic Parameters");
        const inputArea = inputColumn.append("div").attr("class", "inv-inputs");
        try {
            const response = await fetch('Pages/investmentInputs.html'); if (!response.ok) throw new Error(response.statusText);
            inputArea.html(await response.text());
            const workingDaysInput = container.select("#inv-workingDays"); const label = container.select(`label[for="inv-workingDays"]`);
            if (!workingDaysInput.empty() && !label.empty()) {
                let displayButton = document.getElementById('inv-workingDays-button');
                if (!displayButton) { displayButton = document.createElement('button'); displayButton.id = 'inv-workingDays-button'; displayButton.className = 'inv-calendar-button'; label.node().after(displayButton); }
                const currentCount = investmentState.workingDays.length; displayButton.textContent = `${currentCount} Days`;
                workingDaysInput.style("display", "none").property("value", currentCount).attr("data-working-days-list", JSON.stringify(investmentState.workingDays));
                displayButton.replaceWith(displayButton.cloneNode(true)); displayButton = document.getElementById('inv-workingDays-button');
                if(displayButton) { displayButton.addEventListener('click', () => { const modal = document.getElementById("inv-calendar-modal"); if (modal) modal.style.display = "block"; drawCalendarModal(d3.select("#inv-calendar-content-target"), investmentState.currentYear); }); }
            } else { console.error("Could not find #inv-workingDays input or label."); }
             setTimeout(() => {
                 const tooltipsData = { /* ... tooltips data ... */ }; const tooltip = createTooltip("inv-tooltip"); if (!tooltip) return; const containerElement = container.node(); if (!containerElement) return;
                 for (const [id, text] of Object.entries(tooltipsData)) { const labelElement = containerElement.querySelector(`label[for="${id}"]`); if (labelElement) d3.select(labelElement).on("mouseover", (event) => { /*...*/ }).on("mousemove", (event) => { /*...*/ }).on("mouseout", () => tooltip.style("opacity", 0)); }
             }, 100);
        } catch (e) { inputArea.html('<p class="error">Could not load input form.</p>'); console.error(e); }
        container.append("div").attr("class", "inv-results-column").html(`<div id="inv-results-placeholder" style="display: none;"></div><div id="inv-results-display"><div class="inv-scorecard-container"></div><div class="inv-chart-container"></div></div>`);
         try {
            const summaryCostEl = document.getElementById('summary-cost'); if (summaryCostEl?.textContent) { const costText = summaryCostEl.textContent; const parsedCost = parseFloat(costText.replace(/[$,]/g, '')) || 0; if (parsedCost > 0) investmentState.freightExpense = parsedCost; }
            Object.keys(investmentState).forEach(key => { if (key === 'workingDays' || key==='currentYear' || key==='isCalendarInitialized') return; const el = document.getElementById(`inv-${key}`); if (el) el.value = investmentState[key]; });
            const fieldsToFormat = ['inv-mfgOverhead', 'inv-sgaExpenses', 'inv-freightExpense', 'inv-installationCost', 'inv-salvageValue', 'inv-p10Demand', 'inv-p90Demand', 'inv-std'];
            fieldsToFormat.forEach(id => {
                const input = document.getElementById(id);
                if (input) {
                    const key = id.replace('inv-', ''); const initialValue = input.dataset.committedValue !== undefined ? parseFormattedNumber(input.dataset.committedValue) : investmentState[key];
                    input.value = formatNumberWithCommas(['p10Demand', 'p90Demand', 'std'].includes(key) ? Math.round(initialValue) : initialValue);
                    input.removeEventListener('input', handleFormattedInput); input.removeEventListener('change', handleFormattedInput);
                    input.addEventListener('input', handleFormattedInput); input.addEventListener('change', handleFormattedInput);
                }
            });
             function handleFormattedInput(event) {
                 const input = event.target; const key = input.id.replace('inv-', ''); const rawValue = parseFormattedNumber(input.value); const shouldRound = ['p10Demand', 'p90Demand', 'std'].includes(key); let finalValue = rawValue;
                 if (shouldRound) { finalValue = Math.round(rawValue); if (rawValue !== finalValue || event.type === 'change') { const caretPos = input.selectionStart; const oldLen = input.value.length; input.value = formatNumberWithCommas(finalValue); const newLen = input.value.length; try { input.setSelectionRange(caretPos + (newLen - oldLen), caretPos + (newLen - oldLen)); } catch(e){} } }
                 else if (event.type === 'change'){ input.value = formatNumberWithCommas(finalValue); }
                 if (event.type === 'change' || shouldRound) { if (key in investmentState) investmentState[key] = finalValue; }
             }
            container.selectAll("input[data-type='currency'], input[type='number']:not(#inv-p10Demand):not(#inv-p90Demand):not(#inv-std), select").on("change", null).on("change", (event) => {
                const key = event.target.id.replace('inv-', ''); if (key === 'workingDays') return;
                if (key in investmentState) { let value; const target = event.target; if (target.dataset.type === 'currency') { value = parseFormattedNumber(target.value); } else if (target.type === 'select-one') { value = target.value; } else { value = parseFloat(target.value) || 0; } investmentState[key] = value;
                if (['cv', 'ciLevel'].includes(key)) { updateProbabilisticValues(key); } else { clearTimeout(analysisDebounceTimer); analysisDebounceTimer = setTimeout(runFullAnalysis, 500); } }
            });
             container.selectAll("#inv-p10Demand, #inv-p90Demand, #inv-std").on("change.recalc", null).on("change.recalc", function(event) { const key = event.target.id.replace('inv-', ''); if (key in investmentState) { updateProbabilisticValues(key.replace('Demand','')); } });
            const controlsArea = inputColumn.append("div").attr("class", "inv-analysis-controls"); controlsArea.html(`<div class="inv-button-group"><button id="inv-baseCaseBtn">Base Case</button><button id="inv-expansionCaseBtn">Expansion Case</button></div>`); controlsArea.select('#inv-baseCaseBtn').on('click', () => { if(investmentState.runExpansionCase){investmentState.runExpansionCase=false; runFullAnalysis(); controlsArea.select('#inv-baseCaseBtn').classed('active',true); controlsArea.select('#inv-expansionCaseBtn').classed('active',false);} }); controlsArea.select('#inv-expansionCaseBtn').on('click', () => { if(!investmentState.runExpansionCase){investmentState.runExpansionCase=true; runFullAnalysis(); controlsArea.select('#inv-baseCaseBtn').classed('active',false); controlsArea.select('#inv-expansionCaseBtn').classed('active',true);} }); controlsArea.select(investmentState.runExpansionCase ? '#inv-expansionCaseBtn' : '#inv-baseCaseBtn').classed('active', true);
             setTimeout(() => { updateProbabilisticValues('mean'); }, 100);
         } catch(e) { console.error("Error setting up inputs/listeners:", e); }
    };
})();
// Ensure roundUpToQuarter exists globally or is imported if needed elsewhere
function roundUpToQuarter(value) { return Math.ceil(value / 0.25) * 0.25; }