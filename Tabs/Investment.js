const drawInvestmentPanel = (function () {
    /**
     * @property {object} investmentState - Holds the persistent state for all
     * user-configurable inputs on the investment panel.
     */
    const investmentState = {
        analysisPeriod: 5,
        marr: 12.0,
        taxRate: 25.0,
        workingDays: [],
        mfgOverhead: 250000,
        sgaExpenses: 350000,
        freightExpense: 300000,
        costPerFootStraight: 225,
        costPerBend: 450,
        installationCost: 10000,
        salvageValue: 10000,
        runExpansionCase: false,
        // Probabilistic demand parameters
        std: 6750,
        cv: 15.0,
        ciLevel: 95,
        p90Demand: 0,
        p50Demand: 0,
        p10Demand: 0,
        currentYear: new Date().getFullYear(),
        isCalendarInitialized: false
    };

    /**
     * @const {object} MACRS_RATES - Standard depreciation rates for 5-year MACRS.
     */
    const MACRS_RATES = {
        '5-year': [0.2000, 0.3200, 0.1920, 0.1152, 0.1152, 0.0576]
    };

    const Z_SCORE_P90 = 1.28155;
    const CI_Z_SCORES = { 90: 1.645, 95: 1.960, 99: 2.576 };
    let analysisDebounceTimer;

    function formatNumberWithCommas(num) { return (num === null || num === undefined) ? '' : num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
    function parseFormattedNumber(str) { return (typeof str !== 'string') ? str : (parseFloat(str.replace(/,/g, '')) || 0); }

    // --- Calendar Helper Functions --------------------------------

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
        const addHolidaySafe = (month, day) => { try { const d = new Date(year, month, day); if (!isNaN(d)) { const ds = toIsoDateString(d); if (ds) holidays.add(ds); } } catch (e) { } };
        const addAdjustedSafe = (month, day) => { try { const d = new Date(year, month, day); if (!isNaN(d)) { const dow = d.getDay(); if (dow === 0) d.setDate(d.getDate() + 1); else if (dow === 6) d.setDate(d.getDate() - 1); const ds = toIsoDateString(d); if (ds) holidays.add(ds); } } catch (e) { } };
        const addNthDayOfMonthSafe = (month, dayOfWeek, n) => { try { const d = new Date(year, month, 1); if (!isNaN(d)) { const fd = d.getDay(); let off = (dayOfWeek + 7 - fd) % 7; if (off === 0 && dayOfWeek !== fd) off = 7; const dayN = 1 + off + (n - 1) * 7; const cd = new Date(year, month, dayN); if (!isNaN(cd) && cd.getMonth() === month) addHolidaySafe(month, dayN); } } catch (e) { } };
        addAdjustedSafe(0, 1); // NYD
        const easterDate = getEasterSunday(year); if (easterDate) { const eds = toIsoDateString(easterDate); if (eds) holidays.add(eds); }
        try { const lastDayMay = new Date(year, 5, 0); if (!isNaN(lastDayMay)) { const lastDow = lastDayMay.getDay(); lastDayMay.setDate(lastDayMay.getDate() - (lastDow === 0 ? 6 : lastDow - 1)); addHolidaySafe(4, lastDayMay.getDate()); } } catch (e) { } // Memorial
        addAdjustedSafe(5, 19); // Juneteenth
        addAdjustedSafe(6, 4); // Independence
        addNthDayOfMonthSafe(8, 1, 1); // Labor
        addNthDayOfMonthSafe(10, 4, 4); // Thanksgiving
        addAdjustedSafe(11, 24); // Xmas Eve
        addAdjustedSafe(11, 25); // Xmas Day
        addAdjustedSafe(11, 31); // NYE
        return holidays;
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

    // --- Calendar Modal Functions -----------------------------

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
        if (investmentState.currentYear !== year || !investmentState.isCalendarInitialized) {
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
        yearSelect.on("change", function () {
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
                .on("click", function () {
                    const dayIndex = parseInt(d3.select(this).attr("data-day-index"));
                    const cellsToToggle = d3.select(this.closest('.calendar-month')).select('tbody').selectAll(`td[data-day-index="${dayIndex}"]:not(.not-current-month)`);
                    const firstCell = cellsToToggle.node(); const shouldAdd = firstCell ? !firstCell.classList.contains('working-day') : false;
                    cellsToToggle.each(function () {
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
                            .on("click", function () {
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
            holidayCells.each(function () {
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

            // Update the hidden input and the display button
            const hiddenInput = d3.select("#inv-workingDays");
            if (!hiddenInput.empty()) {
                hiddenInput.property("value", newCount).attr("data-working-days-list", JSON.stringify(investmentState.workingDays));
                // Manually dispatch change event so any other listeners pick it up
                hiddenInput.node().dispatchEvent(new Event('change', { bubbles: true }));
            }
            d3.select("#inv-workingDays-button")?.text(`${newCount} Days`); // Update button text

            const modal = document.getElementById("inv-calendar-modal"); if (modal) modal.style.display = "none";

            updateProbabilisticValues('mean');
        });
    }

    function updateDemandUI() {
        document.getElementById('inv-std').value = formatNumberWithCommas(Math.round(investmentState.std));
        document.getElementById('inv-cv').value = investmentState.cv.toFixed(1);
        document.getElementById('inv-p90Demand').value = formatNumberWithCommas(Math.round(investmentState.p90Demand));
        document.getElementById('inv-p50Demand').textContent = formatNumberWithCommas(Math.round(investmentState.p50Demand));
        document.getElementById('inv-p10Demand').value = formatNumberWithCommas(Math.round(investmentState.p10Demand));
    }

    function updateProbabilisticValues(driver) {
        const meanDemand = (parseFloat(dailyDemandInput.value) || 180) * investmentState.workingDays.length;
        investmentState.p50Demand = meanDemand;
        let std;

        if (driver === 'p90') {
            if (investmentState.p90Demand < meanDemand) investmentState.p90Demand = meanDemand;
            std = (investmentState.p90Demand - meanDemand) / Z_SCORE_P90;
            investmentState.std = std > 0 ? std : 0;
            investmentState.cv = meanDemand > 0 ? (investmentState.std / meanDemand) * 100 : 0;
        } else if (driver === 'p10') {
            if (investmentState.p10Demand > meanDemand) investmentState.p10Demand = meanDemand;
            std = (meanDemand - investmentState.p10Demand) / Z_SCORE_P90;
            investmentState.std = std > 0 ? std : 0;
            investmentState.cv = meanDemand > 0 ? (investmentState.std / meanDemand) * 100 : 0;
        } else {
            if (driver === 'std') {
                std = investmentState.std;
                investmentState.cv = meanDemand > 0 ? (std / meanDemand) * 100 : 0;
            } else {
                std = (investmentState.cv / 100) * meanDemand;
                investmentState.std = std;
            }
            const z = CI_Z_SCORES[investmentState.ciLevel] || 1.960;
            const halfWidth = z * std;
            investmentState.p90Demand = meanDemand + halfWidth;
            investmentState.p10Demand = meanDemand - halfWidth;
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
        for (let i = 0; i < maxIter; i++) {
            midRate = (lowRate + highRate) / 2;
            const npvMid = calculateNPV(cashFlows, midRate);
            if (Math.abs(npvMid) < tolerance) return midRate;
            if (npvLow * npvMid < 0) { highRate = midRate; } else { lowRate = midRate; }
        }
        return midRate;
    }

    function calculatePaybackPeriod(cashFlows) {
        if (!cashFlows || cashFlows.length < 2 || cashFlows[0] >= 0) return 0;
        const initialInvestment = Math.abs(cashFlows[0]);
        let cumulativeCashFlow = 0;
        for (let t = 1; t < cashFlows.length; t++) {
            const lastCumulative = cumulativeCashFlow;
            cumulativeCashFlow += cashFlows[t];
            if (cumulativeCashFlow >= initialInvestment) {
                return (cashFlows[t] <= 0) ? t : (t - 1) + ((initialInvestment - lastCumulative) / cashFlows[t]);
            }
        }
        return Infinity;
    }

    function calculateFinancialScenario(annualUnitDemand) {
        const { analysisPeriod, marr, taxRate, runExpansionCase, salvageValue, installationCost } = investmentState;
        const workingDaysCount = investmentState.workingDays.length; // Get length

        const finInputs = {
            laborCost: parseFloat(laborCostInput.value), superSell: parseFloat(superSellInput.value), superCogs: parseFloat(superCogsInput.value),
            ultraSell: parseFloat(ultraSellInput.value), ultraCogs: parseFloat(ultraCogsInput.value), megaSell: parseFloat(megaSellInput.value), megaCogs: parseFloat(megaCogsInput.value),
        };
        const avgPrice = (finInputs.superSell * BUILD_RATIOS.super) + (finInputs.ultraSell * BUILD_RATIOS.ultra) + (finInputs.megaSell * BUILD_RATIOS.mega);
        let unitsToProduce = 0, configForReport = {}, initialInvestment = 0, equipmentCostForDepreciation = 0;
        const currentEmployees = parseInt(numEmployeesInput.value);
        const baseOpHours = parseFloat(opHoursInput.value);

        if (!runExpansionCase) {
            const metrics = calculateMetrics({ dailyDemand: 9999, opHours: baseOpHours, numEmployees: currentEmployees }, {});
            const maxAnnualCapacity = metrics.throughputUnitsPerDay * workingDaysCount;
            unitsToProduce = Math.min(annualUnitDemand, maxAnnualCapacity);
            configForReport = { name: `${currentEmployees} Workers, ${baseOpHours} hrs/day`, empCount: currentEmployees, opHours: baseOpHours };
            equipmentCostForDepreciation = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0))) + installationCost;
            initialInvestment = -equipmentCostForDepreciation;
        } else {
            const optimalConfigResult = findOptimalNPVConfig(annualUnitDemand, finInputs);
            const optimalConfig = { name: `${optimalConfigResult.emp} Workers, ${optimalConfigResult.hrs.toFixed(2)} hrs/day`, empCount: optimalConfigResult.emp, opHours: optimalConfigResult.hrs };
            unitsToProduce = annualUnitDemand;
            configForReport = optimalConfig;
            const oldLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0)));
            const newLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * optimalConfig.empCount) - (optimalConfig.empCount % 2 === 0 ? 2 : 0)));
            const adjustment = newLineCost < oldLineCost ? -(salvageValue * ((oldLineCost - newLineCost) / oldLineCost)) : (newLineCost - oldLineCost);
            equipmentCostForDepreciation = newLineCost < oldLineCost ? 0 : adjustment + installationCost;
            initialInvestment = -(installationCost + adjustment);
        }

        const cashFlows = [initialInvestment];
        const scaledMfgOverhead = investmentState.mfgOverhead * (configForReport.opHours > baseOpHours ? configForReport.opHours / baseOpHours : 1);
        const scaledSgaExpenses = investmentState.sgaExpenses * (configForReport.opHours > baseOpHours ? configForReport.opHours / baseOpHours : 1);
        const macrsSchedule = MACRS_RATES['5-year'];

        for (let t = 1; t <= analysisPeriod; t++) {
            const revenue = unitsToProduce * avgPrice;
            const totalMaterialCost = unitsToProduce * ((finInputs.superCogs * BUILD_RATIOS.super) + (finInputs.ultraCogs * BUILD_RATIOS.ultra) + (finInputs.megaCogs * BUILD_RATIOS.mega));
            const laborCost = configForReport.empCount * configForReport.opHours * finInputs.laborCost * workingDaysCount;
            const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0;
            const ebit = revenue - (totalMaterialCost + laborCost + scaledMfgOverhead + investmentState.freightExpense + scaledSgaExpenses + taxDepreciation);
            const nopat = ebit - (ebit > 0 ? ebit * (taxRate / 100) : 0);
            cashFlows.push(nopat + taxDepreciation);
        }

        if (equipmentCostForDepreciation > 0 && analysisPeriod > 0) { cashFlows[analysisPeriod] += salvageValue * (1 - (taxRate / 100)); }
        const npv = calculateNPV(cashFlows, marr / 100), irr = calculateIRR(cashFlows), payback = calculatePaybackPeriod(cashFlows);
        return { annualUnitDemand, requiredConfig: configForReport, metrics: { npv, irr, payback, initialInvestment }, cashFlows };
    }

    function runFullAnalysis() {

        const resultsDisplay = d3.select("#inv-results-display").style("display", "block");
        const resultsColumn = d3.select(".inv-results-column");
        resultsColumn.transition().duration(150).style("opacity", 0.5);

        setTimeout(() => {
            try {
                const results = Object.fromEntries(Object.entries({ 'P90 (Optimistic)': investmentState.p90Demand, 'P50 (Most Likely)': investmentState.p50Demand, 'P10 (Conservative)': investmentState.p10Demand }).map(([name, demand]) => [name, calculateFinancialScenario(demand)]));
                d3.select("#inv-results-placeholder").style("display", "none");
                renderInvestmentResults(results);
                resultsColumn.transition().duration(250).style("opacity", 1);
            } catch (error) {
                console.error("Error during investment analysis:", error);
                d3.select("#inv-results-placeholder").html(`<p class="error">An error occurred: ${error.message}</p>`).style("display", "block");
                resultsColumn.style("opacity", 1);
            }
        }, 50);
    }

    function findOptimalNPVConfig(annualUnitDemand, finInputs) {
        let maxNPV = -Infinity;
        let bestConfig = { emp: 0, hrs: 0 };
        const dailyDemand = Math.ceil(annualUnitDemand / investmentState.workingDays.length);
        const currentEmployees = parseInt(numEmployeesInput.value);
        const maxDemandMap = new Map(WORKSTATION_CAPACITIES.map(c => [c.ws, c.maxDemand]));

        for (let numEmployees = 3; numEmployees <= 13; numEmployees++) {
            if (dailyDemand > (maxDemandMap.get(numEmployees) || 0)) continue;

            const tempConfig = { ...state.configData };
            state.configData = originalConfigData;
            const { bottleneckTime, fastestTime } = calculateWorkstationDetails(numEmployees);
            state.configData = tempConfig;
            if (bottleneckTime <= 0 || !isFinite(fastestTime) || fastestTime <= 0) continue;

            const productSpacing = fastestTime * 15;
            const throughputTime = (ASSEMBLY_LINE_LENGTH / productSpacing) * bottleneckTime;
            const totalRequiredMinutes = (dailyDemand > 1 ? (dailyDemand - 1) * bottleneckTime : 0) + throughputTime;
            const minRequiredHours = totalRequiredMinutes / 60;
            if (minRequiredHours > 24) continue;

            let optimalOpHours = -1;
            for (let opHours = roundUpToQuarter(minRequiredHours); opHours <= 24; opHours += 0.25) {
                const metrics = calculateMetrics({ dailyDemand, opHours, numEmployees }, finInputs);
                if (metrics && metrics.throughputUnitsPerDay >= dailyDemand) {
                    optimalOpHours = opHours;
                    break;
                }
            }
            if (optimalOpHours === -1) continue;

            const configForAnalysis = { empCount: numEmployees, opHours: optimalOpHours };
            const { analysisPeriod, marr, taxRate, salvageValue, installationCost } = investmentState;
            const workingDaysCount = investmentState.workingDays.length; // Get length

            const oldLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0)));
            const newLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * configForAnalysis.empCount) - (configForAnalysis.empCount % 2 === 0 ? 2 : 0)));
            const adjustment = newLineCost < oldLineCost ? -(salvageValue * ((oldLineCost - newLineCost) / oldLineCost)) : (newLineCost - oldLineCost);
            const equipmentCostForDepreciation = newLineCost < oldLineCost ? 0 : adjustment + installationCost;
            const initialInvestment = -(installationCost + adjustment);
            const cashFlows = [initialInvestment];
            const avgPrice = (finInputs.superSell * BUILD_RATIOS.super) + (finInputs.ultraSell * BUILD_RATIOS.ultra) + (finInputs.megaSell * BUILD_RATIOS.mega);
            const scaledMfgOverhead = investmentState.mfgOverhead * (configForAnalysis.opHours > 15 ? configForAnalysis.opHours / 15 : 1);
            const scaledSgaExpenses = investmentState.sgaExpenses * (configForAnalysis.opHours > 15 ? configForAnalysis.opHours / 15 : 1);
            const macrsSchedule = MACRS_RATES['5-year'];

            for (let t = 1; t <= analysisPeriod; t++) {
                const revenue = annualUnitDemand * avgPrice;
                const totalMaterialCost = annualUnitDemand * ((finInputs.superCogs * BUILD_RATIOS.super) + (finInputs.ultraCogs * BUILD_RATIOS.ultra) + (finInputs.megaCogs * BUILD_RATIOS.mega));
                const laborCost = configForAnalysis.empCount * configForAnalysis.opHours * finInputs.laborCost * workingDaysCount;
                const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0;
                const ebit = revenue - (totalMaterialCost + laborCost + scaledMfgOverhead + investmentState.freightExpense + scaledSgaExpenses + taxDepreciation);
                const nopat = ebit - (ebit > 0 ? ebit * (taxRate / 100) : 0);
                cashFlows.push(nopat + taxDepreciation);
            }

            if (equipmentCostForDepreciation > 0 && analysisPeriod > 0) {
                cashFlows[analysisPeriod] += salvageValue * (1 - (taxRate / 100));
            }

            const currentNPV = calculateNPV(cashFlows, marr / 100);
            if (currentNPV > maxNPV) {
                maxNPV = currentNPV;
                bestConfig = { emp: numEmployees, hrs: optimalOpHours };
            }
        }
        return bestConfig;
    }

    function renderInvestmentResults(results) {
        const p50Result = results['P50 (Most Likely)'];
        const scorecardData = [
            { label: 'Net Present Value (NPV)', value: p50Result.metrics.npv.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }), isError: p50Result.metrics.npv < 0 },
            { label: 'Internal Rate of Return (IRR)', value: isNaN(p50Result.metrics.irr) ? "No Return" : `${(p50Result.metrics.irr * 100).toFixed(1)}%`, isError: isNaN(p50Result.metrics.irr) },
            { label: 'Payback Period', value: isFinite(p50Result.metrics.payback) ? `${Math.ceil(p50Result.metrics.payback * 365.2425)} Days` : "Net Loss", isError: !isFinite(p50Result.metrics.payback) }
        ];

        const scorecards = d3.select(".inv-scorecard-container").html("").selectAll(".inv-scorecard").data(scorecardData).join("div").attr("class", "inv-scorecard");
        scorecards.append("div").attr("class", "inv-scorecard-label").text(d => d.label);
        scorecards.append("div").attr("class", "inv-scorecard-value").style("color", d => d.isError ? 'var(--failure-color)' : null).text(d => d.value);

        const chartContainer = d3.select(".inv-chart-container");
        chartContainer.html("");
        const chartNode = chartContainer.node();
        if (!chartNode) return;
        const scorecardHeight = 95;
        const chartContainerHeight = d3.select('.inv-results-column').node().clientHeight - scorecardHeight - 15;
        chartContainer.style('height', `${chartContainerHeight > 0 ? chartContainerHeight : 0}px`);
        const margin = { top: 20, right: 30, bottom: 60, left: 80 };
        const width = chartNode.getBoundingClientRect().width - margin.left - margin.right;
        const height = chartNode.getBoundingClientRect().height - margin.top - margin.bottom;
        if (width <= 0 || height <= 0) return;

        const chartSvg = chartContainer.append("svg").attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`);
        const chartG = chartSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const cumulativeData = Object.entries(results).map(([name, data]) => ({ name, values: data.cashFlows.map((cf, i) => ({ year: i, value: data.cashFlows.slice(0, i + 1).reduce((a, b) => a + b, 0) })) }));
        const x = d3.scaleLinear().domain([0, investmentState.analysisPeriod]).range([0, width]);
        const y = d3.scaleLinear().domain([d3.min(cumulativeData, d => d3.min(d.values, v => v.value)), d3.max(cumulativeData, d => d3.max(d.values, v => v.value))]).nice().range([height, 0]);
        chartG.append("g").attr("class", "inv-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(investmentState.analysisPeriod).tickFormat(d3.format("d"))).selectAll("text").style("font-size", '14px');
        chartG.append("g").attr("class", "inv-axis").call(d3.axisLeft(y).tickFormat(d3.format("$,.2s"))).selectAll("text").style("font-size", '14px');
        const p90Data = cumulativeData.find(d => d.name.includes('P90')).values, p50Data = cumulativeData.find(d => d.name.includes('P50')).values, p10Data = cumulativeData.find(d => d.name.includes('P10')).values;
        chartG.append("path").datum(p90Data).attr("fill", getComputedStyle(root).getPropertyValue('--primary')).attr("class", "inv-area").attr("d", d3.area().x(d => x(d.year)).y0(d => y(p50Data[d.year].value)).y1(d => y(d.value)));
        chartG.append("path").datum(p50Data).attr("fill", getComputedStyle(root).getPropertyValue('--secondary2')).attr("class", "inv-area").attr("d", d3.area().x(d => x(d.year)).y0(d => y(p10Data[d.year].value)).y1(d => y(d.value)));
        const line = d3.line().x(d => x(d.year)).y(d => y(d.value));
        chartG.selectAll(".inv-line").data(cumulativeData).join("path").attr("class", "inv-line").attr("d", d => line(d.values)).style("stroke", d => d3.scaleOrdinal().domain(['P90 (Optimistic)', 'P50 (Most Likely)', 'P10 (Conservative)']).range([getComputedStyle(root).getPropertyValue('--primary'), getComputedStyle(root).getPropertyValue('--secondary1'), getComputedStyle(root).getPropertyValue('--secondary2')])(d.name)).style("stroke-width", d => d.name.includes('P50') ? '6px' : '2px');
        chartSvg.append("text").attr("class", "inv-axis-label").attr("text-anchor", "middle").attr("x", margin.left + width / 2).attr("y", height + margin.top + 40).text("Analysis Period (Years)").style("font-size", "16px").style("font-family", "Arial");
        chartSvg.append("text").attr("class", "inv-axis-label").attr("transform", "rotate(-90)").attr("text-anchor", "middle").attr("y", margin.left / 4).attr("x", -(margin.top + height / 2)).text("Cumulative Free Cash Flow").style("font-size", "16px").style("font-family", "Arial");
        chartG.append("line").attr("class", "inv-break-even").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0));
        const tooltip = createTooltip("inv-tooltip");;
        chartG.selectAll(".inv-hitbox").data(cumulativeData).join("path").attr("class", "inv-hitbox").attr("d", d => line(d.values)).on("mouseover", (event, d) => {
            tooltip.transition().duration(200).style("opacity", 1);
            const scenarioResult = results[d.name];
            const FmtdIRR = isNaN(scenarioResult.metrics.irr) ? "No Return" : `${(scenarioResult.metrics.irr * 100).toFixed(1)}%`;
            const FmtdPayback = isFinite(scenarioResult.metrics.payback) ? `${Math.ceil(scenarioResult.metrics.payback * 365.2425)} Days` : "Net Loss";
            tooltip.html(`<div class="tooltip-header">${d.name}</div><div class="tooltip-row"><span>NPV:</span> <strong>${scenarioResult.metrics.npv.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></div><div class="tooltip-row"><span>IRR:</span> <strong>${FmtdIRR}</strong></div><div class="tooltip-row"><span>Payback:</span> <strong>${FmtdPayback}</strong></div><hr><div class="tooltip-row"><span>Config:</span> <strong>${scenarioResult.requiredConfig.name}</strong></div><div class="tooltip-row"><span>Annual Demand:</span> <strong>${scenarioResult.annualUnitDemand.toFixed(0).toLocaleString('en-US')} Units</strong></div>`);
        }).on("mousemove", (event) => tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px")).on("mouseout", () => tooltip.transition().duration(500).style("opacity", 0));
    }

    return async function draw() {
        // Initialize calendar system
        if (!investmentState.isCalendarInitialized) {
            initializeDefaultWorkingDays(investmentState.currentYear);
        }
        createCalendarModalOnce();

        const svg = d3.select("#investment-panel");
        svg.selectAll("*").remove();
        const container = svg.append("foreignObject").attr("width", "100%").attr("height", "100%").append("xhtml:div").attr("class", "inv-container");
        const inputColumn = container.append("div").attr("class", "inv-input-column");
        inputColumn.append("h3").attr("class", "inv-column-title").text("Economic Parameters");
        const inputArea = inputColumn.append("div").attr("class", "inv-inputs");
        try {
            const response = await fetch('Pages/investmentInputs.html');
            if (!response.ok) throw new Error(response.statusText);
            inputArea.html(await response.text());

            // --- Calendar Button Setup ---
            const workingDaysInput = container.select("#inv-workingDays");
            const label = container.select(`label[for="inv-workingDays"]`);

            if (!workingDaysInput.empty() && !label.empty()) {
                let displayButton = document.getElementById('inv-workingDays-button');
                if (!displayButton) {
                    displayButton = document.createElement('button');
                    displayButton.id = 'inv-workingDays-button';
                    displayButton.className = 'inv-calendar-button';
                    label.node().after(displayButton);
                }

                const currentCount = investmentState.workingDays.length;
                displayButton.textContent = `${currentCount} Days`;

                workingDaysInput.style("display", "none") // Hide the original number input
                    .property("value", currentCount)
                    .attr("data-working-days-list", JSON.stringify(investmentState.workingDays));

                // Re-clone to remove old listeners
                displayButton.replaceWith(displayButton.cloneNode(true));
                displayButton = document.getElementById('inv-workingDays-button');

                if (displayButton) {
                    displayButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        const modal = document.getElementById("inv-calendar-modal");
                        if (modal) modal.style.display = "block";
                        drawCalendarModal(d3.select("#inv-calendar-content-target"), investmentState.currentYear);
                    });
                }
            } else {
                console.error("Could not find #inv-workingDays input or label.");
            }

            setTimeout(() => {
                const tooltips = {
                    'inv-analysisPeriod': 'The Number of Years over which the Investment\'s Cash Flows are projected.',
                    'inv-marr': 'The Minimum Acceptable Rate of Return (MARR) for an Investment to be worth it.',
                    'inv-taxRate': 'The Corporate Tax Rate applied to Earnings before Tax.',
                    'inv-workingDays': 'The Number of Production Days in a Year.',
                    'inv-mfgOverhead': 'Annual Fixed Manufacturing Expenses not tied to Production (Rent, Utilties).',
                    'inv-sgaExpenses': 'Annual Fixed Selling, General, and Administrative Expenses (Salaries, Marketing).',
                    'inv-freightExpense': 'Annual Variable Cost of Shipping Finished Goods.',
                    'inv-costPerFootStraight': 'The Capital Cost for each Linear Foot of the Straight Conveyor Belt.',
                    'inv-costPerBend': 'The Capital Cost for each 90-Degree Bend in the Conveyor System.',
                    'inv-installationCost': 'The Fixed Cost to Install the New or Modified Assembly Line.',
                    'inv-salvageValue': 'The Estimated Resale Value of Equipment at the end of Analysis Period.',
                    'inv-std': 'Standard Deviation: The Expected Volatility of Annual Demand around the Expected Value.',
                    'inv-cv': 'Coefficient of Variation: The Ratio of Standard Deviation to the Mean, to Normalize Volatility across Means.',
                    'inv-ciLevel': 'Confidence Interval: The Probability that True Annual Demand falls within the Calculated Range to the Right.',
                    'inv-p10Demand': 'P10 Demand: The Conservative Forecast; there is a 10% Chance of Demand being at least this Low',
                    'inv-p90Demand': 'P90 Demand: The Optimistic Forecast; there is a 10% Chance of Demand being at least this High.'
                };

                const tooltip = createTooltip("inv-tooltip");
                const containerElement = container.node();
                for (const [id, text] of Object.entries(tooltips)) {
                    const labelElement = containerElement.querySelector(`label[for="${id}"]`);
                    if (labelElement) {
                        d3.select(labelElement)
                            .on("mouseover", function (event) {
                                tooltip.transition().duration(200).style("opacity", 1);
                                tooltip.html(`<div class="tooltip-row">${text}</div>`)
                                    .style("left", (event.pageX + 15) + "px")
                                    .style("top", (event.pageY - 28) + "px");
                            })
                            .on("mousemove", function (event) {
                                tooltip.style("left", (event.pageX + 15) + "px")
                                    .style("top", (event.pageY - 28) + "px");
                            })
                            .on("mouseout", function () {
                                tooltip.transition().duration(500).style("opacity", 0);
                            });
                    }
                }
            }, 10);
        } catch (e) { inputArea.html('<p class="error">Could not load input form.</p>'); console.error(e); }

        container.append("div").attr("class", "inv-results-column").html(`<div id="inv-results-placeholder" style="display: none;"></div><div id="inv-results-display"><div class="inv-scorecard-container"></div><div class="inv-chart-container"></div></div>`);

        const summaryCostEl = document.getElementById('summary-cost');
        if (summaryCostEl) {
            const costText = summaryCostEl.textContent;
            const parsedCost = parseFloat(costText.replace(/[$,]/g, '')) || 0;
            if (parsedCost > 0) {
                investmentState.freightExpense = parsedCost;
            }
        }

        Object.keys(investmentState).forEach(key => {
            if (key === 'workingDays' || key === 'currentYear' || key === 'isCalendarInitialized') return; // Skip
            const el = document.getElementById(`inv-${key}`);
            if (el) el.value = investmentState[key];
        });

        const fieldsToFormat = ['inv-mfgOverhead', 'inv-sgaExpenses', 'inv-freightExpense', 'inv-installationCost', 'inv-salvageValue'];
        fieldsToFormat.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                const key = id.replace('inv-', '');
                input.value = formatNumberWithCommas(investmentState[key]);
                input.addEventListener('input', () => {
                    const rawValue = parseFormattedNumber(input.value);
                    if (key in investmentState) investmentState[key] = rawValue;
                    input.value = formatNumberWithCommas(rawValue);
                });
            }
        });

        container.selectAll("input[data-type='currency'], input[type='number'], select").on("change", (event) => {
            const key = event.target.id.replace('inv-', '');

            if (key === 'workingDays') return;

            if (key in investmentState) {
                investmentState[key] = event.target.dataset.type === 'currency' ? parseFormattedNumber(event.target.value) : (event.target.type === 'select-one' ? event.target.value : parseFloat(event.target.value)) || 0;
                if (['std', 'cv', 'p90Demand', 'p10Demand', 'ciLevel'].includes(key)) {
                    updateProbabilisticValues(key.replace('Demand', ''));
                } else {
                    clearTimeout(analysisDebounceTimer);
                    analysisDebounceTimer = setTimeout(runFullAnalysis, 500);
                }
            }
        });

        const controlsArea = inputColumn.append("div").attr("class", "inv-analysis-controls");
        controlsArea.html(`<div class="inv-button-group"><button id="inv-baseCaseBtn">Base Case</button><button id="inv-expansionCaseBtn">Expansion Case</button></div>`);
        controlsArea.select('#inv-baseCaseBtn').on('click', () => { if (investmentState.runExpansionCase) { investmentState.runExpansionCase = false; runFullAnalysis(); controlsArea.select('#inv-baseCaseBtn').classed('active', true); controlsArea.select('#inv-expansionCaseBtn').classed('active', false); } });
        controlsArea.select('#inv-expansionCaseBtn').on('click', () => { if (!investmentState.runExpansionCase) { investmentState.runExpansionCase = true; runFullAnalysis(); controlsArea.select('#inv-baseCaseBtn').classed('active', false); controlsArea.select('#inv-expansionCaseBtn').classed('active', true); } });
        controlsArea.select(investmentState.runExpansionCase ? '#inv-expansionCaseBtn' : '#inv-baseCaseBtn').classed('active', true);


        let investmentTabListenersAttached = false;
        if (!investmentTabListenersAttached) {
            const mainInputs = [dailyDemandInput, opHoursInput, numEmployeesInput, laborCostInput, superSellInput, superCogsInput, ultraSellInput, ultraCogsInput, megaSellInput, megaCogsInput];
            mainInputs.forEach(input => {
                if (input) {
                    input.addEventListener('input', () => {
                        if (document.querySelector('.tab-btn.active')?.dataset.tab === 'investment') {
                            updateProbabilisticValues('mean');
                        }
                    });
                }
            });
            investmentTabListenersAttached = true;
        }

        // Initial run
        setTimeout(() => updateProbabilisticValues('mean'), 0);
    };

})();
