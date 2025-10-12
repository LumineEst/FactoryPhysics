/**
 * --------------------------------------------------------------------
 * Investment Analysis Tab (IIFE)
 * --------------------------------------------------------------------
 * This Immediately Invoked Function Expression (IIFE) encapsulates all the logic,
 * state, and helper functions for the Investment Analysis tab. This prevents
 * polluting the global scope and keeps the related functionality self-contained.
 * It returns a single function, `drawInvestmentPanel`, which is the entry
 * point for rendering the tab's content.
 *
 * This script assumes that global variables and functions from the main
 * script (e.g., `dailyDemandInput`, `calculateMetrics`, `state`, `BUILD_RATIOS`)
 * are available in the execution context.
 */
const drawInvestmentPanel = (function () {
    /**
     * @property {object} investmentState - Holds the persistent state for all
     * user-configurable inputs on the investment panel.
     */
    const investmentState = {
        analysisPeriod: 5,
        marr: 12.0,
        taxRate: 25.0,
        workingDays: 250,
        mfgOverhead: 550000,
        sgaExpenses: 350000,
        costPerFootStraight: 225,
        costPerBend: 450,
        installationCost: 10000,
        salvageValue: 10000,
        macrsClass: '5-year',
        runExpansionCase: false,
        // Probabilistic demand parameters
        std: 6750, // Standard Deviation
        cv: 15.0, // Coefficient of Variance
        ciLevel: 95,  // Confidence Interval Level
        p90Demand: 0, // 90th percentile demand (optimistic)
        p50Demand: 0, // 50th percentile demand (mean/median)
        p10Demand: 0 // 10th percentile demand (conservative)
    };

    /**
     * @const {object} MACRS_RATES - Standard depreciation rates for 5- and 7-year
     * Modified Accelerated Cost Recovery System (MACRS) classes.
     */
    const MACRS_RATES = {
        '5-year': [0.2000, 0.3200, 0.1920, 0.1152, 0.1152, 0.0576],
        '7-year': [0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446]
    };

    /**
     * @const {number} Z_SCORE_P90 - The Z-score corresponding to the 90th percentile
     * of a standard normal distribution, used for P10/P90 calculations.
     */
    const Z_SCORE_P90 = 1.28155;

    /**
     * @const {object} CI_Z_SCORES - Z-scores for common confidence interval levels.
     */
    const CI_Z_SCORES = { 90: 1.645, 95: 1.960, 99: 2.576 };

    // Timer for debouncing analysis runs to avoid excessive recalculations.
    let analysisDebounceTimer;

    /**
     * Formats a number by adding thousands separators.
     * @param {number} num - The number to format.
     * @returns {string} The formatted number string.
     */
    function formatNumberWithCommas(num) { return (num === null || num === undefined) ? '' : num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

    /**
     * Parses a formatted number string back into a float.
     * @param {string} str - The string to parse (e.g., "1,234.56").
     * @returns {number} The parsed number.
     */
    function parseFormattedNumber(str) { return (typeof str !== 'string') ? str : (parseFloat(str.replace(/,/g, '')) || 0); }

    /**
     * Updates the UI elements related to probabilistic demand inputs.
     */
    function updateDemandUI() {
        document.getElementById('inv-std').value = formatNumberWithCommas(Math.round(investmentState.std));
        document.getElementById('inv-cv').value = investmentState.cv.toFixed(1);
        document.getElementById('inv-p90Demand').value = formatNumberWithCommas(Math.round(investmentState.p90Demand));
        document.getElementById('inv-p50Demand').textContent = formatNumberWithCommas(Math.round(investmentState.p50Demand));
        document.getElementById('inv-p10Demand').value = formatNumberWithCommas(Math.round(investmentState.p10Demand));
        // The confidence interval range display is no longer needed.
    }

    /**
     * Recalculates all probabilistic demand values based on which one was
     * changed by the user (the driver). This ensures all related fields stay in sync.
     * @param {string} driver - The input that triggered the update ('std', 'cv', 'p90', 'p10').
     */
    function updateProbabilisticValues(driver) {
        const meanDemand = (parseFloat(dailyDemandInput.value) || 180) * investmentState.workingDays;
        investmentState.p50Demand = meanDemand;
        let std;

        if (driver === 'p90') {
            // Enforce P90 >= P50 before calculation
            if (investmentState.p90Demand < meanDemand) {
                investmentState.p90Demand = meanDemand;
            }
            // Asymmetrically recalculate std/cv based on the user-defined P90
            std = (investmentState.p90Demand - meanDemand) / Z_SCORE_P90;
            investmentState.std = std > 0 ? std : 0;
            investmentState.cv = meanDemand > 0 ? (investmentState.std / meanDemand) * 100 : 0;

        } else if (driver === 'p10') {
            // Enforce P10 <= P50 before calculation
            if (investmentState.p10Demand > meanDemand) {
                investmentState.p10Demand = meanDemand;
            }
            // Asymmetrically recalculate std/cv based on the user-defined P10
            std = (meanDemand - investmentState.p10Demand) / Z_SCORE_P90;
            investmentState.std = std > 0 ? std : 0;
            investmentState.cv = meanDemand > 0 ? (investmentState.std / meanDemand) * 100 : 0;

        } else {
            // Symmetrical cases: std, cv, ciLevel, or mean demand was changed
            if (driver === 'std') {
                std = investmentState.std;
                investmentState.cv = meanDemand > 0 ? (std / meanDemand) * 100 : 0;
            } else {
                std = (investmentState.cv / 100) * meanDemand;
                investmentState.std = std;
            }
            // Symmetrically update P10/P90 to match the confidence interval
            const z = CI_Z_SCORES[investmentState.ciLevel] || 1.960;
            const halfWidth = z * std;
            investmentState.p90Demand = meanDemand + halfWidth;
            investmentState.p10Demand = meanDemand - halfWidth;
        }

        updateDemandUI();
        clearTimeout(analysisDebounceTimer);
        analysisDebounceTimer = setTimeout(runFullAnalysis, 0);
    }

    /**
     * Calculates the Net Present Value (NPV) for a series of cash flows.
     * @param {number[]} cashFlows - Array of cash flows, with the first element being the initial investment.
     * @param {number} rate - The discount rate (e.g., 0.12 for 12%).
     * @returns {number} The calculated NPV.
     */
    function calculateNPV(cashFlows, rate) { return cashFlows.reduce((acc, val, i) => acc + val / Math.pow(1 + rate, i), 0); }

    /**
     * Calculates the Internal Rate of Return (IRR) using the bisection method.
     * @param {number[]} cashFlows - Array of cash flows.
     * @returns {number|NaN} The calculated IRR or NaN if not found.
     */
    function calculateIRR(cashFlows, maxIter = 100, tolerance = 1e-6) {
        if (!cashFlows || cashFlows.length === 0 || cashFlows[0] >= 0) { return NaN; }
        let lowRate = -0.99, highRate = 5000000.0, midRate = 0;
        let npvLow = calculateNPV(cashFlows, lowRate), npvHigh = calculateNPV(cashFlows, highRate);
        let attempts = 0;

        while (npvLow * npvHigh > 0 && attempts < 20) {
            if (Math.abs(npvLow) < Math.abs(npvHigh)) { lowRate -= 2.0; npvLow = calculateNPV(cashFlows, lowRate); }
            else { highRate += 2.0; npvHigh = calculateNPV(cashFlows, highRate); }
            attempts++;
        }

        if (npvLow * npvHigh > 0) { return NaN; }
        for (let i = 0; i < maxIter; i++) {
            midRate = (lowRate + highRate) / 2;
            const npvMid = calculateNPV(cashFlows, midRate);
            if (Math.abs(npvMid) < tolerance) { return midRate; }
            if (npvLow * npvMid < 0) { highRate = midRate; npvHigh = npvMid; }
            else { lowRate = midRate; npvLow = npvMid; }
        }

        return midRate;
    }

    /**
     * Calculates the payback period for an investment.
     * @param {number[]} cashFlows - Array of cash flows.
     * @returns {number} The payback period in years, or Infinity if it never pays back.
     */
    function calculatePaybackPeriod(cashFlows) {
        if (!cashFlows || cashFlows.length < 2 || cashFlows[0] >= 0) return 0;
        const initialInvestment = Math.abs(cashFlows[0]);
        let cumulativeCashFlow = 0;

        for (let t = 1; t < cashFlows.length; t++) {
            const lastCumulative = cumulativeCashFlow;
            cumulativeCashFlow += cashFlows[t];

            if (cumulativeCashFlow >= initialInvestment) {
                const amountNeeded = initialInvestment - lastCumulative;
                return (cashFlows[t] <= 0) ? t : (t - 1) + (amountNeeded / cashFlows[t]);
            }
        }
        return Infinity;
    }

    /**
     * Runs a complete financial analysis for a single demand scenario,
     * calculating cash flows and key investment metrics (NPV, IRR, Payback).
     * @param {number} annualUnitDemand - The total number of units to produce in a year.
     * @returns {object} An object containing the results of the analysis.
     */
    function calculateFinancialScenario(annualUnitDemand) {
        const { analysisPeriod, marr, taxRate, workingDays, macrsClass, runExpansionCase, salvageValue, installationCost } = investmentState;
        const finInputs = {
            laborCost: parseFloat(laborCostInput.value),
            superSell: parseFloat(superSellInput.value),
            superCogs: parseFloat(superCogsInput.value),
            ultraSell: parseFloat(ultraSellInput.value),
            ultraCogs: parseFloat(ultraCogsInput.value),
            megaSell: parseFloat(megaSellInput.value),
            megaCogs: parseFloat(megaCogsInput.value),
        };

        const avgPrice = (finInputs.superSell * BUILD_RATIOS.super) + (finInputs.ultraSell * BUILD_RATIOS.ultra) + (finInputs.megaSell * BUILD_RATIOS.mega);
        let unitsToProduce = 0, configForReport = {}, initialInvestment = 0, equipmentCostForDepreciation = 0;
        const currentEmployees = parseInt(numEmployeesInput.value);
        const baseOpHours = parseFloat(opHoursInput.value);

        // Base Case - Explore Profitability of differing Demand Levels based on Current Line Configuration
        if (!runExpansionCase) {
            const metrics = calculateMetrics({ dailyDemand: 9999, opHours: baseOpHours, numEmployees: currentEmployees }, {});
            const maxAnnualCapacity = metrics.throughputUnitsPerDay * workingDays;
            unitsToProduce = Math.min(annualUnitDemand, maxAnnualCapacity);
            configForReport = { name: `${currentEmployees} Workers, ${baseOpHours} hrs/day`, empCount: currentEmployees, opHours: baseOpHours };
            equipmentCostForDepreciation = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0))) + installationCost;
            initialInvestment = -equipmentCostForDepreciation;
        } else {

            // Expansion Case - Find optimal configurations to yield the highest demand for the Demand Levels
            const optimalConfigResult = findOptimalNPVConfig(annualUnitDemand, finInputs);
            const optimalConfig = {
                name: `${optimalConfigResult.emp} Workers, ${optimalConfigResult.hrs.toFixed(2)} hrs/day`,
                empCount: optimalConfigResult.emp,
                opHours: optimalConfigResult.hrs
            };
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
        const macrsSchedule = MACRS_RATES[macrsClass] || [];

        for (let t = 1; t <= analysisPeriod; t++) {
            const revenue = unitsToProduce * avgPrice;
            const totalMaterialCost = unitsToProduce * ((finInputs.superCogs * BUILD_RATIOS.super) + (finInputs.ultraCogs * BUILD_RATIOS.ultra) + (finInputs.megaCogs * BUILD_RATIOS.mega));
            const laborCost = configForReport.empCount * configForReport.opHours * finInputs.laborCost * workingDays;
            const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0;
            const ebit = revenue - (totalMaterialCost + laborCost + scaledMfgOverhead) - scaledSgaExpenses - taxDepreciation;
            const nopat = ebit - (ebit > 0 ? ebit * (taxRate / 100) : 0);
            cashFlows.push(nopat + taxDepreciation);
        }

        if (equipmentCostForDepreciation > 0 && analysisPeriod > 0) { cashFlows[analysisPeriod] += salvageValue * (1 - (taxRate / 100)); }
        const npv = calculateNPV(cashFlows, marr / 100), irr = calculateIRR(cashFlows), payback = calculatePaybackPeriod(cashFlows);
        return { annualUnitDemand, requiredConfig: configForReport, metrics: { npv, irr, payback, initialInvestment }, cashFlows };
    }

    /**
     * Orchestrates the full three-scenario (P10, P50, P90) analysis and
     * triggers the rendering of the results.
     */
    function runFullAnalysis() {
        const resultsDisplay = d3.select("#inv-results-display").style("display", "block");
        const resultsColumn = d3.select(".inv-results-column");
        resultsColumn.transition().duration(150).style("opacity", 0.5);

        // Delay Analysis by 50ms to ensure needed variables load first
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

    /**
     * Finds the optimal production configuration (employees and hours) that
     * maximizes NPV for a given annual demand. Used in the 'Expansion Case'.
     * @param {number} annualUnitDemand - The target annual production.
     * @param {object} finInputs - Financial parameters.
     * @returns {{emp: number, hrs: number}} The optimal configuration.
     */
    function findOptimalNPVConfig(annualUnitDemand, finInputs) {
        let maxNPV = -Infinity;
        let bestConfig = { emp: 0, hrs: 0 };
        const dailyDemand = Math.ceil(annualUnitDemand / investmentState.workingDays);
        const currentEmployees = parseInt(numEmployeesInput.value);
        const maxDemandMap = new Map(WORKSTATION_CAPACITIES.map(c => [c.ws, c.maxDemand]));

        for (let numEmployees = 3; numEmployees <= 13; numEmployees++) {

            // If Demand is higher than the max capacity of a configuration, bypass that workstation
            if (dailyDemand > (maxDemandMap.get(numEmployees) || 0)) {
                continue;
            }
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
                const metrics = calculateMetrics({ dailyDemand: dailyDemand, opHours, numEmployees }, finInputs);

                if (metrics && metrics.throughputUnitsPerDay >= dailyDemand) {
                    optimalOpHours = opHours;
                    // The lowest operational hours which meet the demand are optimal, no need to check further
                    break;
                }
            }

            if (optimalOpHours === -1) {
                continue;
            }

            const configForAnalysis = { empCount: numEmployees, opHours: optimalOpHours };
            const { analysisPeriod, marr, taxRate, workingDays, macrsClass, salvageValue, installationCost } = investmentState;
            const oldLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0)));
            const newLineCost = (investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH) + (investmentState.costPerBend * ((4 * configForAnalysis.empCount) - (configForAnalysis.empCount % 2 === 0 ? 2 : 0)));
            const adjustment = newLineCost < oldLineCost ? -(salvageValue * ((oldLineCost - newLineCost) / oldLineCost)) : (newLineCost - oldLineCost);
            const equipmentCostForDepreciation = newLineCost < oldLineCost ? 0 : adjustment + installationCost;
            const initialInvestment = -(installationCost + adjustment);
            const cashFlows = [initialInvestment];
            const avgPrice = (finInputs.superSell * BUILD_RATIOS.super) + (finInputs.ultraSell * BUILD_RATIOS.ultra) + (finInputs.megaSell * BUILD_RATIOS.mega);
            const scaledMfgOverhead = investmentState.mfgOverhead * (configForAnalysis.opHours > 15 ? configForAnalysis.opHours / 15 : 1);
            const scaledSgaExpenses = investmentState.sgaExpenses * (configForAnalysis.opHours > 15 ? configForAnalysis.opHours / 15 : 1);
            const macrsSchedule = MACRS_RATES[macrsClass] || [];

            for (let t = 1; t <= analysisPeriod; t++) {
                const revenue = annualUnitDemand * avgPrice;
                const totalMaterialCost = annualUnitDemand * ((finInputs.superCogs * BUILD_RATIOS.super) + (finInputs.ultraCogs * BUILD_RATIOS.ultra) + (finInputs.megaCogs * BUILD_RATIOS.mega));
                const laborCost = configForAnalysis.empCount * configForAnalysis.opHours * finInputs.laborCost * workingDays;
                const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0;
                const ebit = revenue - (totalMaterialCost + laborCost + scaledMfgOverhead) - scaledSgaExpenses - taxDepreciation;
                const nopat = ebit - (ebit > 0 ? ebit * (taxRate / 100) : 0);
                cashFlows.push(nopat + taxDepreciation);
            }

            if (equipmentCostForDepreciation > 0 && analysisPeriod > 0) {
                cashFlows[analysisPeriod] += salvageValue * (1 - (taxRate / 100));
            }

            const currentNPV = calculateNPV(cashFlows, marr / 100);

            // If NPV is higher than current value, then the configuration is the new optimal.
            if (currentNPV > maxNPV) {
                maxNPV = currentNPV;
                bestConfig = { emp: numEmployees, hrs: optimalOpHours };
            }
        }
        return bestConfig;
    }

    /**
     * Renders the scorecards and cumulative cash flow chart using D3.js.
     * @param {object} results - The analysis results for all scenarios.
     */
    function renderInvestmentResults(results) {
        const p50Result = results['P50 (Most Likely)'];
        const isZeroInvestment = p50Result.metrics.initialInvestment >= 0;

        // Top Scorecard Display
        const rootElement = document.documentElement;
        const computedStyle = window.getComputedStyle(rootElement);
        const failureColor = computedStyle.getPropertyValue('--failure-color').trim();

        const displayIRR = isNaN(p50Result.metrics.irr) ? "No Return" : `${(p50Result.metrics.irr * 100).toFixed(1)}%`;
        const displayPayback = isFinite(p50Result.metrics.payback) ? `${Math.ceil(p50Result.metrics.payback * 365.2425)} Days` : "Net Loss";

        // Top Scorecard Display
        const npvValue = p50Result.metrics.npv;
        const irrValue = p50Result.metrics.irr;
        const paybackValue = p50Result.metrics.payback;

        const scorecardData = [
            {
                label: 'Net Present Value (NPV)',
                value: npvValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }),
                isError: npvValue < 0
            },
            {
                label: 'Internal Rate of Return (IRR)',
                value: isNaN(irrValue) ? "No Return" : `${(irrValue * 100).toFixed(1)}%`,
                isError: isNaN(irrValue)
            },
            {
                label: 'Payback Period',
                value: isFinite(paybackValue) ? `${Math.ceil(paybackValue * 365.2425)} Days` : "Net Loss",
                isError: !isFinite(paybackValue)
            }
        ];

        const scorecards = d3.select(".inv-scorecard-container").html("").selectAll(".inv-scorecard")
            .data(scorecardData)
            .join("div")
            .attr("class", "inv-scorecard");

        scorecards.append("div")
            .attr("class", "inv-scorecard-label")
            .text(d => d.label);

        scorecards.append("div")
            .attr("class", "inv-scorecard-value")
            .style("color", d => d.isError ? 'var(--failure-color)' : null)
            .text(d => d.value);

        // SVG Container Space Allocations
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

        // Line Graph Spacing and Axis Scaling
        const chartSvg = chartContainer.append("svg").attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`);
        const chartG = chartSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const cumulativeData = Object.entries(results).map(([name, data]) => ({ name, values: data.cashFlows.map((cf, i) => ({ year: i, value: data.cashFlows.slice(0, i + 1).reduce((a, b) => a + b, 0) })) }));
        const x = d3.scaleLinear().domain([0, investmentState.analysisPeriod]).range([0, width]);
        const y = d3.scaleLinear().domain([d3.min(cumulativeData, d => d3.min(d.values, v => v.value)), d3.max(cumulativeData, d => d3.max(d.values, v => v.value))]).nice().range([height, 0]);
        chartG.append("g").attr("class", "inv-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(investmentState.analysisPeriod).tickFormat(d3.format("d"))).selectAll("text").style("font-size", '14px');
        chartG.append("g").attr("class", "inv-axis").call(d3.axisLeft(y).tickFormat(d3.format("$,.2s"))).selectAll("text").style("font-size", '14px');

        // Line Graph Demand Scenario Funnel Configuration
        const p90Data = cumulativeData.find(d => d.name.includes('P90')).values, p50Data = cumulativeData.find(d => d.name.includes('P50')).values, p10Data = cumulativeData.find(d => d.name.includes('P10')).values;
        chartG.append("path").datum(p90Data).attr("fill", getComputedStyle(root).getPropertyValue('--primary')).attr("class", "inv-area").attr("d", d3.area().x(d => x(d.year)).y0(d => y(p50Data[d.year].value)).y1(d => y(d.value)));
        chartG.append("path").datum(p50Data).attr("fill", getComputedStyle(root).getPropertyValue('--secondary2')).attr("class", "inv-area").attr("d", d3.area().x(d => x(d.year)).y0(d => y(p10Data[d.year].value)).y1(d => y(d.value)));

        // Axis Label Configuration
        const line = d3.line().x(d => x(d.year)).y(d => y(d.value));
        chartG.selectAll(".inv-line").data(cumulativeData).join("path").attr("class", "inv-line").attr("d", d => line(d.values)).style("stroke", d => d3.scaleOrdinal().domain(['P90 (Optimistic)', 'P50 (Most Likely)', 'P10 (Conservative)']).range([getComputedStyle(root).getPropertyValue('--primary'), getComputedStyle(root).getPropertyValue('--secondary1'), getComputedStyle(root).getPropertyValue('--secondary2')])(d.name)).style("stroke-width", d => d.name.includes('P50') ? '6px' : '2px');
        chartSvg.append("text").attr("class", "inv-axis-label").attr("text-anchor", "middle").attr("x", margin.left + width / 2).attr("y", height + margin.top + 40).text("Analysis Period (Years)").style("font-size", "16px").style("font-family", "Arial");
        chartSvg.append("text").attr("class", "inv-axis-label").attr("transform", "rotate(-90)").attr("text-anchor", "middle").attr("y", margin.left / 4).attr("x", -(margin.top + height / 2)).text("Cumulative Free Cash Flow").style("font-size", "16px").style("font-family", "Arial");
        chartG.append("line").attr("class", "inv-break-even").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0));

        // Tooltip Configuration
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
            setTimeout(() => {
                const tooltips = {
                    'inv-analysisPeriod': 'The Number of Years over which the Investment\'s Cash Flows are projected.',
                    'inv-marr': 'The Minimum Acceptable Rate of Return (MARR) for an Investment to be worth it.',
                    'inv-taxRate': 'The Corporate Tax Rate applied to Earnings before Tax.',
                    'inv-workingDays': 'The Number of Production Days in a Year.',
                    'inv-mfgOverhead': 'Annual Fixed Manufacturing Expenses not tied to Production (Rent, Utilties).',
                    'inv-sgaExpenses': 'Annual Fixed Selling, General, and Administrative Expenses (Salaries, Marketing).',
                    'inv-costPerFootStraight': 'The Capital Cost for each Linear Foot of the Straight Conveyor Belt.',
                    'inv-costPerBend': 'The Capital Cost for each 90-Degree Bend in the Conveyor System.',
                    'inv-installationCost': 'The Fixed Cost to Install the New or Modified Assembly Line.',
                    'inv-salvageValue': 'The Estimated Resale Value of Equipment at the end of Analysis Period.',
                    'inv-macrsClass': 'The Depreciation Schedule which determines the Annual Tax Deduction for Equipment.',
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
        Object.keys(investmentState).forEach(key => {
            const el = document.getElementById(`inv-${key}`);
            if (el) el.value = investmentState[key];
        });
        const fieldsToFormat = ['inv-mfgOverhead', 'inv-sgaExpenses', 'inv-installationCost', 'inv-salvageValue'];
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
        setTimeout(() => updateProbabilisticValues('mean'), 0);
    };

})();