const LocationTab = (() => {

    // --- Constants and State ---
    const DEMAND_UNIT_LBS = 410;
    const TRUCK_CAPACITY_UNITS = 60;
    let PPI = 170; // Default PPI, will be updated from input
    const cityData = new Map();
    let optimalFactoryLocation = null;
    let totalDemandCapacity = { p10: 0, p50: 0, p90: 0, workingDays: [] }; // Store array now
    let optimizationMode = 'New';
    let resizeObserver = null;
    let mapInitialized = false;
    let projection = null;
    let path = null;
    let radiusScale = null;
    let selectedCityName = null;

    // --- *** MODIFIED: State for bottom ribbon *** ---
    let holdingChartMode = 'shipments'; // 'inventory' or 'shipments' - DEFAULT TO SHIPMENTS
    let isBottomRibbonOpen = false; // Replaces isHoldingBarOpen

    // --- Simulation/Solver State ---
    let simulationWorker = null; // Worker instance
    let isSimulationRunning = false;
    let simulationResults = null;
    let simulationError = null;
    let simulationPromiseResolve = null;
    let simulationPromiseReject = null;
    let isValidationRun = false;

    // --- Helper and Calculation Functions ---
    const toRadians = (deg) => deg * (Math.PI / 180);
    const greatCircleDistance = (coords1, coords2) => { /* ... unchanged baseline ... */
        if (!coords1 || !coords2) return 0;
        const [lon1, lat1] = coords1.map(toRadians); const [lon2, lat2] = coords2.map(toRadians);
        const R = 3959; const dLat = lat2 - lat1; const dLon = lon2 - lon1;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c;
    };
    const getCircuitryFactor = (distance) => { /* ... unchanged baseline ... */
        if (distance >= 250) return 1.2; return 1.35;
    };
    async function loadCsvBaselineData() { /* ... unchanged baseline ... */
        try { const data = await d3.csv("Data/PPI.csv"); const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; let monthlyData = []; data.forEach(row => { const year = parseInt(row.Year); if (isNaN(year)) return; months.forEach((month, index) => { const value = parseFloat(row[month]); monthlyData.push({ date: new Date(year, index, 1), value: value }); }); }); return monthlyData.sort((a, b) => a.date - b.date); } catch (error) { console.error("Failed to load PPI.csv:", error); return []; }
    }
    const calculateLTLCost = (distance, shipmentWeightTons) => { /* ... unchanged baseline ... */
        const q = shipmentWeightTons; const d = distance; if (q <= 0 || d <= 0) return 0; const numerator = (PPI * q * d) / 5.14; const denominator = (q ** (1 / 7) * d ** (15 / 29)) - 3.5; if (denominator <= 0) return Infinity; return numerator / denominator;
    };
    function calculateHoldingCostBreakdown() { /* ... unchanged baseline ... */
        const marrEl = document.getElementById('inv-marr'); const workingDaysEl = document.getElementById('inv-workingDays'); const taxRateEl = document.getElementById('inv-taxRate'); const marr = marrEl ? parseFloat(marrEl.value) || 12.0 : 12.0; const workingDays = workingDaysEl ? parseFloat(workingDaysEl.value) || 250 : 250; const taxRate = taxRateEl ? parseFloat(taxRateEl.value) || 25.0 : 25.0; const capital = marr; const service = 5.0 + (5.0 * (workingDays / 365.0)) + (10.0 * (taxRate / 100.0)); const cities = Array.from(cityData.values()); let storage = 7.0; let risk = 10.0; if (cities.length > 0 && optimalFactoryLocation) { const distances = cities.map(c => greatCircleDistance(optimalFactoryLocation, c.coordinates)); const minDistance = Math.min(...distances); const storageScale = d3.scaleLinear().domain([50, 500]).range([10.0, 4.0]).clamp(true); storage = storageScale(minDistance); const avgFreq = d3.mean(cities, c => c.freq); if (avgFreq) { const riskScale = d3.scalePow().exponent(2).domain([7, 60]).range([5.0, 15.0]).clamp(true); risk = riskScale(avgFreq); } } const total = capital + service + storage + risk; return { capital, storage, service, risk, total };
    }
    function refreshHoldingCost() { /* ... unchanged baseline ... */
        const breakdown = calculateHoldingCostBreakdown(); const input = d3.select("#loc-holding-cost-input"); if (input.empty()) return; const currentVal = parseFloat(input.property("value")); const estimatedVal = parseFloat(input.attr("data-estimated-total") || 0); if (Math.abs(currentVal - estimatedVal) < 0.1 || !input.attr("data-estimated-total")) { input.property("value", breakdown.total.toFixed(1)); } input.attr("data-estimated-total", breakdown.total.toFixed(1)); input.attr("data-breakdown-capital", breakdown.capital.toFixed(2)); input.attr("data-breakdown-storage", breakdown.storage.toFixed(2)); input.attr("data-breakdown-service", breakdown.service.toFixed(2)); input.attr("data-breakdown-risk", breakdown.risk.toFixed(2));
    }

    // --- *** MODIFIED: UI State Update Functions *** ---
    /**
     * Toggles the collapsible bottom ribbon open or closed.
     */
    function toggleBottomRibbon() {
        isBottomRibbonOpen = !isBottomRibbonOpen;

        // Find the main container and trigger a dynamic update of panel positions
        const svgContainer = d3.select("#svg-container").node();
        if (svgContainer) {
            updateDynamicMapElements();
        }

        if (isBottomRibbonOpen && !simulationResults) {
            runDailyInventorySimulation(); // Run sim if opening for the first time
        } else if (isBottomRibbonOpen) {
            drawHoldingCostChart(); // Just redraw if data is already available
        }
    }

    /**
     * Updates the chart mode state and redraws the chart if it's visible.
     */
    function updateHoldingChartMode() {
        // Update button active state
        d3.select("#sim-inv-btn").classed('active', holdingChartMode === 'inventory');
        d3.select("#sim-ship-btn").classed('active', holdingChartMode === 'shipments');

        // Update header text in ribbon
        d3.select(".bottom-ribbon-header-title").html(
            `Simulation: <strong>${holdingChartMode === 'inventory' ? 'Inventory' : 'Shipments'}</strong>`
        );

        // Redraw chart if it's open
        if (isBottomRibbonOpen) {
            drawHoldingCostChart();
        }
    }

    // --- Factory Location Optimization ---
    const runOptimization = () => { /* ... unchanged baseline ... */
        const cities = Array.from(cityData.values()); const ppiInput = d3.select("#loc-ppi-input").property("value"); PPI = ppiInput ? parseFloat(ppiInput) : 170; if (optimizationMode === 'New') { if (cities.length < 2) { optimalFactoryLocation = null; } else { cities.forEach(c => { const shipmentDetails = getShipmentDetails(null, c, 1); const costPerShipmentPerMile = shipmentDetails ? shipmentDetails.costPerShipment : 0; const shipmentsPerYear = 365.2425 / c.freq; c.monetaryWeight = costPerShipmentPerMile * shipmentsPerYear; }); let sumLon = 0, sumLat = 0, totalMonetaryWeight = 0; cities.forEach(c => { if (c.monetaryWeight && isFinite(c.monetaryWeight)) { sumLon += c.coordinates[0] * c.monetaryWeight; sumLat += c.coordinates[1] * c.monetaryWeight; totalMonetaryWeight += c.monetaryWeight; } }); if (totalMonetaryWeight <= 0) { console.warn("Using geometric center."); sumLon = d3.sum(cities, c => c.coordinates[0]); sumLat = d3.sum(cities, c => c.coordinates[1]); totalMonetaryWeight = cities.length; if (totalMonetaryWeight === 0) { optimalFactoryLocation = null; return; } } let currentLocation = [sumLon / totalMonetaryWeight, sumLat / totalMonetaryWeight]; for (let i = 0; i < 100; i++) { let numLon = 0, numLat = 0, den = 0; cities.forEach(city => { const d = Math.max(0.001, greatCircleDistance(currentLocation, city.coordinates)); if (city.monetaryWeight && isFinite(city.monetaryWeight)) { numLon += (city.coordinates[0] * city.monetaryWeight) / d; numLat += (city.coordinates[1] * city.monetaryWeight) / d; den += city.monetaryWeight / d; } }); if (den <= 0) { console.warn("Opt stopped: Invalid denominator."); break; } const nextLocation = [numLon / den, numLat / den]; if (greatCircleDistance(currentLocation, nextLocation) < 0.1) { currentLocation = nextLocation; break; } currentLocation = nextLocation; } const newMedianLocation = [+currentLocation[0].toFixed(3), +currentLocation[1].toFixed(3)]; let minCost = calculateTotalCost(newMedianLocation, cities); let bestLocation = newMedianLocation; for (const potentialSite of cities) { const currentCost = calculateTotalCost(potentialSite.coordinates, cities); if (currentCost <= minCost) { minCost = currentCost; bestLocation = potentialSite.coordinates; } } optimalFactoryLocation = bestLocation; } } else { if (cities.length < 1) { optimalFactoryLocation = null; } else { let bestLocation = null, minCost = Infinity; for (const potentialSite of cities) { const currentCost = calculateTotalCost(potentialSite.coordinates, cities); if (currentCost < minCost) { minCost = currentCost; bestLocation = potentialSite.coordinates; } } optimalFactoryLocation = bestLocation; } } if (mapInitialized) { updateOptimalFactoryMarker(); updateConnectionLines(); } updateSummaryPanel(); refreshHoldingCost();
    };

    // --- Web Worker Simulation Call ---
    function runDailyInventorySimulation() {
        // --- *** MODIFIED: Check isBottomRibbonOpen *** ---
        if (!simulationWorker) { console.error("Sim worker not init."); simulationError = "Worker failed load."; if (isBottomRibbonOpen) drawHoldingCostChart(); return; }

        // Only run if the ribbon is open
        if (!isBottomRibbonOpen) {
            isSimulationRunning = false;
            return;
        }

        console.log("Posting sim job to worker...");
        isSimulationRunning = true;
        simulationResults = null;
        simulationError = null;

        if (isBottomRibbonOpen) { drawHoldingCostChart(); } // *** MODIFIED ***

        let workingDaysSchedule = [];
        const investmentWorkingDaysEl = document.getElementById('inv-workingDays');
        // ... (rest of function is unchanged)
        if (investmentWorkingDaysEl && investmentWorkingDaysEl.dataset.workingDaysList) { try { workingDaysSchedule = JSON.parse(investmentWorkingDaysEl.dataset.workingDaysList); } catch (e) { console.error("Could not parse WD list", e); } } if (!Array.isArray(workingDaysSchedule) || workingDaysSchedule.length === 0) { console.warn("Using default schedule"); const year = new Date().getFullYear(); const date = new Date(year, 0, 1); while (date.getFullYear() === year) { const dayOfWeek = date.getDay(); if (dayOfWeek > 0 && dayOfWeek < 6) { workingDaysSchedule.push(date.toISOString().split('T')[0]); } date.setDate(date.getDate() + 1); } } const opHoursEl = document.getElementById('opHours'); const numEmployeesEl = document.getElementById('numEmployees'); const laborCostEl = document.getElementById('laborCost'); const holdingCostInput = document.getElementById('loc-holding-cost-input'); const mfgOverheadEl = document.getElementById('inv-mfgOverhead'); const sgaExpensesEl = document.getElementById('inv-sgaExpenses'); const scInput = document.getElementById('superCogs'); const ucInput = document.getElementById('ultraCogs'); const mcInput = document.getElementById('megaCogs'); const standardOpHours = opHoursEl ? parseFloat(opHoursEl.value) || 15.0 : 15.0; const numEmployees = numEmployeesEl ? parseInt(numEmployeesEl.value) || 8 : 8; const laborCost = laborCostEl ? parseFloat(laborCostEl.value) || 25.0 : 25.0; const holdingCostRate = (holdingCostInput ? parseFloat(holdingCostInput.value) || 25.0 : 25.0) / 100; const annualMfgOverhead = mfgOverheadEl ? parseFloat(mfgOverheadEl.value.replace(/,/g, '')) || 250000 : 250000; const annualSgaExpenses = sgaExpensesEl ? parseFloat(sgaExpensesEl.value.replace(/,/g, '')) || 350000 : 350000; const superCogsVal = scInput ? parseFloat(scInput.value) : 375; const ultraCogsVal = ucInput ? parseFloat(ucInput.value) : 590; const mcInputVal = mcInput ? parseFloat(mcInput.value) : 960; const buildRatios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.33, ultra: 0.33, mega: 0.34 }; const capacityMetrics = typeof calculateMetrics === 'function' ? calculateMetrics({ dailyDemand: 9999, opHours: standardOpHours, numEmployees }, {}) : { throughputUnitsPerDay: standardOpHours * 10 }; const standardDailyProduction = Math.floor(capacityMetrics?.throughputUnitsPerDay || 0); const cities = Array.from(cityData.values()); simulationWorker.postMessage({ type: 'start', payload: { cities, workingDaysSchedule, standardOpHours, numEmployees, laborCost, holdingCostRate, annualMfgOverhead, annualSgaExpenses, superCogsVal, ultraCogsVal, mcInputVal, buildRatios, standardDailyProduction } });
    }

    // --- D3 Drawing Functions ---
    async function drawPPITrendChart() { /* ... baseline + positionTooltip call ... */
        const svg = d3.select("#ppi-chart-svg"); svg.selectAll("*").remove(); const margin = { top: 20, right: 30, bottom: 40, left: 50 }; const width = 500 - margin.left - margin.right; const height = 280 - margin.top - margin.bottom; const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const tooltip = d3.select(svg.node()?.parentNode).selectAll(".ppi-tooltip").data([0]).join("div").attr("class", "d3-tooltip ppi-tooltip").style("opacity", 0).style("position", "absolute").style("pointer-events", "none"); const errorText = g.append("text").attr("class", "ppi-loading-text").attr("x", width / 2).attr("y", height / 2).attr("fill", "var(--failure-color)").style("display", "none").text("Loading...");
        try {
            errorText.text("Loading baseline data...").style("display", null); let combinedData = await loadCsvBaselineData(); if (combinedData.length === 0) throw new Error("Failed to load PPI data."); combinedData.sort((a, b) => a.date - b.date); const finalPpiData = combinedData; if (finalPpiData.length === 0) throw new Error("No PPI data available."); errorText.style("display", "none"); const maxDate = d3.max(finalPpiData, d => d.date); const domainMaxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1); const x = d3.scaleTime().domain([d3.min(finalPpiData, d => d.date), domainMaxDate]).range([0, width]); const validValues = finalPpiData.map(d => d.value).filter(v => !isNaN(v)); const yMin = d3.min(validValues) ?? 0; const yMax = d3.max(validValues) ?? 1; const yDomain = (yMin === yMax) ? [yMin * 0.9, yMax * 1.1] : [yMin * 0.95, yMax * 1.05]; if (yDomain[0] === 0 && yDomain[1] === 0) yDomain[1] = 1; const y = d3.scaleLinear().domain(yDomain).range([height, 0]); const bisectDate = d3.bisector(d => d.date).left; const formatDate = d3.timeFormat("%b %Y"); g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(d3.timeYear.every(3)).tickFormat(d3.timeFormat("%Y"))).append("text").attr("class", "axis-label").attr("fill", "var(--accent)").attr("x", width / 2).attr("y", 35).attr("text-anchor", "middle").text("Year"); g.append("g").attr("class", "axis").call(d3.axisLeft(y)).append("text").attr("class", "axis-label").attr("fill", "var(--accent)").attr("transform", "rotate(-90)").attr("y", -40).attr("x", -height / 2).attr("text-anchor", "middle").text("Producer Price Index"); const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).defined(d => !isNaN(d.value) && d.value !== null); g.append("path").datum(finalPpiData.filter(d => !isNaN(d.value) && d.value !== null)).attr("class", "ppi-line").attr("d", line); const focus = g.append("g").attr("class", "ppi-focus").style("display", "none"); focus.append("circle").attr("r", 5).attr("class", "ppi-focus-circle"); g.append("rect").attr("class", "ppi-overlay").attr("width", width).attr("height", height).on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); }).on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); }).on("mousemove", mousemove);
            function mousemove(event) {
                const pointer = d3.pointer(event); if (!pointer || pointer.length < 1) return; const x0 = x.invert(pointer[0]); const i = bisectDate(finalPpiData, x0, 1); const d0 = finalPpiData[i - 1]; const d1 = finalPpiData[i]; if (!d0 || !d1) return; const d = (x0 - d0.date > d1.date - x0) ? d1 : d0; if (!d || isNaN(d.value) || d.value === null) { focus.style("display", "none"); tooltip.style("opacity", 0); return; } else { focus.style("display", null); tooltip.style("opacity", 1); } focus.attr("transform", `translate(${x(d.date)},${y(d.value)})`); tooltip.html(`<strong>${formatDate(d.date)}</strong><div class="tooltip-row"><span>Price Index:</span> <span>${d.value.toFixed(2)}</span></div>`);
                positionTooltip(event, tooltip);
            }
        } catch (error) { console.error("Failed to draw PPI chart:", error); errorText.text(`Error: ${error.message}`).style("display", null); }
    }

    function drawHoldingCostChart() {
        const svg = d3.select("#holding-cost-chart-svg");
        svg.selectAll("*").remove();

        const summaryDiv = d3.select("#ribbon-simulation-metrics");
        summaryDiv.html("");

        const svgNode = svg.node();
        if (!svgNode) return;
        const svgContainer = svgNode.parentNode;
        if (!svgContainer) return;
        const { width: viewBoxWidth, height: viewBoxHeight } = svgContainer.getBoundingClientRect();

        // *** MODIFIED: Use createTooltip to append to body ***
        const tooltip = createTooltip("holding-cost-tooltip"); // Ensures it's appended to body

        if (isSimulationRunning) { summaryDiv.html(`<p class="loading" style="color: var(--accent); font-weight: bold;">Loading simulation...</p>`); return; }
        if (simulationError) { summaryDiv.html(`<p class="error" style="color: var(--failure-color); font-weight: bold;">Sim Failed: ${simulationError}</p>`); return; }

        if (viewBoxWidth <= 0 || viewBoxHeight <= 0) {
            console.warn("Holding chart draw skipped: container not visible or has no dimensions.");
            return;
        }

        const margin = { top: 20, right: 30, bottom: 40, left: 50 };
        const width = viewBoxWidth - margin.left - margin.right;
        const height = viewBoxHeight - margin.top - margin.bottom;

        if (width <= 0 || height <= 0) return;

        svg.attr("viewBox", `0 0 ${viewBoxWidth} ${viewBoxHeight}`);

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        // *** MODIFIED: Integer K Formatter ***
        const formatK = (n) => {
            if (Math.abs(n) >= 1000) {
                // Format to 1 decimal place for k, but remove ".0"
                const numStr = (n / 1000).toFixed(1);
                return numStr.endsWith('.0') ? numStr.slice(0, -2) + 'k' : numStr + 'k';
            }
            return Math.round(n); // Ensure non-k values are integers
        };
        // Integer-only formatter (for tooltips primarily)
        const formatInt = d3.format(",.0f");


        // Handle "No Cities" scenario
        if (!simulationResults) {
            let standardDailyProduction = 0;
            try {
                const opHoursEl = document.getElementById('opHours');
                const numEmployeesEl = document.getElementById('numEmployees');
                const standardOpHours = opHoursEl ? parseFloat(opHoursEl.value) || 15.0 : 15.0;
                const numEmployees = numEmployeesEl ? parseInt(numEmployeesEl.value) || 8 : 8;
                const capacityMetrics = typeof calculateMetrics === 'function' ? calculateMetrics({ dailyDemand: 9999, opHours: standardOpHours, numEmployees }, {}) : { throughputUnitsPerDay: standardOpHours * 10 };
                standardDailyProduction = Math.floor(capacityMetrics?.throughputUnitsPerDay || 0);
            } catch (e) { console.warn("Could not calculate placeholder buffer", e); }

            const buffer = (standardDailyProduction * 7) || 1000;

            if (holdingChartMode === 'inventory') {
                const year = new Date().getFullYear();
                const x = d3.scaleTime().domain([new Date(year, 0, 1), new Date(year, 11, 31)]).range([0, width]);
                const yLeft = d3.scaleLinear().domain([0, buffer * 1.2]).range([height, 0]).nice();
                g.append("g").attr("class", "axis x-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(d3.timeMonth.every(2)).tickFormat(d3.timeFormat("%b")));
                g.append("g").attr("class", "axis y-axis-left")
                    .call(d3.axisLeft(yLeft).tickFormat(formatK)) // Apply K format
                    .append("text").attr("class", "axis-label").attr("fill", "currentColor")
                    .attr("transform", "rotate(-90)")
                    .attr("y", -margin.left + 15)
                    .attr("x", -height / 2)
                    .attr("text-anchor", "middle")
                    .text("Inventory On Hand");
                summaryDiv.html(`<div class="summary-row"><span>Avg. Inventory:</span> <strong>-</strong></div> <div class="summary-row total"><span>Holding Costs:</span> <strong>-</strong></div>`);
            } else {
                const x = d3.scaleBand().domain(d3.range(0, 365)).range([0, width]).padding(0.1);
                const yMaxGuess = (standardDailyProduction * 1.5) || 500;
                const yLeft = d3.scaleLinear().domain([0, yMaxGuess]).range([height, 0]).nice();
                g.append("g").attr("class", "axis x-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickValues(d3.range(0, 365, 30)));
                g.append("g").attr("class", "axis y-axis-left")
                    .call(d3.axisLeft(yLeft).tickFormat(formatK)) // Apply K format
                    .append("text").attr("class", "axis-label").attr("fill", "currentColor")
                    .attr("transform", "rotate(-90)")
                    .attr("y", -margin.left + 15)
                    .attr("x", -height / 2)
                    .attr("text-anchor", "middle")
                    .text("Units Delivered");
                summaryDiv.html("<p>Add a city to run simulation.</p>");
            }
            return;
        }

        // --- (Simulation Results *DO* Exist) ---
        const dailyData = simulationResults;
        const holdingCostRate = (parseFloat(d3.select("#loc-holding-cost-input").property("value")) || 25.0) / 100.0;
        const scInput = document.getElementById('superCogs'); const ucInput = document.getElementById('ultraCogs'); const mcInput = document.getElementById('megaCogs');
        const superCogsVal = scInput ? parseFloat(scInput.value) : 375; const ultraCogsVal = ucInput ? parseFloat(ucInput.value) : 590; const mcInputVal = mcInput ? parseFloat(mcInput.value) : 960;
        const buildRatios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.33, ultra: 0.33, mega: 0.34 };
        const avgCogs = (superCogsVal * buildRatios.super) + (ultraCogsVal * buildRatios.ultra) + (mcInputVal * buildRatios.mega);
        const avgInventory = d3.mean(dailyData, d => d.inventoryEnd) || 0;
        const totalAnnualHoldingCost = d3.sum(dailyData, d => d.holdingCost);
        const totalExceptionCost = d3.sum(dailyData, d => d.exceptionCost);

        // --- Populate Metrics ---
        if (holdingChartMode === 'inventory') {
            summaryDiv.html(` <div class="summary-row"><span>Avg. Inventory:</span> <strong>${formatInt(avgInventory)} units</strong></div> <div class="summary-row total"><span>Holding Costs:</span> <strong>${totalAnnualHoldingCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></div> `);
        } else {
            const totalExceptions = d3.sum(dailyData, d => d.isExceptionDay ? 1 : 0);
            summaryDiv.html(` <div class="summary-row"><span>Total Exceptions:</span> <strong>${totalExceptions.toLocaleString()} days</strong></div> <div class="summary-row total"><span>Total Exception Cost:</span> <strong style="color: var(--failure-color);">${totalExceptionCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></div> `);
        }


        if (holdingChartMode === 'inventory') {
            // --- INVENTORY (DAILY) CHART ---
            const x = d3.scaleTime().domain(d3.extent(dailyData, d => new Date(d.date))).range([0, width]);
            const yMin = d3.min(dailyData, d => d.inventoryEnd) ?? 0;
            const yMax = d3.max(dailyData, d => d.inventoryEnd) ?? 0;
            const yLeft = d3.scaleLinear().domain([Math.min(0, yMin), yMax * 1.1]).range([height, 0]).nice();

            g.append("g").attr("class", "axis x-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(d3.timeMonth.every(2)).tickFormat(d3.timeFormat("%b"))).append("text").attr("class", "axis-label").attr("fill", "currentColor").attr("x", width / 2).attr("y", 35).text("Date");
            g.append("g").attr("class", "axis y-axis-left")
                .call(d3.axisLeft(yLeft).tickFormat(formatK)) // Apply K format
                .append("text").attr("class", "axis-label").attr("fill", "currentColor")
                .attr("transform", "rotate(-90)")
                .attr("y", -margin.left + 15)
                .attr("x", -height / 2)
                .attr("text-anchor", "middle")
                .text("Inventory On Hand");

            const area = d3.area().x(d => x(new Date(d.date))).y0(yLeft(0)).y1(d => yLeft(d.inventoryEnd)).curve(d3.curveStepAfter);
            g.append("path").datum(dailyData).attr("class", "holding-cost-area").attr("d", area);

            const bisectDate = d3.bisector(d => new Date(d.date)).left;
            g.append("rect").attr("class", "overlay").attr("width", width).attr("height", height).style('fill', 'none').style('pointer-events', 'all')
                .on("mouseover", () => tooltip.style("opacity", 1))
                .on("mouseout", () => tooltip.style("opacity", 0))
                .on("mousemove", (event) => {
                    tooltip.style("opacity", 1);
                    const pointer = d3.pointer(event, g.node()); if (!pointer?.[0]) return;
                    const date = x.invert(pointer[0]);
                    const i = bisectDate(dailyData, date, 1);
                    const d0 = dailyData[i - 1];
                    const d1 = dailyData[i];
                    const d = (d1 && (date - new Date(d0.date) > new Date(d1.date) - date)) ? d1 : d0;
                    if (!d) return;
                    // *** MODIFIED: Use formatInt for tooltip ***
                    tooltip.html(`<strong>${d.date} (Day ${d.day})</strong><div class="tooltip-row"><span>Inventory:</span> <span>${formatInt(d.inventoryEnd)}</span></div>`);
                    positionTooltip(event, tooltip);
                });

        } else {
            // --- SHIPMENTS (DAILY STACKED) CHART ---

            const chartData = dailyData.map(d => {
                let selectedQty = 0;
                let unselectedQty = 0;
                (d.shipmentDetails || []).forEach(detail => {
                    if (detail.city === selectedCityName) {
                        selectedQty += detail.qty;
                    } else {
                        unselectedQty += detail.qty;
                    }
                });
                return {
                    ...d,
                    unselected: unselectedQty,
                    selected: selectedQty
                };
            });

            const stackKeys = ["unselected", "selected"];
            const stack = d3.stack().keys(stackKeys);
            const stackedData = stack(chartData);
            const color = d3.scaleOrdinal()
                .domain(stackKeys)
                .range(["var(--primary)", "var(--secondary1)"]);

            const x = d3.scaleBand()
                .domain(dailyData.map(d => d.day))
                .range([0, width])
                .padding(0.1);

            const yMax = d3.max(dailyData, d => d.shipments) ?? 0;
            const yLeft = d3.scaleLinear()
                .domain([0, (yMax || 10) * 1.1])
                .range([height, 0])
                .nice();

            g.append("g").attr("class", "axis x-axis").attr("transform", `translate(0,${height})`)
                .call(d3.axisBottom(x).tickValues(d3.range(0, 365, 30)))
                .append("text").attr("class", "axis-label").attr("fill", "currentColor").attr("x", width / 2).attr("y", 35).text("Day of Year");

            g.append("g").attr("class", "axis y-axis-left")
                .call(d3.axisLeft(yLeft).tickFormat(formatK)) // Apply K format
                .append("text").attr("class", "axis-label").attr("fill", "currentColor")
                .attr("transform", "rotate(-90)")
                .attr("y", -margin.left + 15)
                .attr("x", -height / 2)
                .attr("text-anchor", "middle")
                .text("Units Delivered");

            const layers = g.selectAll("g.layer")
                .data(stackedData)
                .join("g")
                .attr("class", d => d.key);

            layers.selectAll("rect")
                .data(d => d)
                .join("rect")
                .attr("x", d => x(d.data.day))
                .attr("y", d => yLeft(d[1]))
                .attr("height", d => Math.max(0, yLeft(d[0]) - yLeft(d[1])))
                .attr("width", x.bandwidth())
                .attr("fill", function (d) {
                    return (d.data.isExceptionDay || d.data.isReductionDay) ? "var(--failure-color)" : color(d3.select(this.parentNode).datum().key);
                });

            g.append("rect").attr("class", "overlay").attr("width", width).attr("height", height).style('fill', 'none').style('pointer-events', 'all')
                .on("mouseover", () => tooltip.style("opacity", 1))
                .on("mouseout", () => tooltip.style("opacity", 0))
                .on("mousemove", (event) => {
                    tooltip.style("opacity", 1);
                    const pointer = d3.pointer(event, g.node()); if (!pointer?.[0]) return;

                    const xPos = pointer[0];
                    const eachBand = x.step();
                    const index = Math.min(dailyData.length - 1, Math.max(0, Math.floor((xPos + (eachBand / 2)) / eachBand)));
                    const d = dailyData[index];
                    if (!d) return;

                    let detailsHtml = "";
                    if (d.shipmentDetails && d.shipmentDetails.length > 0) {
                        detailsHtml += `<hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-header">Shipments</div>`;
                        d.shipmentDetails.forEach(detail => {
                            const style = (detail.city === selectedCityName) ? "font-weight:bold;color:var(--secondary1);" : "";
                            // *** MODIFIED: Use formatInt for shipment quantities ***
                            detailsHtml += `<div class="tooltip-row" style="${style}"><span>${detail.city}:</span> <span>${formatInt(detail.qty)}</span></div>`;
                        });
                    }

                    if (d.isExceptionDay || d.isReductionDay) {
                        detailsHtml += `<hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-header" style="color: var(--failure-color);">Adjustments</div>`;
                        if (d.exceptionDetails) {
                            const costMatch = d.exceptionDetails.match(/Cost: \$([\d,]+)/);
                            const costText = costMatch ? costMatch[1] : null;
                            const detailText = d.exceptionDetails.replace(/ Cost: \$[\d,]+/, '');

                            detailsHtml += `<div>${detailText}</div>`;
                            if (costText) {
                                detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>\$${costText}</span></div>`;
                            } else if (d.exceptionCost > 0) {
                                detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>${d.exceptionCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</span></div>`;
                            }
                        } else if (d.exceptionCost > 0) {
                            detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>${d.exceptionCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</span></div>`;
                        }
                    }
                    // *** MODIFIED: Use formatInt for total shipped ***
                    tooltip.html(`<strong>${d.date} (Day ${d.day})</strong>
                                  <div class="tooltip-row"><span>Total Shipped:</span> <span>${formatInt(d.shipments)}</span></div>
                                  ${detailsHtml}`);
                    positionTooltip(event, tooltip);
                });
        }
    } // End drawHoldingCostChart

    // --- Tooltip Positioning Helper ---
    function positionTooltip(event, tooltipElement) {
        const tooltipNode = tooltipElement.node(); if (!tooltipNode) return; const pageX = event.pageX; const pageY = event.pageY; const { width: tooltipWidth, height: tooltipHeight } = tooltipNode.getBoundingClientRect(); const xOffset = 15; const yOffset = -15; let left = pageX + xOffset; let top = pageY + yOffset - tooltipHeight; const winWidth = window.innerWidth; const winHeight = window.innerHeight; const scrollX = window.scrollX; const scrollY = window.scrollY; if (left + tooltipWidth > scrollX + winWidth) left = pageX - xOffset - tooltipWidth; if (left < scrollX) left = scrollX + 5; if (top < scrollY) top = pageY + Math.abs(yOffset) + 5; if (top + tooltipHeight > scrollY + winHeight) top = scrollY + winHeight - tooltipHeight - 5; tooltipElement.style("left", `${left}px`).style("top", `${top}px`);
    }

    // --- Map Initialization and Update ---
    const initializeMap = (svg, width, height) => {
        if (mapInitialized) return;
        console.log("Initializing map...");
        projection = d3.geoAlbersUsa().scale(width * 1.1).translate([width / 2, height / 2]);
        path = d3.geoPath().projection(projection);
        const defs = svg.append("defs");
        defs.append("marker").attr("id", "arrowhead").attr("viewBox", "0 -5 10 10").attr("refX", 5).attr("refY", 0).attr("markerWidth", 4).attr("markerHeight", 4).attr("orient", "auto").append("path").attr("d", "M0,-5L10,0L0,5").attr("class", "arrowhead");
        const yShift = height * 0.04;
        const mainMapGroup = svg.append("g").attr("class", "main-map-group").attr("transform", `translate(0, ${yShift})`);

        // --- Map click deselects city *** ---
        mainMapGroup.append("g").attr("class", "us-map").on("click", () => {
            d3.select(".city-info-box").style("display", "none");
            if (selectedCityName !== null) {
                selectedCityName = null;
                updateCityMarkers(); // Redraw markers to remove highlight
                if (isBottomRibbonOpen) drawHoldingCostChart(); // Redraw chart
            }
        });

        mainMapGroup.append("g").attr("class", "connection-lines");
        mainMapGroup.append("g").attr("class", "optimal-factory-container");
        mainMapGroup.append("g").attr("class", "city-markers");
        d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => { const continentalStates = topojson.feature(us, us.objects.states).features.filter(d => d.id !== '02' && d.id !== '15'); mainMapGroup.select(".us-map").selectAll("path").data(continentalStates).enter().append("path").attr("d", path).attr("class", "state-boundary"); mapInitialized = true; updateDynamicMapElements(); runOptimization(); }).catch(error => { console.error("Error loading map topology:", error); mapInitialized = false; });
    };

    // --- *** updateDynamicMapElements to handle new layout *** ---
    const updateDynamicMapElements = () => {
        if (!mapInitialized || !projection) return;
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) return;
        const { width, height } = svgContainer.getBoundingClientRect();
        if (width === 0 || height === 0) return;

        const svg = d3.select("#location-panel");

        // --- *** New Ribbon Position Logic *** ---
        const ribbonHeaderHeight = 30;
        const ribbonContentHeight = 250; // Height of the content area when open
        const ribbonHeight = isBottomRibbonOpen ? ribbonHeaderHeight + ribbonContentHeight : ribbonHeaderHeight;
        const ribbonY = height - ribbonHeight;

        const ribbon = svg.select(".bottom-ribbon-bar");
        ribbon.attr("x", 0)
            .attr("y", ribbonY)
            .attr("width", width)
            .attr("height", ribbonHeight);

        // Update content visibility and header arrow
        ribbon.select(".bottom-ribbon-content")
            .style("display", isBottomRibbonOpen ? "flex" : "none")
            .style("height", `${ribbonContentHeight}px`);

        ribbon.select(".bottom-ribbon-header-arrow")
            .html(isBottomRibbonOpen ? '▼' : '▲'); // Point down to collapse, up to expand


        // --- Map projection update (shift map up slightly) ---
        // We shift the map's translate Y position to account for the header
        const yShift = height * 0.04;
        const mapCenterY = (height - ribbonHeaderHeight) / 2; // Center map in the visible area above the ribbon

        projection.scale(width * 1.1).translate([width / 2, mapCenterY]);
        path.projection(projection);
        radiusScale = d3.scaleSqrt().domain([100, 100000]).range([4, 25]).clamp(true);

        // This group moves the whole map, we just use a small fixed shift
        d3.select(".main-map-group").attr("transform", `translate(0, ${yShift})`);

        // Redraw map elements with new projection
        d3.select(".us-map").selectAll("path").attr("d", path);
        updateCityMarkers();
        updateOptimalFactoryMarker();
        updateConnectionLines();

        // --- *** REMOVED old panel positioning *** ---

        // --- Right-hand panel and modal positions (unchanged) ---
        svg.select(".summary-panel").attr("x", width - 235).attr("y", 5);
        svg.select("#ppi-chart-modal").attr("x", "50%").attr("y", "50%");
    };

    // --- Main Draw Function ---
    const draw = () => {
        const svg = d3.select("#location-panel");
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) { console.error("Container not found."); return; }
        const { width, height } = svgContainer.getBoundingClientRect();
        if (width === 0 || height === 0) return;

        if (!mapInitialized) {
            svg.selectAll("*").remove();
            d3.select("body").selectAll(".d3-tooltip").remove();
            initializeMap(svg, width, height);
        } else {
            updateDynamicMapElements();
        }

        if (!simulationWorker) {
            try {
                simulationWorker = new Worker('simulation.worker.js');
                simulationWorker.onmessage = (e) => {
                    const { type, results, message } = e.data;
                    console.log("Main received:", type);
                    isSimulationRunning = false;
                    if (type === 'complete') {
                        simulationResults = results;
                        simulationError = null;
                    } else if (type === 'error') {
                        simulationResults = null;
                        simulationError = message || "Worker error";
                        console.error("Worker Error:", simulationError);
                    }
                    if (isBottomRibbonOpen) drawHoldingCostChart();
                };
                simulationWorker.onerror = (err) => {
                    console.error("Worker onerror:", err);
                    isSimulationRunning = false;
                    simulationError = `Worker error: ${err.message}.`;
                    if (isBottomRibbonOpen) drawHoldingCostChart();
                };
            } catch (err) {
                console.error("Failed init worker:", err);
                simulationError = "Could not create worker.";
            }
        }
        svg.selectAll("foreignObject").remove(); // This wipes and redraws all UI panels

        // --- Controls (Top Left - Baseline) ---
        const controls = svg.append("foreignObject").attr("x", 15).attr("y", 15).attr("width", 550).attr("height", 100);
        const controlsDiv = controls.append("xhtml:div").attr("class", "location-controls");
        const cityGroup = controlsDiv.append("div").attr("class", "input-group"); cityGroup.append("label").text("City"); const citySelect = cityGroup.append("select").attr("id", "city-select"); if (typeof majorCities !== 'undefined') { Object.keys(majorCities).sort().forEach(city => citySelect.append("option").attr("value", city).text(city)); } else { console.error("majorCities missing."); } const demandGroup = controlsDiv.append("div").attr("class", "input-group"); demandGroup.append("label").text("Ship Qty"); const demandInputGroup = demandGroup.append("div").attr("class", "input-with-unit"); demandInputGroup.append("input").attr("type", "number").attr("id", "shipment-qty").attr("value", "200").attr("min", "1"); demandInputGroup.append("span").attr("class", "unit-label").text("Units"); const freqGroup = controlsDiv.append("div").attr("class", "input-group"); freqGroup.append("label").text("Freq"); const freqInputGroup = freqGroup.append("div").attr("class", "input-with-unit"); freqInputGroup.append("input").attr("type", "number").attr("id", "shipment-freq").attr("value", "7").attr("min", "1"); freqInputGroup.append("span").attr("class", "unit-label").text("Days"); controlsDiv.append("button").attr("class", "loc-control-btn").text("Add City").on("click", addCity);


        // --- City Info Box (Baseline) ---
        const infoBox = svg.append("foreignObject").attr("width", 200).attr("height", 120).attr("class", "city-info-box").style("display", "none");
        const infoDiv = infoBox.append("xhtml:div"); infoDiv.append("h4").attr("id", "info-header"); infoDiv.append("p").attr("id", "info-demand"); infoDiv.append("p").attr("id", "info-annual-cost"); infoDiv.append("button").text("Remove City").attr("id", "info-remove-btn").on("click", function () { const cityToRemove = d3.select(this).attr("data-city-name"); if (cityToRemove && cityData.delete(cityToRemove)) { infoBox.style("display", "none"); updateCityMarkers(); runOptimization(); updateDemandCapacityBox(); refreshHoldingCost(); runDailyInventorySimulation(); } });

        // --- Summary Panel (Top Right - Baseline) ---
        const summaryPanel = svg.append("foreignObject").attr("class", "summary-panel")
            .attr("x", width - 235).attr("y", 5).attr("width", 220).attr("height", 155);
        const summaryDiv = summaryPanel.append("xhtml:div");
        const switchGroup = summaryDiv.append("div").attr("class", "inv-button-group"); switchGroup.append("button").attr("id", "loc-new-btn").text("New").classed('active', optimizationMode === 'New').on('click', () => { if (optimizationMode !== 'New') { optimizationMode = 'New'; d3.select("#loc-new-btn").classed('active', true); d3.select("#loc-existing-btn").classed('active', false); runOptimization(); } }); switchGroup.append("button").attr("id", "loc-existing-btn").text("Existing").classed('active', optimizationMode === 'Existing').on('click', () => { if (optimizationMode !== 'New') { optimizationMode = 'Existing'; d3.select("#loc-new-btn").classed('active', false); d3.select("#loc-existing-btn").classed('active', true); runOptimization(); } }); summaryDiv.append("h4").text("Optimal Summary"); summaryDiv.append("div").attr('class', 'demand-row').html(`<span>Loc:</span><span id="summary-location">N/A</span>`); summaryDiv.append("div").attr('class', 'demand-row').html(`<span>Cost:</span><span id="summary-cost">$0</span>`); summaryDiv.append("div").attr('class', 'demand-row').html(`<span>Ships:</span><span id="summary-shipments">0</span>`); summaryDiv.append("div").attr('class', 'demand-row').html(`<span>Avg Cost/U:</span><span id="summary-avg-cost">$0.00</span>`);

        // --- Modals (PPI Only) ---
        const ppiModal = svg.append("foreignObject").attr("id", "ppi-chart-modal")
            .attr("x", "50%").attr("y", "50%").attr("width", 500).attr("height", 350)
            .style("transform", "translate(-50%, -50%)").style("display", "none");
        const ppiModalDiv = ppiModal.append("xhtml:div").attr("class", "modal-content ppi-modal-content");
        ppiModalDiv.append("button").attr("class", "close-btn").html("&times;").on("click", () => d3.select("#ppi-chart-modal").style("display", "none"));
        ppiModalDiv.append("h4").text("PPI: General Freight Trucking");
        ppiModalDiv.append("svg").attr("id", "ppi-chart-svg").attr("viewBox", `0 0 500 280`).attr("preserveAspectRatio", "xMidYMid meet");

        // --- NEW: Collapsible Bottom Ribbon ---
        const ribbon = svg.append("foreignObject")
            .attr("class", "bottom-ribbon-bar")
            .attr("x", 0).attr("y", height - 30) // Start collapsed
            .attr("width", width)
            .attr("height", 30) // Start collapsed
            .style("overflow", "hidden");

        const ribbonDiv = ribbon.append("xhtml:div").attr("class", "bottom-ribbon-container");

        // --- Ribbon Header ---
        const ribbonHeader = ribbonDiv.append("div")
            .attr("class", "bottom-ribbon-header")
            .on("click", toggleBottomRibbon); // Click handler

        ribbonHeader.append("div").attr("class", "bottom-ribbon-header-title")
            .html(`Simulation: <strong>${holdingChartMode === 'inventory' ? 'Inventory' : 'Shipments'}</strong>`);

        ribbonHeader.append("div").attr("class", "bottom-ribbon-header-arrow")
            .html('▲'); // Start collapsed (arrow up)

        // --- Ribbon Content ---
        const ribbonContent = ribbonDiv.append("div")
            .attr("class", "bottom-ribbon-content")
            .style("display", "none"); // Start hidden

        // --- Content: 1. Cost Inputs (Left) ---
        const costInputDiv = ribbonContent.append("div")
            .attr("class", "ribbon-cost-inputs");

        costInputDiv.append("h4").text("Cost Inputs");

        // --- *** MODIFIED: Reordered Inputs *** ---

        // 1. Holding Cost
        const holdingGroup = costInputDiv.append("div").attr("class", "user-input-row");
        const holdingLabel = holdingGroup.append("label").attr("for", "loc-holding-cost-input").text("Hold Cost (%)");
        holdingGroup.append("input").attr("type", "number").attr("id", "loc-holding-cost-input").attr("value", 25).attr("step", "0.1").on("change", () => { runOptimization(); runDailyInventorySimulation(); }).on("input", function () { d3.select(this).attr("data-user-modified", "true"); });
        const breakdownTooltip = createTooltip('holding-cost-breakdown-tooltip');
        holdingLabel.on("mouseover mousemove", (event) => {
            const input = d3.select("#loc-holding-cost-input"); const breakdown = { c: input.attr("data-breakdown-capital") || 0, s: input.attr("data-breakdown-storage") || 0, v: input.attr("data-breakdown-service") || 0, r: input.attr("data-breakdown-risk") || 0, t: input.attr("data-estimated-total") || 0 }; breakdownTooltip.style("opacity", 1).html(`Est. Breakdown:<br>Cap: ${breakdown.c}% Sto: ${breakdown.s}%<br>Svc: ${breakdown.v}% Rsk: ${breakdown.r}%<hr>Total: ${breakdown.t}%`);
            positionTooltip(event, breakdownTooltip);
        }).on("mouseout", () => breakdownTooltip.style("opacity", 0));

        // 2. PPI
        const ppiGroup = costInputDiv.append("div").attr("class", "user-input-row");
        ppiGroup.append("label").attr("for", "loc-ppi-input").text("PPI");
        ppiGroup.append("input").attr("type", "number").attr("id", "loc-ppi-input").attr("value", PPI).attr("step", "0.1").on("change", function () { PPI = +this.value; runOptimization(); });

        // 3. PPI Button
        const buttonGroup = costInputDiv.append("div").attr("class", "user-input-buttons");
        buttonGroup.append("button").attr("class", "loc-control-btn").attr("id", "show-ppi-chart-btn")
            .text("What is my PPI?").on("click", () => { d3.select("#ppi-chart-modal").style("display", "block"); drawPPITrendChart(); });

        // 4. Chart Toggle Switch
        const simSwitchGroup = costInputDiv.append("div").attr("class", "inv-button-group sim-chart-switch");
        simSwitchGroup.append("button").attr("id", "sim-inv-btn")
            .text("Inventory")
            .classed('active', holdingChartMode === 'inventory')
            .on('click', () => {
                holdingChartMode = 'inventory';
                updateHoldingChartMode();
            });
        simSwitchGroup.append("button").attr("id", "sim-ship-btn")
            .text("Shipments")
            .classed('active', holdingChartMode === 'shipments')
            .on('click', () => {
                holdingChartMode = 'shipments';
                updateHoldingChartMode();
            });

        // --- Content: 2. Chart (Middle) ---
        const chartAreaDiv = ribbonContent.append("div")
            .attr("class", "ribbon-chart-area");
        // --- *** MODIFIED: Removed summary div from here *** ---
        // chartAreaDiv.append("div").attr("id", "holding-cost-summary");
        chartAreaDiv.append("div").attr("id", "holding-cost-svg-container")
            .append("svg").attr("id", "holding-cost-chart-svg");

        // --- Content: 3. Demand (Right) ---
        const demandDiv = ribbonContent.append("div")
            .attr("class", "ribbon-demand-panel");

        // --- *** MODIFIED: Added new metrics div here *** ---
        demandDiv.append("div").attr("id", "ribbon-simulation-metrics");

        demandDiv.append("h4").text("Annual Demand");
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P10:</span><span id="demand-p10">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P50:</span><span id="demand-p50">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P90:</span><span id="demand-p90">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>Alloc:</span><span id="demand-allocated">0</span>`);
        demandDiv.append("div").attr("class", "demand-bar-container").append("div").attr("class", "demand-bar").attr("id", "demand-bar-fill").text("0%");

        // --- Add City Function (Baseline) ---
        function addCity() {
            const name = d3.select("#city-select").property("value"); const qty = parseFloat(d3.select("#shipment-qty").property("value")); const freq = parseFloat(d3.select("#shipment-freq").property("value")); if (name && qty > 0 && freq > 0) { if (typeof majorCities === 'undefined' || !majorCities[name]) { console.error(`Coords for "${name}" not found.`); alert(`Error: Data missing for city "${name}".`); return; } const annualDemand = (qty / freq) * totalDemandCapacity.workingDays.length; cityData.set(name, { name, coordinates: majorCities[name], annualDemand, qty, freq }); updateCityMarkers(); runOptimization(); updateDemandCapacityBox(); refreshHoldingCost(); runDailyInventorySimulation(); } else { console.warn("Invalid city/qty/freq."); }
        }

        // --- Initial Updates (Baseline) ---
        fetchDemandData();
        refreshHoldingCost();
        updateDemandCapacityBox();
        updateSummaryPanel();

        updateDynamicMapElements();

        if (mapInitialized) {
            runOptimization();
        }
    }; // End draw function


    // --- Other Helper Functions ---
    function fetchDemandData() {
        const p50Display = document.getElementById('inv-p50Demand'); const p10Input = document.getElementById('inv-p10Demand'); const p90Input = document.getElementById('inv-p90Demand'); const workingDaysInput = document.getElementById('inv-workingDays'); let p10 = 0, p50 = 0, p90 = 0, workingDaysList = [], workingDaysCount = 250; if (p50Display && p10Input && p90Input && workingDaysInput) { p10 = parseFloat(p10Input.value.replace(/,/g, '')) || 0; p50 = parseFloat(p50Display.textContent.replace(/,/g, '')) || 0; p90 = parseFloat(p90Input.value.replace(/,/g, '')) || 0; workingDaysCount = parseFloat(workingDaysInput.value || 250); try { workingDaysList = JSON.parse(workingDaysInput.dataset.workingDaysList || '[]'); } catch (e) { workingDaysList = []; console.error("Error parsing WD list:", e); } } else { console.warn("Using estimated demand."); const daily = parseFloat(document.getElementById('dailyDemand')?.value || 180); workingDaysCount = 250; const std = 6750; p50 = daily * workingDaysCount; const halfWidth = 1.28155 * std; p90 = p50 + halfWidth; p10 = Math.max(0, p50 - halfWidth); const year = new Date().getFullYear(); const date = new Date(year, 0, 1); while (date.getFullYear() === year) { const day = date.getDay(); if (day > 0 && day < 6) workingDaysList.push(date.toISOString().split('T')[0]); date.setDate(date.getDate() + 1); } } totalDemandCapacity = { p10, p50, p90, workingDays: workingDaysList }; updateDemandCapacityBox();
    }
    function updateDemandCapacityBox() {
        if (!totalDemandCapacity) return; const allocated = Array.from(cityData.values()).reduce((sum, city) => sum + city.annualDemand, 0); const formatNumber = (num) => isFinite(num) ? Math.round(num).toLocaleString() : 'N/A'; const isOver = (val) => isFinite(val) && val > 0 && allocated > val; d3.select("#demand-p10").text(formatNumber(totalDemandCapacity.p10)).style("font-weight", isOver(totalDemandCapacity.p10) ? "bold" : null).style("color", isOver(totalDemandCapacity.p10) ? "var(--failure-color)" : null); d3.select("#demand-p50").text(formatNumber(totalDemandCapacity.p50)).style("font-weight", isOver(totalDemandCapacity.p50) ? "bold" : null).style("color", isOver(totalDemandCapacity.p50) ? "var(--failure-color)" : null); d3.select("#demand-p90").text(formatNumber(totalDemandCapacity.p90)).style("font-weight", isOver(totalDemandCapacity.p90) ? "bold" : null).style("color", isOver(totalDemandCapacity.p90) ? "var(--failure-color)" : null); d3.select("#demand-allocated").text(formatNumber(allocated)); const percent = (totalDemandCapacity.p50 > 0 && isFinite(totalDemandCapacity.p50)) ? Math.max(0, (allocated / totalDemandCapacity.p50) * 100) : 0; const bar = d3.select("#demand-bar-fill"); bar.style("width", `${Math.min(percent, 100)}%`).text(`${Math.round(percent)}%`); bar.style("background-color", percent > 100 ? "var(--failure-color)" : "var(--primary)");
    }
    function updateSummaryPanel() {
        let totalCost = 0; let totalShipments = 0; let totalAllocatedDemand = 0; const cities = Array.from(cityData.values()); let locationText = "N/A"; if (optimalFactoryLocation && cities.length > 0) { totalCost = calculateTotalCost(optimalFactoryLocation, cities); totalShipments = cities.reduce((sum, city) => { const shipmentsPerYear = 365.2425 / Math.max(1, city.freq); const details = getShipmentDetails(optimalFactoryLocation, city); const trucksPerShipment = details ? details.numFTL + (details.remainderChoice === 'FTL' ? 1 : (details.remainderChoice === 'LTL' ? 1 : 0)) : 0; return sum + (shipmentsPerYear * trucksPerShipment); }, 0); totalAllocatedDemand = cities.reduce((sum, city) => sum + city.annualDemand, 0); const lat = optimalFactoryLocation[1].toFixed(3); const lon = optimalFactoryLocation[0].toFixed(3); const closestCity = cities.find(c => c.coordinates && optimalFactoryLocation && c.coordinates[0] === optimalFactoryLocation[0] && c.coordinates[1] === optimalFactoryLocation[1]); locationText = closestCity ? closestCity.name : `${lat}°N, ${Math.abs(lon)}°W`; } const avgCostPerUnit = totalAllocatedDemand > 0 ? totalCost / totalAllocatedDemand : 0; const formatCurrency = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); const formatCurrencySmall = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); d3.select("#summary-cost").text(formatCurrency(totalCost)); d3.select("#summary-shipments").text(Math.round(totalShipments).toLocaleString()); d3.select("#summary-avg-cost").text(formatCurrencySmall(avgCostPerUnit)); d3.select("#summary-location").text(locationText);
    }

    // --- Tooltip Creation Helper (Appends to body) ---
    function createTooltip(className) {
        let tooltip = d3.select(`body > .d3-tooltip.${className}`); // Selects tooltip directly from body
        if (tooltip.empty()) {
            tooltip = d3.select('body').append('div') // Appends a new div to the body
                .attr('class', `d3-tooltip ${className}`)
                .style('opacity', 0)
                .style('position', 'absolute')
                .style('pointer-events', 'none')
                // Default styles (might be overridden by specific CSS)
                .style('background', 'rgba(0,0,0,0.8)')
                .style('color', '#fff')
                .style('padding', '5px')
                .style('border-radius', '3px');
        }
        return tooltip; // Returns the d3 selection of the tooltip div
    }

    // --- Tooltip Positioning Helper ---
    function positionTooltip(event, tooltipElement) {
        const tooltipNode = tooltipElement.node();
        if (!tooltipNode) return; // Exit if the tooltip element doesn't exist

        const pageX = event.pageX; // Mouse position relative to the document
        const pageY = event.pageY;

        // Get tooltip dimensions *after* content might have changed its size
        const { width: tooltipWidth, height: tooltipHeight } = tooltipNode.getBoundingClientRect();

        const xOffset = 15; // Aim slightly right of the cursor
        const yOffset = -15; // Aim slightly above the cursor

        // Initial position calculation (above and to the right)
        let left = pageX + xOffset;
        let top = pageY + yOffset - tooltipHeight; // Adjust top based on tooltip height

        // Window boundaries and scroll position
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        // Adjust horizontal position if tooltip goes off-screen right
        if (left + tooltipWidth > scrollX + winWidth) {
            left = pageX - xOffset - tooltipWidth; // Flip to the left of the cursor
        }
        // Clamp horizontal position if tooltip goes off-screen left
        if (left < scrollX) {
            left = scrollX + 5; // Add a small margin from the edge
        }

        // Adjust vertical position if tooltip goes off-screen top
        if (top < scrollY) {
            top = pageY + Math.abs(yOffset) + 5; // Flip below the cursor
        }
        // Clamp vertical position if tooltip goes off-screen bottom
        if (top + tooltipHeight > scrollY + winHeight) {
            top = scrollY + winHeight - tooltipHeight - 5; // Add a small margin from the edge
        }

        // Apply the calculated position
        tooltipElement.style("left", `${left}px`).style("top", `${top}px`);
    }

    function updateOptimalFactoryMarker() {
        if (!projection || !mapInitialized) return; const container = d3.select(".optimal-factory-container"); const tooltip = createTooltip('factory-tooltip'); const data = optimalFactoryLocation ? [optimalFactoryLocation] : []; const marker = container.selectAll(".optimal-factory-marker").data(data); marker.exit().transition().duration(300).style("opacity", 0).remove(); marker.enter().append("path").attr("class", "optimal-factory-marker").attr("d", d3.symbol(d3.symbolStar, 400)).style("opacity", 0).merge(marker).on("mouseover", (event, d) => { const lat = d[1].toFixed(3); const lon = d[0].toFixed(3); tooltip.style("opacity", 1).html(`Optimal Location:<br>${lat}°N, ${Math.abs(lon)}°W`); })
            .on("mousemove", (event) => positionTooltip(event, tooltip))
            .on("mouseout", () => tooltip.style("opacity", 0)).transition().duration(500).attr("transform", d => `translate(${projection(d)})`).style("opacity", 1);
    }
    function updateCityMarkers() { /* ... uses positionTooltip ... */
        if (!projection || !mapInitialized || !radiusScale) return;
        const tooltip = createTooltip('city-calc-tooltip');
        const infoBox = d3.select(".city-info-box");
        const markers = d3.select(".city-markers").selectAll(".city-marker").data(Array.from(cityData.values()), d => d.name);

        markers.exit().transition().duration(300).attr("r", 0).remove();

        markers.enter().append("circle").attr("class", "city-marker").attr("r", 0).attr("transform", d => `translate(${projection(d.coordinates)})`).merge(markers)
            .on("mouseover", (event, d) => {
                // ... (existing mouseover logic unchanged) ...
                const details = getShipmentDetails(optimalFactoryLocation, d); const costFormat = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }; if (!details || !optimalFactoryLocation) { tooltip.style("opacity", 1).html(`<strong>${d.name}</strong><br>Calculating...`); positionTooltip(event, tooltip); return; } const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d); const avgCostPerUnit = d.annualDemand > 0 ? (annualCost / d.annualDemand) : 0; let shipmentDetailsHtml; if (details.remainderChoice === 'Local') shipmentDetailsHtml = `<div class="tooltip-row"><span>Shipment:</span> <span>Local (No Cost)</span></div>`; else if (details.remainderChoice === 'LTL') shipmentDetailsHtml = `<div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${details.numFTL}</span></div><div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${details.costFTL.toLocaleString('en-US', costFormat)}</span></div><hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-row"><span>LTL Weight/Ship:</span> <span>${details.remainderTons.toFixed(2)} tons</span></div><div class="tooltip-row"><span>LTL Cost/Ship:</span> <span>${details.costRemainder.toLocaleString('en-US', costFormat)}</span></div>`; else { const totalFTL = details.numFTL + (details.remainderChoice === 'FTL' ? 1 : 0); const totalFTLCost = details.costFTL + (details.remainderChoice === 'FTL' ? details.costRemainder : 0); shipmentDetailsHtml = `<div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${totalFTL}</span></div><div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${totalFTLCost.toLocaleString('en-US', costFormat)}</span></div>`; if (details.remainderUnits > 0 && details.remainderChoice !== 'FTL' && details.remainderChoice !== 'LTL' && details.remainderChoice !== 'Local') shipmentDetailsHtml += `<div class="tooltip-row" style="color: yellow;"><span>Warning:</span> <span>Remainder (${details.remainderUnits}u) cost error? Choice: ${details.remainderChoice}</span></div>`; } tooltip.style("opacity", 1).html(`<div class="tooltip-header">${d.name} Details</div><div class="tooltip-row"><span>Est. Road Dist:</span> <span>${details.roadDistance.toFixed(0)} mi</span></div><hr style='margin: 2px 0; border-top-color: #555;'>${shipmentDetailsHtml}<hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-row"><span>Annual Qty:</span> <span>${Math.round(d.annualDemand).toLocaleString()}</span></div><div class="tooltip-row"><span>Annual Cost:</span> <span>${annualCost.toLocaleString('en-US', costFormat)}</span></div><div class="tooltip-row"><span>Avg Cost/Unit:</span> <span>${avgCostPerUnit.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span></div>`);
            })
            .on("mousemove", (event) => positionTooltip(event, tooltip))
            .on("mouseout", () => tooltip.style("opacity", 0))
            .on("click", (event, d) => {
                event.stopPropagation();

                // --- *** MODIFIED: Toggle selection and redraw *** ---
                if (selectedCityName === d.name) {
                    selectedCityName = null; // Deselect
                } else {
                    selectedCityName = d.name; // Select
                }
                updateCityMarkers(); // Redraws all markers with new selection state
                if (isBottomRibbonOpen) drawHoldingCostChart(); // Redraw chart

                // --- (rest of infobox logic is unchanged) ---
                if (!projection) return;
                const projectedCoords = projection(d.coordinates); if (!projectedCoords) return;
                const [x, y] = projectedCoords; const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d);
                infoBox.select("#info-header").text(d.name); infoBox.select("#info-demand").text(`Demand: ${d.qty} u / ${d.freq} days`); infoBox.select("#info-annual-cost").text(`Annual Cost: ${annualCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`); infoBox.select("#info-remove-btn").attr("data-city-name", d.name); const svgContainer = d3.select("#svg-container").node(); const svgRect = svgContainer.getBoundingClientRect(); const yShift = d3.select(".main-map-group").attr("transform").match(/translate\([\d\.]+, ([\d\.]+)\)/); const mapYShift = yShift ? parseFloat(yShift[1]) : 0; let infoX = x + 15; let infoY = y + mapYShift - 15; const infoBoxWidth = 200; const infoBoxHeight = 120; if (infoX + infoBoxWidth > svgRect.width) infoX = x - infoBoxWidth - 15; if (infoY < 0) infoY = y + mapYShift + 15; const ribbonHeight = isBottomRibbonOpen ? 280 : 30; if (infoY + infoBoxHeight > svgRect.height - ribbonHeight) { infoY = y + mapYShift - infoBoxHeight - 15; }
                infoBox.attr("x", infoX).attr("y", infoY).style("display", "block");
            })
            // --- Style fill based on selection *** ---
            .style("fill", d => (d.name === selectedCityName) ? "var(--secondary1)" : "var(--secondary2)")
            .transition().duration(500)
            .attr("r", d => radiusScale(d.annualDemand))
            .attr("transform", d => `translate(${projection(d.coordinates)})`);
    }

    function updateConnectionLines() { /* ... unchanged baseline ... */
        if (!projection || !radiusScale || !mapInitialized) return; const lineGroup = d3.select(".connection-lines"); const cities = Array.from(cityData.values()); if (!optimalFactoryLocation || cities.length < 1) { lineGroup.selectAll(".connection-group").interrupt().remove(); return; } const costs = cities.map(city => calculateTotalCostForCity(optimalFactoryLocation, city)); const maxCost = d3.max(costs); const widthScale = d3.scaleLinear().domain([0, maxCost || 1]).range([1, 8]).clamp(true); const dashScale = d3.scaleLinear().domain([1, TRUCK_CAPACITY_UNITS * 3]).range([5, 30]).clamp(true); const gapScale = d3.scaleLinear().domain([1, 30]).range([15, 100]).clamp(true); const groups = lineGroup.selectAll(".connection-group").data(cities, d => d.name); groups.exit().selectAll(".connection-line").interrupt(); groups.exit().remove(); const enterGroups = groups.enter().append("g").attr("class", "connection-group"); enterGroups.append("line").attr("class", "connection-line-bg"); enterGroups.append("line").attr("class", "connection-line"); enterGroups.merge(groups).each(function (d) { const group = d3.select(this); const startPoint = projection(optimalFactoryLocation); const endPoint = projection(d.coordinates); if (!startPoint || !endPoint) { group.selectAll('line').style('display', 'none'); return; } const radius = radiusScale(d.annualDemand) + 3; const dx = endPoint[0] - startPoint[0]; const dy = endPoint[1] - startPoint[1]; const lineLength = Math.sqrt(dx * dx + dy * dy); if (lineLength < radius) { group.selectAll('line').style('display', 'none'); group.select(".connection-line").interrupt(); return; } else { group.selectAll('line').style('display', null); } const newEndPointX = endPoint[0] - (dx / lineLength) * radius; const newEndPointY = endPoint[1] - (dy / lineLength) * radius; const strokeWidth = widthScale(calculateTotalCostForCity(optimalFactoryLocation, d)); group.select(".connection-line-bg").attr("x1", startPoint[0]).attr("y1", startPoint[1]).attr("x2", newEndPointX).attr("y2", newEndPointY).attr("marker-end", "url(#arrowhead)").style("stroke-width", strokeWidth); const animLine = group.select(".connection-line").attr("x1", startPoint[0]).attr("y1", startPoint[1]).attr("x2", newEndPointX).attr("y2", newEndPointY).style("stroke-width", strokeWidth).style("stroke", "var(--secondary1)").attr("stroke-dasharray", `${dashScale(d.qty)} ${gapScale(d.freq)}`).attr("marker-end", "url(#arrowhead)"); animLine.interrupt(); function repeatAnimation() { if (!animLine.node()?.isConnected) return; const totalLength = dashScale(d.qty) + gapScale(d.freq); animLine.attr("stroke-dashoffset", totalLength).transition().ease(d3.easeLinear).duration(Math.max(1, d.freq) * 100).attr("stroke-dashoffset", 0).on("end", repeatAnimation); } repeatAnimation(); });
    }
    function getShipmentDetails(factoryCoords, city, overrideDistance = null) { /* ... unchanged baseline ... */
        if (!city?.coordinates || (!factoryCoords && !overrideDistance)) return null; const distance = overrideDistance ?? greatCircleDistance(factoryCoords, city.coordinates); if (distance <= 0.1 && !overrideDistance) return { distance, roadDistance: 0, numFTL: 0, costFTL: 0, remainderUnits: city.qty, remainderTons: 0, costRemainder: 0, remainderChoice: 'Local', costPerShipment: 0 }; const roadDistance = distance * getCircuitryFactor(distance); const numFTL = Math.floor(city.qty / TRUCK_CAPACITY_UNITS); const remainderUnits = city.qty % TRUCK_CAPACITY_UNITS; const remainderTons = (remainderUnits * DEMAND_UNIT_LBS) / 2000; const costFTL = (numFTL * PPI * roadDistance) / 51.35; let costRemainder = 0, remainderChoice = "N/A"; if (remainderTons > 0) { const ltlCost = calculateLTLCost(roadDistance, remainderTons); const ftlCostForRemainder = (PPI * roadDistance) / 51.35; const validLtlCost = isFinite(ltlCost) ? ltlCost : Infinity; const validFtlCost = isFinite(ftlCostForRemainder) ? ftlCostForRemainder : Infinity; costRemainder = Math.min(validLtlCost, validFtlCost); if (!isFinite(costRemainder)) { costRemainder = 0; remainderChoice = "Error"; } else { remainderChoice = validLtlCost <= validFtlCost ? "LTL" : "FTL"; } } else { remainderChoice = "None"; } return { distance, roadDistance, numFTL, costFTL, remainderUnits, remainderTons, costRemainder, remainderChoice, costPerShipment: costFTL + costRemainder };
    }
    function calculateTotalCostForCity(factoryCoords, city) { /* ... unchanged baseline ... */
        if (!factoryCoords || !city?.coordinates) return 0; if (factoryCoords[0] === city.coordinates[0] && factoryCoords[1] === city.coordinates[1]) return 0; const details = getShipmentDetails(factoryCoords, city); if (!details || !isFinite(details.costPerShipment)) return 0; const shipmentsPerYear = 365.2425 / Math.max(1, city.freq); return details.costPerShipment * shipmentsPerYear;
    }
    function calculateTotalCost(factoryCoords, cities) { /* ... unchanged baseline ... */ return cities.reduce((total, city) => total + calculateTotalCostForCity(factoryCoords, city), 0); }

    // --- Setup Listeners (Baseline) ---
    const setupListeners = () => {
        const idsToWatch = ['inv-p10Demand', 'inv-p90Demand', 'dailyDemand', 'inv-workingDays', 'inv-marr', 'inv-taxRate'];
        idsToWatch.forEach(id => { const input = document.getElementById(id); if (input) { input.addEventListener('change', () => { if (document.querySelector('.tab-btn.active')?.dataset.tab === 'location') { const isDemandDriver = ['inv-p10Demand', 'inv-p90Demand', 'dailyDemand', 'inv-workingDays'].includes(id); const isCostDriver = ['inv-workingDays', 'inv-marr', 'inv-taxRate'].includes(id); if (isDemandDriver) { fetchDemandData(); } if (isCostDriver) { refreshHoldingCost(); } if (isDemandDriver || isCostDriver) { runDailyInventorySimulation(); } } }); } else { console.warn(`Listener setup: ID '${id}' not found.`); } });
        if (resizeObserver) resizeObserver.disconnect(); const svgContainerNode = d3.select("#svg-container").node(); if (svgContainerNode) { resizeObserver = new ResizeObserver(entries => { requestAnimationFrame(() => { for (let entry of entries) { if (entry.target === svgContainerNode && document.querySelector('.tab-btn.active')?.dataset.tab === 'location' && mapInitialized) { updateDynamicMapElements(); } } }); }); resizeObserver.observe(svgContainerNode); } else { console.error("Could not find #svg-container for resize."); } window.addEventListener('beforeunload', () => { if (resizeObserver) resizeObserver.disconnect(); if (simulationWorker) simulationWorker.terminate(); });
    };
    setTimeout(setupListeners, 2000);

    // --- Public Interface ---
    return { draw: draw };

})(); // End LocationTab IIFE
