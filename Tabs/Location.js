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

    let _localWageStress = 0.0; // Local wage-based stress factor
    let _currentWageDisplay = 'N/A'; // Current wage display text

    // --- Map & D3 State ---
    let mapInitialized = false; // Flag to prevent re-initializing the map
    let projection = null; // D3 geo projection
    let path = null; // D3 geo path generator
    let radiusScale = null; // D3 scale for city marker radius
    let continentalStatesFeatures = null; // GeoJSON features for US states
    let lastCheckedLocation = null;

    // --- Simulation State ---
    let simulationWorker = null; // Web Worker for running simulations
    let isSimulationRunning = false; // Flag to show loading/prevent concurrent runs
    let simulationResults = null; // Cached results from the last successful simulation
    let simulationError = null; // Cached error message from a failed simulation
    let simulationPromiseResolve = null; // for async/await handling of worker
    let simulationPromiseReject = null; // for async/await handling of worker
    let isValidationRun = false; // Flag for simulation runs that shouldn't update global state

    // --- Filter and Brush state variables ---
    let showOverageHighlight = true;
    let showRemovedHighlight = true;
    let brushSelection = null; // Holds the [Date, Date] selection

    // --- New Constants for Responsive Layout ---
    const TOP_PANEL_AREA_HEIGHT_RATIO = 0.1; // 15% of the main area height for controls
    const SUMMARY_WIDTH_RATIO = 0.20; // Target width ratio for summary
    const HORIZONTAL_GAP_RATIO = 0.02; // 2% horizontal gap
    const MIN_CONTROLS_PIXEL_WIDTH = 600; // Minimum pixel width for the Controls Bar (to prevent wrapping)

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
        modalWidth: 750,
        modalHeight: 525,

        /**
         * Update the manager's state with new dimensions.
         */
        update(width, height, isRibbonOpen) {
            this.svgWidth = width || 0;
            this.svgHeight = height || 0;
            this.isRibbonOpen = isRibbonOpen;
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
            const mainArea = this.getMainAreaRect();
            const rightAnchor = this.svgWidth * 0.6;
            const leftMargin = this.svgWidth * HORIZONTAL_GAP_RATIO;

            // Compute a safe max allowed width (may be small on narrow screens). Ensure it's >= 120px.
            const maxAllowedWidth = Math.max(Math.floor(rightAnchor - leftMargin - this.topPanelMargin), 120);

            // Use the configured minimum desired width but cap it to the available space.
            let width = Math.min(MIN_CONTROLS_PIXEL_WIDTH, maxAllowedWidth);
            width = Math.max(120, width); // enforce sensible lower bound

            // Ensure x stays inside the svg bounds
            const x = Math.max(leftMargin, Math.min(rightAnchor - width - this.topPanelMargin, Math.max(0, rightAnchor - width - this.topPanelMargin)));
            const height = mainArea.height * TOP_PANEL_AREA_HEIGHT_RATIO;

            return {
                x: x,
                y: this.topPanelMargin,
                width: width,
                height: Math.max(80, height) // Maintain a minimum sensible height
            };
        },

        /**
         * Get coordinates for the top-right summary panel.
         */
        getSummaryRect() {
            const mainArea = this.getMainAreaRect();

            // Determine available space to the right of the controls panel and use that to size the summary.
            const controls = this.getControlsRect();
            const gap = this.svgWidth * HORIZONTAL_GAP_RATIO;

            // Start with a target width but cap it to the available space; keep sensible min width.
            const targetWidth = Math.max(120, Math.floor(this.svgWidth * SUMMARY_WIDTH_RATIO));
            const availableRight = Math.max(120, Math.floor(this.svgWidth - (controls.x + controls.width) - gap - this.topPanelMargin));
            const width = Math.min(targetWidth, Math.max(120, availableRight));

            // Prefer placing near the rightAnchor but ensure it doesn't overflow.
            const preferredX = this.svgWidth * 0.6;
            const x = Math.min(Math.max(preferredX, controls.x + controls.width + gap), Math.max(0, this.svgWidth - width - this.topPanelMargin));
            const height = this.svgHeight * 0.23;

            return {
                x: x,
                y: this.topPanelMargin,
                width: width - this.topPanelMargin,
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
            const controlRect = this.getControlsRect();;

            const mapY = controlRect.y + controlRect.height + this.topPanelMargin;
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
     */
    const calculateLTLCost = (distance, shipmentWeightTons) => {
        const q = shipmentWeightTons;
        const d = distance;
        if (q <= 0 || d <= 0) return 0;

        const numerator = (PPI * q * d) / 5.14;
        const denominator = (q ** (1 / 7) * d ** (15 / 29)) - 3.5;

        if (denominator <= 0) return Infinity;
        return numerator / denominator;
    };

    /**
     * Calculates the holding cost breakdown based on various inputs from other tabs.
     */
    function calculateHoldingCostBreakdown() {
        const marrEl = document.getElementById('inv-marr');
        const workingDaysEl = document.getElementById('inv-workingDays');
        const taxRateEl = document.getElementById('inv-taxRate');

        const marr = marrEl ? parseFloat(marrEl.value) || 12.0 : 12.0;
        const workingDays = workingDaysEl ? parseFloat(workingDaysEl.value) || 250 : 250;
        const taxRate = taxRateEl ? parseFloat(taxRateEl.value) || 25.0 : 25.0;

        const capital = marr;
        const service = 5.0 + (5.0 * (workingDays / 365.0)) + (10.0 * (taxRate / 100.0));

        const cities = Array.from(cityData.values());
        let storage = 7.0;
        let risk = 10.0;

        if (cities.length > 0 && optimalFactoryLocation) {
            const distances = cities.map(c => greatCircleDistance(optimalFactoryLocation, c.coordinates));
            const minDistance = Math.min(...distances);
            const storageScale = d3.scaleLinear().domain([50, 500]).range([10.0, 4.0]).clamp(true);
            storage = storageScale(minDistance);

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
     */
    function refreshHoldingCost() {
        const breakdown = calculateHoldingCostBreakdown();
        const input = d3.select("#loc-holding-cost-input");
        if (input.empty()) return;

        const currentVal = parseFloat(input.property("value"));
        const estimatedVal = parseFloat(input.attr("data-estimated-total") || 0);

        if (Math.abs(currentVal - estimatedVal) < 0.1 || !input.attr("data-estimated-total")) {
            input.property("value", breakdown.total.toFixed(1));
        }

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
     * Toggles the visibility of the bottom simulation ribbon using a delayed redraw.
     */
    function toggleBottomRibbon() {
        isBottomRibbonOpen = !isBottomRibbonOpen;
        const contentDiv = d3.select(".bottom-ribbon-content");

        d3.select(".bottom-ribbon-header-arrow")
            .html(isBottomRibbonOpen ? '▼' : '▲');
        contentDiv.style("display", isBottomRibbonOpen ? "flex" : "none");

        updateDynamicMapElements();

        setTimeout(() => {
            if (isBottomRibbonOpen) {
                if (!simulationResults && !isSimulationRunning && !simulationError) {
                    runDailyInventorySimulation().catch(e => console.warn("Initial sim run failed:", e));
                } else {
                    drawHoldingCostChart(true);
                }
            } else if (!isBottomRibbonOpen) {
                drawHoldingCostChart(false);
            }
        }, 400);
    }

    /**
     * Updates the chart mode (Inventory vs. Shipments) and redraws the chart.
     */
    function updateHoldingChartMode() {
        d3.select("#sim-inv-btn").classed('active', holdingChartMode === 'inventory');
        d3.select("#sim-ship-btn").classed('active', holdingChartMode === 'shipments');

        d3.select(".bottom-ribbon-header-title").html(
            `Simulation: <strong>${holdingChartMode === 'inventory' ? 'Inventory' : 'Shipments'}</strong>`
        );

        if (isBottomRibbonOpen) {
            drawHoldingCostChart();
        }
    }

    /**
    * ASYNC HELPER
    * Fetches the median wage for the current optimalFactoryLocation
    * and updates the _localWageStress state.
    * Takes the current labor cost as an argument.
    * @param {number} currentLaborCost - The labor cost from the main UI.
    * @returns {Promise<void>}
    */
    async function updateLocalWageStress(currentLaborCost) {
        if (!optimalFactoryLocation) {
            _localWageStress = 0;
            return;
        }

        // re-calculate stress based on the new laborCost.
        console.log("Recalculating wage stress with new labor cost...");

        const [lon, lat] = optimalFactoryLocation;

        const { medianHouseholdIncome, medianHourly, stress } = await getLocalWageAndStress(lat, lon, currentLaborCost);

        if (Number.isFinite(medianHourly) && medianHourly > 0) {
            _localWageStress = stress; // Update the stress

            const displayEl = document.getElementById('loc-wage-display');
            if (displayEl) {
                const newValue = `$${medianHourly.toFixed(2)}/hr`;
                _currentWageDisplay = newValue;
                displayEl.textContent = newValue;
            }
        } else {
            console.warn("getLocalWageAndStress returned N/A, preserving last known wage and stress.");
        }
    }

    /**
     * Runs the facility location optimization algorithm.
     * NOW ACCEPTS an options object { forceApiCall: boolean }
     * Returns a Promise that resolves when the async wage stress calc is done.
     */
    const runOptimization = (options = {}) => {
        const cities = Array.from(cityData.values());
        const ppiInputEl = d3.select("#loc-ppi-input");
        const ppiInput = ppiInputEl.empty() ? null : ppiInputEl.property("value");
        PPI = ppiInput ? parseFloat(ppiInput) : 170;

        if (optimizationMode === 'New') {

            // *** THIS IS THE FIX ***
            if (cities.length === 1) {
                // If there is only one city, the optimal location *is* that city.
                optimalFactoryLocation = cities[0].coordinates;
            } else if (cities.length < 2) {
                // If there are 0 cities
                optimalFactoryLocation = null;
            } else {
                // *** END FIX ***

                // (Original logic for 2+ cities)
                cities.forEach(c => {
                    const shipmentDetails = getShipmentDetails(null, c, 1);
                    const costPerShipmentPerMile = shipmentDetails ? shipmentDetails.costPerShipment : 0;
                    const shipmentsPerYear = 365.2425 / c.freq;
                    c.monetaryWeight = costPerShipmentPerMile * shipmentsPerYear;
                });

                let sumLon = 0, sumLat = 0, totalMonetaryWeight = 0;
                cities.forEach(c => {
                    if (c.monetaryWeight && isFinite(c.monetaryWeight)) {
                        sumLon += c.coordinates[0] * c.monetaryWeight;
                        sumLat += c.coordinates[1] * c.monetaryWeight;
                        totalMonetaryWeight += c.monetaryWeight;
                    }
                });

                if (totalMonetaryWeight <= 0) {
                    console.warn("Using geometric center (no valid monetary weights).");
                    sumLon = d3.sum(cities, c => c.coordinates[0]);
                    sumLat = d3.sum(cities, c => c.coordinates[1]);
                    totalMonetaryWeight = cities.length;
                    if (totalMonetaryWeight === 0) {
                        optimalFactoryLocation = null;
                        return Promise.resolve();
                    }
                }

                let currentLocation = [sumLon / totalMonetaryWeight, sumLat / totalMonetaryWeight];

                for (let i = 0; i < 100; i++) {
                    let numLon = 0, numLat = 0, den = 0;

                    cities.forEach(city => {
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

                    if (greatCircleDistance(currentLocation, nextLocation) < 0.1) {
                        currentLocation = nextLocation;
                        break;
                    }
                    currentLocation = nextLocation;
                }

                const newMedianLocation = [+currentLocation[0].toFixed(2), +currentLocation[1].toFixed(2)];
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
            setTimeout(() => updateConnectionLines(), 750);
        }
        updateSummaryPanel();
        refreshHoldingCost();

        // --- API Call Logic ---
        return new Promise((resolve) => {
            setTimeout(async () => {
                if (!optimalFactoryLocation) {
                    // No location, reset stress and last checked location
                    _localWageStress = 0;
                    lastCheckedLocation = null;
                    resolve();
                    return;
                }

                // Only run the API call if the location has actually changed
                if (lastCheckedLocation &&
                    lastCheckedLocation[0] === optimalFactoryLocation[0] &&
                    lastCheckedLocation[1] === optimalFactoryLocation[1]) {

                    console.log("Skipping wage API call, location unchanged.");
                    resolve();
                    return;
                }

                // Location is new, update the last checked location before the call
                lastCheckedLocation = [...optimalFactoryLocation];
                const currentLaborCost = parseFloat(document.getElementById('laborCost')?.value) || 25;

                await updateLocalWageStress(currentLaborCost);
                resolve();
            }, 100);
        });
    };

    /**
     * Runs the daily inventory simulation in the web worker.
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

            isSimulationRunning = true;
            if (!isValidationRun) {
                simulationError = null;
            }

            if (isBottomRibbonOpen) {
                drawHoldingCostChart();
            }

            simulationWorker.postMessage({ type: 'start', payload: paramsToUse });
        });
    }

    /**
     * Gathers all necessary parameters from the DOM to send to the simulation worker.
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

        const dailyDemandEl = document.getElementById('dailyDemand');
        const targetDailyProduction = (dailyDemandEl ? parseInt(dailyDemandEl.value) : 180) || 180;

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
            ? calculateMetrics({ dailyDemand: 9999, opHours: standardOpHours, numEmployees }, {}, true)
            : { throughputUnitsPerDay: standardOpHours * 10 }; // Simple fallback

        const maxStandardProduction = Math.floor(capacityMetrics?.throughputUnitsPerDay || 0);
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
            targetDailyProduction,
            maxStandardProduction
        };
    }

    /**
     *  Generates and downloads a CSV file from the current simulation results.
     */
    function exportSimulationCSV() {
        if (!simulationResults || simulationResults.length === 0) {
            alert("No simulation data available. Please run the simulation first.");
            return;
        }

        // Get constant inputs for columns that don't change per day
        const numEmployees = document.getElementById('numEmployees')?.value || "8";
        const opHoursStd = document.getElementById('opHours')?.value || "15.0";

        // 1. Define Headers
        const headers = [
            "Date",
            "Day Type",
            "Op Hours",
            "Produced Units",
            "Total Shipped",
            "Inventory End",
            "Holding Cost ($)",
            "Exception Cost ($)"
        ];

        // 2. Map Data Rows
        const rows = simulationResults.map(d => {
            // Determine Day Type String
            let type = "Standard";
            if (d.isReductionDay) type = "Reduction";
            else if (d.isExceptionDay) type = "Overtime/Exception";
            else if (!d.isWorkingDay) type = "Weekend/Holiday";

            // Determine Production Hours
            let hours = Math.max(d.opHours, opHoursStd).toFixed(2);
            if (d.isReductionDay || !d.isWorkingDay) {
                hours = 0;
            }
            // Escape function for CSV safety (though numbers are usually safe)
            const safe = (val) => String(val).replace(/,/g, "");

            // Shipments might be an object or number depending on your worker structure,
            // casting to Number handles the general case.
            return [
                d.date,
                type,
                hours, // Simulation usually returns specific hours for exception days
                safe(d.production),
                safe(d.actualShipments),
                safe(d.inventoryEnd),
                d.holdingCost.toFixed(2),
                d.exceptionCost.toFixed(2)
            ].join(",");
        });

        // 3. Construct CSV String
        const csvContent = [headers.join(","), ...rows].join("\n");

        // 4. Trigger Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `FactoryFlow_Sim_Export_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Draws the PPI trend line chart in the modal.
     */
    async function drawPPITrendChart() {
        const svg = d3.select("#ppi-chart-svg");
        svg.selectAll("*").remove();

        // *** Read size from layoutManager ***
        const modalWidth = layoutManager.modalWidth;
        // Subtract height for modal padding and title
        const modalHeight = layoutManager.modalHeight - 70;
        if (modalWidth <= 0 || modalHeight <= 0) return;

        // *** Use the modal size for the viewBox ***
        svg.attr("viewBox", `0 0 ${modalWidth} ${modalHeight}`);

        const margin = { top: 20, right: 40, bottom: 40, left: 50 };
        const width = modalWidth - margin.left - margin.right;
        const height = modalHeight - margin.top - margin.bottom;

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

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
            // --- Load Data ---
            errorText.text("Loading baseline data...").style("display", null);
            let combinedData = await loadCsvBaselineData();
            if (combinedData.length === 0) throw new Error("Failed to load PPI data.");

            combinedData.sort((a, b) => a.date - b.date);
            const finalPpiData = combinedData;
            if (finalPpiData.length === 0) throw new Error("No PPI data available.");
            errorText.style("display", "none");

            // --- Define Scales ---
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

            // --- Draw Axes ---
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

            // --- Draw Line ---
            const line = d3.line()
                .x(d => x(d.date))
                .y(d => y(d.value))
                .defined(d => !isNaN(d.value) && d.value !== null);

            g.append("path")
                .datum(finalPpiData.filter(d => !isNaN(d.value) && d.value !== null))
                .attr("class", "ppi-line")
                .attr("d", line);

            // --- Tooltip Setup ---
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
     * @param {boolean} animate - Flag to enable the smooth entrance animation.
     */
    function drawHoldingCostChart(animate = false) {
        const svg = d3.select("#holding-cost-chart-svg");
        svg.selectAll("*").remove();

        const metricsPlaceholder = d3.select("#metrics-placeholder-in-demand");
        metricsPlaceholder.html(""); // Clear old metrics

        const tooltip = createTooltip("holding-cost-tooltip");

        const svgNode = svg.node();
        if (!svgNode) return;
        const svgContainer = svgNode.parentNode;
        if (!svgContainer) return;

        // --- Get dimensions ---
        let viewBoxWidth = 0;
        let viewBoxHeight = 0;
        try {
            const rect = svgContainer.getBoundingClientRect();
            viewBoxWidth = rect.width;
            viewBoxHeight = rect.height;

            svg.attr("width", viewBoxWidth)
                .attr("height", viewBoxHeight)
                .attr("viewBox", `0 0 ${viewBoxWidth} ${viewBoxHeight}`);

        } catch (e) {
            console.error("Could not get bounding rect for chart container", e);
            return;
        }

        // --- Handle Loading State ---
        if (isSimulationRunning) {
            metricsPlaceholder.html(`<p class="loading sim-loading-text">Loading...</p>`);
            if (viewBoxWidth > 0 && viewBoxHeight > 0) {
                svg.append("text")
                    .attr("x", viewBoxWidth / 2)
                    .attr("y", viewBoxHeight / 2)
                    .attr("text-anchor", "middle")
                    .text("Loading Simulation...");
            }
            return;
        }

        // --- Determine Display State ---
        const isConflictError = simulationError && simulationError.startsWith("Demand Conflict");
        const hasValidResults = simulationResults && Array.isArray(simulationResults) && simulationResults.length > 0;
        const displayState = isConflictError
            ? "CONFLICT"
            : (!hasValidResults ? "NO_RESULTS_OR_GENERAL_ERROR" : "VALID_RESULTS");

        // --- Setup SVG and Margins ---
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

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        // *** Get inputs for tooltip/highlighting ***
        const opHoursEl = document.getElementById('opHours');
        const standardOpHours = opHoursEl ? parseFloat(opHoursEl.value) || 15.0 : 15.0;
        const dailyDemandEl = document.getElementById('dailyDemand');
        const targetDailyProduction = (dailyDemandEl ? parseInt(dailyDemandEl.value) : 180) || 180;
        const numEmployeesEl = document.getElementById('numEmployees');
        const numEmployees = numEmployeesEl ? parseInt(numEmployeesEl.value) || 8 : 8;
        const failureColor = "var(--failure-color)";

        // *** Get COGS for Inv. Valuation ***
        const scInput = document.getElementById('superCogs');
        const ucInput = document.getElementById('ultraCogs');
        const mcInput = document.getElementById('megaCogs');
        const superCogsVal = scInput ? parseFloat(scInput.value) : 375;
        const ultraCogsVal = ucInput ? parseFloat(ucInput.value) : 590;
        const mcInputVal = mcInput ? parseFloat(mcInput.value) : 960;
        const buildRatios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.33, ultra: 0.33, mega: 0.34 };
        const avgCogs = (superCogsVal * buildRatios.super) + (ultraCogsVal * buildRatios.ultra) + (mcInputVal * buildRatios.mega);

        // Formatters
        const formatK = d3.format(".2s");
        const formatInt = d3.format(",.0f");
        const formatCurrency = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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

        // --- Calculate Default Line Ops ---
        let defaultConveyorSpeed = 0;
        if (typeof calculateMetrics === 'function' && targetDailyProduction > 0 && standardOpHours > 0) {
            try {
                const defaultMetrics = calculateMetrics({
                    dailyDemand: Math.round(targetDailyProduction),
                    opHours: standardOpHours,
                    numEmployees: numEmployees
                }, {});
                if (defaultMetrics) {
                    defaultConveyorSpeed = defaultMetrics.conveyorSpeed;
                }
            } catch (e) { console.warn("Failed to calc default metrics", e); }
        }


        // --- Draw Empty Chart (if no results or general error) ---
        if (displayState === "NO_RESULTS_OR_GENERAL_ERROR") {
            const x = d3.scaleTime().domain([startDate, endDate]).range([0, width]);
            drawMonthAxis(g, x, height);
            const defaultYDomain = [0, 100];

            if (holdingChartMode === 'inventory') {
                const yLeft = d3.scaleLinear().domain(defaultYDomain).range([height, 0]).nice();
                applyAxisLabelStyle(
                    g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatK)),
                    "Inventory On Hand"
                );
                metricsPlaceholder.append("div").attr('class', 'summary-row')
                    .html(`<span>Avg. Inventory:</span><span><strong>-</strong></span>`);
                metricsPlaceholder.append("div").attr('class', 'summary-row')
                    .html(`<span>Inv. Valuation:</span><span><strong>-</strong></span>`);
                metricsPlaceholder.append("div").attr('class', 'summary-row total')
                    .html(`<span>Holding Costs:</span><span><strong>-</strong></span>`);
            } else {
                const yLeftShip = d3.scaleLinear().domain(defaultYDomain).range([height, 0]).nice();
                applyAxisLabelStyle(
                    g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeftShip).tickFormat(formatInt)),
                    "Units Delivered"
                );
                metricsPlaceholder.html(
                    `<div class="summary-row filter-row"><label for="filter-overage"><input type="checkbox" id="filter-overage" checked> Overages:</label> <strong>-</strong></div>` +
                    `<div class="summary-row filter-row"><label for="filter-removed"><input type="checkbox" id="filter-removed" checked> Days Removed:</label> <strong>-</strong></div>` +
                    `<div class="summary-row total"><span>Exception Costs:</span> <strong>-</strong></div>`
                );
                metricsPlaceholder.select("#filter-overage").on("change", () => { });
                metricsPlaceholder.select("#filter-removed").on("change", () => { });
            }

            if (simulationError && !isConflictError) {
                g.append("text").attr("x", width / 2).attr("y", height / 2)
                    .attr("text-anchor", "middle").attr("fill", failureColor)
                    .text("Simulation Error");
                metricsPlaceholder.html(`<div class="summary-row error-message"><span class="sim-error-text">Sim Failed</span></div>`);
            }
            return;
        }

        // --- Draw Chart with Valid Results (or Conflict Overlay) ---
        const dailyData = simulationResults.map(d => ({ ...d, dateObj: new Date(d.date + 'T00:00:00Z') }));

        // --- Implement D3 Brush for data filtering ---
        const x = d3.scaleTime().domain(d3.extent(dailyData, d => d.dateObj)).range([0, width]);
        drawMonthAxis(g, x, height);

        let metricData = dailyData;

        const clipRect = g.append("defs").append("clipPath")
            .attr("id", "clip-brush")
            .append("rect")
            .attr("x", 0).attr("y", 0)
            .attr("width", width).attr("height", height);

        const brush = d3.brushX()
            .extent([[0, 0], [width, height]])
            .on("end", onBrushEnd);

        // The brush <g> element will capture all mouse events.
        const brushG = g.append("g")
            .attr("class", "brush")
            .call(brush);

        if (brushSelection && brushSelection[0] && brushSelection[1]) {
            const pixelSelection = [x(brushSelection[0]), x(brushSelection[1])];
            if (isFinite(pixelSelection[0]) && isFinite(pixelSelection[1])) {
                clipRect.attr("x", pixelSelection[0]).attr("width", pixelSelection[1] - pixelSelection[0]);
                metricData = dailyData.filter(d => d.dateObj >= brushSelection[0] && d.dateObj <= brushSelection[1]);
                brushG.call(brush.move, pixelSelection);
            }
        }

        // --- Calculate Metrics (based on metricData) ---
        const avgInventory = d3.mean(metricData, d => d.inventoryEnd) || 0;
        const totalAnnualHoldingCost = d3.sum(metricData, d => d.holdingCost);
        const totalExceptionCost = d3.sum(metricData, d => d.exceptionCost);
        const overageDays = d3.sum(metricData, d => d.isExceptionDay ? 1 : 0);
        const removedDays = d3.sum(metricData, d => d.isReductionDay ? 1 : 0);

        // Helper to attach tooltip events
        const attachMetricTooltip = (selection, text) => {
            selection.style("cursor", "help")
                .on("mouseover", (event) => {
                    tooltip.style("opacity", 1).html(`<div class="tooltip-row">${text}</div>`);
                    if (typeof positionTooltip === 'function') positionTooltip(tooltip, event, 15, -28);
                    else tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
                })
                .on("mousemove", (event) => {
                    if (typeof positionTooltip === 'function') positionTooltip(tooltip, event, 15, -28);
                    else tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
                })
                .on("mouseout", () => tooltip.style("opacity", 0));
        };

        // Update metrics panel
        if (holdingChartMode === 'inventory') {
            const invValuation = avgInventory * avgCogs;

            // 1. Avg Inventory
            const row1 = metricsPlaceholder.append("div").attr('class', 'summary-row');
            const label1 = row1.append("span").text("Avg. Inventory: ");
            row1.append("span").html(`<strong>${formatInt(avgInventory)}</strong> units`);
            attachMetricTooltip(label1, "The average number of units held in stock throughout the year.");

            // 2. Inv Valuation
            const row2 = metricsPlaceholder.append("div").attr('class', 'summary-row');
            const label2 = row2.append("span").text("Inv. Valuation: ");
            row2.append("span").html(`<strong>${formatCurrency(invValuation)}</strong>`);
            attachMetricTooltip(label2, "The monetary value of the average inventory based on the weighted average Cost of Goods Sold (COGS).");

            // 3. Holding Costs
            const row3 = metricsPlaceholder.append("div").attr('class', 'summary-row total');
            const label3 = row3.append("span").text("Holding Costs: ");
            row3.append("span").html(`<strong>${formatCurrency(totalAnnualHoldingCost)}</strong>`);
            attachMetricTooltip(label3, "Total annual cost to store inventory, including capital (opportunity), storage, service, and risk costs.");

        } else {
            // --- SHIPMENTS MODE ---

            // 1. Overages Row
            const row1 = metricsPlaceholder.append("div").attr("class", "summary-row filter-row");
            const label1 = row1.append("label").attr("for", "filter-overage");

            // Re-attach checkbox behavior
            label1.append("input")
                .attr("type", "checkbox")
                .attr("id", "filter-overage")
                .property("checked", showOverageHighlight)
                .on("change", function () {
                    showOverageHighlight = this.checked;
                    drawHoldingCostChart();
                });

            const text1 = label1.append("span").text(" Overages: ");
            row1.append("strong").text(`${overageDays} days`);
            attachMetricTooltip(text1, "Days where production exceeded standard capacity (requiring Overtime) to meet a shipment deadline.");

            // 2. Days Removed Row
            const row2 = metricsPlaceholder.append("div").attr("class", "summary-row filter-row");
            const label2 = row2.append("label").attr("for", "filter-removed");

            label2.append("input")
                .attr("type", "checkbox")
                .attr("id", "filter-removed")
                .property("checked", showRemovedHighlight)
                .on("change", function () {
                    showRemovedHighlight = this.checked;
                    drawHoldingCostChart();
                });

            const text2 = label2.append("span").text(" Days Removed: ");
            row2.append("strong").text(`${removedDays}`);
            attachMetricTooltip(text2, "Days where standard production was canceled to reduce excess inventory slack or offset previous overtime costs.");

            // 3. Exception Costs Row
            const row3 = metricsPlaceholder.append("div").attr("class", "summary-row total");
            const label3 = row3.append("span").text("Exception Costs: ");
            row3.append("strong").style("color", failureColor).text(formatCurrency(totalExceptionCost));
            attachMetricTooltip(label3, "The total financial penalty incurred from using Overtime (Overages).");
        }

        if (holdingChartMode === 'inventory') {
            // --- 7a. INVENTORY MODE (Area Chart) ---
            const yMin = d3.min(dailyData, d => d.inventoryEnd) ?? 0;
            const yMax = d3.max(dailyData, d => d.inventoryEnd) ?? 0;
            const yLeft = d3.scaleLinear().domain([Math.min(0, yMin), Math.max(10, yMax * 1.1)]).range([height, 0]).nice();

            applyAxisLabelStyle(
                g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatK)),
                "Inventory On Hand"
            );

            // Area generator
            const area = d3.area()
                .x(d => x(d.dateObj))
                .y0(yLeft(0))
                .y1(d => yLeft(d.inventoryEnd))
                .curve(d3.curveStepAfter);

            // --- Add Highlight Bars like Shipment Chart *** ---
            const bandwidth = (width / 365) * 0.9;

            const highlightData = dailyData.filter(d =>
                (showRemovedHighlight && d.isReductionDay) ||
                (showOverageHighlight &&
                    (d.isExceptionDay ||
                        (d.isWorkingDay && !d.isReductionDay && d.production > 0.01 && Math.abs(d.production - targetDailyProduction) > 0.01)
                    )
                )
            );

            // --- Draw Dimmed Background Bars ---
            g.selectAll(".exception-bg-bar-dimmed")
                .data(highlightData, d => d.dateObj)
                .join("rect")
                .attr("class", "exception-bg-bar")
                .attr("x", d => x(d.dateObj) - bandwidth / 2)
                .attr("y", 0)
                .attr("width", bandwidth)
                .attr("height", height)
                .attr("fill", failureColor)
                .style("opacity", 0.2);

            // --- Draw Clipped Highlight Bars ---
            const highlightBars = g.selectAll(".exception-bg-bar")
                .data(highlightData, d => d.dateObj)
                .join("rect")
                .attr("class", "exception-bg-bar")
                .attr("x", d => x(d.dateObj) - bandwidth / 2)
                .attr("y", 0)
                .attr("width", bandwidth)
                .attr("height", height)
                .attr("fill", failureColor)
                .style("opacity", 0.3)
                .attr("clip-path", "url(#clip-brush)");

            // --- Draw Dimmed Background Area ---
            g.append("path")
                .datum(dailyData)
                .attr("class", "holding-cost-area")
                .attr("d", area)
                .style("opacity", 0.2);

            // --- Draw Main Clipped Area ---
            const areaPath = g.append("path")
                .datum(dailyData)
                .attr("class", "holding-cost-area")
                .attr("clip-path", "url(#clip-brush)")
                .attr("d", area);

            // Animate on first load (if no brush)
            if (animate && !brushSelection) {
                const collapsedArea = d3.area()
                    .x(d => x(d.dateObj))
                    .y0(yLeft(0))
                    .y1(yLeft(0))
                    .curve(d3.curveStepAfter);

                areaPath.attr("d", collapsedArea)
                    .transition().duration(500).ease(d3.easeQuadOut)
                    .attr("d", area);

                // Animate highlight bars
                highlightBars.attr("y", height)
                    .attr("height", 0)
                    .transition().duration(500).ease(d3.easeQuadOut)
                    .attr("y", 0)
                    .attr("height", height);
            } else {
                // No animation, just draw
                highlightBars.attr("y", 0)
                    .attr("height", height);
            }

            // --- Tooltip ---
            const bisectDate = d3.bisector(d => d.dateObj).left;

            brushG
                .on("mouseover.tooltip", () => tooltip.style("opacity", 1))
                .on("mouseout.tooltip", () => tooltip.style("opacity", 0))
                .on("mousemove.tooltip", handleInventoryTooltip)
                .on("contextmenu", (event) => { // Right-click to clear
                    event.preventDefault();
                    brushSelection = null;
                    brush.move(brushG, null);
                    drawHoldingCostChart();
                });

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

                // --- New Metric Calculations ---
                const dailyProduction = d.production || 0;
                let operationsHtml = "";

                // --- Determine text styles ---
                const prodStyle = (d.isWorkingDay && !d.isReductionDay && d.production > 0.01 && Math.abs(dailyProduction - targetDailyProduction) > 0.01)
                    ? `color:${failureColor};` : '';
                const hourStyle = d.isExceptionDay ? `color:${failureColor};` : '';

                // Only show operations if the line actually ran
                if (dailyProduction > 0.01 || (d.opHours > 0.01 && !d.isReductionDay)) {

                    let opHoursForCalc = standardOpHours;
                    if (d.isExceptionDay) {
                        opHoursForCalc = d.opHours;
                    }

                    let conveyorSpeed = 'N/A';
                    let conveyorSpeedStyle = '';

                    if (typeof calculateMetrics === 'function' && opHoursForCalc > 0.01) {
                        try {
                            const opInputs = {
                                dailyDemand: Math.round(dailyProduction),
                                opHours: opHoursForCalc,
                                numEmployees: numEmployees
                            };
                            const metrics = calculateMetrics(opInputs, {});

                            if (metrics) {
                                const actualConveyorSpeed = metrics.conveyorSpeed;
                                conveyorSpeed = `${actualConveyorSpeed.toFixed(2)} ft/min`;
                                if (Math.abs(actualConveyorSpeed - defaultConveyorSpeed) > 0.01) {
                                    conveyorSpeedStyle = `color:${failureColor};`;
                                }
                            }
                        } catch (e) {
                            console.warn("Tooltip calculateMetrics failed:", e);
                            conveyorSpeed = 'Calc Error';
                            conveyorSpeedStyle = `color:${failureColor};`;
                        }
                    }

                    // --- Build HTML ---
                    operationsHtml =
                        `<hr style='margin: 2px 0; border-top-color: #555;'>` +
                        `<div class="tooltip-header">Operations</div>` +
                        `<div class="tooltip-row"><span style="${hourStyle}">Op. Hours:</span> <span style="${hourStyle}">${(d.isExceptionDay ? d.opHours : standardOpHours).toFixed(2)} h</span></div>` +
                        `<div class="tooltip-row"><span style="${conveyorSpeedStyle}">Conv. Speed:</span> <span style="${conveyorSpeedStyle}">${conveyorSpeed}</span></div>`;
                }

                tooltip.html(
                    `<strong>${d.date} (Day ${d.day + 1})</strong>` +
                    `<div class="tooltip-header">Inventory</div>` +
                    `<div class="tooltip-row"><span style="${prodStyle}">Produced:</span> <span style="${prodStyle}">${formatInt(d.production)}</span></div>` +
                    `<div class="tooltip-row"><span>End of Day:</span> <span>${formatInt(d.inventoryEnd)}</span></div>` +
                    `${operationsHtml}`
                );

                tooltip.style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            }

        } else {
            // --- SHIPMENTS MODE (Stacked Bar Chart) ---
            const xBand = d3.scaleBand().domain(d3.range(dailyData.length)).range([0, width]).padding(0.1);
            const bandwidth = xBand.bandwidth();

            const yMax = d3.max(dailyData, d => d.actualShipments) ?? 0;
            const yLeft = d3.scaleLinear().domain([0, Math.max(10, (yMax || 0) * 1.1)]).range([height, 0]).nice();

            applyAxisLabelStyle(
                g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(yLeft).tickFormat(formatInt)),
                "Units Delivered"
            );

            // Process data for stacking
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

            // --- Draw Dimmed Exception Bars ---
            g.selectAll(".exception-bg-bar-dimmed")
                .data(chartData.filter(d => (showOverageHighlight && d.isExceptionDay) || (showRemovedHighlight && d.isReductionDay)), d => d.dateObj)
                .join("rect")
                .attr("class", "exception-bg-bar")
                .attr("x", d => x(d.dateObj) - bandwidth / 2)
                .attr("y", 0)
                .attr("width", bandwidth)
                .attr("height", height)
                .attr("fill", failureColor)
                .style("opacity", 0.2);

            // --- Draw Clipped Exception Bars ---
            g.selectAll(".exception-bg-bar")
                .data(chartData.filter(d => (showOverageHighlight && d.isExceptionDay) || (showRemovedHighlight && d.isReductionDay)), d => d.dateObj)
                .join("rect")
                .attr("class", "exception-bg-bar")
                .attr("x", d => x(d.dateObj) - bandwidth / 2)
                .attr("y", 0)
                .attr("width", bandwidth)
                .attr("height", height)
                .attr("fill", failureColor)
                .style("opacity", 0.3)
                .attr("clip-path", "url(#clip-brush)");


            const stackKeys = ["unselected", "selected"];
            const stack = d3.stack().keys(stackKeys);
            const stackedData = stack(chartData);
            const color = d3.scaleOrdinal().domain(stackKeys).range(["var(--primary)", "var(--secondary1)"]);

            // --- Draw Dimmed Stacked Bars ---
            const dimmedLayers = g.selectAll("g.layer-dimmed").data(stackedData).join("g")
                .attr("class", d => d.key);

            dimmedLayers.selectAll("rect")
                .data(d => d)
                .join("rect")
                .attr("x", d => x(d.data.dateObj) - bandwidth / 2)
                .attr("width", bandwidth)
                .attr("fill", function (d) {
                    return color(d3.select(this.parentNode).datum().key);
                })
                .attr("y", d => (isNaN(d[1]) ? yLeft(0) : yLeft(d[1])))
                .attr("height", d => {
                    const y0 = isNaN(d[0]) ? 0 : d[0];
                    const y1 = isNaN(d[1]) ? y0 : d[1];
                    const scaledY0 = yLeft(y0);
                    const scaledY1 = yLeft(y1);
                    return (isNaN(scaledY0) || isNaN(scaledY1)) ? 0 : Math.max(0, scaledY0 - scaledY1);
                })
                .style("opacity", 0.2);

            // --- Draw Clipped Stacked Bars ---
            const layers = g.selectAll("g.layer").data(stackedData).join("g")
                .attr("class", d => d.key)
                .attr("clip-path", "url(#clip-brush)"); // Apply clip path

            layers.selectAll("rect")
                .data(d => d)
                .join("rect")
                .attr("x", d => x(d.data.dateObj) - bandwidth / 2)
                .attr("width", bandwidth)
                .attr("fill", function (d) {
                    return color(d3.select(this.parentNode).datum().key);
                })
                .style("cursor", "default")
                .call(rect => {
                    const finalY = d => (isNaN(d[1]) ? yLeft(0) : yLeft(d[1]));
                    const finalHeight = d => {
                        const y0 = isNaN(d[0]) ? 0 : d[0];
                        const y1 = isNaN(d[1]) ? y0 : d[1];
                        const scaledY0 = yLeft(y0);
                        const scaledY1 = yLeft(y1);
                        return (isNaN(scaledY0) || isNaN(scaledY1)) ? 0 : Math.max(0, scaledY0 - scaledY1);
                    };

                    if (animate && !brushSelection) {
                        rect.attr("y", height)
                            .attr("height", 0)
                            .transition().duration(500).ease(d3.easeQuadOut)
                            .attr("y", finalY)
                            .attr("height", finalHeight);
                    } else {
                        rect.attr("y", finalY)
                            .attr("height", finalHeight);
                    }
                });

            // Tooltip
            brushG
                .style("cursor", "crosshair")
                .on("mouseover.tooltip", () => tooltip.style("opacity", 1))
                .on("mouseout.tooltip", () => tooltip.style("opacity", 0))
                .on("mousemove.tooltip", handleShipmentTooltip)
                .on("contextmenu", (event) => { // Right-click to clear
                    event.preventDefault();
                    brushSelection = null;
                    brush.move(brushG, null);
                    drawHoldingCostChart();
                });

            function handleShipmentTooltip(event) {
                tooltip.style("opacity", 1);
                const pointer = d3.pointer(event, g.node());
                if (!pointer?.[0]) return;

                const date = x.invert(pointer[0]);
                const index = d3.bisectCenter(dailyData.map(d => d.dateObj), date);
                const d = dailyData[index];
                if (!d) return;

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
                    detailsHtml += `<hr style='margin: 2px 0; border-top-color: #555;'><div class="tooltip-header" style="color: ${failureColor};">Adjustments</div>`;
                    if (d.exceptionDetails) {
                        const costMatch = d.exceptionDetails.match(/Cost: \$([\d,]+)/);
                        const costText = costMatch ? costMatch[1] : null;
                        const detailText = d.exceptionDetails.replace(/ Cost: \$[\d,]+/, '');
                        detailsHtml += `<div>${detailText}</div>`;
                        if (costText) {
                            detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>\$${costText}</span></div>`;
                        } else if (d.exceptionCost > 0) {
                            detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>${formatCurrency(d.exceptionCost)}</span></div>`;
                        }
                    } else if (d.exceptionCost > 0) {
                        detailsHtml += `<div class="tooltip-row"><span>Cost:</span> <span>${formatCurrency(d.exceptionCost)}</span></div>`;
                    }
                }

                tooltip.html(
                    `<strong>${d.date} (Day ${d.day + 1})</strong>` +
                    `<div class="tooltip-row"><span>Total Shipped:</span> <span>${formatInt(d.actualShipments || 0)}</span></div>` +
                    `${detailsHtml}`
                );

                tooltip.style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            }
        }

        // --- BRUSH HANDLER ---
        function onBrushEnd(event) {
            if (!event.sourceEvent) return;

            const selection = event.selection;

            if (selection) {
                brushSelection = selection.map(x.invert);
            } else {
                brushSelection = null;
            }

            drawHoldingCostChart();
        }

        // --- Draw Conflict Overlay (if needed) ---
        if (displayState === "CONFLICT") {
            const rawConflictMessage = simulationError || "Unknown Conflict";

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
                return (startPos + endPos) / 2;
            })
            .attr("y", 15)
            .attr("text-anchor", "middle")
            .attr("fill", "currentColor")
            .style("font-size", "12px")
            .text(d3.utcFormat("%b"));
    }

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

        layoutManager.update(width, height);

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

        // --- Setup Map Layers (Groups) ---
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

        // --- Load GeoJSON and Draw States ---
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

        const svg = d3.select("#location-panel");
        layoutManager.update(width, height, isBottomRibbonOpen);

        // --- Update UI Panel Positions ---
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

        // --- Update Map Projection ---
        if (mapInitialized && continentalStatesFeatures && projection && path) {
            const mapBounds = layoutManager.getMapBounds();

            if (mapBounds.width > 0 && mapBounds.height > 0) {
                // Fit projection to the available map area
                projection.fitSize([mapBounds.width, mapBounds.height], { type: "FeatureCollection", features: continentalStatesFeatures });

                // Adjust vertical translation to account for top panels
                const currentTranslate = projection.translate();
                projection.translate([currentTranslate[0], currentTranslate[1] + mapBounds.y]);

                path.projection(projection);

                // --- Redraw/Update Map Elements ---
                d3.select(".us-map").selectAll("path").attr("d", path);
                radiusScale = d3.scaleSqrt().domain([100, 100000]).range([4, 25]).clamp(true);

                updateCityMarkers();
                updateOptimalFactoryMarker();
                updateConnectionLines();

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

        // --- Initialize Map (if first time) ---
        if (!mapInitialized) {
            svg.selectAll("*").remove();
            d3.select("body").selectAll(".ppi-tooltip, .holding-cost-tooltip, .factory-tooltip, .city-calc-tooltip, .holding-cost-breakdown-tooltip, .ppi-ribbon-tooltip").remove(); // Clear old tooltips
            initializeMap(svg, width, height);
        }

        // --- Initialize Simulation Worker (if first time) ---
        if (!simulationWorker) {
            try {
                simulationWorker = new Worker('simulation.worker.js');

                // --- Worker Message Handler ---
                simulationWorker.onmessage = (e) => {
                    const { type, results, message } = e.data;
                    isSimulationRunning = false;

                    if (type === 'complete') {
                        if (!isValidationRun) {
                            simulationResults = results;
                            simulationError = null;
                        }
                        if (simulationPromiseResolve) simulationPromiseResolve(results);

                    } else if (type === 'error') {
                        const isConflictError = message && message.startsWith("Demand Conflict");
                        if (!isValidationRun) {
                            simulationError = message || "Worker error";
                            console.error("Worker Error:", simulationError);

                            if (!isConflictError) {
                                simulationResults = null;
                            }
                        }
                        if (simulationPromiseReject) simulationPromiseReject(new Error(message || "Worker error"));
                    }

                    simulationPromiseResolve = null;
                    simulationPromiseReject = null;

                    if (isBottomRibbonOpen) drawHoldingCostChart();
                };

                // --- Worker Error Handler ---
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

        // --- Draw UI Panels (using <foreignObject>) ---
        svg.selectAll("foreignObject").remove(); // Clear old UI

        // --- Top-Left Controls (Add City) ---
        const controlsRect = layoutManager.getControlsRect();
        const controls = svg.append("foreignObject")
            .attr("class", "location-controls-wrapper")
            .attr("x", controlsRect.x)
            .attr("y", controlsRect.y)
            .attr("width", controlsRect.width)
            .attr("height", controlsRect.height);

        const controlsDiv = controls.append("xhtml:div").attr("class", "location-controls");

        // --- TOOLTIP SETUP ---
        const generalTooltip = createTooltip('loc-general-tooltip');
        const attachLabelTooltip = (element, text) => {
            element.style("cursor", "help")
                .on("mouseover", (e) => {
                    generalTooltip.style("opacity", 1).html(`<div class="tooltip-row">${text}</div>`);
                    if (typeof positionTooltip === 'function') positionTooltip(generalTooltip, e, 15, -28);
                    else generalTooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px");
                })
                .on("mousemove", (e) => {
                    if (typeof positionTooltip === 'function') positionTooltip(generalTooltip, e, 15, -28);
                    else generalTooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px");
                })
                .on("mouseout", () => generalTooltip.style("opacity", 0));
        };

        const cityGroup = controlsDiv.append("div").attr("class", "input-group");
        const cityLabel = cityGroup.append("label").text("Shipping Hub: City");
        attachLabelTooltip(cityLabel, "The destination city to add to your logistics network.");
        const citySelect = cityGroup.append("select").attr("id", "city-select");
        if (typeof majorCities !== 'undefined') {
            Object.keys(majorCities).sort().forEach(city => citySelect.append("option").attr("value", city).text(city));
        } else {
            console.error("majorCities data is missing.");
        }

        const demandGroup = controlsDiv.append("div").attr("class", "input-group");
        const demandLabel = demandGroup.append("label").text("Ship Qty");
        attachLabelTooltip(demandLabel, "The number of refrigerators sent in a single shipment to this city.");

        demandGroup.append("div").attr("class", "input-with-unit")
            .append("input").attr("type", "number").attr("id", "shipment-qty").attr("value", "200").attr("min", "1");

        const freqGroup = controlsDiv.append("div").attr("class", "input-group");
        const freqLabel = freqGroup.append("label").text("Freq (Days)");
        attachLabelTooltip(freqLabel, "How often shipments are sent (e.g., every 7 days).");

        freqGroup.append("div").attr("class", "input-with-unit")
            .append("input").attr("type", "number").attr("id", "shipment-freq").attr("value", "7").attr("min", "1");

        controlsDiv.append("button").attr("class", "loc-control-btn").text("Add City")
            .on("click", addCity);
        controlsDiv.append("button").attr("class", "loc-control-btn remove-all-btn").text("Remove All")
            .on("click", removeAllCities);

        // --- City Info Box (hidden by default) ---
        const infoBox = svg.append("foreignObject")
            .attr("width", 200).attr("height", 120)
            .attr("class", "city-info-box")
            .style("display", "none");

        const infoDiv = infoBox.append("xhtml:div");
        infoDiv.append("h4").attr("id", "info-header");
        infoDiv.append("p").attr("id", "info-demand");
        infoDiv.append("p").attr("id", "info-annual-cost");
        infoDiv.append("button").text("Remove City").attr("id", "info-remove-btn")
            .on("click", function () {
                const cityToRemove = d3.select(this).attr("data-city-name");
                removeCity(cityToRemove);
            });

        // --- Top-Right Summary Panel ---
        const summaryRect = layoutManager.getSummaryRect();
        const summaryPanel = svg.append("foreignObject")
            .attr("class", "summary-panel-wrapper")
            .attr("x", summaryRect.x)
            .attr("y", summaryRect.y)
            .attr("width", summaryRect.width)
            .attr("height", summaryRect.height);

        const summaryDiv = summaryPanel.append("xhtml:div").attr("class", "summary-panel");

        const switchGroup = summaryDiv.append("div").attr("class", "inv-button-group");


        const newBtn = switchGroup.append("button").attr("id", "loc-new-btn").text("New")
            .classed('active', optimizationMode === 'New')
            .on('click', async () => {
                if (optimizationMode !== 'New') {
                    optimizationMode = 'New';
                    d3.select("#loc-new-btn").classed('active', true);
                    d3.select("#loc-existing-btn").classed('active', false);
                    await runOptimization();
                    if (typeof updateUI === 'function') updateUI();
                }
            });

        attachLabelTooltip(newBtn, "<strong>Greenfield Analysis:</strong>Calculates the optimal coordinates to minimize total transportation costs, regardless of existing infrastructure.");

        const existBtn = switchGroup.append("button").attr("id", "loc-existing-btn").text("Existing")
            .classed('active', optimizationMode === 'Existing')
            .on('click', async () => {
                if (optimizationMode !== 'Existing') {
                    optimizationMode = 'Existing';
                    d3.select("#loc-new-btn").classed('active', false);
                    d3.select("#loc-existing-btn").classed('active', true);
                    await runOptimization();
                    if (typeof updateUI === 'function') updateUI();
                }
            });

        attachLabelTooltip(existBtn, "<strong>Brownfield Analysis:</strong>Evaluates only the specific city locations currently added to the map and selects the one that minimizes total costs.");

        summaryDiv.append("h4").text("Optimal Summary");
        const locationLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Location:</span><span id="summary-location">N/A</span>`);
        attachLabelTooltip(locationLbl, "The Optimal Location for the Factory.");
        const shipCostLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Ship Cost:</span><span id="summary-ship-cost">$0</span>`);
        attachLabelTooltip(shipCostLbl, "The Estimated Annual Shipping Cost to all Distribution Centers.");
        const shipLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span># Shipments:</span><span id="summary-shipments">0</span>`);
        attachLabelTooltip(shipLbl, "The Total Trucks needed to be scheduled over the Year.");
        const costLbl = summaryDiv.append("div").attr('class', 'summary-row summary-total').html(`<span>Total Cost:</span><span id="summary-total-cost">$0</span>`);
        attachLabelTooltip(costLbl, "The sum of Annual Shipping, Inventory Holding, and Production Exception Costs.");
        const avgCostLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Avg Cost/Unit:</span><span id="summary-avg-cost">$0.00</span>`);
        attachLabelTooltip(avgCostLbl, "The impact of these operational costs on each unit producted.");
        const wagesLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Median Wage:</span><span id="loc-wage-display">${_currentWageDisplay}</span>`);
        attachLabelTooltip(wagesLbl, "The Median Wage for Production Workers in the designated City.");

        // --- Bottom Ribbon ---
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
        ribbonHeader.append("button")
            .attr("class", "ribbon-export-btn")
            .html("Export Schedule")
            .attr("title", "Download daily simulation data")
            .on("click", (event) => {
                event.stopPropagation(); // Prevent ribbon from toggling
                exportSimulationCSV();
            });

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
                runOptimization();
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after cost change:", e));
            })
            .on("input", function () {
                d3.select(this).attr("data-user-modified", "true");
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

            const html = `
            <div class="tt-title">Estimated Breakdown</div>
            <div class="tooltip-row"><span>Capital:</span><span>${breakdown.c}%</span></div>
            <div class="tooltip-row"><span>Storage:</span><span>${breakdown.s}%</span></div>
            <div class="tooltip-row"><span>Administrative:</span><span>${breakdown.v}%</span></div>
            <div class="tooltip-row"><span>Risk:</span><span>${breakdown.r}%</span></div>
            <hr>
            <div class="tooltip-row tt-total"><span>Total Est:</span><span>${breakdown.t}%</span></div>`;

            breakdownTooltip.style("opacity", 1).html(html);
            if (typeof positionTooltip === 'function') positionTooltip(breakdownTooltip, event, 15, -28);
        })
            .on("mousemove", (event) => {
                if (typeof positionTooltip === 'function') {
                    positionTooltip(breakdownTooltip, event, 15, -28);
                } else {
                    // Fallback if helper isn't available
                    breakdownTooltip
                        .style("left", (event.pageX + 15) + "px")
                        .style("top", (event.pageY - 28) + "px");
                }
            })
            .on("mouseout", () => breakdownTooltip.style("opacity", 0));

        const ppiGroup = costInputDiv.append("div").attr("class", "user-input-row");
        const ppiLabel = ppiGroup.append("label").attr("for", "loc-ppi-input").text("Producer Price Index");
        const ppiTooltip = createTooltip('ppi-ribbon-tooltip');
        ppiLabel.on("mouseover", (event) => {
            ppiTooltip.style("opacity", 1).html(
                `<strong>Producer Price Index (PPI)</strong><br>` +
                `Measures the average change in selling prices received by domestic producers. This value directly scales all LTL (Less-Than-Truckload) and FTL (Full-Truckload) shipping costs.`
            );
        })
            .on("mousemove", (event) => ppiTooltip
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px")
            )
            .on("mouseout", () => ppiTooltip.style("opacity", 0));

        ppiGroup.append("input").attr("type", "number").attr("id", "loc-ppi-input").attr("value", PPI).attr("step", "0.1")
            .on("change", function () {
                PPI = +this.value;
                runOptimization();
            });

        // Attach shared input behaviors (commit semantics, drag-to-change, ctrl-reset)
        setTimeout(() => {
            try {
                const holdingEl = document.getElementById('loc-holding-cost-input');
                const ppiEl = document.getElementById('loc-ppi-input');
                const inputs = [holdingEl, ppiEl].filter(Boolean);

                if (inputs.length) {
                    attachCommitBehavior(inputs, (id, value) => {
                        if (id === 'loc-holding-cost-input') {
                            try { refreshHoldingCost(); } catch (e) { /* noop */ }
                            try { runOptimization(); } catch (e) { /* noop */ }
                            try { runDailyInventorySimulation().catch(e => console.warn("Sim failed after holding cost commit:", e)); } catch (e) { /* noop */ }
                        } else if (id === 'loc-ppi-input') {
                            PPI = value;
                            try { runOptimization(); } catch (e) { /* noop */ }
                        }
                    });

                    inputs.forEach(inp => {
                        try { enableMiddleDragNumberInput(inp, 1, 1); } catch (e) { /* ignore if unavailable */ }

                        inp.addEventListener('click', function (e) {
                            if (e.ctrlKey) {
                                const primaryColor = getComputedStyle(root).getPropertyValue('--primary').trim();
                                if (this.id === 'loc-holding-cost-input') {
                                    this.value = 39.9;
                                    commitInput(this, (id, v) => {
                                        try { refreshHoldingCost(); } catch (e) { }
                                        try { runOptimization(); } catch (e) { }
                                        try { runDailyInventorySimulation().catch(e => console.warn("Sim failed after holding cost ctrl reset:", e)); } catch (e) { }
                                    });
                                    this.style.backgroundColor = primaryColor;
                                    setTimeout(() => { this.style.backgroundColor = ''; }, 200);
                                } else if (this.id === 'loc-ppi-input') {
                                    const defaultPpi = 170;
                                    this.value = defaultPpi;
                                    commitInput(this, (id, v) => { PPI = v; try { runOptimization(); } catch (e) { } });
                                    this.style.backgroundColor = primaryColor;
                                    setTimeout(() => { this.style.backgroundColor = ''; }, 200);
                                }
                            }
                        });
                    });
                }
            } catch (err) {
                console.error('Failed to attach cost input behaviors:', err);
            }
        }, 10);
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
        demandDiv.append("div").attr("id", "metrics-placeholder-in-demand");
        const demandHeader = demandDiv.append("h4").text("Annual Demand");
        attachLabelTooltip(demandHeader, "Annual Forecast metrics derived from the Investment Tab inputs.");

        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P10:</span><span id="demand-p10">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P50:</span><span id="demand-p50">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P90:</span><span id="demand-p90">0</span>`);
        const allocatedDemand = demandDiv.append("div").attr('class', 'demand-row').html(`<span>Allocated:</span><span id="demand-allocated">0</span>`);
        attachLabelTooltip(allocatedDemand, "The sum of Annual Demand for all cities added to the map.");
        demandDiv.append("div").attr("class", "demand-bar-container").append("div").attr("class", "demand-bar").attr("id", "demand-bar-fill").text("0%");


        // --- PPI Chart Modal (hidden by default) ---
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
            .attr("preserveAspectRatio", "xMidYMid meet");

        /**
         * Adds a city to the map from the control panel inputs.
         */
        async function addCity() {
            const name = d3.select("#city-select").property("value");
            const qty = parseFloat(d3.select("#shipment-qty").property("value"));
            const freq = parseFloat(d3.select("#shipment-freq").property("value"));

            if (name && qty > 0 && freq > 0) {
                if (typeof majorCities === 'undefined' || !majorCities[name]) {
                    console.error(`Coordinates for "${name}" not found.`);
                    alert(`Error: Data missing for city "${name}".`);
                    return;
                }

                const annualDemand = (qty / freq) * 365.2425;

                cityData.set(name, {
                    name,
                    coordinates: majorCities[name],
                    annualDemand,
                    qty,
                    freq
                });

                updateCityMarkers();
                await runOptimization();
                updateDemandCapacityBox();
                refreshHoldingCost();
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after adding city:", e));

                if (typeof updateUI === 'function') {
                    updateUI();
                }
            } else {
                console.warn("Invalid city/qty/freq.");
            }
        }

        /**
         * Removes a single city from the map and recalculates.
         */
        async function removeCity(cityName) {
            if (cityName && cityData.delete(cityName)) {
                d3.select(".city-info-box").style("display", "none");

                if (selectedCityName === cityName) {
                    selectedCityName = null;
                }

                updateCityMarkers();
                await runOptimization();
                updateDemandCapacityBox();
                refreshHoldingCost();
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after city removal:", e));

                if (isBottomRibbonOpen) drawHoldingCostChart();

                if (typeof updateUI === 'function') {
                    updateUI();
                }
            } else {
                console.warn("Attempted to remove non-existent city:", cityName);
            }
        }

        // --- Initial Data Fetch and UI Updates ---
        fetchDemandData();
        refreshHoldingCost();
        updateDemandCapacityBox();
        updateSummaryPanel();

        // Update map elements only if initialized (prevents errors on first load)
        if (mapInitialized) {
            updateDynamicMapElements();
            runOptimization();
        }

        // Redraw simulation chart if ribbon is open
        if (isBottomRibbonOpen) {
            setTimeout(drawHoldingCostChart, 50);
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
            // Fallback if elements aren't ready
            console.warn("Using estimated demand. Investment tab elements not found.");
            const daily = parseFloat(document.getElementById('dailyDemand')?.value || 180);
            workingDaysCount = 250;
            const std = 6750;
            p50 = daily * workingDaysCount;
            const halfWidth = 1.28155 * std;
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
            const lat = optimalFactoryLocation[1].toFixed(2);
            const lon = optimalFactoryLocation[0].toFixed(2);
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

    /**
     * Updates the optimal factory marker (the star) on the map.
     */
    function updateOptimalFactoryMarker() {
        if (!projection || !mapInitialized) return;

        const container = d3.select(".optimal-factory-container");
        const tooltip = createTooltip('factory-tooltip');
        const data = optimalFactoryLocation ? [optimalFactoryLocation] : [];
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
            .attr("d", d3.symbol(d3.symbolStar, 400))
            .style("opacity", 0)
            .merge(marker)
            .on("mouseover", (event, d) => {
                const lat = d[1].toFixed(2);
                const lon = d[0].toFixed(2);
                tooltip.style("opacity", 1).html(`Optimal Location:<br>${lat}°N, ${Math.abs(lon)}°W`);
            })
            .on("mousemove", (event) => tooltip
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

        const tooltip = createTooltip('city-calc-tooltip');
        const infoBox = d3.select(".city-info-box");
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
            .attr("r", 0)
            .attr("transform", d => `translate(${projection(d.coordinates)})`)
            .merge(markers)
            .on("mouseover", (event, d) => {

                // --- MOUSEOVER TOOLTIP LOGIC ---
                const details = getShipmentDetails(optimalFactoryLocation, d);
                const costFormat = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 };

                if (!details || !optimalFactoryLocation) {
                    tooltip.style("opacity", 1)
                        .html(`<strong>${d.name}</strong><br>Calculating...`);
                    tooltip.style("left", (event.pageX + 15) + "px")
                        .style("top", (event.pageY - 28) + "px");
                    return;
                }

                const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d);
                const avgCostPerUnit = d.annualDemand > 0 ? (annualCost / d.annualDemand) : 0;
                let shipmentDetailsHtml = "";

                // Build shipment details
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

                // Set tooltip summary
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
            .on("mousemove", (event) => tooltip
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px")
            )
            .on("mouseout", () => tooltip.style("opacity", 0))
            .on("click", (event, d) => {
                // --- CLICK HANDLER (INFO BOX) ---
                event.stopPropagation();

                if (selectedCityName === d.name) {
                    selectedCityName = null;
                } else {
                    selectedCityName = d.name;
                }
                updateCityMarkers();
                if (isBottomRibbonOpen) drawHoldingCostChart();

                if (!projection) return;
                const projectedCoords = projection(d.coordinates);
                if (!projectedCoords) return;

                // --- Populate Info Box ---
                const [x, y] = projectedCoords;
                const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d);

                infoBox.select("#info-header").text(d.name);
                infoBox.select("#info-demand").text(`Demand: ${d.qty} u / ${d.freq} days`);
                infoBox.select("#info-annual-cost").text(`Annual Cost: ${annualCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`);
                infoBox.select("#info-remove-btn").attr("data-city-name", d.name);

                // --- Position Info Box ---
                const mainAreaRect = layoutManager.getMainAreaRect();
                let infoX = x + 15;
                let infoY = y - 15;
                const infoBoxWidth = 200;
                const infoBoxHeight = 120;

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
                event.preventDefault();
                removeCity(d.name);
            })
            .style("fill", d => (d.name === selectedCityName) ? "var(--secondary1)" : "var(--secondary2)")
            .transition().duration(500)
            .attr("r", d => radiusScale(d.annualDemand))
            .attr("transform", d => `translate(${projection(d.coordinates)})`);
    }

    /**
     * Removes a single city from the map and recalculates.
     */
    function removeCity(cityName) {
        if (cityName && cityData.delete(cityName)) {
            d3.select(".city-info-box").style("display", "none");

            if (selectedCityName === cityName) {
                selectedCityName = null;
            }

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
        d3.select(".city-info-box").style("display", "none");
        selectedCityName = null;

        updateCityMarkers();
        runOptimization();
        updateDemandCapacityBox();
        refreshHoldingCost();

        simulationResults = null;
        simulationError = null;
        _localWageStress = 0;
        lastCheckedLocation = null;
        _currentWageDisplay = 'N/A';
        const displayEl = document.getElementById('loc-wage-display');
        if (displayEl) {
            displayEl.textContent = _currentWageDisplay;
        }

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
        if (!optimalFactoryLocation || cities.length < 2) {
            lineGroup.selectAll(".connection-group").interrupt().remove();
            return;
        }

        // --- Setup Scales based on cost ---
        const costs = cities.map(city => calculateTotalCostForCity(optimalFactoryLocation, city));
        const maxCost = d3.max(costs);
        const widthScale = d3.scaleLinear().domain([0, maxCost || 1]).range([1, 8]).clamp(true); // Line width by cost
        const dashScale = d3.scaleLinear().domain([1, TRUCK_CAPACITY_UNITS * 3]).range([5, 30]).clamp(true); // Dash length by qty
        const gapScale = d3.scaleLinear().domain([1, 30]).range([15, 100]).clamp(true); // Gap length by freq

        // --- D3 Data Join ---
        const groups = lineGroup.selectAll(".connection-group")
            .data(cities, d => d.name);

        // Exit
        groups.exit().selectAll(".connection-line").interrupt();
        groups.exit().remove();

        // Enter
        const enterGroups = groups.enter().append("g")
            .attr("class", "connection-group");

        enterGroups.append("line").attr("class", "connection-line-bg"); // Solid background line
        enterGroups.append("line").attr("class", "connection-line"); // Animated dashed line

        // --- Update (Enter + Merge) ---
        enterGroups.merge(groups).each(function (d) {
            const group = d3.select(this);
            const startPoint = projection(optimalFactoryLocation);
            const endPoint = projection(d.coordinates);

            if (!startPoint || !endPoint) {
                group.selectAll('line').style('display', 'none');
                return;
            }

            // Shorten line so it points to the edge of the circle, not the center
            const radius = radiusScale(d.annualDemand) + 3;
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
                .attr("marker-end", "url(#arrowhead)");

            // --- Start/Restart Animation ---
            animLine.interrupt();

            // Calculate pixel length for animation
            const pixelLength = Math.sqrt(dx * dx + dy * dy);

            // Define dash pattern
            const dashArray = `${dashScale(d.qty)} ${gapScale(d.freq)}`;
            const dashTotal = dashScale(d.qty) + gapScale(d.freq);

            // Dynamic growth duration
            const growDuration = Math.max(800, Math.min(4000, pixelLength * 2));

            // Initialize dashed line collapsed at start
            animLine
                .attr("stroke-dasharray", dashArray)
                .attr("stroke-dashoffset", 0) // dash visible immediately
                .attr("x2", startPoint[0])
                .attr("y2", startPoint[1]);

            // Compute target position
            const targetX = newEndPointX;
            const targetY = newEndPointY;

            // Start simultaneous animations
            animateLine(animLine, targetX, targetY, growDuration, dashTotal);

            function animateLine(line, targetX, targetY, growDuration, dashTotal) {
                // 1️⃣ Animate the line length (x2,y2 grows from start → end)
                line
                    .transition("grow")
                    .duration(growDuration)
                    .attr("x2", targetX)
                    .attr("y2", targetY)
                    .on("end", function () {
                        // Continue dash motion once fully extended
                        repeatMotion(line, dashTotal);
                    });

                // 2️⃣ Animate dash motion *concurrently* with length growth
                repeatMotion(line, dashTotal);
            }

            function repeatMotion(line, dashTotal) {
                if (!line.node()?.isConnected) return;
                line
                    .attr("stroke-dashoffset", dashTotal)
                    .transition("move")
                    .ease(d3.easeLinear)
                    .duration(600)
                    .attr("stroke-dashoffset", 0)
                    .on("end", () => repeatMotion(line, dashTotal));
            }
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
            remainderChoice = "None";
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
        updateDynamicMapElements();

        // Delay chart redraw slightly to ensure layout reflow is complete after map resize.
        setTimeout(() => {
            if (isBottomRibbonOpen && document.querySelector('.tab-btn.active')?.dataset.tab === 'location') {
                try {
                    drawHoldingCostChart();
                } catch (e) {
                    console.error("Error redrawing holding cost chart on resize:", e);
                }
            }
        }, 400);
    };

    /**
     * Sets the cityData from saved configuration.
     * @param {Array} dataArray - Array of [name, data] pairs.
     */
    const setCityData = (dataArray) => {
        cityData.clear();
        dataArray.forEach(([name, data]) => cityData.set(name, data));
        updateCityMarkers();
        runOptimization();
        updateDemandCapacityBox();
        refreshHoldingCost();
        if (simulationWorker) {
            runDailyInventorySimulation().catch(e => console.warn("Sim failed after loading cityData:", e));
        }
    };

    /**
     * Gets the city data as an array of [name, data] pairs.
     * @returns {Array} Array of [name, data] pairs.
     */
    const getCityData = () => Array.from(cityData.entries());

    /**
     * Gets the current overtime stress factor based on simulation results.
     * This uses a logistic function where the CV penalizes the input
     * @returns {number} Overtime stress factor (0-1).
     */
    const getOvertimeStress = () => {
        if (!simulationResults || simulationResults.length === 0) return 0;

        const N = simulationResults.length; // Total days

        const k_exceptions = simulationResults.filter(d => d.isExceptionDay).length; // Exception days

        if (k_exceptions === 0) return 0.0; // No exceptions, no stress

        const measuredRatio = k_exceptions / N;

        // Get CV from the global stDevPercentage (defined in QualityYield.js)
        const cv = window.stDevPercentage || 0.15;
        const cv_clamped = Math.max(0.0, cv); // Clamp CV for safety

        //    The CV penalizes the input by amplifying the measured ratio.
        const effectiveRatio = measuredRatio * (1 + cv_clamped);

        // Define the static, extended S-curve parameters
        const k_steepness = 20;
        const x0_midpoint = 0.20;

        // Calculate the stress using the Logistic function:
        const stress = 1 / (1 + Math.exp(-k_steepness * (effectiveRatio - x0_midpoint)));

        return stress;
    };

    // Expose functions globally
    if (typeof window !== 'undefined') {
        window.setCityData = setCityData;
        window.getCityData = getCityData;
    }

    // Return the public interface
    return {
        draw: draw,
        resize: resize,
        getCityData: getCityData,
        getOvertimeStress: getOvertimeStress,
        getLocalWageStress: () => _localWageStress,
        runOptimization: runOptimization,
        updateLocalWageStress: updateLocalWageStress
    };

})();