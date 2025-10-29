/**
 * @file LocationTab.js
 * Manages the "Location" tab, including the US map for optimal factory
 * location, cost calculations (shipping, holding), and inventory simulation.
 */

const LocationTab = (() => {

    // --- Constants ---
    const DEMAND_UNIT_LBS = 410; // Weight per demand unit in pounds
    const TRUCK_CAPACITY_UNITS = 60; // Capacity of a full truckload (FTL) in units
    let PPI = 170; // Producer Price Index (mutable, can be user-set)

    // --- Module State ---
    const cityData = new Map(); // Holds all active city {name, coords, demand, qty, freq}
    let optimalFactoryLocation = null; // [lon, lat] of the calculated optimal location
    let totalDemandCapacity = { p10: 0, p50: 0, p90: 0, workingDays: [] }; // Demand forecast
    let optimizationMode = 'New'; // 'New' (Weiszfeld) or 'Existing' (p-median)
    let selectedCityName = null; // Name of the currently clicked/selected city
    let holdingChartMode = 'shipments'; // 'shipments' or 'inventory' for the bottom chart
    let isBottomRibbonOpen = false; // UI state for the bottom simulation panel

    // --- Map & D3 State ---
    let mapInitialized = false; // Flag to prevent re-initializing the map
    let projection = null; // D3 geo projection
    let path = null; // D3 geo path generator
    let radiusScale = null; // D3 scale for city marker radius
    let continentalStatesFeatures = null; // GeoJSON features for US states
    // Removed resizeObserver, handled globally now

    // --- Simulation State ---
    let simulationWorker = null; // Web Worker for running simulations
    let isSimulationRunning = false; // Flag to show loading/prevent concurrent runs
    let simulationResults = null; // Cached results from the last successful simulation
    let simulationError = null; // Cached error message from a failed simulation
    let simulationPromiseResolve = null; // for async/await handling of worker
    let simulationPromiseReject = null; // for async/await handling of worker
    let isValidationRun = false; // Flag for simulation runs that shouldn't update global state

    /**
     * Manages SVG layout, calculating positions and dimensions for all components.
     */
    const layoutManager = {
        svgWidth: 0,
        svgHeight: 0,
        isRibbonOpen: false,

        // Dimensions
        ribbonHeaderHeight: 30,
        ribbonContentHeight: 250,
        topPanelMargin: 5,
        modalWidth: 500,
        modalHeight: 350,
        controlsHeight: 80,

        /**
         * Update the manager's state with new dimensions.
         */
        update(width, height, isRibbonOpen) {
            this.svgWidth = width || 0;
            this.svgHeight = height || 0;
            this.isRibbonOpen = isRibbonOpen;
            console.log(`LayoutManager Updated: W=${this.svgWidth.toFixed(0)}, H=${this.svgHeight.toFixed(0)}, Ribbon=${this.isRibbonOpen}`); // Debug
        },

        /**
         * Get coordinates for the bottom ribbon.
         */
        getRibbonRect() {
            const height = this.isRibbonOpen
                ? this.ribbonHeaderHeight + this.ribbonContentHeight
                : this.ribbonHeaderHeight;
            const y = this.svgHeight - height;
            return { x: 0, y: y, width: this.svgWidth, height: height };
        },

        /**
         * Get coordinates for the main map/content area.
         */
        getMainAreaRect() {
            const ribbonRect = this.getRibbonRect();
            return {
                x: 0,
                y: 0,
                width: this.svgWidth,
                height: Math.max(0, this.svgHeight - ribbonRect.height)
            };
        },

        /**
         * Get coordinates for the top-left controls panel.
         */
        getControlsRect() {
            const x = this.svgWidth * 0.2;
            const width = this.svgWidth * 0.4;
            return {
                x: x,
                y: this.topPanelMargin,
                width: width,
                height: this.controlsHeight
            };
        },

        /**
         * Get coordinates for the top-right summary panel.
         */
        getSummaryRect() {
            const gap = 5;
            const x = this.svgWidth * 0.6 + gap;
            const width = this.svgWidth * 0.2 - gap;
            const height = this.controlsHeight * 2.5;
            return {
                x: x,
                y: this.topPanelMargin,
                width: Math.max(50, width),
                height: height
            };
        },

        /**
         * Get coordinates for the pop-up modal.
         */
        getModalRect() {
            const x = (this.svgWidth - this.modalWidth) / 2;
            const y = (this.svgHeight - this.modalHeight) / 2;
            return {
                x: Math.max(0, x),
                y: Math.max(0, y),
                width: this.modalWidth,
                height: this.modalHeight,
            };
        },

        /**
         * Get the bounding box for the map itself, excluding top panels.
         */
        getMapBounds() {
            const mainArea = this.getMainAreaRect();
            const mapY = this.topPanelMargin + this.controlsHeight + this.topPanelMargin;
            const mapHeight = Math.max(1, mainArea.height - mapY);

            return {
                x: 0,
                y: mapY,
                width: mainArea.width,
                height: mapHeight
            };
        }
    };

    /**
     * Converts degrees to radians.
     */
    const toRadians = (deg) => deg * (Math.PI / 180);

    /**
     * Calculates the great-circle distance (in miles) between two [lon, lat] coordinates.
     * Uses the Haversine formula.
     */
    const greatCircleDistance = (coords1, coords2) => {
        if (!coords1 || !coords2) return 0;

        const [lon1, lat1] = coords1.map(toRadians);
        const [lon2, lat2] = coords2.map(toRadians);

        const R = 3959; // Earth's radius in miles
        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;

        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    /**
     * Estimates a circuitry (road travel) factor based on straight-line distance.
     */
    const getCircuitryFactor = (distance) => {
        return (distance >= 250) ? 1.2 : 1.35;
    };

    /**
     * Loads and parses the PPI.csv file.
     * @returns {Promise<Array<{date: Date, value: number}>>} Sorted array of PPI data.
     */
    async function loadCsvBaselineData() {
        try {
            const data = await d3.csv("Data/PPI.csv");
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            let monthlyData = [];

            data.forEach(row => {
                const year = parseInt(row.Year);
                if (isNaN(year)) return;

                months.forEach((month, index) => {
                    const value = parseFloat(row[month]);
                    monthlyData.push({
                        date: new Date(year, index, 1),
                        value: value
                    });
                });
            });

            return monthlyData.sort((a, b) => a.date - b.date);

        } catch (error) {
            console.error("Failed to load PPI.csv:", error);
            return [];
        }
    }

    /**
     * Calculates the cost of a single LTL shipment.
     * @param {number} distance - Road distance in miles.
     * @param {number} shipmentWeightTons - Weight in tons.
     * @returns {number} Estimated LTL cost.
     */
    const calculateLTLCost = (distance, shipmentWeightTons) => {
        const q = shipmentWeightTons;
        const d = distance;
        if (q <= 0 || d <= 0) return 0;

        const numerator = (PPI * q * d) / 5.14;
        const denominator = (q ** (1 / 7) * d ** (15 / 29)) - 3.5;

        if (denominator <= 0) return Infinity; // Avoid division by zero/negative
        return numerator / denominator;
    };

    /**
     * Calculates the holding cost breakdown based on various inputs from other tabs.
     * @returns {object} { capital, storage, service, risk, total }
     */
    function calculateHoldingCostBreakdown() {
        // Get inputs from other tabs
        const marrEl = document.getElementById('inv-marr');
        const workingDaysEl = document.getElementById('inv-workingDays');
        const taxRateEl = document.getElementById('inv-taxRate');

        // Provide defaults
        const marr = marrEl ? parseFloat(marrEl.value) || 12.0 : 12.0;
        const workingDays = workingDaysEl ? parseFloat(workingDaysEl.value) || 250 : 250;
        const taxRate = taxRateEl ? parseFloat(taxRateEl.value) || 25.0 : 25.0;

        // Calculate components
        const capital = marr;
        const service = 5.0 + (5.0 * (workingDays / 365.0)) + (10.0 * (taxRate / 100.0));

        // Dynamic storage & risk costs
        const cities = Array.from(cityData.values());
        let storage = 7.0; // Default
        let risk = 10.0;   // Default

        if (cities.length > 0 && optimalFactoryLocation) {
            // Storage cost based on proximity
            const distances = cities.map(c => greatCircleDistance(optimalFactoryLocation, c.coordinates));
            const minDistance = Math.min(...distances);
            const storageScale = d3.scaleLinear().domain([50, 500]).range([10.0, 4.0]).clamp(true);
            storage = storageScale(minDistance);

            // Risk cost based on average shipment frequency
            const avgFreq = d3.mean(cities, c => c.freq);
            if (avgFreq) {
                const riskScale = d3.scalePow().exponent(2).domain([7, 60]).range([5.0, 15.0]).clamp(true);
                risk = riskScale(avgFreq);
            }
        }

        const total = capital + service + storage + risk;
        return { capital, storage, service, risk, total };
    }

    /**
     * Refreshes the holding cost input field with the new estimated breakdown.
     * Stores the breakdown in data attributes for the tooltip.
     */
    function refreshHoldingCost() {
        const breakdown = calculateHoldingCostBreakdown();
        const input = d3.select("#loc-holding-cost-input");
        if (input.empty()) return;

        // Only update if user hasn't manually changed it, or if it's the first run
        const currentVal = parseFloat(input.property("value"));
        const estimatedVal = parseFloat(input.attr("data-estimated-total") || 0);

        if (Math.abs(currentVal - estimatedVal) < 0.1 || !input.attr("data-estimated-total")) {
            input.property("value", breakdown.total.toFixed(1));
        }

        // Store breakdown in data attributes for the tooltip
        input.attr("data-estimated-total", breakdown.total.toFixed(1));
        input.attr("data-breakdown-capital", breakdown.capital.toFixed(2));
        input.attr("data-breakdown-storage", breakdown.storage.toFixed(2));
        input.attr("data-breakdown-service", breakdown.service.toFixed(2));
        input.attr("data-breakdown-risk", breakdown.risk.toFixed(2));
    }


    // -------------------------------------------------------------------------
    // Bottom Ribbon (Simulation) UI Handlers
    // -------------------------------------------------------------------------

    /**
     * Toggles the visibility of the bottom simulation ribbon.
     */
    function toggleBottomRibbon() {
        isBottomRibbonOpen = !isBottomRibbonOpen;
        console.log(`Toggling ribbon. New state: ${isBottomRibbonOpen ? 'Open' : 'Closed'}`);

        // Update map elements (resizes the map)
        updateDynamicMapElements(); // Calls layoutManager.update internally

        // Update UI elements
        d3.select(".bottom-ribbon-header-arrow")
            .html(isBottomRibbonOpen ? '▼' : '▲');

        d3.select(".bottom-ribbon-content")
            .style("display", isBottomRibbonOpen ? "flex" : "none");

        // After transition, run simulation if needed
        setTimeout(() => {
            if (isBottomRibbonOpen && !simulationResults && !isSimulationRunning && !simulationError) {
                // If opening for the first time, run simulation
                runDailyInventorySimulation().catch(e => console.warn("Initial sim run failed:", e));
            } else if (isBottomRibbonOpen) {
                // If data already exists, just redraw the chart
                drawHoldingCostChart();
            }
        }, 310); // 310ms, just after 300ms CSS transition
    }

    /**
     * Updates the chart mode (Inventory vs. Shipments) and redraws the chart.
     */
    function updateHoldingChartMode() {
        // Update button active state
        d3.select("#sim-inv-btn").classed('active', holdingChartMode === 'inventory');
        d3.select("#sim-ship-btn").classed('active', holdingChartMode === 'shipments');

        // Update ribbon title
        d3.select(".bottom-ribbon-header-title").html(
            `Simulation: <strong>${holdingChartMode === 'inventory' ? 'Inventory' : 'Shipments'}</strong>`
        );

        if (isBottomRibbonOpen) {
            drawHoldingCostChart();
        }
    }

    /**
     * Runs the facility location optimization algorithm.
     * - 'New' mode uses a Weiszfeld algorithm (iterative geometric median)
     * and then checks if an existing city site is better.
     * - 'Existing' mode just checks all existing city sites (p-median).
     */
    const runOptimization = () => {
        const cities = Array.from(cityData.values());
        const ppiInput = d3.select("#loc-ppi-input").property("value");
        PPI = ppiInput ? parseFloat(ppiInput) : 170;

        if (optimizationMode === 'New') {
            // --- 'New' (Greenfield) Optimization ---
            if (cities.length < 2) {
                optimalFactoryLocation = null;
            } else {
                // Step 1: Calculate monetary weight for each city
                // (Cost per shipment per mile * shipments per year)
                cities.forEach(c => {
                    // Use a dummy distance of 1 mile to get a "per mile" cost
                    const shipmentDetails = getShipmentDetails(null, c, 1);
                    const costPerShipmentPerMile = shipmentDetails ? shipmentDetails.costPerShipment : 0;
                    const shipmentsPerYear = 365.2425 / c.freq;
                    c.monetaryWeight = costPerShipmentPerMile * shipmentsPerYear;
                });

                // Step 2: Find the geometric center (initial guess)
                let sumLon = 0, sumLat = 0, totalMonetaryWeight = 0;
                cities.forEach(c => {
                    if (c.monetaryWeight && isFinite(c.monetaryWeight)) {
                        sumLon += c.coordinates[0] * c.monetaryWeight;
                        sumLat += c.coordinates[1] * c.monetaryWeight;
                        totalMonetaryWeight += c.monetaryWeight;
                    }
                });

                if (totalMonetaryWeight <= 0) {
                    // Fallback to pure geometric center if weights are invalid
                    console.warn("Using geometric center (no valid monetary weights).");
                    sumLon = d3.sum(cities, c => c.coordinates[0]);
                    sumLat = d3.sum(cities, c => c.coordinates[1]);
                    totalMonetaryWeight = cities.length;
                    if (totalMonetaryWeight === 0) {
                        optimalFactoryLocation = null;
                        return; // No cities, exit
                    }
                }

                let currentLocation = [sumLon / totalMonetaryWeight, sumLat / totalMonetaryWeight];

                // Step 3: Iteratively refine location (Weiszfeld algorithm)
                for (let i = 0; i < 100; i++) {
                    let numLon = 0, numLat = 0, den = 0;

                    cities.forEach(city => {
                        // Distance from current iteration's location
                        const d = Math.max(0.001, greatCircleDistance(currentLocation, city.coordinates));
                        if (city.monetaryWeight && isFinite(city.monetaryWeight)) {
                            numLon += (city.coordinates[0] * city.monetaryWeight) / d;
                            numLat += (city.coordinates[1] * city.monetaryWeight) / d;
                            den += city.monetaryWeight / d;
                        }
                    });

                    if (den <= 0) {
                        console.warn("Opt stopped: Invalid denominator.");
                        break;
                    }

                    const nextLocation = [numLon / den, numLat / den];

                    // Stop if convergence is reached
                    if (greatCircleDistance(currentLocation, nextLocation) < 0.1) {
                        currentLocation = nextLocation;
                        break;
                    }
                    currentLocation = nextLocation;
                }

                // Step 4: Compare the calculated "new" location cost vs. all "existing" city sites
                const newMedianLocation = [+currentLocation[0].toFixed(3), +currentLocation[1].toFixed(3)];
                let minCost = calculateTotalCost(newMedianLocation, cities);
                let bestLocation = newMedianLocation;

                for (const potentialSite of cities) {
                    const currentCost = calculateTotalCost(potentialSite.coordinates, cities);
                    if (currentCost <= minCost) {
                        minCost = currentCost;
                        bestLocation = potentialSite.coordinates;
                    }
                }
                optimalFactoryLocation = bestLocation;
            }
        } else {
            // --- 'Existing' (p-median) Optimization ---
            if (cities.length < 1) {
                optimalFactoryLocation = null;
            } else {
                let bestLocation = null, minCost = Infinity;
                // Find the city site that has the minimum total cost
                for (const potentialSite of cities) {
                    const currentCost = calculateTotalCost(potentialSite.coordinates, cities);
                    if (currentCost < minCost) {
                        minCost = currentCost;
                        bestLocation = potentialSite.coordinates;
                    }
                }
                optimalFactoryLocation = bestLocation;
            }
        }

        // --- Update UI ---
        if (mapInitialized) {
            updateOptimalFactoryMarker();
            updateConnectionLines();
        }
        updateSummaryPanel();
        refreshHoldingCost();
    };

    /**
     * Runs the daily inventory simulation in the web worker.
     * @param {object | null} validationParams - If provided, runs a "validation" sim
     * that doesn't update the global state.
     * @returns {Promise<object>} Promise that resolves with simulation results.
     */
    function runDailyInventorySimulation(validationParams = null) {
        return new Promise((resolve, reject) => {
            simulationPromiseResolve = resolve;
            simulationPromiseReject = reject;
            isValidationRun = !!validationParams;

            if (!simulationWorker) {
                console.error("Simulation worker is not initialized.");
                simulationError = "Worker failed load.";
                if (isBottomRibbonOpen) drawHoldingCostChart();
                return reject(new Error("Worker failed load."));
            }

            const paramsToUse = validationParams || getCurrentSimulationParams();
            if (!paramsToUse) {
                console.error("Could not get simulation parameters.");
                return reject(new Error("Could not get simulation parameters."));
            }

            console.log(`WORKER: Posting simulation job (Validation: ${isValidationRun})...`);
            isSimulationRunning = true;
            if (!isValidationRun) {
                simulationError = null; // Clear previous errors
            }

            // Show loading state
            if (isBottomRibbonOpen) {
                drawHoldingCostChart();
            }

            simulationWorker.postMessage({ type: 'start', payload: paramsToUse });
        });
    }

    /**
     * Gathers all necessary parameters from the DOM to send to the simulation worker.
     * @returns {object | null}
     */
    function getCurrentSimulationParams() {
        // Get working days schedule
        let workingDaysSchedule = [];
        const investmentWorkingDaysEl = document.getElementById('inv-workingDays');

        if (investmentWorkingDaysEl && investmentWorkingDaysEl.dataset.workingDaysList) {
            try {
                workingDaysSchedule = JSON.parse(investmentWorkingDaysEl.dataset.workingDaysList);
            } catch (e) {
                console.error("Could not parse working days list", e);
            }
        }

        // Fallback to default 5-day work week if list is invalid
        if (!Array.isArray(workingDaysSchedule) || workingDaysSchedule.length === 0) {
            console.warn("Using default working days schedule");
            const year = new Date().getFullYear();
            const date = new Date(year, 0, 1);
            while (date.getFullYear() === year) {
                const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
                if (dayOfWeek > 0 && dayOfWeek < 6) { // Mon-Fri
                    workingDaysSchedule.push(date.toISOString().split('T')[0]);
                }
                date.setDate(date.getDate() + 1);
            }
        }

        // Get other parameters
        const opHoursEl = document.getElementById('opHours');
        const numEmployeesEl = document.getElementById('numEmployees');
        const laborCostEl = document.getElementById('laborCost');
        const holdingCostInput = document.getElementById('loc-holding-cost-input');
        const mfgOverheadEl = document.getElementById('inv-mfgOverhead');
        const sgaExpensesEl = document.getElementById('inv-sgaExpenses');
        const scInput = document.getElementById('superCogs');
        const ucInput = document.getElementById('ultraCogs');
        const mcInput = document.getElementById('megaCogs');

        // Provide defaults for all parameters
        const standardOpHours = opHoursEl ? parseFloat(opHoursEl.value) || 15.0 : 15.0;
        const numEmployees = numEmployeesEl ? parseInt(numEmployeesEl.value) || 8 : 8;
        const laborCost = laborCostEl ? parseFloat(laborCostEl.value) || 25.0 : 25.0;
        const holdingCostRate = (holdingCostInput ? parseFloat(holdingCostInput.value) || 25.0 : 25.0) / 100;
        const annualMfgOverhead = mfgOverheadEl ? parseFloat(mfgOverheadEl.value.replace(/,/g, '')) || 250000 : 250000;
        const annualSgaExpenses = sgaExpensesEl ? parseFloat(sgaExpensesEl.value.replace(/,/g, '')) || 350000 : 350000;
        const superCogsVal = scInput ? parseFloat(scInput.value) : 375;
        const ultraCogsVal = ucInput ? parseFloat(ucInput.value) : 590;
        const mcInputVal = mcInput ? parseFloat(mcInput.value) : 960;

        // Ensure global objects/functions exist, provide fallbacks
        const buildRatios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.33, ultra: 0.33, mega: 0.34 };
        const capacityMetrics = typeof calculateMetrics === 'function'
            ? calculateMetrics({ dailyDemand: 9999, opHours: standardOpHours, numEmployees }, {})
            : { throughputUnitsPerDay: standardOpHours * 10 }; // Simple fallback

        const standardDailyProduction = Math.floor(capacityMetrics?.throughputUnitsPerDay || 0);
        const cities = Array.from(cityData.values());

        return {
            cities,
            workingDaysSchedule,
            standardOpHours,
            numEmployees,
            laborCost,
            holdingCostRate,
            annualMfgOverhead,
            annualSgaExpenses,
            superCogsVal,
            ultraCogsVal,
            mcInputVal,
            buildRatios,
            standardDailyProduction
        };
    }

    /**
     * Draws the PPI trend line chart in the modal.
     */
    async function drawPPITrendChart() {
        const svg = d3.select("#ppi-chart-svg");
        svg.selectAll("*").remove();

        // --- 1. Setup ---
        const margin = { top: 20, right: 30, bottom: 40, left: 50 };
        const modalWidth = 500;
        const modalHeight = 280;
        const width = modalWidth - margin.left - margin.right;
        const height = modalHeight - margin.top - margin.bottom;

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Use global tooltip
        const tooltip = createTooltip("ppi-tooltip");

        const errorText = g.append("text")
            .attr("class", "ppi-loading-text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("fill", "var(--failure-color)")
            .style("display", "none")
            .text("Loading...");

        try {
            // --- 2. Load Data ---
            errorText.text("Loading baseline data...").style("display", null);
            let combinedData = await loadCsvBaselineData();
            if (combinedData.length === 0) throw new Error("Failed to load PPI data.");

            combinedData.sort((a, b) => a.date - b.date);
            const finalPpiData = combinedData;
            if (finalPpiData.length === 0) throw new Error("No PPI data available.");
            errorText.style("display", "none");

            // --- 3. Define Scales ---
            const maxDate = d3.max(finalPpiData, d => d.date);
            const domainMaxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
            const x = d3.scaleTime()
                .domain([d3.min(finalPpiData, d => d.date), domainMaxDate])
                .range([0, width]);

            const validValues = finalPpiData.map(d => d.value).filter(v => !isNaN(v));
            const yMin = d3.min(validValues) ?? 0;
            const yMax = d3.max(validValues) ?? 1;
            const yDomainMin = yMin * 0.95;
            const yDomainMax = (yMax === yMin) ? yMax * 1.1 + 1 : yMax * 1.05;
            const y = d3.scaleLinear()
                .domain([yDomainMin, yDomainMax])
                .range([height, 0]);

            const bisectDate = d3.bisector(d => d.date).left;
            const formatDate = d3.timeFormat("%b %Y");

            // --- 4. Draw Axes ---
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

            // --- 5. Draw Line ---
            const line = d3.line()
                .x(d => x(d.date))
                .y(d => y(d.value))
                .defined(d => !isNaN(d.value) && d.value !== null);

            g.append("path")
                .datum(finalPpiData.filter(d => !isNaN(d.value) && d.value !== null))
                .attr("class", "ppi-line")
                .attr("d", line);

            // --- 6. Tooltip Setup ---
            const focus = g.append("g")
                .attr("class", "ppi-focus");

            focus.append("circle")
                .attr("r", 5)
                .attr("class", "ppi-focus-circle");

            g.append("rect")
                .attr("class", "ppi-overlay")
                .attr("width", width)
                .attr("height", height)
                .on("mouseover", () => {
                    focus.style("display", null);
                    tooltip.style("opacity", 1);
                })
                .on("mouseout", () => {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                })
                .on("mousemove", mousemove);

            function mousemove(event) {
                tooltip.style("opacity", 1);
                const pointer = d3.pointer(event, g.node());
                if (!pointer || pointer.length < 1) return;

                const x0 = x.invert(pointer[0]);
                const i = bisectDate(finalPpiData, x0, 1);
                const d0 = finalPpiData[i - 1];
                const d1 = finalPpiData[i];

                if (!d0 || !d1) {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                    return;
                }

                const d = (x0 - d0.date > d1.date - x0) ? d1 : d0;

                if (!d || isNaN(d.value) || d.value === null) {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                    return;
                } else {
                    focus.style("display", null);
                }

                focus.attr("transform", `translate(${x(d.date)},${y(d.value)})`);
                tooltip.html(`<strong>${formatDate(d.date)}</strong><div class="tooltip-row"><span>Price Index:</span> <span>${d.value.toFixed(2)}</span></div>`);
                // Use standard tooltip positioning
                tooltip.style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            }

        } catch (error) {
            console.error("Failed to draw PPI chart:", error);
            errorText.text(`Error: ${error.message}`).style("display", null);
            tooltip.style("opacity", 0);
        }
    }

    /**
     * Draws the main simulation chart (Inventory or Shipments) in the bottom ribbon.
     */
    function drawHoldingCostChart() {
        const svg = d3.select("#holding-cost-chart-svg");
        svg.selectAll("*").remove();

        const metricsPlaceholder = d3.select("#metrics-placeholder-in-demand");
        metricsPlaceholder.html(""); // Clear old metrics

        // Use global tooltip
        const tooltip = createTooltip("holding-cost-tooltip");

        const svgNode = svg.node();
        if (!svgNode) return;
        const svgContainer = svgNode.parentNode;
        if (!svgContainer) return;

        const { width: viewBoxWidth, height: viewBoxHeight } = svgContainer.getBoundingClientRect();

        // --- 1. Handle Loading State ---
        if (isSimulationRunning) {
            metricsPlaceholder.html(`<p class="loading sim-loading-text">Loading...</p>`);
            svg.append("text")
                .attr("x", viewBoxWidth / 2)
                .attr("y", viewBoxHeight / 2)
                .attr("text-anchor", "middle")
                .text("Loading Simulation...");
            return;
        }

        // --- 2. Determine Display State ---
        const isConflictError = simulationError && simulationError.startsWith("Demand Conflict");
        const hasValidResults = simulationResults && Array.isArray(simulationResults) && simulationResults.length > 0;

        // State can be: CONFLICT, NO_RESULTS_OR_GENERAL_ERROR, VALID_RESULTS
        const displayState = isConflictError
            ? "CONFLICT"
            : (!hasValidResults ? "NO_RESULTS_OR_GENERAL_ERROR" : "VALID_RESULTS");

        console.log(`drawHoldingCostChart: Display State = ${displayState}, Conflict Msg Present: ${!!isConflictError}, Valid Results Present: ${hasValidResults}`);

        // --- 3. Setup SVG and Margins ---
        if (viewBoxWidth <= 0 || viewBoxHeight <= 0) {
            console.warn("drawHoldingCostChart skipped: viewBox has no dimensions.", `W: ${viewBoxWidth}`, `H: ${viewBoxHeight}`);
            return;
        }
        const margin = { top: 20, right: 30, bottom: 30, left: 55 };
        const width = viewBoxWidth - margin.left - margin.right;
        const height = viewBoxHeight - margin.top - margin.bottom;

        if (width <= 0 || height <= 0) {
            console.warn("drawHoldingCostChart skipped: chart area has no dimensions.", `W: ${width}`, `H: ${height}`);
            return;
        }

        svg.attr("viewBox", `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        // Formatters
        const formatK = (n) => (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
        const formatInt = d3.format(",.0f");
        const year = new Date().getFullYear();
        const startDate = new Date(Date.UTC(year, 0, 1));
        const endDate = new Date(Date.UTC(year, 11, 31));

        // Helper for axis labels
        const applyAxisLabelStyle = (selection, labelText) => {
            selection.append("text")
                .attr("class", "axis-label")
                .attr("fill", "currentColor")
                .attr("transform", "rotate(-90)")
                .attr("y", -margin.left + 12)
                .attr("x", -height / 2)
                .attr("text-anchor", "middle")
                .style("font-size", "14px")
                .text(labelText);
        };

        // --- 4. Draw Empty Chart (if no results or general error) ---
        if (displayState === "NO_RESULTS_OR_GENERAL_ERROR") {
            console.log("Drawing empty axes.");
            const x = d3.scaleTime().domain([startDate, endDate]).range([0, width]);
            drawMonthAxis(g, x, height);
            const defaultYDomain = [0, 100];

            if (holdingChartMode === 'inventory') {
                const yLeft = d3.scaleLinear().domain(defaultYDomain).range([height, 0]).nice();
                applyAxisLabelStyle(
                    g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatK)),
                    "Inventory On Hand"
                );
                metricsPlaceholder.html(`<div class="summary-row"><span>Avg. Inventory:</span> <strong>-</strong></div> <div class="summary-row total"><span>Holding Costs:</span> <strong>-</strong></div>`);
            } else {
                const yLeftShip = d3.scaleLinear().domain(defaultYDomain).range([height, 0]).nice();
                applyAxisLabelStyle(
                    g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeftShip).tickFormat(formatInt)),
                    "Units Delivered"
                );
                metricsPlaceholder.html("<p class='sim-placeholder-text'>Add a city to run simulation.</p>");
            }

            if (simulationError && !isConflictError) {
                g.append("text").attr("x", width / 2).attr("y", height / 2)
                    .attr("text-anchor", "middle").attr("fill", "var(--failure-color)")
                    .text("Simulation Error");
                metricsPlaceholder.html(`<div class="summary-row error-message"><span class="sim-error-text">Sim Failed</span></div>`);
            }
            return;
        }

        // --- 5. Draw Chart with Valid Results (or Conflict Overlay) ---
        console.log("Drawing chart content using simulationResults.");
        const dailyData = simulationResults.map(d => ({ ...d, dateObj: new Date(d.date + 'T00:00:00Z') }));

        // Calculate metrics
        const avgInventory = d3.mean(dailyData, d => d.inventoryEnd) || 0;
        const totalAnnualHoldingCost = d3.sum(dailyData, d => d.holdingCost);
        const totalExceptionCost = d3.sum(dailyData, d => d.exceptionCost);
        const exceptionsCount = d3.sum(dailyData, d => (d.isExceptionDay || d.isReductionDay) ? 1 : 0);

        // Update metrics panel
        if (holdingChartMode === 'inventory') {
            metricsPlaceholder.append("div").attr('class', 'summary-row')
                .html(`<span>Avg. Inventory:</span><span><strong>${formatInt(avgInventory)}</strong> units</span>`);
            metricsPlaceholder.append("div").attr('class', 'summary-row total')
                .html(`<span>Holding Costs:</span><span><strong>${totalAnnualHoldingCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></span>`);
        } else {
            metricsPlaceholder.append("div").attr('class', 'summary-row')
                .html(`<span>Exceptions:</span><span><strong>${exceptionsCount.toLocaleString()}</strong> days</span>`);
            metricsPlaceholder.append("div").attr('class', 'summary-row total')
                .html(`<span>Exception Cost:</span><span><strong style="color: var(--failure-color);">${totalExceptionCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></span>`);
        }

        const x = d3.scaleTime().domain(d3.extent(dailyData, d => d.dateObj)).range([0, width]);

        if (holdingChartMode === 'inventory') {
            // --- 5a. INVENTORY MODE (Area Chart) ---
            const yMin = d3.min(dailyData, d => d.inventoryEnd) ?? 0;
            const yMax = d3.max(dailyData, d => d.inventoryEnd) ?? 0;
            const yLeft = d3.scaleLinear().domain([Math.min(0, yMin), Math.max(10, yMax * 1.1)]).range([height, 0]).nice();

            drawMonthAxis(g, x, height);
            applyAxisLabelStyle(
                g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatK)),
                "Inventory On Hand"
            );

            const area = d3.area()
                .x(d => x(d.dateObj))
                .y0(yLeft(0))
                .y1(d => yLeft(d.inventoryEnd))
                .curve(d3.curveStepAfter);

            g.append("path").datum(dailyData).attr("class", "holding-cost-area").attr("d", area);

            // Tooltip
            const bisectDate = d3.bisector(d => d.dateObj).left;
            g.append("rect").attr("class", "overlay").attr("width", width).attr("height", height)
                .on("mouseover", () => tooltip.style("opacity", 1))
                .on("mouseout", () => tooltip.style("opacity", 0))
                .on("mousemove", handleInventoryTooltip);

            function handleInventoryTooltip(event) {
                tooltip.style("opacity", 1);
                const pointer = d3.pointer(event, g.node());
                if (!pointer?.[0]) return;

                const date = x.invert(pointer[0]);
                const i = bisectDate(dailyData, date, 1);
                const d0 = dailyData[i - 1];
                const d1 = dailyData[i];
                const d = (d1 && (date - d0.dateObj > d1.dateObj - date)) ? d1 : d0;

                if (!d) return;

                tooltip.html(`<strong>${d.date} (Day ${d.day + 1})</strong><div class="tooltip-row"><span>Inventory:</span> <span>${formatInt(d.inventoryEnd)}</span></div>`);
                // Use standard tooltip positioning
                tooltip.style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            }

        } else {
            // --- 5b. SHIPMENTS MODE (Stacked Bar Chart) ---
            const xBand = d3.scaleBand().domain(d3.range(dailyData.length)).range([0, width]).padding(0.1);
            const bandwidth = xBand.bandwidth();

            const yMax = d3.max(dailyData, d => d.actualShipments) ?? 0;
            const yLeft = d3.scaleLinear().domain([0, Math.max(10, (yMax || 0) * 1.1)]).range([height, 0]).nice();

            drawMonthAxis(g, x, height);
            applyAxisLabelStyle(
                g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatInt)),
                "Units Delivered"
            );

            // Process data for stacking (highlighting selected city)
            const chartData = dailyData.map(d => {
                let selectedQty = 0;
                let unselectedQty = 0;
                (d.actualShipmentDetails || []).forEach(detail => {
                    const qty = Number(detail.qty) || 0;
                    if (detail.city === selectedCityName) {
                        selectedQty += qty;
                    } else {
                        unselectedQty += qty;
                    }
                });
                return { ...d, unselected: unselectedQty, selected: selectedQty, actualShipments: Number(d.actualShipments) || 0 };
            });

            g.selectAll(".exception-bg-bar")
                .data(chartData.filter(d => d.isExceptionDay || d.isReductionDay), d => d.dateObj) // Filter and key
                .join("rect")
                .attr("class", "exception-bg-bar")
                .attr("x", d => x(d.dateObj) - bandwidth / 2) // Use same x and width as bars
                .attr("y", 0) // Top of the chart area
                .attr("width", bandwidth)
                .attr("height", height) // Full height of the chart area
                .attr("fill", "var(--failure-color)")
                .style("opacity", 0.5); // Faint background effect
            const stackKeys = ["unselected", "selected"];
            const stack = d3.stack().keys(stackKeys);
            const stackedData = stack(chartData);
            const color = d3.scaleOrdinal().domain(stackKeys).range(["var(--primary)", "var(--secondary1)"]);

            // Draw stacked bars
            const layers = g.selectAll("g.layer").data(stackedData).join("g")
                .attr("class", d => d.key);

            layers.selectAll("rect")
                .data(d => d)
                .join("rect")
                .attr("x", d => x(d.data.dateObj) - bandwidth / 2)
                .attr("y", d => (isNaN(d[1]) ? yLeft(0) : yLeft(d[1])))
                .attr("height", d => {
                    const y0 = isNaN(d[0]) ? 0 : d[0];
                    const y1 = isNaN(d[1]) ? y0 : d[1];
                    const scaledY0 = yLeft(y0);
                    const scaledY1 = yLeft(y1);
                    return (isNaN(scaledY0) || isNaN(scaledY1)) ? 0 : Math.max(0, scaledY0 - scaledY1);
                })
                .attr("width", bandwidth)
                .attr("fill", function (d) {
                    return color(d3.select(this.parentNode).datum().key);
                })
                .style("cursor", "default");

            // Tooltip
            g.append("rect").attr("class", "overlay").attr("width", width).attr("height", height)
                .style("cursor", "crosshair")
                .on("mouseover", () => tooltip.style("opacity", 1))
                .on("mouseout", () => tooltip.style("opacity", 0))
                .on("mousemove", handleShipmentTooltip);

            function handleShipmentTooltip(event) {
                tooltip.style("opacity", 1);
                const pointer = d3.pointer(event, g.node());
                if (!pointer?.[0]) return;

                const date = x.invert(pointer[0]);
                const index = d3.bisectCenter(dailyData.map(d => d.dateObj), date);
                const d = dailyData[index];
                if (!d) return;

                d3.select(event.currentTarget).style("cursor", "crosshair");
                let detailsHtml = "";

                // Actual Shipments
                if (d.actualShipmentDetails && d.actualShipmentDetails.length > 0) {
                    detailsHtml += `<hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-header">Actual Shipments</div>`;
                    d.actualShipmentDetails.forEach(detail => {
                        const style = (detail.city === selectedCityName) ? "font-weight:bold;color:var(--secondary1);" : "";
                        detailsHtml += `<div class="tooltip-row" style="${style}"><span>${detail.city}:</span> <span>${formatInt(detail.qty || 0)}</span></div>`;
                    });
                }

                // Exception Details
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
                            detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>${d.exceptionCost.toLocaleString('en-US', { style: 'currency', 'currency': 'USD', maximumFractionDigits: 0 })}</span></div>`;
                        }
                    } else if (d.exceptionCost > 0) {
                        detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>${d.exceptionCost.toLocaleString('en-US', { style: 'currency', 'currency': 'USD', maximumFractionDigits: 0 })}</span></div>`;
                    }
                }

                tooltip.html(
                    `<strong>${d.date} (Day ${d.day + 1})</strong>` +
                    `<div class="tooltip-row"><span>Total Shipped:</span> <span>${formatInt(d.actualShipments || 0)}</span></div>` +
                    `${detailsHtml}`
                );
                // Use standard tooltip positioning
                tooltip.style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            }
        }

        // --- 6. Draw Conflict Overlay (if needed) ---
        if (displayState === "CONFLICT") {
            const rawConflictMessage = simulationError || "Unknown Conflict";
            console.log("Adding conflict error overlay to chart.");

            // Faded background
            g.append("rect")
                .attr("class", "error-overlay-bg")
                .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
                .attr("fill", "rgba(255, 255, 255, 0.85)")
                .style("pointer-events", "none");

            // Error message text
            const errorFo = g.append("foreignObject")
                .attr("x", 10).attr("y", 10).attr("width", width - 20).attr("height", height - 20)
                .style("pointer-events", "none");

            errorFo.append("xhtml:div")
                .attr("class", "chart-error-message")
                .html(rawConflictMessage.replace(/\n/g, "<br>")); // Format newlines
        }
    }

    /**
     * Helper function to draw a custom month axis.
     */
    function drawMonthAxis(selection, xScale, chartHeight) {
        const monthStarts = d3.utcMonth.range(xScale.domain()[0], d3.utcDay.offset(xScale.domain()[1], 1));

        // Draw the main axis line with ticks
        const xAxis = d3.axisBottom(xScale)
            .tickValues(monthStarts)
            .tickFormat("")
            .tickSizeOuter(0);

        const axisGroup = selection.append("g")
            .attr("class", "axis x-axis")
            .attr("transform", `translate(0,${chartHeight})`)
            .call(xAxis);

        // Add centered month labels (e.g., "Jan", "Feb")
        axisGroup.selectAll(".month-label")
            .data(monthStarts)
            .enter().append("text")
            .attr("class", "month-label axis-label")
            .attr("x", d => {
                const nextMonth = d3.utcMonth.offset(d, 1);
                const endPos = xScale(nextMonth < xScale.domain()[1] ? nextMonth : xScale.domain()[1]);
                const startPos = xScale(d);
                return (startPos + endPos) / 2; // Center label in the month
            })
            .attr("y", 15) // Position below the axis line
            .attr("text-anchor", "middle")
            .attr("fill", "currentColor")
            .style("font-size", "12px")
            .text(d3.utcFormat("%b"));
    }

    // REMOVED local positionTooltip function - use global pattern

    // -------------------------------------------------------------------------
    // Map Initialization & Update Functions
    // -------------------------------------------------------------------------

    /**
     * Initializes the D3 map, projection, and static elements.
     * Runs only once when the `draw` function is first called.
     */
    const initializeMap = (svg, width, height) => {
        if (mapInitialized) return;
        console.log("Initializing map...");

        layoutManager.update(width, height, isBottomRibbonOpen);

        // --- 1. Setup Projection and Defs ---
        projection = d3.geoAlbersUsa();
        path = d3.geoPath().projection(projection);

        const defs = svg.append("defs");

        // Arrowhead marker for connection lines
        defs.append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 5)
            .attr("refY", 0)
            .attr("markerWidth", 4)
            .attr("markerHeight", 4)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("class", "arrowhead");

        // --- 2. Setup Map Layers (Groups) ---
        // Order matters for z-index
        const mainMapGroup = svg.append("g").attr("class", "main-map-group");

        mainMapGroup.append("g")
            .attr("class", "us-map")
            .on("click", () => {
                // Click on map deselects city
                d3.select(".city-info-box").style("display", "none");
                if (selectedCityName !== null) {
                    selectedCityName = null;
                    updateCityMarkers();
                    if (isBottomRibbonOpen) drawHoldingCostChart();
                }
            });

        mainMapGroup.append("g").attr("class", "connection-lines");
        mainMapGroup.append("g").attr("class", "optimal-factory-container");
        mainMapGroup.append("g").attr("class", "city-markers");

        // --- 3. Load GeoJSON and Draw States ---
        d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
            // Filter out AK (02) and HI (15)
            continentalStatesFeatures = topojson.feature(us, us.objects.states)
                .features.filter(d => d.id !== '02' && d.id !== '15');

            mainMapGroup.select(".us-map").selectAll("path")
                .data(continentalStatesFeatures)
                .enter().append("path")
                .attr("d", path)
                .attr("class", "state-boundary");

            mapInitialized = true;
            updateDynamicMapElements(); // Fit map to size
            runOptimization();
        }).catch(error => {
            console.error("Error loading map topology:", error);
            mapInitialized = false;
        });
    };

    /**
     * Updates all responsive map elements and UI panels based on new dimensions.
     * Called on window resize and on ribbon toggle.
     */
    const updateDynamicMapElements = () => {
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) {
            console.error("updateDynamicMapElements: #svg-container not found!");
            return;
        }

        const { width, height } = svgContainer.getBoundingClientRect();
        if (width <= 0 || height <= 0) {
            console.warn(`updateDynamicMapElements skipped: Invalid dimensions W: ${width}, H: ${height}.`);
            return;
        }

        console.log(`updateDynamicMapElements: Using dimensions W: ${width.toFixed(0)}, H: ${height.toFixed(0)}`);
        const svg = d3.select("#location-panel");
        layoutManager.update(width, height, isBottomRibbonOpen); // Update layout manager

        // --- 1. Update UI Panel Positions ---
        svg.select(".bottom-ribbon-bar")
            .attr("x", layoutManager.getRibbonRect().x)
            .attr("y", layoutManager.getRibbonRect().y)
            .attr("width", layoutManager.getRibbonRect().width)
            .attr("height", layoutManager.getRibbonRect().height);

        svg.select(".location-controls-wrapper")
            .attr("x", layoutManager.getControlsRect().x)
            .attr("y", layoutManager.getControlsRect().y)
            .attr("width", layoutManager.getControlsRect().width)
            .attr("height", layoutManager.getControlsRect().height);

        svg.select(".summary-panel-wrapper")
            .attr("x", layoutManager.getSummaryRect().x)
            .attr("y", layoutManager.getSummaryRect().y)
            .attr("width", layoutManager.getSummaryRect().width)
            .attr("height", layoutManager.getSummaryRect().height);

        svg.select("#ppi-chart-modal")
            .attr("x", layoutManager.getModalRect().x)
            .attr("y", layoutManager.getModalRect().y)
            .attr("width", layoutManager.getModalRect().width)
            .attr("height", layoutManager.getModalRect().height);

        // --- 2. Update Map Projection ---
        if (mapInitialized && continentalStatesFeatures && projection && path) {
            const mapBounds = layoutManager.getMapBounds();
            console.log(`updateDynamicMapElements: Fitting map to [${mapBounds.width.toFixed(0)}, ${mapBounds.height.toFixed(0)}] at y=${mapBounds.y.toFixed(0)}`);

            if (mapBounds.width > 0 && mapBounds.height > 0) {
                // Fit projection to the available map area
                projection.fitSize([mapBounds.width, mapBounds.height], { type: "FeatureCollection", features: continentalStatesFeatures });

                // Adjust vertical translation to account for top panels
                const currentTranslate = projection.translate();
                projection.translate([currentTranslate[0], currentTranslate[1] + mapBounds.y]);

                path.projection(projection);

                // --- 3. Redraw/Update Map Elements ---
                d3.select(".us-map").selectAll("path").attr("d", path);

                // Update radius scale (domain might change, but range is fixed)
                radiusScale = d3.scaleSqrt().domain([100, 100000]).range([4, 25]).clamp(true);

                updateCityMarkers();
                updateOptimalFactoryMarker();
                updateConnectionLines();

                // Redraw simulation chart if ribbon is open
                if (isBottomRibbonOpen) {
                    drawHoldingCostChart();
                }

            } else {
                console.warn("updateDynamicMapElements skipped map update: mapBounds have zero dimensions.");
            }

        } else {
            console.warn("updateDynamicMapElements skipped map update: Map not ready.");
        }
    };

    /**
     * Main entry point. Draws the entire Location tab UI, initializes the map,
     * and sets up the simulation worker.
     */
    const draw = () => {
        // --- 0. Pre-flight Checks ---
        const locationPanelElement = document.getElementById("location-panel");
        if (!locationPanelElement) {
            console.error("CRITICAL ERROR: SVG element #location-panel not found.");
            const container = document.getElementById('svg-container');
            if (container) container.innerHTML = '<p style="color:red; padding:20px; text-align:center;">Error loading Location tab: Missing required SVG element (#location-panel).</p>';
            return;
        }

        const svg = d3.select(locationPanelElement);
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) {
            console.error("Container not found.");
            return;
        }

        const { width, height } = svgContainer.getBoundingClientRect();
        if (width === 0 || height === 0) {
            console.warn("LocationTab.draw: SVG container has zero dimensions. Skipping draw.");
            return;
        }

        layoutManager.update(width, height, isBottomRibbonOpen); // Update layout manager FIRST

        // --- 1. Initialize Map (if first time) ---
        if (!mapInitialized) {
            svg.selectAll("*").remove(); // Clear any previous state
            d3.select("body").selectAll(".d3-tooltip").remove(); // Clear old tooltips
            initializeMap(svg, width, height); // Pass dimensions
        }

        // --- 2. Initialize Simulation Worker (if first time) ---
        if (!simulationWorker) {
            try {
                simulationWorker = new Worker('simulation.worker.js');

                // --- 2a. Worker Message Handler ---
                simulationWorker.onmessage = (e) => {
                    const { type, results, message } = e.data;
                    console.log("Main received:", type, (isValidationRun ? "(Validation)" : ""));
                    isSimulationRunning = false;

                    if (type === 'complete') {
                        if (!isValidationRun) {
                            // Store results for non-validation runs
                            simulationResults = results;
                            simulationError = null;
                            console.log("onmessage: Success - Stored new results.");
                        }
                        if (simulationPromiseResolve) simulationPromiseResolve(results);

                    } else if (type === 'error') {
                        const isConflictError = message && message.startsWith("Demand Conflict");
                        if (!isValidationRun) {
                            simulationError = message || "Worker error";
                            console.error("Worker Error:", simulationError);

                            if (!isConflictError) {
                                // Clear results on a general error
                                simulationResults = null;
                                console.log("onmessage: Non-conflict error - Cleared simulationResults.");
                            } else {
                                // On conflict, keep old results to show chart + overlay
                                console.log("onmessage: Conflict error - PRESERVING current simulationResults state.");
                            }
                        }
                        if (simulationPromiseReject) simulationPromiseReject(new Error(message || "Worker error"));
                    }

                    // Clean up promises
                    simulationPromiseResolve = null;
                    simulationPromiseReject = null;

                    // Redraw chart with new state (results or error)
                    if (isBottomRibbonOpen) drawHoldingCostChart();
                };

                // --- 2b. Worker Error Handler ---
                simulationWorker.onerror = (err) => {
                    console.error("Worker onerror:", err);
                    isSimulationRunning = false;
                    const errorMessage = `Worker error: ${err.message}.`;

                    if (!isValidationRun) {
                        simulationError = errorMessage;
                        simulationResults = null;
                    }
                    if (simulationPromiseReject) {
                        simulationPromiseReject(new Error(errorMessage));
                    }

                    simulationPromiseResolve = null;
                    simulationPromiseReject = null;
                    isValidationRun = false;

                    if (isBottomRibbonOpen) drawHoldingCostChart();
                };

            } catch (err) {
                console.error("Failed init worker:", err);
                simulationError = "Could not create worker.";
                if (simulationPromiseReject) simulationPromiseReject(new Error(simulationError));
                simulationPromiseResolve = null;
                simulationPromiseReject = null;
                isValidationRun = false;
                if (isBottomRibbonOpen) drawHoldingCostChart();
            }
        }

        // --- 3. Draw UI Panels (using <foreignObject>) ---
        svg.selectAll("foreignObject").remove(); // Clear old UI

        // --- 3a. Top-Left Controls (Add City) ---
        const controlsRect = layoutManager.getControlsRect();
        const controls = svg.append("foreignObject")
            .attr("class", "location-controls-wrapper")
            .attr("x", controlsRect.x)
            .attr("y", controlsRect.y)
            .attr("width", controlsRect.width)
            .attr("height", controlsRect.height);

        const controlsDiv = controls.append("xhtml:div").attr("class", "location-controls");

        const cityGroup = controlsDiv.append("div").attr("class", "input-group");
        cityGroup.append("label").text("Shipping Hub: City");
        const citySelect = cityGroup.append("select").attr("id", "city-select");
        if (typeof majorCities !== 'undefined') {
            Object.keys(majorCities).sort().forEach(city => citySelect.append("option").attr("value", city).text(city));
        } else {
            console.error("majorCities data is missing.");
        }

        const demandGroup = controlsDiv.append("div").attr("class", "input-group");
        demandGroup.append("label").text("Ship Qty");
        demandGroup.append("div").attr("class", "input-with-unit")
            .append("input").attr("type", "number").attr("id", "shipment-qty").attr("value", "200").attr("min", "1");

        const freqGroup = controlsDiv.append("div").attr("class", "input-group");
        freqGroup.append("label").text("Freq (Days)");
        freqGroup.append("div").attr("class", "input-with-unit")
            .append("input").attr("type", "number").attr("id", "shipment-freq").attr("value", "7").attr("min", "1");

        controlsDiv.append("button").attr("class", "loc-control-btn").text("Add City")
            .on("click", addCity);
        controlsDiv.append("button").attr("class", "loc-control-btn remove-all-btn").text("Remove All")
            .on("click", removeAllCities);

        // --- 3b. City Info Box (hidden by default) ---
        const infoBox = svg.append("foreignObject")
            .attr("width", 200).attr("height", 120)
            .attr("class", "city-info-box")
            .style("display", "none"); // Hidden

        const infoDiv = infoBox.append("xhtml:div");
        infoDiv.append("h4").attr("id", "info-header");
        infoDiv.append("p").attr("id", "info-demand");
        infoDiv.append("p").attr("id", "info-annual-cost");
        infoDiv.append("button").text("Remove City").attr("id", "info-remove-btn")
            .on("click", function () {
                const cityToRemove = d3.select(this).attr("data-city-name");
                removeCity(cityToRemove);
            });

        // --- 3c. Top-Right Summary Panel ---
        const summaryRect = layoutManager.getSummaryRect();
        const summaryPanel = svg.append("foreignObject")
            .attr("class", "summary-panel-wrapper")
            .attr("x", summaryRect.x)
            .attr("y", summaryRect.y)
            .attr("width", summaryRect.width)
            .attr("height", summaryRect.height);

        const summaryDiv = summaryPanel.append("xhtml:div").attr("class", "summary-panel");

        const switchGroup = summaryDiv.append("div").attr("class", "inv-button-group");
        switchGroup.append("button").attr("id", "loc-new-btn").text("New")
            .classed('active', optimizationMode === 'New')
            .on('click', () => {
                if (optimizationMode !== 'New') {
                    optimizationMode = 'New';
                    d3.select("#loc-new-btn").classed('active', true);
                    d3.select("#loc-existing-btn").classed('active', false);
                    runOptimization();
                }
            });
        switchGroup.append("button").attr("id", "loc-existing-btn").text("Existing")
            .classed('active', optimizationMode === 'Existing')
            .on('click', () => {
                if (optimizationMode !== 'Existing') {
                    optimizationMode = 'Existing';
                    d3.select("#loc-new-btn").classed('active', false);
                    d3.select("#loc-existing-btn").classed('active', true);
                    runOptimization();
                }
            });

        summaryDiv.append("h4").text("Optimal Summary");
        summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Location:</span><span id="summary-location">N/A</span>`);
        summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Ship Cost:</span><span id="summary-ship-cost">$0</span>`);
        summaryDiv.append("div").attr('class', 'summary-row').html(`<span># Shipments:</span><span id="summary-shipments">0</span>`);
        summaryDiv.append("div").attr('class', 'summary-row summary-total').html(`<span>Total Cost:</span><span id="summary-total-cost">$0</span>`);
        summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Avg Cost/U:</span><span id="summary-avg-cost">$0.00</span>`);

        // --- 3d. PPI Chart Modal (hidden by default) ---
        const modalRect = layoutManager.getModalRect();
        const ppiModal = svg.append("foreignObject")
            .attr("id", "ppi-chart-modal")
            .attr("x", modalRect.x)
            .attr("y", modalRect.y)
            .attr("width", modalRect.width)
            .attr("height", modalRect.height)
            .style("display", "none"); // Hidden

        const ppiModalDiv = ppiModal.append("xhtml:div").attr("class", "modal-content ppi-modal-content");
        ppiModalDiv.append("button").attr("class", "close-btn").html("&times;")
            .on("click", () => d3.select("#ppi-chart-modal").style("display", "none"));
        ppiModalDiv.append("h4").text("PPI: General Freight Trucking");
        ppiModalDiv.append("svg").attr("id", "ppi-chart-svg")
            .attr("viewBox", `0 0 500 280`) // Fixed viewBox for modal content
            .attr("preserveAspectRatio", "xMidYMid meet");

        // --- 3e. Bottom Ribbon ---
        const ribbonRect = layoutManager.getRibbonRect();
        const ribbon = svg.append("foreignObject")
            .attr("class", "bottom-ribbon-bar")
            .attr("x", ribbonRect.x)
            .attr("y", ribbonRect.y)
            .attr("width", ribbonRect.width)
            .attr("height", ribbonRect.height);

        const ribbonDiv = ribbon.append("xhtml:div").attr("class", "bottom-ribbon-container");

        // Ribbon Header (clickable)
        const ribbonHeader = ribbonDiv.append("div").attr("class", "bottom-ribbon-header")
            .on("click", toggleBottomRibbon);
        ribbonHeader.append("div").attr("class", "bottom-ribbon-header-title")
            .html(`Simulation: <strong>${holdingChartMode === 'inventory' ? 'Inventory' : 'Shipments'}</strong>`);
        ribbonHeader.append("div").attr("class", "bottom-ribbon-header-arrow")
            .html(isBottomRibbonOpen ? '▼' : '▲');

        // Ribbon Content (collapsible)
        const ribbonContent = ribbonDiv.append("div").attr("class", "bottom-ribbon-content")
            .style("display", isBottomRibbonOpen ? "flex" : "none");

        // Ribbon Content: Left Panel (Cost Inputs)
        const costInputDiv = ribbonContent.append("div").attr("class", "ribbon-cost-inputs");
        costInputDiv.append("h4").text("Cost Inputs");

        const holdingGroup = costInputDiv.append("div").attr("class", "user-input-row");
        const holdingLabel = holdingGroup.append("label").attr("for", "loc-holding-cost-input").text("Annual Hold Cost (%)");
        holdingGroup.append("input").attr("type", "number").attr("id", "loc-holding-cost-input").attr("value", 25).attr("step", "0.1")
            .on("change", () => {
                runOptimization(); // Recalculate summary
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after cost change:", e)); // Rerun sim
            })
            .on("input", function () {
                d3.select(this).attr("data-user-modified", "true"); // Mark as user-set
            });

        // Use global tooltip
        const breakdownTooltip = createTooltip('holding-cost-breakdown-tooltip');
        holdingLabel.on("mouseover", (event) => {
            const input = d3.select("#loc-holding-cost-input");
            const breakdown = {
                c: input.attr("data-breakdown-capital") || 0,
                s: input.attr("data-breakdown-storage") || 0,
                v: input.attr("data-breakdown-service") || 0,
                r: input.attr("data-breakdown-risk") || 0,
                t: input.attr("data-estimated-total") || 0
            };
            breakdownTooltip.style("opacity", 1).html(
                `Est. Breakdown:<br>Capital: ${breakdown.c}%<br>Storage: ${breakdown.s}%<br>Administative: ${breakdown.v}%<br>Risk: ${breakdown.r}%<hr>Total: ${breakdown.t}%`
            );
        })
            .on("mousemove", (event) => breakdownTooltip
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px")
            )
            .on("mouseout", () => breakdownTooltip.style("opacity", 0));


        const ppiGroup = costInputDiv.append("div").attr("class", "user-input-row");
        ppiGroup.append("label").attr("for", "loc-ppi-input").text("Producer Price Index");
        ppiGroup.append("input").attr("type", "number").attr("id", "loc-ppi-input").attr("value", PPI).attr("step", "0.1")
            .on("change", function () {
                PPI = +this.value;
                runOptimization(); // PPI changes shipping costs
            });

        const buttonGroup = costInputDiv.append("div").attr("class", "user-input-buttons");
        buttonGroup.append("button").attr("class", "loc-control-btn").attr("id", "show-ppi-chart-btn").text("What is my PPI?")
            .on("click", () => {
                d3.select("#ppi-chart-modal").style("display", "block");
                drawPPITrendChart();
            });

        const simSwitchGroup = costInputDiv.append("div").attr("class", "inv-button-group sim-chart-switch");
        simSwitchGroup.append("button").attr("id", "sim-inv-btn").text("Inventory")
            .classed('active', holdingChartMode === 'inventory')
            .on('click', () => {
                holdingChartMode = 'inventory';
                updateHoldingChartMode();
            });
        simSwitchGroup.append("button").attr("id", "sim-ship-btn").text("Shipments")
            .classed('active', holdingChartMode === 'shipments')
            .on('click', () => {
                holdingChartMode = 'shipments';
                updateHoldingChartMode();
            });

        // Ribbon Content: Center Panel (Chart)
        const chartAreaDiv = ribbonContent.append("div").attr("class", "ribbon-chart-area");
        chartAreaDiv.append("div").attr("id", "holding-cost-svg-container")
            .append("svg").attr("id", "holding-cost-chart-svg");

        // Ribbon Content: Right Panel (Demand)
        const demandDiv = ribbonContent.append("div").attr("class", "ribbon-demand-panel");
        demandDiv.append("div").attr("id", "metrics-placeholder-in-demand"); // For sim metrics
        demandDiv.append("h4").text("Annual Demand");
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P10:</span><span id="demand-p10">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P50:</span><span id="demand-p50">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P90:</span><span id="demand-p90">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>Allocated:</span><span id="demand-allocated">0</span>`);
        demandDiv.append("div").attr("class", "demand-bar-container")
            .append("div").attr("class", "demand-bar").attr("id", "demand-bar-fill").text("0%");

        // --- 4. Define Nested Helper Functions ---

        /**
         * Adds a city to the map from the control panel inputs.
         */
        function addCity() {
            const name = d3.select("#city-select").property("value");
            const qty = parseFloat(d3.select("#shipment-qty").property("value"));
            const freq = parseFloat(d3.select("#shipment-freq").property("value"));

            if (name && qty > 0 && freq > 0) {
                if (typeof majorCities === 'undefined' || !majorCities[name]) {
                    console.error(`Coordinates for "${name}" not found.`);
                    alert(`Error: Data missing for city "${name}".`);
                    return;
                }

                // Calculate annual demand based on working days from the forecast
                const annualDemand = (qty / freq) * 365.2425;

                cityData.set(name, {
                    name,
                    coordinates: majorCities[name],
                    annualDemand,
                    qty,
                    freq
                });

                // Update everything
                updateCityMarkers();
                runOptimization();
                updateDemandCapacityBox();
                refreshHoldingCost();
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after adding city:", e));
            } else {
                console.warn("Invalid city/qty/freq.");
            }
        }

        // --- 5. Initial Data Fetch and UI Updates ---
        fetchDemandData();
        refreshHoldingCost();
        updateDemandCapacityBox();
        updateSummaryPanel();

        // Update map elements only if initialized (prevents errors on first load)
        if (mapInitialized) {
            updateDynamicMapElements();
            runOptimization(); // Rerun opt after potentially getting dimensions
        }

        // Redraw simulation chart if ribbon is open
        if (isBottomRibbonOpen) {
            setTimeout(drawHoldingCostChart, 50); // Draw chart just after UI renders
        }
    };

    // -------------------------------------------------------------------------
    // Data & UI Update Functions
    // -------------------------------------------------------------------------

    /**
     * Fetches demand forecast data from the DOM (set by another tab).
     */
    function fetchDemandData() {
        // Get elements from the "Investment" tab
        const p50Display = document.getElementById('inv-p50Demand');
        const p10Input = document.getElementById('inv-p10Demand');
        const p90Input = document.getElementById('inv-p90Demand');
        const workingDaysInput = document.getElementById('inv-workingDays');

        let p10 = 0, p50 = 0, p90 = 0, workingDaysList = [], workingDaysCount = 250;

        if (p50Display && p10Input && p90Input && workingDaysInput) {
            // Use data from the Investment tab
            p10 = parseFloat(p10Input.value.replace(/,/g, '')) || 0;
            p50 = parseFloat(p50Display.textContent.replace(/,/g, '')) || 0;
            p90 = parseFloat(p90Input.value.replace(/,/g, '')) || 0;
            workingDaysCount = parseFloat(workingDaysInput.value || 250);
            try {
                workingDaysList = JSON.parse(workingDaysInput.dataset.workingDaysList || '[]');
            } catch (e) {
                workingDaysList = [];
                console.error("Error parsing WD list:", e);
            }
        } else {
            // Fallback if elements aren't ready (should not happen in prod)
            console.warn("Using estimated demand. Investment tab elements not found.");
            const daily = parseFloat(document.getElementById('dailyDemand')?.value || 180);
            workingDaysCount = 250;
            const std = 6750;
            p50 = daily * workingDaysCount;
            const halfWidth = 1.28155 * std; // p90
            p90 = p50 + halfWidth;
            p10 = Math.max(0, p50 - halfWidth);

            // Generate default working days list
            const year = new Date().getFullYear();
            const date = new Date(year, 0, 1);
            while (date.getFullYear() === year) {
                const day = date.getDay();
                if (day > 0 && day < 6) workingDaysList.push(date.toISOString().split('T')[0]);
                date.setDate(date.getDate() + 1);
            }
        }

        totalDemandCapacity = { p10, p50, p90, workingDays: workingDaysList };
        updateDemandCapacityBox();
    }

    /**
     * Updates the "Annual Demand" panel in the bottom ribbon.
     */
    function updateDemandCapacityBox() {
        if (!totalDemandCapacity) return;

        const allocated = Array.from(cityData.values()).reduce((sum, city) => sum + city.annualDemand, 0);
        const formatNumber = (num) => isFinite(num) ? Math.round(num).toLocaleString() : 'N/A';
        const isOver = (val) => isFinite(val) && val > 0 && allocated > val;

        // Highlight if allocated > forecast
        d3.select("#demand-p10").text(formatNumber(totalDemandCapacity.p10))
            .style("font-weight", isOver(totalDemandCapacity.p10) ? "bold" : null)
            .style("color", isOver(totalDemandCapacity.p10) ? "var(--failure-color)" : null);

        d3.select("#demand-p50").text(formatNumber(totalDemandCapacity.p50))
            .style("font-weight", isOver(totalDemandCapacity.p50) ? "bold" : null)
            .style("color", isOver(totalDemandCapacity.p50) ? "var(--failure-color)" : null);

        d3.select("#demand-p90").text(formatNumber(totalDemandCapacity.p90))
            .style("font-weight", isOver(totalDemandCapacity.p90) ? "bold" : null)
            .style("color", isOver(totalDemandCapacity.p90) ? "var(--failure-color)" : null);

        d3.select("#demand-allocated").text(formatNumber(allocated));

        // Update progress bar
        const percent = (totalDemandCapacity.p50 > 0 && isFinite(totalDemandCapacity.p50))
            ? Math.max(0, (allocated / totalDemandCapacity.p50) * 100)
            : 0;

        const bar = d3.select("#demand-bar-fill");
        bar.style("width", `${Math.min(percent, 100)}%`)
            .text(`${Math.round(percent)}%`);

        // Bar turns red if over 100%
        bar.style("background-color", percent > 100 ? "var(--failure-color)" : "var(--primary)");
    }

    /**
     * Updates the "Optimal Summary" panel.
     * Combines shipping costs from optimization and holding/exception costs from simulation.
     */
    function updateSummaryPanel() {
        let shipmentCost = 0;
        let totalShipments = 0;
        let totalAllocatedDemand = 0;
        const cities = Array.from(cityData.values());
        let locationText = "N/A";

        if (optimalFactoryLocation && cities.length > 0) {
            // Calculate total shipping cost
            shipmentCost = calculateTotalCost(optimalFactoryLocation, cities);

            // Calculate total number of truckloads per year
            totalShipments = cities.reduce((sum, city) => {
                const shipmentsPerYear = 365.2425 / Math.max(1, city.freq);
                const details = getShipmentDetails(optimalFactoryLocation, city);
                const trucksPerShipment = details ? details.numFTL + (details.remainderChoice === 'FTL' ? 1 : (details.remainderChoice === 'LTL' ? 1 : 0)) : 0;
                return sum + (shipmentsPerYear * trucksPerShipment);
            }, 0);

            totalAllocatedDemand = cities.reduce((sum, city) => sum + city.annualDemand, 0);

            // Get location name
            const lat = optimalFactoryLocation[1].toFixed(3);
            const lon = optimalFactoryLocation[0].toFixed(3);
            // Check if location is an existing city
            const closestCity = cities.find(c => c.coordinates && optimalFactoryLocation &&
                c.coordinates[0] === optimalFactoryLocation[0] &&
                c.coordinates[1] === optimalFactoryLocation[1]);

            locationText = closestCity ? closestCity.name : `${lat}°N, ${Math.abs(lon)}°W`;
        }

        // Get costs from simulation
        let holdingCost = 0;
        let exceptionCost = 0;
        if (simulationResults) {
            holdingCost = d3.sum(simulationResults, d => d.holdingCost);
            exceptionCost = d3.sum(simulationResults, d => d.exceptionCost);
        }

        const totalCombinedCost = shipmentCost + holdingCost + exceptionCost;
        const avgCostPerUnit = totalAllocatedDemand > 0 ? totalCombinedCost / totalAllocatedDemand : 0;

        // Formatters
        const formatCurrency = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const formatCurrencySmall = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        // Update DOM
        d3.select("#summary-location").text(locationText);
        d3.select("#summary-ship-cost").text(formatCurrency(shipmentCost));
        d3.select("#summary-shipments").text(Math.round(totalShipments).toLocaleString());
        d3.select("#summary-total-cost").text(formatCurrency(totalCombinedCost));
        d3.select("#summary-avg-cost").text(formatCurrencySmall(avgCostPerUnit));
    }

    // REMOVED local createTooltip function - uses global one

    /**
     * Updates the optimal factory marker (the star) on the map.
     */
    function updateOptimalFactoryMarker() {
        if (!projection || !mapInitialized) return;

        const container = d3.select(".optimal-factory-container");
        // Use global tooltip
        const tooltip = createTooltip('factory-tooltip');
        const data = optimalFactoryLocation ? [optimalFactoryLocation] : [];

        // D3 data join
        const marker = container.selectAll(".optimal-factory-marker")
            .data(data);

        // Exit
        marker.exit()
            .transition().duration(300)
            .style("opacity", 0)
            .remove();

        // Enter + Merge
        marker.enter().append("path")
            .attr("class", "optimal-factory-marker")
            .attr("d", d3.symbol(d3.symbolStar, 400)) // 400px area
            .style("opacity", 0)
            .merge(marker)
            .on("mouseover", (event, d) => {
                const lat = d[1].toFixed(3);
                const lon = d[0].toFixed(3);
                tooltip.style("opacity", 1).html(`Optimal Location:<br>${lat}°N, ${Math.abs(lon)}°W`);
            })
            .on("mousemove", (event) => tooltip // Use standard positioning
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px")
            )
            .on("mouseout", () => tooltip.style("opacity", 0))
            .transition().duration(500)
            .attr("transform", d => `translate(${projection(d)})`)
            .style("opacity", 1);
    }

    /**
     * Updates the city markers (circles) on the map.
     */
    function updateCityMarkers() {
        if (!projection || !mapInitialized || !radiusScale) return;

        // Use global tooltip
        const tooltip = createTooltip('city-calc-tooltip');
        const infoBox = d3.select(".city-info-box");

        // D3 data join
        const markers = d3.select(".city-markers").selectAll(".city-marker")
            .data(Array.from(cityData.values()), d => d.name); // Keyed by name

        // Exit
        markers.exit()
            .transition().duration(300)
            .attr("r", 0)
            .remove();

        // Enter + Merge
        markers.enter().append("circle")
            .attr("class", "city-marker")
            .attr("r", 0) // Start at 0 radius
            .attr("transform", d => `translate(${projection(d.coordinates)})`) // Initial position
            .merge(markers)
            .on("mouseover", (event, d) => {
                // --- MOUSEOVER TOOLTIP LOGIC ---
                const details = getShipmentDetails(optimalFactoryLocation, d);
                const costFormat = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 };

                if (!details || !optimalFactoryLocation) {
                    tooltip.style("opacity", 1)
                        .html(`<strong>${d.name}</strong><br>Calculating...`);
                    // Use standard positioning
                    tooltip.style("left", (event.pageX + 15) + "px")
                        .style("top", (event.pageY - 28) + "px");
                    return;
                }

                const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d);
                const avgCostPerUnit = d.annualDemand > 0 ? (annualCost / d.annualDemand) : 0;
                let shipmentDetailsHtml = "";

                // Build shipment details HTML
                if (details.remainderChoice === 'Local') {
                    shipmentDetailsHtml = `<div class="tooltip-row"><span>Shipment:</span> <span>Local (No Cost)</span></div>`;
                } else if (details.remainderChoice === 'LTL') {
                    shipmentDetailsHtml = `<div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${details.numFTL}</span></div>` +
                        `<div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${details.costFTL.toLocaleString('en-US', costFormat)}</span></div>` +
                        `<hr style='margin: 2px 0; border-top-color: #555;'>` +
                        `<div class="tooltip-row"><span>LTL Weight/Ship:</span> <span>${details.remainderTons.toFixed(2)} tons</span></div>` +
                        `<div class="tooltip-row"><span>LTL Cost/Ship:</span> <span>${details.costRemainder.toLocaleString('en-US', costFormat)}</span></div>`;
                } else { // FTL or FTL for remainder
                    const totalFTL = details.numFTL + (details.remainderChoice === 'FTL' ? 1 : 0);
                    const totalFTLCost = details.costFTL + (details.remainderChoice === 'FTL' ? details.costRemainder : 0);
                    shipmentDetailsHtml = `<div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${totalFTL}</span></div>` +
                        `<div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${totalFTLCost.toLocaleString('en-US', costFormat)}</span></div>`;

                    if (details.remainderUnits > 0 && details.remainderChoice !== 'FTL' && details.remainderChoice !== 'LTL' && details.remainderChoice !== 'Local') {
                        shipmentDetailsHtml += `<div class="tooltip-row" style="color: yellow;"><span>Warning:</span> <span>Remainder (${details.remainderUnits}u) cost error? Choice: ${details.remainderChoice}</span></div>`;
                    }
                }

                // Set final tooltip HTML
                tooltip.style("opacity", 1).html(
                    `<div class="tooltip-header">${d.name} Details</div>` +
                    `<div class="tooltip-row"><span>Est. Road Dist:</span> <span>${details.roadDistance.toFixed(0)} mi</span></div>` +
                    `<hr style='margin: 2px 0; border-top-color: #555;'>` +
                    `${shipmentDetailsHtml}` +
                    `<hr style='margin: 2px 0; border-top-color: #555;'>` +
                    `<div class="tooltip-row"><span>Annual Qty:</span> <span>${Math.round(d.annualDemand).toLocaleString()}</span></div>` +
                    `<div class="tooltip-row"><span>Annual Cost:</span> <span>${annualCost.toLocaleString('en-US', costFormat)}</span></div>` +
                    `<div class="tooltip-row"><span>Avg Cost/Unit:</span> <span>${avgCostPerUnit.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span></div>`
                );
            })
            .on("mousemove", (event) => tooltip // Use standard positioning
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px")
            )
            .on("mouseout", () => tooltip.style("opacity", 0))
            .on("click", (event, d) => {
                // --- CLICK HANDLER (INFO BOX) ---
                event.stopPropagation(); // Prevent map click from firing

                // Toggle selection
                if (selectedCityName === d.name) {
                    selectedCityName = null;
                } else {
                    selectedCityName = d.name;
                }
                updateCityMarkers(); // Redraw to show selection highlight
                if (isBottomRibbonOpen) drawHoldingCostChart(); // Redraw chart to highlight city

                if (!projection) return;
                const projectedCoords = projection(d.coordinates);
                if (!projectedCoords) return;

                // --- 1. Populate Info Box ---
                const [x, y] = projectedCoords;
                const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d);

                infoBox.select("#info-header").text(d.name);
                infoBox.select("#info-demand").text(`Demand: ${d.qty} u / ${d.freq} days`);
                infoBox.select("#info-annual-cost").text(`Annual Cost: ${annualCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`);
                infoBox.select("#info-remove-btn").attr("data-city-name", d.name);

                // --- 2. Position Info Box ---
                const mainAreaRect = layoutManager.getMainAreaRect();
                let infoX = x + 15;
                let infoY = y - 15;
                const infoBoxWidth = 200;
                const infoBoxHeight = 120;

                // Keep it on screen
                if (infoX + infoBoxWidth > mainAreaRect.width) infoX = x - infoBoxWidth - 15;
                if (infoY < 0) infoY = y + 15;
                if (infoY + infoBoxHeight > mainAreaRect.height) {
                    infoY = y - infoBoxHeight - 15;
                }

                infoBox.attr("x", infoX)
                    .attr("y", infoY)
                    .style("display", "block");
            })
            .on("contextmenu", (event, d) => {
                event.preventDefault(); // Prevent right-click menu
                removeCity(d.name);
            })
            .style("fill", d => (d.name === selectedCityName) ? "var(--secondary1)" : "var(--secondary2)") // Highlight selected
            .transition().duration(500)
            .attr("r", d => radiusScale(d.annualDemand)) // Animate to size
            .attr("transform", d => `translate(${projection(d.coordinates)})`); // Update position
    }

    /**
     * Removes a single city from the map and recalculates.
     */
    function removeCity(cityName) {
        if (cityName && cityData.delete(cityName)) {
            console.log("Removing city:", cityName);
            d3.select(".city-info-box").style("display", "none"); // Hide info box

            if (selectedCityName === cityName) {
                selectedCityName = null;
            }

            // Update everything
            updateCityMarkers();
            runOptimization();
            updateDemandCapacityBox();
            refreshHoldingCost();
            runDailyInventorySimulation().catch(e => console.warn("Sim failed after city removal:", e));

            if (isBottomRibbonOpen) drawHoldingCostChart();
        } else {
            console.warn("Attempted to remove non-existent city:", cityName);
        }
    }

    /**
     * Removes all cities from the map.
     */
    function removeAllCities() {
        if (cityData.size === 0) return;

        console.log("Removing all cities");
        cityData.clear();

        // Reset UI
        d3.select(".city-info-box").style("display", "none");
        selectedCityName = null;

        // Update everything
        updateCityMarkers();
        runOptimization();
        updateDemandCapacityBox();
        refreshHoldingCost();

        // Clear simulation
        simulationResults = null;
        simulationError = null;
        if (isBottomRibbonOpen) drawHoldingCostChart();
    }

    /**
     * Updates the animated connection lines from the factory to the cities.
     */
    function updateConnectionLines() {
        if (!projection || !radiusScale || !mapInitialized) return;

        const lineGroup = d3.select(".connection-lines");
        const cities = Array.from(cityData.values());

        // No factory or no cities, remove all lines
        if (!optimalFactoryLocation || cities.length < 1) {
            lineGroup.selectAll(".connection-group").interrupt().remove();
            return;
        }

        // --- 1. Setup Scales based on cost ---
        const costs = cities.map(city => calculateTotalCostForCity(optimalFactoryLocation, city));
        const maxCost = d3.max(costs);
        const widthScale = d3.scaleLinear().domain([0, maxCost || 1]).range([1, 8]).clamp(true); // Line width by cost
        const dashScale = d3.scaleLinear().domain([1, TRUCK_CAPACITY_UNITS * 3]).range([5, 30]).clamp(true); // Dash length by qty
        const gapScale = d3.scaleLinear().domain([1, 30]).range([15, 100]).clamp(true); // Gap length by freq

        // --- 2. D3 Data Join ---
        const groups = lineGroup.selectAll(".connection-group")
            .data(cities, d => d.name); // Keyed by name

        // Exit
        groups.exit().selectAll(".connection-line").interrupt(); // Stop animation
        groups.exit().remove();

        // Enter
        const enterGroups = groups.enter().append("g")
            .attr("class", "connection-group");

        enterGroups.append("line").attr("class", "connection-line-bg"); // Solid background line
        enterGroups.append("line").attr("class", "connection-line");    // Animated dashed line

        // --- 3. Update (Enter + Merge) ---
        enterGroups.merge(groups).each(function (d) {
            const group = d3.select(this);
            const startPoint = projection(optimalFactoryLocation);
            const endPoint = projection(d.coordinates);

            if (!startPoint || !endPoint) {
                group.selectAll('line').style('display', 'none');
                return;
            }

            // Shorten line so it points to the edge of the circle, not the center
            const radius = radiusScale(d.annualDemand) + 3; // +3px padding
            const dx = endPoint[0] - startPoint[0];
            const dy = endPoint[1] - startPoint[1];
            const lineLength = Math.sqrt(dx * dx + dy * dy);

            // If factory is inside circle, hide line
            if (lineLength < radius) {
                group.selectAll('line').style('display', 'none');
                group.select(".connection-line").interrupt(); // Stop animation
                return;
            } else {
                group.selectAll('line').style('display', null);
            }

            // Calculate new end point at edge of circle
            const newEndPointX = endPoint[0] - (dx / lineLength) * radius;
            const newEndPointY = endPoint[1] - (dy / lineLength) * radius;

            const strokeWidth = widthScale(calculateTotalCostForCity(optimalFactoryLocation, d));

            // Update background line
            group.select(".connection-line-bg")
                .attr("x1", startPoint[0]).attr("y1", startPoint[1])
                .attr("x2", newEndPointX).attr("y2", newEndPointY)
                .attr("marker-end", "url(#arrowhead)")
                .style("stroke-width", strokeWidth);

            // Update animated line
            const animLine = group.select(".connection-line")
                .attr("x1", startPoint[0]).attr("y1", startPoint[1])
                .attr("x2", newEndPointX).attr("y2", newEndPointY)
                .style("stroke-width", strokeWidth)
                .attr("stroke-dasharray", `${dashScale(d.qty)} ${gapScale(d.freq)}`)
                .attr("marker-end", "url(#arrowhead)");

            // --- 4. Start/Restart Animation ---
            animLine.interrupt(); // Stop any existing transition

            function repeatAnimation() {
                if (!animLine.node()?.isConnected) return; // Stop if element is removed

                const totalLength = dashScale(d.qty) + gapScale(d.freq);
                animLine.attr("stroke-dashoffset", totalLength)
                    .transition()
                    .ease(d3.easeLinear)
                    .duration(Math.max(1, d.freq) * 100) // Duration based on freq
                    .attr("stroke-dashoffset", 0)
                    .on("end", repeatAnimation); // Loop
            }

            repeatAnimation();
        });
    }

    /**
     * Gets detailed shipment cost info for one shipment to one city.
     * @param {Array<number>} factoryCoords - [lon, lat] of factory.
     * @param {object} city - City data object.
     * @param {number} [overrideDistance] - Optional distance to use instead of calculating.
     * @returns {object} Detailed cost breakdown.
     */
    function getShipmentDetails(factoryCoords, city, overrideDistance = null) {
        if (!city?.coordinates || (!factoryCoords && !overrideDistance)) return null;

        const distance = overrideDistance ?? greatCircleDistance(factoryCoords, city.coordinates);

        // If distance is effectively zero, it's a "Local" shipment
        if (distance <= 0.1 && !overrideDistance) {
            return {
                distance,
                roadDistance: 0,
                numFTL: 0,
                costFTL: 0,
                remainderUnits: city.qty,
                remainderTons: 0,
                costRemainder: 0,
                remainderChoice: 'Local',
                costPerShipment: 0
            };
        }

        const roadDistance = distance * getCircuitryFactor(distance);

        // --- FTL (Full Truckload) Calculation ---
        const numFTL = Math.floor(city.qty / TRUCK_CAPACITY_UNITS);
        const costFTL = (numFTL * PPI * roadDistance) / 51.35; // FTL cost formula

        // --- Remainder (LTL vs. FTL) Calculation ---
        const remainderUnits = city.qty % TRUCK_CAPACITY_UNITS;
        const remainderTons = (remainderUnits * DEMAND_UNIT_LBS) / 2000;

        let costRemainder = 0;
        let remainderChoice = "N/A";

        if (remainderTons > 0) {
            const ltlCost = calculateLTLCost(roadDistance, remainderTons);
            const ftlCostForRemainder = (PPI * roadDistance) / 51.35; // Cost of one more FTL truck

            const validLtlCost = isFinite(ltlCost) ? ltlCost : Infinity;
            const validFtlCost = isFinite(ftlCostForRemainder) ? ftlCostForRemainder : Infinity;

            // Choose the cheaper option for the remainder
            costRemainder = Math.min(validLtlCost, validFtlCost);

            if (!isFinite(costRemainder)) {
                costRemainder = 0;
                remainderChoice = "Error";
            } else {
                remainderChoice = (validLtlCost <= validFtlCost) ? "LTL" : "FTL";
            }
        } else {
            remainderChoice = "None"; // No remainder
        }

        return {
            distance,
            roadDistance,
            numFTL,
            costFTL,
            remainderUnits,
            remainderTons,
            costRemainder,
            remainderChoice,
            costPerShipment: costFTL + costRemainder
        };
    }

    /**
     * Calculates the total *annual* shipping cost for a single city.
     */
    function calculateTotalCostForCity(factoryCoords, city) {
        if (!factoryCoords || !city?.coordinates) return 0;

        // Check for local
        if (factoryCoords[0] === city.coordinates[0] && factoryCoords[1] === city.coordinates[1]) {
            return 0;
        }

        const details = getShipmentDetails(factoryCoords, city);
        if (!details || !isFinite(details.costPerShipment)) return 0;

        const shipmentsPerYear = 365.2425 / Math.max(1, city.freq);
        return details.costPerShipment * shipmentsPerYear;
    }

    /**
     * Calculates the total *annual* shipping cost for all cities.
     */
    function calculateTotalCost(factoryCoords, cities) {
        return cities.reduce((total, city) =>
            total + calculateTotalCostForCity(factoryCoords, city),
            0
        );
    }

    /**
     * Resize function called by the global resize handler.
     */
    const resize = () => {
        console.log("LocationTab.resize() called.");
        updateDynamicMapElements();
    };

    // Return the public interface
    return {
        draw: draw,
        resize: resize // Expose the resize function
    };

})();