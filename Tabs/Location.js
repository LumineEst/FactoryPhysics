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

    function toggleBottomRibbon() {
        isBottomRibbonOpen = !isBottomRibbonOpen;
        console.log(`Toggling ribbon. New state: ${isBottomRibbonOpen ? 'Open' : 'Closed'}`);

        const svgContainer = d3.select("#svg-container").node();
        if (svgContainer) {
            const { height: currentHeight } = svgContainer.getBoundingClientRect();
            const ribbonHeaderHeight = 30;
            const ribbonContentHeight = 250;
            const ribbonHeight = isBottomRibbonOpen ? ribbonHeaderHeight + ribbonContentHeight : ribbonHeaderHeight;
            const ribbonY = currentHeight - ribbonHeight;

            const ribbon = d3.select(".bottom-ribbon-bar");

            // Just update the ribbon attributes. The ResizeObserver *must* handle the rest.
            ribbon.attr("y", ribbonY).attr("height", ribbonHeight);
            ribbon.select(".bottom-ribbon-content")
                .style("display", isBottomRibbonOpen ? "flex" : "none"); // Show/hide content
            ribbon.select(".bottom-ribbon-header-arrow")
                .html(isBottomRibbonOpen ? '▼' : '▲');

            // NO call to updateDynamicMapElements or requestAnimationFrame here.

        } else { /* error */ }

        // Trigger simulation or redraw chart
        setTimeout(() => { /* ... simulation/chart redraw logic ... */
            if (isBottomRibbonOpen && !simulationResults && !isSimulationRunning && !simulationError) { runDailyInventorySimulation().catch(e => console.warn("Initial sim run failed:", e)); } else if (isBottomRibbonOpen) { drawHoldingCostChart(); }
        }, 0); // Short delay
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

    // --- *** Web Worker Simulation Call (Returns Promise) *** ---
    function runDailyInventorySimulation(validationParams = null) {
        return new Promise((resolve, reject) => {
            // Store resolve/reject for the worker message handler
            simulationPromiseResolve = resolve;
            simulationPromiseReject = reject;
            isValidationRun = !!validationParams; // Set flag if validating

            if (!simulationWorker) {
                console.error("Sim worker not init.");
                simulationError = "Worker failed load.";
                if (isBottomRibbonOpen) drawHoldingCostChart();
                return reject(new Error("Worker failed load.")); // Reject the promise
            }

            // Use validation params if provided, otherwise use current state
            const paramsToUse = validationParams || getCurrentSimulationParams();

            if (!paramsToUse) {
                console.error("Could not get simulation parameters.");
                return reject(new Error("Could not get simulation parameters."));
            }

            console.log(`WORKER: Posting sim job (Validation: ${isValidationRun})...`);
            isSimulationRunning = true; // Still set global flag for UI feedback
            // Don't reset global results/error if validating
            if (!isValidationRun) {
                simulationResults = null;
                simulationError = null;
            }

            // Always redraw chart to show loading state
            if (isBottomRibbonOpen) { drawHoldingCostChart(); }

            simulationWorker.postMessage({ type: 'start', payload: paramsToUse });
        });
    }

    // --- *** NEW: Helper to gather current simulation parameters *** ---
    function getCurrentSimulationParams() {
        let workingDaysSchedule = [];
        const investmentWorkingDaysEl = document.getElementById('inv-workingDays');
        // ... (Gather all parameters as before in the original runDailyInventorySimulation) ...
        if (investmentWorkingDaysEl && investmentWorkingDaysEl.dataset.workingDaysList) { try { workingDaysSchedule = JSON.parse(investmentWorkingDaysEl.dataset.workingDaysList); } catch (e) { console.error("Could not parse WD list", e); } } if (!Array.isArray(workingDaysSchedule) || workingDaysSchedule.length === 0) { console.warn("Using default schedule"); const year = new Date().getFullYear(); const date = new Date(year, 0, 1); while (date.getFullYear() === year) { const dayOfWeek = date.getDay(); if (dayOfWeek > 0 && dayOfWeek < 6) { workingDaysSchedule.push(date.toISOString().split('T')[0]); } date.setDate(date.getDate() + 1); } } const opHoursEl = document.getElementById('opHours'); const numEmployeesEl = document.getElementById('numEmployees'); const laborCostEl = document.getElementById('laborCost'); const holdingCostInput = document.getElementById('loc-holding-cost-input'); const mfgOverheadEl = document.getElementById('inv-mfgOverhead'); const sgaExpensesEl = document.getElementById('inv-sgaExpenses'); const scInput = document.getElementById('superCogs'); const ucInput = document.getElementById('ultraCogs'); const mcInput = document.getElementById('megaCogs'); const standardOpHours = opHoursEl ? parseFloat(opHoursEl.value) || 15.0 : 15.0; const numEmployees = numEmployeesEl ? parseInt(numEmployeesEl.value) || 8 : 8; const laborCost = laborCostEl ? parseFloat(laborCostEl.value) || 25.0 : 25.0; const holdingCostRate = (holdingCostInput ? parseFloat(holdingCostInput.value) || 25.0 : 25.0) / 100; const annualMfgOverhead = mfgOverheadEl ? parseFloat(mfgOverheadEl.value.replace(/,/g, '')) || 250000 : 250000; const annualSgaExpenses = sgaExpensesEl ? parseFloat(sgaExpensesEl.value.replace(/,/g, '')) || 350000 : 350000; const superCogsVal = scInput ? parseFloat(scInput.value) : 375; const ultraCogsVal = ucInput ? parseFloat(ucInput.value) : 590; const mcInputVal = mcInput ? parseFloat(mcInput.value) : 960; const buildRatios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.33, ultra: 0.33, mega: 0.34 }; const capacityMetrics = typeof calculateMetrics === 'function' ? calculateMetrics({ dailyDemand: 9999, opHours: standardOpHours, numEmployees }, {}) : { throughputUnitsPerDay: standardOpHours * 10 }; const standardDailyProduction = Math.floor(capacityMetrics?.throughputUnitsPerDay || 0);
        // --- Get cities directly from cityData ---
        const cities = Array.from(cityData.values());

        return { cities, workingDaysSchedule, standardOpHours, numEmployees, laborCost, holdingCostRate, annualMfgOverhead, annualSgaExpenses, superCogsVal, ultraCogsVal, mcInputVal, buildRatios, standardDailyProduction };
    }

    async function drawPPITrendChart() {
        const svg = d3.select("#ppi-chart-svg");
        svg.selectAll("*").remove(); // Clear previous chart

        // --- Chart Dimensions ---
        const margin = { top: 20, right: 30, bottom: 40, left: 50 };
        // Use fixed dimensions based on the modal's viewBox/size
        const modalWidth = 500;
        const modalHeight = 280; // Matches viewBox height in draw()
        const width = modalWidth - margin.left - margin.right;
        const height = modalHeight - margin.top - margin.bottom;

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // --- *** MODIFIED: Use createTooltip helper *** ---
        // This ensures the tooltip is appended to the body, avoiding modal conflicts.
        const tooltip = createTooltip("ppi-tooltip");
        // --- End Modification ---

        // Loading/Error Text
        const errorText = g.append("text")
            .attr("class", "ppi-loading-text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle") // Center text
            .attr("fill", "var(--failure-color)")
            .style("font-size", "14px")
            .style("display", "none") // Hide initially
            .text("Loading...");

        try {
            errorText.text("Loading baseline data...").style("display", null);
            let combinedData = await loadCsvBaselineData();
            if (combinedData.length === 0) throw new Error("Failed to load PPI data.");

            combinedData.sort((a, b) => a.date - b.date);
            const finalPpiData = combinedData;
            if (finalPpiData.length === 0) throw new Error("No PPI data available.");

            errorText.style("display", "none"); // Hide loading text

            // --- Scales ---
            const maxDate = d3.max(finalPpiData, d => d.date);
            // Ensure domain extends slightly past last data point for visibility
            const domainMaxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
            const x = d3.scaleTime()
                .domain([d3.min(finalPpiData, d => d.date), domainMaxDate])
                .range([0, width]);

            const validValues = finalPpiData.map(d => d.value).filter(v => !isNaN(v));
            const yMin = d3.min(validValues) ?? 0;
            const yMax = d3.max(validValues) ?? 1;
            // Ensure domain has some height even if data is flat or zero
            const yDomainMin = yMin * 0.95;
            const yDomainMax = (yMax === yMin) ? yMax * 1.1 + 1 : yMax * 1.05; // Add 1 if flat
            const y = d3.scaleLinear()
                .domain([yDomainMin, yDomainMax])
                .range([height, 0]);

            // Helpers
            const bisectDate = d3.bisector(d => d.date).left;
            const formatDate = d3.timeFormat("%b %Y");

            // --- Axes ---
            g.append("g").attr("class", "axis x-axis")
                .attr("transform", `translate(0,${height})`)
                .call(d3.axisBottom(x).ticks(d3.timeYear.every(3)).tickFormat(d3.timeFormat("%Y")))
                .append("text").attr("class", "axis-label")
                .attr("fill", "var(--accent)").attr("x", width / 2).attr("y", 35)
                .attr("text-anchor", "middle").text("Year");

            g.append("g").attr("class", "axis y-axis")
                .call(d3.axisLeft(y))
                .append("text").attr("class", "axis-label")
                .attr("fill", "var(--accent)").attr("transform", "rotate(-90)").attr("y", -40)
                .attr("x", -height / 2).attr("text-anchor", "middle").text("Producer Price Index");

            // --- Line ---
            const line = d3.line()
                .x(d => x(d.date))
                .y(d => y(d.value))
                .defined(d => !isNaN(d.value) && d.value !== null); // Filter out invalid points

            g.append("path")
                .datum(finalPpiData.filter(d => !isNaN(d.value) && d.value !== null)) // Filter data for path
                .attr("class", "ppi-line") // Use class for styling
                .attr("d", line);

            // --- Focus Circle ---
            const focus = g.append("g")
                .attr("class", "ppi-focus")
                .style("display", "none"); // Hide initially

            focus.append("circle")
                .attr("r", 5)
                .attr("class", "ppi-focus-circle"); // Use class for styling

            // --- Interaction Overlay ---
            g.append("rect")
                .attr("class", "ppi-overlay")
                .attr("width", width)
                .attr("height", height)
                .on("mouseover", () => {
                    focus.style("display", null);
                    tooltip.style("opacity", 1); // Show tooltip on hover
                })
                .on("mouseout", () => {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0); // Hide tooltip on mouseout
                })
                .on("mousemove", mousemove); // Call named handler

            // --- Mousemove Handler ---
            function mousemove(event) {
                // Ensure tooltip remains visible during move
                tooltip.style("opacity", 1);

                const pointer = d3.pointer(event, g.node()); // Get pointer relative to 'g'
                if (!pointer || pointer.length < 1) return;

                const x0 = x.invert(pointer[0]); // Get date from x position
                const i = bisectDate(finalPpiData, x0, 1); // Find index
                const d0 = finalPpiData[i - 1];
                const d1 = finalPpiData[i];

                // Determine closest data point
                if (!d0 || !d1) { // Handle edge cases where only one point exists near cursor
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                    return;
                }
                const d = (x0 - d0.date > d1.date - x0) ? d1 : d0;

                // Check if the found data point is valid
                if (!d || isNaN(d.value) || d.value === null) {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0); // Hide if data invalid
                    return;
                } else {
                    focus.style("display", null); // Ensure focus is visible
                }

                // Update focus circle position
                focus.attr("transform", `translate(${x(d.date)},${y(d.value)})`);

                // Update tooltip content
                tooltip.html(`<strong>${formatDate(d.date)}</strong><div class="tooltip-row"><span>Price Index:</span> <span>${d.value.toFixed(2)}</span></div>`);

                // Position the tooltip
                positionTooltip(event, tooltip);
            }
        } catch (error) {
            console.error("Failed to draw PPI chart:", error);
            errorText.text(`Error: ${error.message}`).style("display", null); // Show error
            tooltip.style("opacity", 0); // Ensure tooltip is hidden on error
        }
    }

    function drawHoldingCostChart() {
        const svg = d3.select("#holding-cost-chart-svg");
        svg.selectAll("*").remove(); // Clear previous drawing

        const metricsPlaceholder = d3.select("#metrics-placeholder-in-demand");
        metricsPlaceholder.html(""); // Clear placeholder initially

        const tooltip = createTooltip("holding-cost-tooltip");

        const svgNode = svg.node();
        if (!svgNode) return;
        const svgContainer = svgNode.parentNode;
        if (!svgContainer) return;
        const { width: viewBoxWidth, height: viewBoxHeight } = svgContainer.getBoundingClientRect();

        // --- Loading State Check ---
        if (isSimulationRunning) {
            metricsPlaceholder.html(`<p class="loading" style="color: var(--accent); font-weight: bold; margin: 0; padding: 2px 0;">Loading...</p>`);
            svg.append("text").attr("x", viewBoxWidth / 2).attr("y", viewBoxHeight / 2).attr("text-anchor", "middle").text("Loading Simulation...");
            return;
        }

        // --- Determine State: Conflict Error, General Error, No Results, or Valid Results ---
        const isConflictError = simulationError && simulationError.startsWith("Demand Conflict");
        const hasValidResults = simulationResults && Array.isArray(simulationResults) && simulationResults.length > 0;
        const displayState = isConflictError ? "CONFLICT" : (!hasValidResults ? "NO_RESULTS_OR_GENERAL_ERROR" : "VALID_RESULTS");

        console.log(`drawHoldingCostChart: Display State = ${displayState}, Conflict Msg Present: ${!!isConflictError}, Valid Results Present: ${hasValidResults}`);

        // --- Dimension Checks ---
        if (viewBoxWidth <= 0 || viewBoxHeight <= 0) { return; }
        const margin = { top: 20, right: 30, bottom: 30, left: 55 };
        const width = viewBoxWidth - margin.left - margin.right;
        const height = viewBoxHeight - margin.top - margin.bottom;
        if (width <= 0 || height <= 0) { return; }

        svg.attr("viewBox", `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        // Formatters, Dates
        const formatK = (n) => { /* ... */ }; const formatInt = d3.format(",.0f"); const year = new Date().getFullYear(); const startDate = new Date(Date.UTC(year, 0, 1)); const endDate = new Date(Date.UTC(year, 11, 31));


        // --- Draw Based on State ---
        if (displayState === "NO_RESULTS_OR_GENERAL_ERROR") {
            console.log("Drawing empty axes.");
            // --- Draw Empty Axes ---
            let standardDailyProduction = 0; try { /* ... calc buffer ... */ } catch (e) { /* ... */ } const buffer = (standardDailyProduction * 7) || 1000; const x = d3.scaleTime().domain([startDate, endDate]).range([0, width]); drawMonthAxis(g, x, height); if (holdingChartMode === 'inventory') { const yLeft = d3.scaleLinear().domain([0, buffer * 1.2]).range([height, 0]).nice(); g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatK)).append("text")/*.attr(...)*/.text("Inventory On Hand"); metricsPlaceholder.html(`<div class="summary-row"><span>Avg. Inventory:</span> <strong>-</strong></div> <div class="summary-row total"><span>Holding Costs:</span> <strong>-</strong></div>`); } else { const yMaxGuess = (buffer * 1.5) || 500; const yLeftShip = d3.scaleLinear().domain([0, yMaxGuess]).range([height, 0]).nice(); g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeftShip).tickFormat(formatK)).append("text")/*.attr(...)*/.text("Units Delivered"); metricsPlaceholder.html("<p style='margin:0; padding: 2px 0;'>Add a city to run simulation.</p>"); } g.selectAll(".axis-label").attr("fill", "currentColor").attr("transform", "rotate(-90)").attr("y", -margin.left + 12).attr("x", -height / 2).attr("text-anchor", "middle").style("font-size", "14px"); g.selectAll(".axis .tick text").style("font-size", "12px");
            // Display general error message if applicable
            if (simulationError && !isConflictError) { // Only show general errors here
                g.append("text").attr("x", width / 2).attr("y", height / 2).attr("text-anchor", "middle").attr("fill", "var(--failure-color)").text("Simulation Error");
                metricsPlaceholder.html(`<div class="summary-row error-message"><span style="color: var(--failure-color); font-weight: bold;">Sim Failed</span></div>`);
            }
            return; // Stop here
        }

        // --- States "VALID_RESULTS" or "CONFLICT" ---
        // Both these states require drawing the chart using simulationResults
        console.log("Drawing chart content using simulationResults.");
        const dailyData = simulationResults.map(d => ({ ...d, dateObj: new Date(d.date + 'T00:00:00Z') }));

        // --- Populate Metrics (Only if VALID_RESULTS) ---
        if (displayState === "VALID_RESULTS") {
            const avgInventory = d3.mean(dailyData, d => d.inventoryEnd) || 0; const totalAnnualHoldingCost = d3.sum(dailyData, d => d.holdingCost); const totalExceptionCost = d3.sum(dailyData, d => d.exceptionCost); const exceptionsCount = d3.sum(dailyData, d => (d.isExceptionDay || d.isReductionDay) ? 1 : 0);
            if (holdingChartMode === 'inventory') {
                metricsPlaceholder.append("div").attr('class', 'summary-row').html(`<span>Avg. Inventory:</span><span><strong>${formatInt(avgInventory)}</strong> units</span>`);
                metricsPlaceholder.append("div").attr('class', 'summary-row total').html(`<span>Holding Costs:</span><span><strong>${totalAnnualHoldingCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></span>`);
            } else {
                metricsPlaceholder.append("div").attr('class', 'summary-row').html(`<span>Exceptions:</span><span><strong>${exceptionsCount.toLocaleString()}</strong> days</span>`);
                metricsPlaceholder.append("div").attr('class', 'summary-row total').html(`<span>Exception Cost:</span><span><strong style="color: var(--failure-color);">${totalExceptionCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></span>`);
            }
        } else if (displayState === "CONFLICT") {
            // Show simple conflict message in metrics area
            metricsPlaceholder.html(`<div class="summary-row error-message"><span style="color: var(--failure-color); font-weight: bold;">Conflict Detected!</span></div>`);
        }


        // --- Common X Scale ---
        const x = d3.scaleTime().domain(d3.extent(dailyData, d => d.dateObj)).range([0, width]);

        // --- Draw Inventory or Shipment Chart ---
        if (holdingChartMode === 'inventory') {
            // ... (Inventory chart drawing code - unchanged) ...
            const yMin = d3.min(dailyData, d => d.inventoryEnd) ?? 0; const yMax = d3.max(dailyData, d => d.inventoryEnd) ?? 0; const yLeft = d3.scaleLinear().domain([Math.min(0, yMin), Math.max(10, yMax * 1.1)]).range([height, 0]).nice(); drawMonthAxis(g, x, height); g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatK)).selectAll("text").style("font-size", "12px"); g.select(".y-axis-left").append("text").attr("class", "axis-label").attr("fill", "currentColor").attr("transform", "rotate(-90)").attr("y", -margin.left + 12).attr("x", -height / 2).attr("text-anchor", "middle").style("font-size", "14px").text("Inventory On Hand"); const area = d3.area().x(d => x(d.dateObj)).y0(yLeft(0)).y1(d => yLeft(d.inventoryEnd)).curve(d3.curveStepAfter); g.append("path").datum(dailyData).attr("class", "holding-cost-area").attr("d", area); const bisectDate = d3.bisector(d => d.dateObj).left; g.append("rect").attr("class", "overlay").attr("width", width).attr("height", height).style('fill', 'none').style('pointer-events', 'all').on("mouseover", () => tooltip.style("opacity", 1)).on("mouseout", () => tooltip.style("opacity", 0)).on("mousemove", handleInventoryTooltip); function handleInventoryTooltip(event) { tooltip.style("opacity", 1); const pointer = d3.pointer(event, g.node()); if (!pointer?.[0]) return; const date = x.invert(pointer[0]); const i = bisectDate(dailyData, date, 1); const d0 = dailyData[i - 1]; const d1 = dailyData[i]; const d = (d1 && (date - d0.dateObj > d1.dateObj - date)) ? d1 : d0; if (!d) return; tooltip.html(`<strong>${d.date} (Day ${d.day + 1})</strong><div class="tooltip-row"><span>Inventory:</span> <span>${formatInt(d.inventoryEnd)}</span></div>`); positionTooltip(event, tooltip); }
        } else {
            // ... (Shipment chart drawing code - unchanged, NO DRAG) ...
            const xBand = d3.scaleBand().domain(d3.range(dailyData.length)).range([0, width]).padding(0.1); const bandwidth = xBand.bandwidth(); const yMax = d3.max(dailyData, d => d.actualShipments) ?? 0; const yLeft = d3.scaleLinear().domain([0, Math.max(10, (yMax || 0) * 1.1)]).range([height, 0]).nice(); drawMonthAxis(g, x, height); g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatK)).selectAll("text").style("font-size", "12px"); g.select(".y-axis-left").append("text").attr("class", "axis-label").attr("fill", "currentColor").attr("transform", "rotate(-90)").attr("y", -margin.left + 12).attr("x", -height / 2).attr("text-anchor", "middle").style("font-size", "14px").text("Units Delivered"); const chartData = dailyData.map(d => { let selectedQty = 0; let unselectedQty = 0; (d.actualShipmentDetails || []).forEach(detail => { const qty = Number(detail.qty) || 0; if (detail.city === selectedCityName) { selectedQty += qty; } else { unselectedQty += qty; } }); return { ...d, unselected: unselectedQty, selected: selectedQty, actualShipments: Number(d.actualShipments) || 0 }; }); const stackKeys = ["unselected", "selected"]; const stack = d3.stack().keys(stackKeys); const stackedData = stack(chartData); const color = d3.scaleOrdinal().domain(stackKeys).range(["var(--primary)", "var(--secondary1)"]); const layers = g.selectAll("g.layer").data(stackedData).join("g").attr("class", d => d.key); layers.selectAll("rect").data(d => d).join("rect").attr("x", d => x(d.data.dateObj) - bandwidth / 2).attr("y", d => (isNaN(d[1]) ? yLeft(0) : yLeft(d[1]))).attr("height", d => { const y0 = isNaN(d[0]) ? 0 : d[0]; const y1 = isNaN(d[1]) ? y0 : d[1]; const scaledY0 = yLeft(y0); const scaledY1 = yLeft(y1); return (isNaN(scaledY0) || isNaN(scaledY1)) ? 0 : Math.max(0, scaledY0 - scaledY1); }).attr("width", bandwidth).attr("fill", function (d) { return (d.data.isExceptionDay || d.data.isReductionDay) ? "var(--failure-color)" : color(d3.select(this.parentNode).datum().key); }).style("cursor", "default"); g.append("rect").attr("class", "overlay").attr("width", width).attr("height", height).style('fill', 'none').style('pointer-events', 'all').style("cursor", "crosshair").on("mouseover", () => tooltip.style("opacity", 1)).on("mouseout", () => tooltip.style("opacity", 0)).on("mousemove", handleShipmentTooltip); function handleShipmentTooltip(event) { tooltip.style("opacity", 1); const pointer = d3.pointer(event, g.node()); if (!pointer?.[0]) return; const date = x.invert(pointer[0]); const index = d3.bisectCenter(dailyData.map(d => d.dateObj), date); const d = dailyData[index]; if (!d) return; d3.select(event.currentTarget).style("cursor", "crosshair"); let detailsHtml = ""; if (d.actualShipmentDetails && d.actualShipmentDetails.length > 0) { detailsHtml += `<hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-header">Actual Shipments</div>`; d.actualShipmentDetails.forEach(detail => { const style = (detail.city === selectedCityName) ? "font-weight:bold;color:var(--secondary1);" : ""; detailsHtml += `<div class="tooltip-row" style="${style}"><span>${detail.city}:</span> <span>${formatInt(detail.qty || 0)}</span></div>`; }); } if (d.isExceptionDay || d.isReductionDay) { /* ... adjustment details ... */ detailsHtml += `<hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-header" style="color: var(--failure-color);">Adjustments</div>`; if (d.exceptionDetails) { const costMatch = d.exceptionDetails.match(/Cost: \$([\d,]+)/); const costText = costMatch ? costMatch[1] : null; const detailText = d.exceptionDetails.replace(/ Cost: \$[\d,]+/, ''); detailsHtml += `<div>${detailText}</div>`; if (costText) { detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>\$${costText}</span></div>`; } else if (d.exceptionCost > 0) { detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>${d.exceptionCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</span></div>`; } } else if (d.exceptionCost > 0) { detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>${d.exceptionCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</span></div>`; } } tooltip.html(`<strong>${d.date} (Day ${d.day + 1})</strong> <div class="tooltip-row"><span>Total Shipped:</span> <span>${formatInt(d.actualShipments || 0)}</span></div> ${detailsHtml}`); positionTooltip(event, tooltip); }
        }

        // --- Add Conflict Error Overlay LAST (if state is CONFLICT) ---
        if (displayState === "CONFLICT") {
            // Ensure conflictErrorMessage has the raw message
            const rawConflictMessage = simulationError || "Unknown Conflict"; // Fallback
            console.log("Adding conflict error overlay to chart.");
            // Add background
            g.append("rect")
                .attr("class", "error-overlay-bg")
                .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
                .attr("fill", "rgba(255, 255, 255, 0.85)")
                .style("pointer-events", "none");

            // Add text using foreignObject
            const errorFo = g.append("foreignObject")
                .attr("x", 10).attr("y", 10).attr("width", width - 20).attr("height", height - 20)
                .style("pointer-events", "none"); // Make FO non-interactive

            errorFo.append("xhtml:div")
                .attr("class", "chart-error-message") // Apply class
                .style("color", "var(--failure-color)")
                .style("font-weight", "bold")
                .style("font-size", "12px")
                .style("line-height", "1.4")
                .style("white-space", "pre-wrap") // Respect newlines
                .style("padding", "10px")
                .style("border", "2px solid var(--failure-color)")
                .style("background-color", "rgba(255, 200, 200, 0.95)")
                .style("max-height", "100%")
                .style("overflow-y", "auto")
                .html(rawConflictMessage.replace(/\n/g, "<br>")); // Use stored raw message
        }

    } // End drawHoldingCostChart

    // --- Helper Function to Draw Centered Month Axis ---
    function drawMonthAxis(selection, xScale, chartHeight) {
        const monthStarts = d3.utcMonth.range(xScale.domain()[0], d3.utcDay.offset(xScale.domain()[1], 1));

        const xAxis = d3.axisBottom(xScale)
            .tickValues(monthStarts)
            .tickFormat("")
            .tickSizeOuter(0);

        const axisGroup = selection.append("g")
            .attr("class", "axis x-axis")
            .attr("transform", `translate(0,${chartHeight})`)
            .call(xAxis);

        // Add custom centered month labels
        axisGroup.selectAll(".month-label")
            .data(monthStarts)
            .enter().append("text")
            .attr("class", "month-label axis-label")
            .attr("x", d => {
                const nextMonth = d3.utcMonth.offset(d, 1);
                const endPos = xScale(nextMonth < xScale.domain()[1] ? nextMonth : xScale.domain()[1]);
                const startPos = xScale(d);
                return (startPos + endPos) / 2;
            })
            // --- MODIFIED: Reduced y padding ---
            .attr("y", 15) // Closer to axis line (was 20)
            .attr("text-anchor", "middle")
            .attr("fill", "currentColor")
            .style("font-size", "12px")
            .text(d3.utcFormat("%b"));
    }

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

    const updateDynamicMapElements = () => {
        if (!mapInitialized || !projection || !path) {
            console.warn("updateDynamicMapElements skipped: Map not fully initialized.");
            return;
        }
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) {
            console.error("updateDynamicMapElements: #svg-container not found!");
            return;
        }

        // --- Get CURRENT dimensions ---
        let { width, height } = svgContainer.getBoundingClientRect();
        if (width <= 0 || height <= 0) { // Changed width check to <= 0
            console.warn(`updateDynamicMapElements skipped: Invalid dimensions W: ${width}, H: ${height}.`);
            return;
        }
        console.log(`updateDynamicMapElements: Using dimensions W: ${width.toFixed(0)}, H: ${height.toFixed(0)}`);

        const svg = d3.select("#location-panel"); // Select SVG element

        // --- Recalculate Ribbon Position (based on current height) ---
        const ribbonHeaderHeight = 30;
        const ribbonContentHeight = 250;
        const ribbonCurrentHeight = isBottomRibbonOpen ? ribbonHeaderHeight + ribbonContentHeight : ribbonHeaderHeight;
        const ribbonY = height - ribbonCurrentHeight;
        svg.select(".bottom-ribbon-bar")
            .attr("y", ribbonY)
            .attr("height", ribbonCurrentHeight)
            .attr("width", width)
            .attr("x", 0);

        // --- Recalculate Map Projection ---
        const mapHeightAvailable = height - ribbonHeaderHeight;
        const topMargin = height * 0.04;
        const effectiveMapHeight = Math.max(10, mapHeightAvailable - topMargin);
        const mapCenterY = topMargin + (effectiveMapHeight / 2);
        const mapCenterX = width / 2;
        // Simple scale - ensure it's applied correctly
        const finalScale = Math.max(50, width * 1.1);
        console.log(`updateDynamicMapElements: Setting projection scale=${finalScale.toFixed(0)}, translate=[${mapCenterX.toFixed(0)}, ${mapCenterY.toFixed(0)}]`);

        projection.scale(finalScale).translate([mapCenterX, mapCenterY]);
        path.projection(projection); // Update path generator

        // --- Update Map Elements ---
        radiusScale = d3.scaleSqrt().domain([100, 100000]).range([4, 25]).clamp(true);
        d3.select(".main-map-group").attr("transform", `translate(0, ${topMargin})`);

        // Force redraw of states
        const mapPaths = d3.select(".us-map").selectAll("path");
        if (!mapPaths.empty()) {
            mapPaths.attr("d", path); // Re-apply the 'd' attribute using the updated path generator
        } else { console.warn("updateDynamicMapElements: No map paths found to redraw."); }

        // Force redraw of markers/lines by calling their update functions
        updateCityMarkers();
        updateOptimalFactoryMarker();
        updateConnectionLines();

        // --- Update Other Panel Positions ---
        svg.select(".location-controls").attr("x", 15).attr("y", 15);
        svg.select(".summary-panel").attr("x", width - 235).attr("y", 5);
        svg.select("#ppi-chart-modal").attr("x", "50%").attr("y", "50%");
    };

    // --- Main Draw Function ---
    const draw = () => {
        // --- Setup ---
        const locationPanelElement = document.getElementById("location-panel");
        if (!locationPanelElement) {
            console.error("CRITICAL ERROR: SVG element #location-panel not found.");
            // Display error in main container if possible
            const container = document.getElementById('svg-container');
            if (container) container.innerHTML = '<p style="color:red; padding:20px; text-align:center;">Error loading Location tab: Missing required SVG element (#location-panel).</p>';
            return; // Stop execution
        }
        const svg = d3.select(locationPanelElement);
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) { console.error("Container not found."); return; }
        const { width, height } = svgContainer.getBoundingClientRect();
        if (width === 0 || height === 0) {
            console.warn("LocationTab.draw: SVG container has zero dimensions. Skipping draw.");
            return;
        }

        // --- Map Init/Update ---
        if (!mapInitialized) {
            svg.selectAll("*").remove(); // Clear SVG content before initializing
            d3.select("body").selectAll(".d3-tooltip").remove(); // Clear any stray tooltips
            initializeMap(svg, width, height); // Pass the defined svg variable
        } else {
            updateDynamicMapElements(); // Doesn't need svg passed directly
        }

        // --- Initialize Worker (if needed) ---
        if (!simulationWorker) {
            try {
                simulationWorker = new Worker('simulation.worker.js');

                // --- Worker Message Handler ---
                simulationWorker.onmessage = (e) => {
                    const { type, results, message } = e.data;
                    console.log("Main received:", type, (isValidationRun ? "(Validation)" : ""));
                    isSimulationRunning = false; // Always reset global flag

                    if (type === 'complete') {
                        // Success: Update results, clear error
                        if (!isValidationRun) {
                            simulationResults = results; // Store NEW results
                            simulationError = null;    // Clear any error
                            console.log("onmessage: Success - Stored new results.");
                        }
                        if (simulationPromiseResolve) simulationPromiseResolve(results);

                    } else if (type === 'error') {
                        const isConflictError = message && message.startsWith("Demand Conflict");

                        if (!isValidationRun) {
                            // ALWAYS store the LATEST error message
                            simulationError = message || "Worker error";
                            console.error("Worker Error:", simulationError);

                            // *** Critical: ONLY clear results if the NEW error is NOT a conflict error ***
                            if (!isConflictError) {
                                simulationResults = null; // Clear results ONLY for non-conflict errors
                                console.log("onmessage: Non-conflict error - Cleared simulationResults.");
                            } else {
                                // If the NEW error IS a conflict error, DO NOTHING to simulationResults.
                                console.log("onmessage: Conflict error - PRESERVING current simulationResults state.");
                            }
                        }
                        if (simulationPromiseReject) simulationPromiseReject(new Error(message || "Worker error"));
                    }

                    // Clear promise callbacks
                    simulationPromiseResolve = null;
                    simulationPromiseReject = null;

                    // Always redraw chart after worker response
                    if (isBottomRibbonOpen) drawHoldingCostChart();
                };
                // --- End Worker Message Handler ---

                simulationWorker.onerror = (err) => {
                    console.error("Worker onerror:", err);
                    isSimulationRunning = false;
                    const errorMessage = `Worker error: ${err.message}.`;
                    if (!isValidationRun) {
                        simulationError = errorMessage;
                        simulationResults = null; // Clear results on worker crash
                    }
                    if (simulationPromiseReject) {
                        simulationPromiseReject(new Error(errorMessage));
                    }
                    simulationPromiseResolve = null;
                    simulationPromiseReject = null;
                    isValidationRun = false; // Reset flag on crash too
                    if (isBottomRibbonOpen) drawHoldingCostChart(); // Redraw to show error state
                };
            } catch (err) {
                console.error("Failed init worker:", err);
                simulationError = "Could not create worker.";
                if (simulationPromiseReject) simulationPromiseReject(new Error(simulationError));
                simulationPromiseResolve = null; simulationPromiseReject = null; isValidationRun = false;
                // Handle UI feedback for worker init failure if needed
                if (isBottomRibbonOpen) drawHoldingCostChart(); // Attempt to draw (will show error state)
            }
        }

        // --- Remove old UI panels before drawing new ones ---
        svg.selectAll("foreignObject").remove();

        // --- Controls (Top Left) ---
        const controls = svg.append("foreignObject").attr("x", 15).attr("y", 15).attr("width", 650).attr("height", 100);
        const controlsDiv = controls.append("xhtml:div").attr("class", "location-controls");
        const cityGroup = controlsDiv.append("div").attr("class", "input-group");
        cityGroup.append("label").text("City");
        const citySelect = cityGroup.append("select").attr("id", "city-select");
        if (typeof majorCities !== 'undefined') { Object.keys(majorCities).sort().forEach(city => citySelect.append("option").attr("value", city).text(city)); } else { console.error("majorCities missing."); }
        const demandGroup = controlsDiv.append("div").attr("class", "input-group");
        demandGroup.append("label").text("Ship Qty");
        const demandInputGroup = demandGroup.append("div").attr("class", "input-with-unit");
        demandInputGroup.append("input").attr("type", "number").attr("id", "shipment-qty").attr("value", "200").attr("min", "1");
        demandInputGroup.append("span").attr("class", "unit-label").text("Units");
        const freqGroup = controlsDiv.append("div").attr("class", "input-group");
        freqGroup.append("label").text("Freq");
        const freqInputGroup = freqGroup.append("div").attr("class", "input-with-unit");
        freqInputGroup.append("input").attr("type", "number").attr("id", "shipment-freq").attr("value", "7").attr("min", "1");
        freqInputGroup.append("span").attr("class", "unit-label").text("Days");
        controlsDiv.append("button").attr("class", "loc-control-btn").text("Add City").on("click", addCity);
        controlsDiv.append("button").attr("class", "loc-control-btn remove-all-btn").text("Remove All").on("click", removeAllCities);

        // --- City Info Box ---
        const infoBox = svg.append("foreignObject").attr("width", 200).attr("height", 120).attr("class", "city-info-box").style("display", "none");
        const infoDiv = infoBox.append("xhtml:div");
        infoDiv.append("h4").attr("id", "info-header");
        infoDiv.append("p").attr("id", "info-demand");
        infoDiv.append("p").attr("id", "info-annual-cost");
        infoDiv.append("button").text("Remove City").attr("id", "info-remove-btn").on("click", function () { const cityToRemove = d3.select(this).attr("data-city-name"); removeCity(cityToRemove); });

        // --- Summary Panel (Top Right) ---
        const summaryPanel = svg.append("foreignObject").attr("class", "summary-panel").attr("x", width - 235).attr("y", 5).attr("width", 220).attr("height", 195);
        const summaryDiv = summaryPanel.append("xhtml:div");
        const switchGroup = summaryDiv.append("div").attr("class", "inv-button-group");
        switchGroup.append("button").attr("id", "loc-new-btn").text("New").classed('active', optimizationMode === 'New').on('click', () => { if (optimizationMode !== 'New') { optimizationMode = 'New'; d3.select("#loc-new-btn").classed('active', true); d3.select("#loc-existing-btn").classed('active', false); runOptimization(); } });
        switchGroup.append("button").attr("id", "loc-existing-btn").text("Existing").classed('active', optimizationMode === 'Existing').on('click', () => { if (optimizationMode !== 'Existing') { optimizationMode = 'Existing'; d3.select("#loc-new-btn").classed('active', false); d3.select("#loc-existing-btn").classed('active', true); runOptimization(); } });
        summaryDiv.append("h4").text("Optimal Summary");
        summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Location:</span><span id="summary-location">N/A</span>`);
        summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Ship Cost:</span><span id="summary-ship-cost">$0</span>`);
        summaryDiv.append("div").attr('class', 'summary-row').html(`<span># Shipments:</span><span id="summary-shipments">0</span>`);
        summaryDiv.append("div").attr('class', 'summary-row summary-total').html(`<span>Total Cost:</span><span id="summary-total-cost">$0</span>`);
        summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Avg Cost/U:</span><span id="summary-avg-cost">$0.00</span>`);

        // --- Modals (PPI Only) ---
        const ppiModal = svg.append("foreignObject").attr("id", "ppi-chart-modal").attr("x", "50%").attr("y", "50%").attr("width", 500).attr("height", 350).style("transform", "translate(-50%, -50%)").style("display", "none");
        const ppiModalDiv = ppiModal.append("xhtml:div").attr("class", "modal-content ppi-modal-content");
        ppiModalDiv.append("button").attr("class", "close-btn").html("&times;").on("click", () => d3.select("#ppi-chart-modal").style("display", "none"));
        ppiModalDiv.append("h4").text("PPI: General Freight Trucking");
        ppiModalDiv.append("svg").attr("id", "ppi-chart-svg").attr("viewBox", `0 0 500 280`).attr("preserveAspectRatio", "xMidYMid meet");

        // --- Collapsible Bottom Ribbon ---
        const ribbon = svg.append("foreignObject").attr("class", "bottom-ribbon-bar").attr("x", 0).attr("y", height - 30).attr("width", width).attr("height", 30).style("overflow", "hidden");
        const ribbonDiv = ribbon.append("xhtml:div").attr("class", "bottom-ribbon-container");
        const ribbonHeader = ribbonDiv.append("div").attr("class", "bottom-ribbon-header").on("click", toggleBottomRibbon);
        ribbonHeader.append("div").attr("class", "bottom-ribbon-header-title").html(`Simulation: <strong>${holdingChartMode === 'inventory' ? 'Inventory' : 'Shipments'}</strong>`);
        ribbonHeader.append("div").attr("class", "bottom-ribbon-header-arrow").html('▲');
        const ribbonContent = ribbonDiv.append("div").attr("class", "bottom-ribbon-content").style("display", "none");

        // --- Content: 1. Cost Inputs (Left) ---
        const costInputDiv = ribbonContent.append("div").attr("class", "ribbon-cost-inputs");
        costInputDiv.append("h4").text("Cost Inputs");
        const holdingGroup = costInputDiv.append("div").attr("class", "user-input-row");
        const holdingLabel = holdingGroup.append("label").attr("for", "loc-holding-cost-input").text("Hold Cost (%)");
        holdingGroup.append("input").attr("type", "number").attr("id", "loc-holding-cost-input").attr("value", 25).attr("step", "0.1").on("change", () => { runOptimization(); runDailyInventorySimulation().catch(e => console.warn("Sim failed after cost change:", e)); }).on("input", function () { d3.select(this).attr("data-user-modified", "true"); });
        const breakdownTooltip = createTooltip('holding-cost-breakdown-tooltip');
        holdingLabel.on("mouseover mousemove", (event) => { const input = d3.select("#loc-holding-cost-input"); const breakdown = { c: input.attr("data-breakdown-capital") || 0, s: input.attr("data-breakdown-storage") || 0, v: input.attr("data-breakdown-service") || 0, r: input.attr("data-breakdown-risk") || 0, t: input.attr("data-estimated-total") || 0 }; breakdownTooltip.style("opacity", 1).html(`Est. Breakdown:<br>Cap: ${breakdown.c}% Sto: ${breakdown.s}%<br>Svc: ${breakdown.v}% Rsk: ${breakdown.r}%<hr>Total: ${breakdown.t}%`); positionTooltip(event, breakdownTooltip); }).on("mouseout", () => breakdownTooltip.style("opacity", 0));
        const ppiGroup = costInputDiv.append("div").attr("class", "user-input-row");
        ppiGroup.append("label").attr("for", "loc-ppi-input").text("PPI");
        ppiGroup.append("input").attr("type", "number").attr("id", "loc-ppi-input").attr("value", PPI).attr("step", "0.1").on("change", function () { PPI = +this.value; runOptimization(); });
        const buttonGroup = costInputDiv.append("div").attr("class", "user-input-buttons");
        buttonGroup.append("button").attr("class", "loc-control-btn").attr("id", "show-ppi-chart-btn").text("What is my PPI?").on("click", () => { d3.select("#ppi-chart-modal").style("display", "block"); drawPPITrendChart(); });
        const simSwitchGroup = costInputDiv.append("div").attr("class", "inv-button-group sim-chart-switch");
        simSwitchGroup.append("button").attr("id", "sim-inv-btn").text("Inventory").classed('active', holdingChartMode === 'inventory').on('click', () => { holdingChartMode = 'inventory'; updateHoldingChartMode(); });
        simSwitchGroup.append("button").attr("id", "sim-ship-btn").text("Shipments").classed('active', holdingChartMode === 'shipments').on('click', () => { holdingChartMode = 'shipments'; updateHoldingChartMode(); });

        // --- Content: 2. Chart (Middle) ---
        const chartAreaDiv = ribbonContent.append("div").attr("class", "ribbon-chart-area");
        chartAreaDiv.append("div").attr("id", "holding-cost-svg-container").append("svg").attr("id", "holding-cost-chart-svg");

        // --- Content: 3. Demand (Right) ---
        const demandDiv = ribbonContent.append("div").attr("class", "ribbon-demand-panel");
        demandDiv.append("div").attr("id", "metrics-placeholder-in-demand"); // Placeholder for metrics
        demandDiv.append("h4").text("Annual Demand");
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P10:</span><span id="demand-p10">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P50:</span><span id="demand-p50">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P90:</span><span id="demand-p90">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>Alloc:</span><span id="demand-allocated">0</span>`);
        demandDiv.append("div").attr("class", "demand-bar-container").append("div").attr("class", "demand-bar").attr("id", "demand-bar-fill").text("0%");

        // --- Add City Function (Local scope) ---
        function addCity() {
            const name = d3.select("#city-select").property("value");
            const qty = parseFloat(d3.select("#shipment-qty").property("value"));
            const freq = parseFloat(d3.select("#shipment-freq").property("value"));
            if (name && qty > 0 && freq > 0) {
                if (typeof majorCities === 'undefined' || !majorCities[name]) {
                    console.error(`Coords for "${name}" not found.`); alert(`Error: Data missing for city "${name}".`); return;
                }
                const annualDemand = (qty / freq) * (totalDemandCapacity?.workingDays?.length || 250);
                cityData.set(name, { name, coordinates: majorCities[name], annualDemand, qty, freq });
                updateCityMarkers(); runOptimization(); updateDemandCapacityBox(); refreshHoldingCost();
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after adding city:", e)); // Trigger sim
            } else {
                console.warn("Invalid city/qty/freq.");
            }
        }

        // --- Initial Updates ---
        fetchDemandData();
        refreshHoldingCost();
        updateDemandCapacityBox();
        updateSummaryPanel(); // Call AFTER fetchDemandData etc.
        updateDynamicMapElements(); // Set initial positions

        if (mapInitialized) {
            runOptimization();
        }
        // Draw chart if ribbon is already open
        if (isBottomRibbonOpen) {
            drawHoldingCostChart();
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
        let shipmentCost = 0; // Renamed for clarity
        let totalShipments = 0;
        let totalAllocatedDemand = 0;
        const cities = Array.from(cityData.values());
        let locationText = "N/A";

        if (optimalFactoryLocation && cities.length > 0) {
            shipmentCost = calculateTotalCost(optimalFactoryLocation, cities); // This is just shipment cost
            totalShipments = cities.reduce((sum, city) => { /* ... calculation unchanged ... */
                const shipmentsPerYear = 365.2425 / Math.max(1, city.freq); const details = getShipmentDetails(optimalFactoryLocation, city); const trucksPerShipment = details ? details.numFTL + (details.remainderChoice === 'FTL' ? 1 : (details.remainderChoice === 'LTL' ? 1 : 0)) : 0; return sum + (shipmentsPerYear * trucksPerShipment);
            }, 0);
            totalAllocatedDemand = cities.reduce((sum, city) => sum + city.annualDemand, 0);
            const lat = optimalFactoryLocation[1].toFixed(3);
            const lon = optimalFactoryLocation[0].toFixed(3);
            const closestCity = cities.find(c => c.coordinates && optimalFactoryLocation && c.coordinates[0] === optimalFactoryLocation[0] && c.coordinates[1] === optimalFactoryLocation[1]);
            locationText = closestCity ? closestCity.name : `${lat}°N, ${Math.abs(lon)}°W`;
        }

        // --- MODIFIED: Include Holding and Exception Costs ---
        let holdingCost = 0;
        let exceptionCost = 0;
        if (simulationResults) {
            holdingCost = d3.sum(simulationResults, d => d.holdingCost);
            exceptionCost = d3.sum(simulationResults, d => d.exceptionCost);
        }
        const totalCombinedCost = shipmentCost + holdingCost + exceptionCost;
        const avgCostPerUnit = totalAllocatedDemand > 0 ? totalCombinedCost / totalAllocatedDemand : 0;
        // --- END MODIFICATION ---

        const formatCurrency = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const formatCurrencySmall = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        // Update display elements
        d3.select("#summary-location").text(locationText);
        d3.select("#summary-ship-cost").text(formatCurrency(shipmentCost)); // Update Ship Cost span
        d3.select("#summary-shipments").text(Math.round(totalShipments).toLocaleString());
        d3.select("#summary-total-cost").text(formatCurrency(totalCombinedCost)); // Update Total Cost span
        d3.select("#summary-avg-cost").text(formatCurrencySmall(avgCostPerUnit)); // Update Avg Cost span
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

    function updateCityMarkers() {
        if (!projection || !mapInitialized || !radiusScale) return;
        const tooltip = createTooltip('city-calc-tooltip');
        const infoBox = d3.select(".city-info-box");
        const markers = d3.select(".city-markers").selectAll(".city-marker").data(Array.from(cityData.values()), d => d.name);

        markers.exit().transition().duration(300).attr("r", 0).remove();

        markers.enter().append("circle").attr("class", "city-marker").attr("r", 0).attr("transform", d => `translate(${projection(d.coordinates)})`).merge(markers)
            .on("mouseover", (event, d) => { /* ... mouseover logic unchanged ... */
                const details = getShipmentDetails(optimalFactoryLocation, d); const costFormat = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }; if (!details || !optimalFactoryLocation) { tooltip.style("opacity", 1).html(`<strong>${d.name}</strong><br>Calculating...`); positionTooltip(event, tooltip); return; } const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d); const avgCostPerUnit = d.annualDemand > 0 ? (annualCost / d.annualDemand) : 0; let shipmentDetailsHtml; if (details.remainderChoice === 'Local') shipmentDetailsHtml = `<div class="tooltip-row"><span>Shipment:</span> <span>Local (No Cost)</span></div>`; else if (details.remainderChoice === 'LTL') shipmentDetailsHtml = `<div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${details.numFTL}</span></div><div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${details.costFTL.toLocaleString('en-US', costFormat)}</span></div><hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-row"><span>LTL Weight/Ship:</span> <span>${details.remainderTons.toFixed(2)} tons</span></div><div class="tooltip-row"><span>LTL Cost/Ship:</span> <span>${details.costRemainder.toLocaleString('en-US', costFormat)}</span></div>`; else { const totalFTL = details.numFTL + (details.remainderChoice === 'FTL' ? 1 : 0); const totalFTLCost = details.costFTL + (details.remainderChoice === 'FTL' ? details.costRemainder : 0); shipmentDetailsHtml = `<div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${totalFTL}</span></div><div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${totalFTLCost.toLocaleString('en-US', costFormat)}</span></div>`; if (details.remainderUnits > 0 && details.remainderChoice !== 'FTL' && details.remainderChoice !== 'LTL' && details.remainderChoice !== 'Local') shipmentDetailsHtml += `<div class="tooltip-row" style="color: yellow;"><span>Warning:</span> <span>Remainder (${details.remainderUnits}u) cost error? Choice: ${details.remainderChoice}</span></div>`; } tooltip.style("opacity", 1).html(`<div class="tooltip-header">${d.name} Details</div><div class="tooltip-row"><span>Est. Road Dist:</span> <span>${details.roadDistance.toFixed(0)} mi</span></div><hr style='margin: 2px 0; border-top-color: #555;'>${shipmentDetailsHtml}<hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-row"><span>Annual Qty:</span> <span>${Math.round(d.annualDemand).toLocaleString()}</span></div><div class="tooltip-row"><span>Annual Cost:</span> <span>${annualCost.toLocaleString('en-US', costFormat)}</span></div><div class="tooltip-row"><span>Avg Cost/Unit:</span> <span>${avgCostPerUnit.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span></div>`);
            })
            .on("mousemove", (event) => positionTooltip(event, tooltip))
            .on("mouseout", () => tooltip.style("opacity", 0))
            .on("click", (event, d) => { /* ... click logic unchanged ... */
                event.stopPropagation(); if (selectedCityName === d.name) { selectedCityName = null; } else { selectedCityName = d.name; } updateCityMarkers(); if (isBottomRibbonOpen) drawHoldingCostChart(); if (!projection) return; const projectedCoords = projection(d.coordinates); if (!projectedCoords) return; const [x, y] = projectedCoords; const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d); infoBox.select("#info-header").text(d.name); infoBox.select("#info-demand").text(`Demand: ${d.qty} u / ${d.freq} days`); infoBox.select("#info-annual-cost").text(`Annual Cost: ${annualCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`); infoBox.select("#info-remove-btn").attr("data-city-name", d.name); const svgContainer = d3.select("#svg-container").node(); const svgRect = svgContainer.getBoundingClientRect(); const mapGroupTransform = d3.select(".main-map-group").attr("transform"); const yMatch = mapGroupTransform ? mapGroupTransform.match(/translate\([\d\.\-]+,\s*([\d\.\-]+)\)/) : null; const mapYShift = yMatch ? parseFloat(yMatch[1]) : 0; let infoX = x + 15; let infoY = y + mapYShift - 15; const infoBoxWidth = 200; const infoBoxHeight = 120; if (infoX + infoBoxWidth > svgRect.width) infoX = x - infoBoxWidth - 15; if (infoY < mapYShift) infoY = y + mapYShift + 15; const ribbonCurrentHeight = isBottomRibbonOpen ? 280 : 30; if (infoY + infoBoxHeight > svgRect.height - ribbonCurrentHeight) { infoY = y + mapYShift - infoBoxHeight - 15; } infoBox.attr("x", infoX).attr("y", infoY).style("display", "block");
            })
            // --- *** NEW: Right-click listener *** ---
            .on("contextmenu", (event, d) => {
                event.preventDefault(); // Prevent default browser context menu
                removeCity(d.name); // Call helper function
            })
            // --- END NEW ---
            .style("fill", d => (d.name === selectedCityName) ? "var(--secondary1)" : "var(--secondary2)")
            .transition().duration(500)
            .attr("r", d => radiusScale(d.annualDemand))
            .attr("transform", d => `translate(${projection(d.coordinates)})`);
    }

    // --- *** NEW: Helper Function for Removing a City *** ---
    function removeCity(cityName) {
        if (cityName && cityData.delete(cityName)) {
            console.log("Removing city:", cityName);
            d3.select(".city-info-box").style("display", "none"); // Hide info box if open
            if (selectedCityName === cityName) {
                selectedCityName = null; // Deselect if removing selected city
            }
            // Trigger necessary updates
            updateCityMarkers();
            runOptimization();
            updateDemandCapacityBox();
            refreshHoldingCost();
            runDailyInventorySimulation().catch(e => console.warn("Sim failed after city removal:", e));
            if (isBottomRibbonOpen) drawHoldingCostChart(); // Redraw chart if open
        } else {
            console.warn("Attempted to remove non-existent city:", cityName);
        }
    }

    // --- *** NEW: Helper Function for Removing All Cities *** ---
    function removeAllCities() {
        if (cityData.size === 0) return; // Nothing to remove
        console.log("Removing all cities");
        cityData.clear(); // Empty the map
        d3.select(".city-info-box").style("display", "none");
        selectedCityName = null; // Clear selection

        // Trigger necessary updates
        updateCityMarkers();
        runOptimization();
        updateDemandCapacityBox();
        refreshHoldingCost();
        // Reset simulation results as there are no cities
        simulationResults = null;
        simulationError = null;
        if (isBottomRibbonOpen) drawHoldingCostChart(); // Redraw chart (will show 'no data' state)
        // No need to run simulation as there are no cities
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

    const setupListeners = () => {
        // ... (input listeners - unchanged) ...

        if (resizeObserver) {
            console.log("Disconnecting existing ResizeObserver.");
            resizeObserver.disconnect();
        }
        const svgContainerNode = d3.select("#svg-container").node();
        if (svgContainerNode) {
            console.log("Attempting to attach ResizeObserver to #svg-container...");
            resizeObserver = new ResizeObserver(entries => {
                // No need for requestAnimationFrame if updateDynamicMapElements handles dimensions correctly
                console.log("ResizeObserver Fired!"); // LOG: Confirm observer is firing
                if (document.querySelector('.tab-btn.active')?.dataset.tab === 'location' && mapInitialized) {
                    console.log("ResizeObserver calling updateDynamicMapElements.");
                    updateDynamicMapElements(); // Call the update function directly
                } else {
                    console.log("ResizeObserver: Conditions not met (Tab active? Map init?).");
                }
            });
            resizeObserver.observe(svgContainerNode);
            console.log("ResizeObserver attached to #svg-container.");
        } else {
            console.error("CRITICAL: Could not find #svg-container for ResizeObserver.");
        }
        // ... (beforeunload listener - unchanged) ...
    };
    // Ensure setupListeners is called after initial DOM setup
    setTimeout(setupListeners, 1500); // Adjust delay if needed, ensure it runs after elements exist

    // --- Public Interface ---
    return { draw: draw };

})(); // End LocationTab IIFE
