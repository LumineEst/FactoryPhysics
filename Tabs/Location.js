const LocationTab = (() => {
    // --- Constants and State ---
    const DEMAND_UNIT_LBS = 410;
    const TRUCK_CAPACITY_UNITS = 60;
    let PPI = 170; // Default PPI, will be updated from input
    const majorCities = {
        "New York, NY": [-74.0060, 40.7128],
        "Los Angeles, CA": [-118.2437, 34.0522],
        "Chicago, IL": [-87.6298, 41.8781],
        "Houston, TX": [-95.3698, 29.7604],
        "Phoenix, AZ": [-112.0740, 33.4484],
        "Philadelphia, PA": [-75.1652, 39.9526],
        "San Antonio, TX": [-98.4936, 29.4241],
        "San Diego, CA": [-117.1611, 32.7157],
        "Dallas, TX": [-96.7970, 32.7767],
        "Columbus, OH": [-82.9988, 39.9612],
        "Charlotte, NC": [-80.8431, 35.2271],
        "Indianapolis, IN": [-86.1581, 39.7684],
        "Jacksonville, FL": [-81.6557, 30.3322],
        "San Francisco, CA": [-122.4194, 37.7749],
        "Seattle, WA": [-122.3321, 47.6062],
        "Denver, CO": [-104.9903, 39.7392],
        "Washington, D.C.": [-77.0369, 38.9072],
        "Boston, MA": [-71.0589, 42.3601],
        "Detroit, MI": [-83.0458, 42.3314],
        "Memphis, TN": [-90.0490, 35.1495],
        "Salt Lake City, UT": [-111.8910, 40.7608],
        "Las Vegas, NV": [-115.1398, 36.1699],
        "St. Louis, MO": [-90.1994, 38.6270],
        "Miami, FL": [-80.1918, 25.7617],
        "Atlanta, GA": [-84.3880, 33.7490]
    };
    const cityData = new Map();
    let optimalFactoryLocation = null;
    let totalDemandCapacity = { p10: 0, p50: 0, p90: 0, workingDays: 250 };
    let optimizationMode = 'New';
    let resizeObserver = null;
    // --- Helper and Calculation Functions ---
    const toRadians = (deg) => deg * (Math.PI / 180);
    const greatCircleDistance = (coords1, coords2) => {
        if (!coords1 || !coords2) return 0;
        const [lon1, lat1] = coords1.map(toRadians);
        const [lon2, lat2] = coords2.map(toRadians);
        const distanceRad = Math.acos(
            (Math.sin(lat1) * Math.sin(lat2)) +
            (Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2))
        );
        const meanLat = (coords1[1] + coords2[1]) / 2;
        const radius = 3963.34 - (13.35 * Math.sin(toRadians(meanLat)));
        return distanceRad * radius;
    };
    const getCircuitryFactor = (distance) => {
        if (distance >= 250) return 1.2;
        return 1.35;
    };
    const calculateLTLCost = (distance, shipmentWeightTons) => {
        const q = shipmentWeightTons;
        const d = distance;
        if (q <= 0 || d <= 0) return 0;
        // Use the globally set PPI
        const numerator = (PPI * q * d) / 5.14;
        const denominator = (q ** (1 / 7) * d ** (15 / 29)) - 3.5;
        if (denominator <= 0) return Infinity;
        return numerator / denominator;
    };
    /**
     * --- NEW ---
     * Calculates the holding cost breakdown based on global inputs
     * @returns {object} { capital, storage, service, risk, total }
     */
    function calculateHoldingCostBreakdown() {
        // 1. Get Investment Params from DOM (following existing pattern)
        const marr = parseFloat(document.getElementById('inv-marr')?.value) || 12.0;
        const workingDays = parseFloat(document.getElementById('inv-workingDays')?.value) || 250;
        const taxRate = parseFloat(document.getElementById('inv-taxRate')?.value) || 25.0;
        // 2. Capital Cost
        const capital = marr;
        // 3. Service Cost: 5% + (5% * (Work_Days / 365)) + (10% * Tax_Rate)
        const service = 5.0 + (5.0 * (workingDays / 365.0)) + (10.0 * (taxRate / 100.0));
        // 4. Storage & Risk Costs (depend on cities and factory location)
        const cities = Array.from(cityData.values());
        let storage = 7.0; // Default if no cities/location
        let risk = 10.0; // Default if no cities
        if (cities.length > 0 && optimalFactoryLocation) {
            // Storage Cost: 4% (far) to 10% (close)
            // Scale: 10% at 50mi or less, 4% at 500mi or more
            const distances = cities.map(c => greatCircleDistance(optimalFactoryLocation, c.coordinates));
            const minDistance = Math.min(...distances);
            const storageScale = d3.scaleLinear().domain([50, 500]).range([10.0, 4.0]).clamp(true);
            storage = storageScale(minDistance);
            // Risk Cost: 5% (fast) to 15% (slow)
            // Based on average delivery frequency
            const avgFreq = d3.mean(cities, c => c.freq);
            if (avgFreq) {
                // Scale: 5% at 7 days, 15% at 60 days (pow(2) for exponential feel)
                const riskScale = d3.scalePow().exponent(2).domain([7, 60]).range([5.0, 15.0]).clamp(true);
                risk = riskScale(avgFreq);
            }
        }
        const total = capital + service + storage + risk;
        return { capital, storage, service, risk, total };
    }
    /**
     * --- NEW ---
     * Updates the holding cost input field and stores breakdown in data attributes
     */
    function refreshHoldingCost() {
        const breakdown = calculateHoldingCostBreakdown();
        const input = d3.select("#loc-holding-cost-input");
        if (input.empty()) return;
        const currentVal = parseFloat(input.property("value"));
        const estimatedVal = parseFloat(input.attr("data-estimated-total") || 0);
        // If value is unchanged from last estimate, or this is the first run, update it.
        // This preserves user overrides.
        if (Math.abs(currentVal - estimatedVal) < 0.1 || !input.attr("data-estimated-total")) {
            input.property("value", breakdown.total.toFixed(1));
        }
        // Always update the data attributes for the tooltip
        input.attr("data-estimated-total", breakdown.total.toFixed(1));
        input.attr("data-breakdown-capital", breakdown.capital.toFixed(2));
        input.attr("data-breakdown-storage", breakdown.storage.toFixed(2));
        input.attr("data-breakdown-service", breakdown.service.toFixed(2));
        input.attr("data-breakdown-risk", breakdown.risk.toFixed(2));
    }
    const runOptimization = () => {
        const cities = Array.from(cityData.values());
        // Update PPI from input field just in case
        const ppiInput = d3.select("#loc-ppi-input").property("value");
        PPI = ppiInput ? parseFloat(ppiInput) : 170;
        if (optimizationMode === 'New') {
            if (cities.length < 2) {
                optimalFactoryLocation = null;
            } else {
                cities.forEach(c => {
                    const costPerShipmentPerMile = getShipmentDetails(null, c, 1).costPerShipment;
                    const shipmentsPerYear = 365.2425 / c.freq;
                    c.monetaryWeight = costPerShipmentPerMile * shipmentsPerYear;
                });
                let sumLon = 0, sumLat = 0, totalMonetaryWeight = 0;
                cities.forEach(c => {
                    sumLon += c.coordinates[0] * c.monetaryWeight;
                    sumLat += c.coordinates[1] * c.monetaryWeight;
                    totalMonetaryWeight += c.monetaryWeight;
                });
                let currentLocation = [sumLon / totalMonetaryWeight, sumLat / totalMonetaryWeight];
                for (let i = 0; i < 100; i++) {
                    let numLon = 0, numLat = 0, den = 0;
                    cities.forEach(city => {
                        const d = Math.max(0.001, greatCircleDistance(currentLocation, city.coordinates));
                        numLon += (city.coordinates[0] * city.monetaryWeight) / d;
                        numLat += (city.coordinates[1] * city.monetaryWeight) / d;
                        den += city.monetaryWeight / d;
                    });
                    const nextLocation = [numLon / den, numLat / den];
                    if (greatCircleDistance(currentLocation, nextLocation) < 0.1) {
                        currentLocation = nextLocation;
                        break;
                    }
                    currentLocation = nextLocation;
                }
                // 1. Round the new median location to 3 decimal places
                const newMedianLocation = [
                    +currentLocation[0].toFixed(3),
                    +currentLocation[1].toFixed(3)
                ];
                // 2. Get its cost and set it as the initial best
                let minCost = calculateTotalCost(newMedianLocation, cities);
                let bestLocation = newMedianLocation;
                // 3. Now, check if any *existing* customer site is better (more profitable)
                for (const potentialSite of cities) {
                    const currentCost = calculateTotalCost(potentialSite.coordinates, cities);
                    if (currentCost <= minCost) {
                        minCost = currentCost;
                        bestLocation = potentialSite.coordinates;
                    }
                }
                // 4. Assign the final best location
                optimalFactoryLocation = bestLocation;
            }
        } else { // 'Existing' mode
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
        updateOptimalFactoryMarker();
        updateSummaryPanel();
        updateConnectionLines();
        refreshHoldingCost(); // <-- NEW: Update cost after location changes
    };
    // --- D3 Drawing and Updating Functions ---
    let projection;
    let radiusScale;
    /**
     * --- Loads baseline PPI data from CSV ---
     * Reads monthly data.
     */
    async function loadCsvBaselineData() {
        try {
            const data = await d3.csv("Data/PPI.csv");
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            // Flatten data to monthly points
            let monthlyData = [];
            data.forEach(row => {
                const year = parseInt(row.Year);
                if (isNaN(year)) return; // Skip invalid rows
                months.forEach((month, index) => {
                    const valueStr = row[month];
                    const value = parseFloat(valueStr); // Will be NaN if empty/invalid
                    monthlyData.push({
                        date: new Date(year, index, 1), // index is 0-11
                        value: value // Keep NaN to create gaps in the line
                    });
                });
            });
            return monthlyData.sort((a, b) => a.date - b.date); // Sort by date
        } catch (error) {
            console.error("Failed to load PPI.csv:", error);
            return []; // Return empty on error
        }
    }
    /**
     * Draws the PPI trend chart using baseline data
     */
    async function drawPPITrendChart() {
        const svg = d3.select("#ppi-chart-svg");
        svg.selectAll("*").remove(); // Clear previous chart
        const margin = { top: 20, right: 30, bottom: 40, left: 50 };
        const width = 500 - margin.left - margin.right;
        const height = 280 - margin.top - margin.bottom;
        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        // Add tooltip div relative to the modal content
        // We select the parent of the SVG (the modal content div)
        const tooltip = d3.select(svg.node().parentNode)
            .append("div")
            .attr("class", "d3-tooltip ppi-tooltip") // Use existing class + a new one
            .style("opacity", 0);
        // Error message placeholder
        const errorText = g.append("text")
            .attr("class", "ppi-loading-text") // Re-use style for error
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("fill", "var(--failure-color)")
            .style("display", "none");
        try {
            // 1. Load data from CSV
            let combinedData = await loadCsvBaselineData();
            if (combinedData.length === 0) {
                throw new Error("Failed to load baseline data from Data/PPI.csv");
            }
            // 4. Use all data
            combinedData.sort((a, b) => a.date - b.date); // Ensure sorted
            const finalPpiData = combinedData;
            if (finalPpiData.length === 0) {
                throw new Error("No PPI data available to display.");
            }
            // Add one month padding to the end of the domain
            const maxDate = d3.max(finalPpiData, d => d.date);
            const domainMaxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
            const x = d3.scaleTime()
                .domain([d3.min(finalPpiData, d => d.date), domainMaxDate]) // Full data domain + padding
                .range([0, width]);
            // Filter out NaN values for y-domain calculation
            const validValues = finalPpiData.map(d => d.value).filter(v => !isNaN(v));
            const y = d3.scaleLinear()
                .domain([d3.min(validValues) * 0.9, d3.max(validValues) * 1.1]) // Widen padding
                .range([height, 0]);
            const bisectDate = d3.bisector(d => d.date).left;
            const formatDate = d3.timeFormat("%b %Y");
            // X-Axis
            g.append("g")
                .attr("class", "axis")
                .attr("transform", `translate(0,${height})`)
                .call(d3.axisBottom(x)
                    .ticks(d3.timeYear.every(3)) // Show ticks every 3 years to avoid crowding
                    .tickFormat(d3.timeFormat("%Y"))
                )
                .append("text")
                .attr("class", "axis-label")
                .attr("fill", "var(--accent)")
                .attr("x", width / 2)
                .attr("y", 35)
                .attr("text-anchor", "middle")
                .text("Year");
            // Y-Axis
            g.append("g")
                .attr("class", "axis")
                .call(d3.axisLeft(y))
                .append("text")
                .attr("class", "axis-label")
                .attr("fill", "var(--accent)")
                .attr("transform", "rotate(-90)")
                .attr("y", -40)
                .attr("x", -height / 2)
                .attr("text-anchor", "middle")
                .text("Producer Price Index"); // CHANGED: Removed acronym
            // Line
            const line = d3.line()
                .x(d => x(d.date))
                .y(d => y(d.value))
                .defined(d => !isNaN(d.value)); // Skips gaps in data
            g.append("path")
                .datum(finalPpiData)
                .attr("class", "ppi-line") // This class is styled by ppi-chart-styles.css
                .attr("d", line);
            // --- Tooltip Interaction Elements ---
            const focus = g.append("g")
                .attr("class", "ppi-focus")
                .style("display", "none");
            focus.append("circle")
                .attr("r", 5)
                .attr("class", "ppi-focus-circle"); // This class is styled by ppi-chart-styles.css
            g.append("rect")
                .attr("class", "ppi-overlay") // This class is styled by ppi-chart-styles.css
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
                const x0 = x.invert(d3.pointer(event)[0]);
                const i = bisectDate(finalPpiData, x0, 1);
                const d0 = finalPpiData[i - 1];
                const d1 = finalPpiData[i];
                if (!d0 || !d1) return;
                const d = (x0 - d0.date > d1.date - x0) ? d1 : d0;
                if (isNaN(d.value)) {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                    return;
                } else {
                    focus.style("display", null);
                    tooltip.style("opacity", 1);
                }
                focus.attr("transform", `translate(${x(d.date)},${y(d.value)})`);
                tooltip.html(
                    `<strong>${formatDate(d.date)}</strong>` +
                    `<div class="tooltip-row"><span>Price Index:</span> <span>${d.value.toFixed(2)}</span></div>`
                );
                const [modalX, modalY] = d3.pointer(event, svg.node().parentNode);
                const modalContentNode = svg.node().parentNode;
                const modalWidth = modalContentNode.clientWidth;
                const tooltipNode = tooltip.node();
                if (!tooltipNode) return;
                const tooltipRect = tooltipNode.getBoundingClientRect();
                const tooltipWidth = tooltipRect.width;
                const tooltipHeight = tooltipRect.height;
                const padding = 15;
                let left = modalX + padding;
                let top = modalY - padding - tooltipHeight;
                if (left + tooltipWidth > modalWidth - padding) {
                    left = modalX - padding - tooltipWidth;
                }
                if (top < padding) {
                    top = modalY + padding;
                }
                tooltip.style("left", left + "px").style("top", top + "px");
            }
        } catch (error) {
            console.error("Failed to draw PPI chart:", error);
            errorText.text(`Error: ${error.message}`).style("display", null);
        }
    }
    /**
     * --- NEW FUNCTION ---
     * Draws the Holding Cost chart
     */
    function drawHoldingCostChart() {
        const svg = d3.select("#holding-cost-chart-svg");
        svg.selectAll("*").remove(); // Clear previous
        const summaryDiv = d3.select("#holding-cost-summary");
        summaryDiv.html(""); // Clear previous summary
        // 1. Get Data
        const cities = Array.from(cityData.values());
        if (cities.length === 0) {
            summaryDiv.html("<p>Please add at least one city to the map to calculate holding costs.</p>");
            return;
        }
        const holdingCostRate = (parseFloat(d3.select("#loc-holding-cost-input").property("value")) || 25) / 100;
        const avgCogs = (parseFloat(superCogsInput.value) * BUILD_RATIOS.super) + (parseFloat(ultraCogsInput.value) * BUILD_RATIOS.ultra) + (parseFloat(megaCogsInput.value) * BUILD_RATIOS.mega);
        const totalAnnualDemand = cities.reduce((sum, city) => sum + city.annualDemand, 0);
        const dailyConsumption = totalAnnualDemand / 365;
        // 2. Schedule Deliveries
        let dailyDeliveries = new Array(365).fill(0);
        cities.forEach(city => {
            let bestStartDay = 0;
            let minPeak = Infinity;
            const freq = Math.round(city.freq);
            // Find the best start day (from 0 to freq-1) to even out the load
            for (let startDay = 0; startDay < freq; startDay++) {
                let tempSchedule = Array.from(dailyDeliveries);
                let currentMax = 0;
                for (let d = startDay; d < 365; d += freq) {
                    tempSchedule[d] += city.qty;
                    if (tempSchedule[d] > currentMax) currentMax = tempSchedule[d];
                }
                // We check the max of the *entire* schedule, not just this city's peak
                let scheduleMax = Math.max(...tempSchedule);
                if (scheduleMax < minPeak) {
                    minPeak = scheduleMax;
                    bestStartDay = startDay;
                }
            }
            // Apply the best schedule
            for (let d = bestStartDay; d < 365; d += freq) {
                dailyDeliveries[d] += city.qty;
            }
        });
        // 3. Calculate Inventory Curve
        // First pass: find minimum inventory to set baseline
        let inventorySim = new Array(365);
        inventorySim[0] = 0; // Start of Day 0
        let minInv = 0;
        for (let d = 0; d < 365; d++) {
            const endOfDayInv = (d > 0 ? inventorySim[d - 1] : 0) + dailyDeliveries[d] - dailyConsumption;
            inventorySim[d] = endOfDayInv;
            if (endOfDayInv < minInv) minInv = endOfDayInv;
        }
        // Second pass: create actual data
        const startingInventory = -minInv;
        let inventoryData = new Array(365);
        inventoryData[0] = startingInventory + dailyDeliveries[0] - dailyConsumption;
        for (let d = 1; d < 365; d++) {
            inventoryData[d] = inventoryData[d - 1] + dailyDeliveries[d] - dailyConsumption;
        }
        // 4. Aggregate by Week (52 weeks)
        let chartData = [];
        for (let w = 0; w < 52; w++) {
            const startDay = w * 7;
            const endDay = startDay + 6;
            let weeklyDelivery = 0;
            for (let d = startDay; d <= endDay; d++) {
                weeklyDelivery += dailyDeliveries[d];
            }
            chartData.push({
                week: w + 1,
                deliveries: weeklyDelivery,
                inventory: inventoryData[endDay] // Inventory at end of the week
            });
        }
        // 5. Calculate Summary Stats
        const avgInventory = d3.mean(inventoryData);
        const avgInventoryValue = avgInventory * avgCogs;
        const totalAnnualHoldingCost = avgInventoryValue * holdingCostRate;
        summaryDiv.html(`
            <div class="summary-row"><span>Avg. Inventory:</span> <strong>${avgInventory.toFixed(0).toLocaleString()} units</strong></div>
            <div class="summary-row"><span>Avg. Unit Value (COGS):</span> <strong>${avgCogs.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</strong></div>
            <div class="summary-row"><span>Annual Holding Rate:</span> <strong>${(holdingCostRate * 100).toFixed(1)}%</strong></div>
            <div class="summary-row total"><span>Est. Annual Holding Cost:</span> <strong>${totalAnnualHoldingCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></div>
        `);
        // 6. Render D3 Chart
        const margin = { top: 20, right: 60, bottom: 40, left: 60 };
        const width = 600 - margin.left - margin.right;
        const height = 300 - margin.top - margin.bottom;
        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const tooltip = d3.select(svg.node().parentNode)
            .append("div")
            .attr("class", "d3-tooltip holding-cost-tooltip")
            .style("opacity", 0);
        const x = d3.scaleBand()
            .domain(chartData.map(d => d.week))
            .range([0, width])
            .padding(0.2);
        const yLeft = d3.scaleLinear() // For Bars
            .domain([0, d3.max(chartData, d => d.deliveries) * 1.1])
            .range([height, 0]);
        const yRight = d3.scaleLinear() // For Area
            .domain([0, d3.max(chartData, d => d.inventory) * 1.1])
            .range([height, 0]);
        // X-Axis
        g.append("g")
            .attr("class", "axis")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x).tickValues(x.domain().filter((d, i) => (i % 4 === 0) || i === 51))) // Show tick every 4 weeks
            .append("text")
            .attr("class", "axis-label")
            .attr("fill", "var(--accent)")
            .attr("x", width / 2)
            .attr("y", 35)
            .attr("text-anchor", "middle")
            .text("Week of Year");
        // Y-Axis Left (Bars)
        g.append("g")
            .attr("class", "axis")
            .call(d3.axisLeft(yLeft))
            .append("text")
            .attr("class", "axis-label")
            .attr("fill", "var(--accent)")
            .attr("transform", "rotate(-90)")
            .attr("y", -50)
            .attr("x", -height / 2)
            .attr("text-anchor", "middle")
            .text("Units Delivered");
        // Y-Axis Right (Area)
        g.append("g")
            .attr("class", "axis")
            .attr("transform", `translate(${width},0)`)
            .call(d3.axisRight(yRight))
            .append("text")
            .attr("class", "axis-label")
            .attr("fill", "var(--accent)")
            .attr("transform", "rotate(-90)")
            .attr("y", 50)
            .attr("x", -height / 2)
            .attr("text-anchor", "middle")
            .text("Inventory on Hand");
        // Area Chart (Inventory) - DRAW FIRST
        const area = d3.area()
            .x(d => x(d.week) + x.bandwidth() / 2) // Center area on the week
            .y0(height)
            .y1(d => yRight(d.inventory))
            .curve(d3.curveMonotoneX);
        g.append("path")
            .datum(chartData)
            .attr("class", "holding-cost-area")
            .attr("d", area);
        // Bar Chart (Deliveries)
        g.selectAll(".bar")
            .data(chartData)
            .join("rect")
            .attr("class", "holding-cost-bar")
            .attr("x", d => x(d.week))
            .attr("y", d => yLeft(d.deliveries))
            .attr("width", x.bandwidth())
            .attr("height", d => height - yLeft(d.deliveries));
        // Tooltip Overlay
        g.append("rect")
            .attr("class", "ppi-overlay") // Reuse style
            .attr("width", width)
            .attr("height", height)
            .on("mouseover", () => tooltip.style("opacity", 1))
            .on("mouseout", () => tooltip.style("opacity", 0))
            .on("mousemove", (event) => {
                const pointer = d3.pointer(event, g.node());
                const xPos = pointer[0];
                const week = Math.round(xPos / width * 52); // Approx
                const d = chartData.find(data => data.week === Math.ceil(xPos / x.step()));
                if (!d) return;
                tooltip.html(
                    `<strong>Week ${d.week}</strong>` +
                    `<div class="tooltip-row"><span>Delivered:</span> <span>${d.deliveries.toLocaleString()}</span></div>` +
                    `<div class="tooltip-row"><span>On Hand (EOW):</span> <span>${d.inventory.toFixed(0).toLocaleString()}</span></div>`
                );
                // Tooltip positioning logic (same as PPI chart)
                const [modalX, modalY] = d3.pointer(event, svg.node().parentNode);
                const modalContentNode = svg.node().parentNode;
                const modalWidth = modalContentNode.clientWidth;
                const tooltipNode = tooltip.node();
                if (!tooltipNode) return;
                const tooltipRect = tooltipNode.getBoundingClientRect();
                const tooltipWidth = tooltipRect.width;
                const tooltipHeight = tooltipRect.height;
                const padding = 15;
                let left = modalX + padding;
                let top = modalY - padding - tooltipHeight;
                if (left + tooltipWidth > modalWidth - padding) left = modalX - padding - tooltipWidth;
                if (top < padding) top = modalY + padding;
                tooltip.style("left", left + "px").style("top", top + "px");
            });
    }
    const draw = () => {
        const svg = d3.select("#location-panel");
        svg.selectAll("*").remove();
        // --- Clean up any stray tooltips ---
        d3.select(svg.node().parentNode).selectAll(".ppi-tooltip").remove();
        d3.select(svg.node().parentNode).selectAll(".holding-cost-tooltip").remove();
        d3.select(svg.node().parentNode).selectAll(".holding-cost-breakdown-tooltip").remove();
        const defs = svg.append("defs");
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
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) {
            console.error("LocationTab.draw(): #svg-container not found.");
            return;
        }
        const width = svgContainer.getBoundingClientRect().width;
        const height = svgContainer.getBoundingClientRect().height;
        if (width === 0 || height === 0) {
            return;
        }
        projection = d3.geoAlbersUsa().scale(width * 1.1).translate([width / 2, height / 2]);
        const path = d3.geoPath().projection(projection);
        radiusScale = d3.scaleSqrt().domain([100, 100000]).range([4, 25]).clamp(true);
        const yShift = height*0.04; 
        const mainMapGroup = svg.append("g").attr("transform", `translate(0, ${yShift})`);
        mainMapGroup.append("g").attr("class", "us-map").on("click", () => infoBox.style("display", "none"));
        mainMapGroup.append("g").attr("class", "connection-lines");
        mainMapGroup.append("g").attr("class", "optimal-factory-container");
        mainMapGroup.append("g").attr("class", "city-markers");
        const infoBox = svg.append("foreignObject")
            .attr("width", 200).attr("height", 120).attr("class", "city-info-box").style("display", "none");
        const infoDiv = infoBox.append("xhtml:div");
        infoDiv.append("h4").attr("id", "info-header");
        infoDiv.append("p").attr("id", "info-demand");
        infoDiv.append("p").attr("id", "info-annual-cost");
        infoDiv.append("button").text("Remove City").attr("id", "info-remove-btn");
        d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
            const continentalStates = topojson.feature(us, us.objects.states).features.filter(d => d.id !== '02' && d.id !== '15');
            mainMapGroup.select(".us-map").selectAll("path")
                .data(continentalStates)
                .enter().append("path")
                .attr("d", path)
                .attr("class", "state-boundary");
            updateCityMarkers();
            runOptimization();
        });
        const controls = svg.append("foreignObject").attr("x", 15).attr("y", 15).attr("width", 550).attr("height", 100);
        const controlsDiv = controls.append("xhtml:div").attr("class", "location-controls");
        const cityGroup = controlsDiv.append("div").attr("class", "input-group");
        cityGroup.append("label").text("City");
        const citySelect = cityGroup.append("select").attr("id", "city-select");
        Object.keys(majorCities).sort().forEach(city => citySelect.append("option").attr("value", city).text(city));
        const demandGroup = controlsDiv.append("div").attr("class", "input-group");
        demandGroup.append("label").text("Shipment Qty");
        const demandInputGroup = demandGroup.append("div").attr("class", "input-with-unit");
        demandInputGroup.append("input").attr("type", "number").attr("id", "shipment-qty").attr("value", "200").attr("min", "1");
        demandInputGroup.append("span").attr("class", "unit-label").text("Units");
        const freqGroup = controlsDiv.append("div").attr("class", "input-group");
        freqGroup.append("label").text("Frequency");
        const freqInputGroup = freqGroup.append("div").attr("class", "input-with-unit");
        freqInputGroup.append("input").attr("type", "number").attr("id", "shipment-freq").attr("value", "7").attr("min", "1");
        freqInputGroup.append("span").attr("class", "unit-label").text("Days");
        controlsDiv.append("button").attr("class", "loc-control-btn").text("Add City").on("click", addCity);
        // --- User Input Box (Bottom Left) ---
        const userInputBox = svg.append("foreignObject")
            .attr("class", "user-input-box")
            .attr("x", 15)
            .attr("y", height - 195)
            .attr("width", 220)
            .attr("height", 180);
        const userInputDiv = userInputBox.append("xhtml:div");
        userInputDiv.append("h4").text("Cost Inputs");
        const ppiGroup = userInputDiv.append("div").attr("class", "user-input-row");
        ppiGroup.append("label").attr("for", "loc-ppi-input").text("Producer Price Index");
        ppiGroup.append("input").attr("type", "number").attr("id", "loc-ppi-input").attr("value", PPI);
        // --- MODIFIED: Holding Cost Input ---
        const holdingGroup = userInputDiv.append("div").attr("class", "user-input-row");
        const holdingLabel = holdingGroup.append("label").attr("for", "loc-holding-cost-input").text("Annual Holding Cost (%)");
        holdingGroup.append("input").attr("type", "number").attr("id", "loc-holding-cost-input").attr("value", 25); // Default, will be replaced
        const breakdownTooltip = createTooltip('holding-cost-breakdown-tooltip');
        holdingLabel
            .on("mouseover", (event) => {
                const input = d3.select("#loc-holding-cost-input");
                const capital = parseFloat(input.attr("data-breakdown-capital") || 0);
                const storage = parseFloat(input.attr("data-breakdown-storage") || 0);
                const service = parseFloat(input.attr("data-breakdown-service") || 0);
                const risk = parseFloat(input.attr("data-breakdown-risk") || 0);
                const total = (capital + storage + service + risk).toFixed(1);
                breakdownTooltip.style("opacity", 1).html(
                    `<div class="tooltip-header">Est. Holding Cost Breakdown</div>
                     <div class="tooltip-row"><span>Capital Cost (MARR):</span> <span>${capital.toFixed(1)}%</span></div>
                     <div class="tooltip-row"><span>Storage Cost (Location):</span> <span>${storage.toFixed(1)}%</span></div>
                     <div class="tooltip-row"><span>Service Cost (Ops):</span> <span>${service.toFixed(1)}%</span></div>
                     <div class="tooltip-row"><span>Risk Cost (Frequency):</span> <span>${risk.toFixed(1)}%</span></div>
                     <hr>
                     <div class="tooltip-row"><strong>Est. Total Rate:</strong> <strong>${total}%</strong></div>`
                );
                const tooltipNode = breakdownTooltip.node();
                if (!tooltipNode) return;
                const { width, height } = tooltipNode.getBoundingClientRect();
                const padding = 15;
                let left = event.pageX + padding;
                let top = event.pageY - height - padding; // Show above cursor
                if (left + width > window.innerWidth) { left = event.pageX - width - padding; }
                if (top < 0) { top = event.pageY + padding; } // Show below if no space above
                breakdownTooltip.style("left", `${left}px`).style("top", `${top}px`);
            })
            .on("mousemove", (event) => {
                const tooltipNode = breakdownTooltip.node();
                if (!tooltipNode) return;
                const { width, height } = tooltipNode.getBoundingClientRect();
                const padding = 15;
                let left = event.pageX + padding;
                let top = event.pageY - height - padding;
                if (left + width > window.innerWidth) { left = event.pageX - width - padding; }
                if (top < 0) { top = event.pageY + padding; }
                breakdownTooltip.style("left", `${left}px`).style("top", `${top}px`);
            })
            .on("mouseout", () => breakdownTooltip.style("opacity", 0));
        // --- END MODIFICATION ---
        const buttonGroup = userInputDiv.append("div").attr("class", "user-input-buttons");
        buttonGroup.append("button").attr("class", "loc-control-btn").attr("id", "show-ppi-chart-btn").text("What is my PPI?");
        buttonGroup.append("button").attr("class", "loc-control-btn").attr("id", "show-holding-info-btn").text("What is Holding Cost?");
        // --- Demand Box (Bottom Right) ---
        const demandBox = svg.append("foreignObject")
            .attr("class", "demand-capacity-box")
            .attr("x", width - 235)
            .attr("y", height - 180)
            .attr("width", 220).attr("height", 165);
        const demandDiv = demandBox.append("xhtml:div");
        demandDiv.append("h4").text("Annual Demand");
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P10 (Low):</span><span id="demand-p10">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P50 (Likely):</span><span id="demand-p50">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P90 (High):</span><span id="demand-p90">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>Allocated:</span><span id="demand-allocated">0</span>`);
        demandDiv.append("div").attr("class", "demand-bar-container")
            .append("div").attr("class", "demand-bar").attr("id", "demand-bar-fill").text("0%");
        // --- Summary Panel (Top Right) ---
        const summaryPanel = svg.append("foreignObject").attr("class", "summary-panel")
            .attr("x", width - 235).attr("y", 5)
            .attr("width", 220).attr("height", 155);
        const summaryDiv = summaryPanel.append("xhtml:div");
        const switchGroup = summaryDiv.append("div").attr("class", "inv-button-group");
        switchGroup.append("button").attr("id", "loc-new-btn").text("New");
        switchGroup.append("button").attr("id", "loc-existing-btn").text("Existing");
        summaryDiv.append("h4").text("Optimal Summary");
        summaryDiv.append("div").attr("class", "demand-row").html(`<span><strong>Location:</strong></span><span id="summary-location">N/A</span>`);
        summaryDiv.append("div").attr("class", "demand-row").html(`<span><strong>Annual Cost:</strong></span><span id="summary-cost">$0</span>`);
        summaryDiv.append("div").attr("class", "demand-row").html(`<span><strong>Shipments:</strong></span><span id="summary-shipments">0</span>`);
        summaryDiv.append("div").attr("class", "demand-row").html(`<span><strong>Avg Cost/Unit:</strong></span><span id="summary-avg-cost">$0.00</span>`);
        // --- PPI Chart Modal (Hidden) ---
        const ppiModal = svg.append("foreignObject")
            .attr("id", "ppi-chart-modal")
            .attr("x", "50%").attr("y", "50%")
            .attr("width", 500).attr("height", 350)
            .style("transform", "translate(-50%, -50%)")
            .style("display", "none");
        const ppiModalDiv = ppiModal.append("xhtml:div").attr("class", "ppi-modal-content");
        ppiModalDiv.append("button").attr("class", "close-btn").attr("id", "close-ppi-chart-btn").html("&times;");
        ppiModalDiv.append("h4").text("Historical PPI: General Freight Trucking (WPU112)");
        ppiModalDiv.append("svg")
            .attr("id", "ppi-chart-svg")
            .attr("viewBox", `0 0 500 280`) // Use viewBox for scaling
            .attr("preserveAspectRatio", "xMidYMid meet");
        // --- NEW: Holding Cost Modal (Hidden) ---
        const holdingCostModal = svg.append("foreignObject")
            .attr("id", "holding-cost-modal")
            .attr("x", "50%").attr("y", "50%")
            .attr("width", 600).attr("height", 450) // Larger modal
            .style("transform", "translate(-50%, -50%)")
            .style("display", "none");
        const holdingCostModalDiv = holdingCostModal.append("xhtml:div").attr("class", "ppi-modal-content"); // Reuse style
        holdingCostModalDiv.append("button").attr("class", "close-btn").attr("id", "close-holding-cost-btn").html("&times;");
        holdingCostModalDiv.append("h4").text("Annual Delivery & Inventory Cycle Analysis");
        holdingCostModalDiv.append("div").attr("id", "holding-cost-summary"); // For summary stats
        holdingCostModalDiv.append("svg")
            .attr("id", "holding-cost-chart-svg")
            .attr("viewBox", `0 0 600 300`) // Use viewBox
            .attr("preserveAspectRatio", "xMidYMid meet");
        // --- Event Listeners ---
        d3.select("#loc-new-btn").on('click', () => {
            if (optimizationMode === 'Existing') {
                optimizationMode = 'New';
                d3.select("#loc-new-btn").classed('active', true);
                d3.select("#loc-existing-btn").classed('active', false);
                runOptimization();
            }
        });
        d3.select("#loc-existing-btn").on('click', () => {
            if (optimizationMode === 'New') {
                optimizationMode = 'Existing';
                d3.select("#loc-new-btn").classed('active', false);
                d3.select("#loc-existing-btn").classed('active', true);
                runOptimization();
            }
        });
        d3.select(optimizationMode === 'New' ? "#loc-new-btn" : "#loc-existing-btn").classed('active', true);
        fetchDemandData();
        function addCity() {
            const name = d3.select("#city-select").property("value");
            const qty = parseFloat(d3.select("#shipment-qty").property("value"));
            const freq = parseFloat(d3.select("#shipment-freq").property("value"));
            if (name && qty > 0 && freq > 0) {
                const annualDemand = (qty / freq) * totalDemandCapacity.workingDays;
                cityData.set(name, { name, coordinates: majorCities[name], annualDemand, qty, freq });
                updateCityMarkers();
                runOptimization();
                updateDemandCapacityBox();
                refreshHoldingCost(); // <-- NEW: Update cost after city list changes
            }
        }
        d3.select("#info-remove-btn").on("click", function () {
            const cityToRemove = d3.select(this).attr("data-city-name");
            if (cityToRemove) {
                cityData.delete(cityToRemove);
                infoBox.style("display", "none");
                updateCityMarkers();
                runOptimization();
                updateDemandCapacityBox();
                refreshHoldingCost(); // <-- NEW: Update cost after city list changes
            }
        });
        d3.select("#loc-ppi-input").on("change", function () {
            PPI = +this.value;
            runOptimization();
        });
        d3.select("#show-ppi-chart-btn").on("click", () => {
            d3.select("#ppi-chart-modal").style("display", "block");
            drawPPITrendChart();
        });
        d3.select("#close-ppi-chart-btn").on("click", () => {
            d3.select("#ppi-chart-modal").style("display", "none");
            d3.select("#ppi-chart-svg").selectAll("*").remove(); // Clear chart
            d3.select("#ppi-chart-modal").select(".ppi-tooltip").remove();
        });
        // --- NEW: Holding Cost Button Listeners ---
        d3.select("#show-holding-info-btn").on("click", () => {
            d3.select("#holding-cost-modal").style("display", "block");
            drawHoldingCostChart(); // Call the new function
        });
        d3.select("#close-holding-cost-btn").on("click", () => {
            d3.select("#holding-cost-modal").style("display", "none");
            d3.select("#holding-cost-chart-svg").selectAll("*").remove();
            d3.select("#holding-cost-modal").select(".holding-cost-tooltip").remove();
        });
        runOptimization();
        updateDemandCapacityBox();
        refreshHoldingCost(); // <-- NEW: Initial calculation on draw
        function updateCityMarkers() {
            if (!projection) return;
            const tooltip = createTooltip('city-calc-tooltip');
            const markers = d3.select(".city-markers").selectAll(".city-marker").data(Array.from(cityData.values()), d => d.name);
            markers.exit().transition().duration(300).attr("r", 0).remove();
            markers.enter()
                .append("circle").attr("class", "city-marker").attr("r", 0)
                .merge(markers)
                .on("mouseover", (event, d) => {
                    const details = getShipmentDetails(optimalFactoryLocation, d);
                    if (!details) return;
                    const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d);
                    const avgCostPerUnit = d.annualDemand > 0 ? (annualCost / d.annualDemand) : 0;
                    let shipmentDetailsHtml;
                    const costFormat = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 };
                    if (details.remainderChoice === 'LTL') {
                        shipmentDetailsHtml = `
                            <div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${details.numFTL}</span></div>
                            <div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${details.costFTL.toLocaleString('en-US', costFormat)}</span></div>
                            <hr>
                            <div class="tooltip-row"><span>LTL Weight/Ship:</span> <span>${details.remainderTons.toFixed(2)} tons</span></div>
                            <div class="tooltip-row"><span>LTL Cost/Ship:</span> <span>${details.costRemainder.toLocaleString('en-US', costFormat)}</span></div>
                        `;
                    } else {
                        const totalFTL = details.numFTL + (details.remainderChoice === 'FTL' ? 1 : 0);
                        const totalFTLCost = details.costFTL + details.costRemainder;
                        shipmentDetailsHtml = `
                            <div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${totalFTL}</span></div>
                            <div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${totalFTLCost.toLocaleString('en-US', costFormat)}</span></div>
                        `;
                    }
                    tooltip.style("opacity", 1).html(
                        `<div class="tooltip-header">${d.name} Details</div>
                         <div class="tooltip-row"><span>Est. Road Dist:</span> <span>${details.roadDistance.toFixed(0)} mi</span></div>
transform                  <hr>
                         ${shipmentDetailsHtml}
                         <hr>
                         <div class="tooltip-row"><span>Annual Qty:</span> <span>${Math.round(d.annualDemand).toLocaleString()}</span></div>
              _        <div class="tooltip-row"><span>Annual Cost:</span> <span>${annualCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</span></div>
                         <div class="tooltip-row"><span>Avg Cost/Unit:</span> <span>${avgCostPerUnit.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span></div>`
                    );
                    const tooltipNode = tooltip.node();
                    if (!tooltipNode) return;
                    const { width, height } = tooltipNode.getBoundingClientRect();
                    const padding = 15;
                    let left = event.pageX + padding;
                    let top = event.pageY + padding;
                    if (left + width > window.innerWidth) { left = event.pageX - width - padding; }
                    if (top + height > window.innerHeight) { top = event.pageY - height - padding; }
                    tooltip.style("left", `${left}px`).style("top", `${top}px`);
                })
                .on("mousemove", (event) => {
                    const tooltipNode = tooltip.node();
                    if (!tooltipNode) return;
                    const { width, height } = tooltipNode.getBoundingClientRect();
                    const padding = 15;
                    let left = event.pageX + padding;
                    let top = event.pageY + padding;
                    if (left + width > window.innerWidth) { left = event.pageX - width - padding; }
                    if (top + height > window.innerHeight) { top = event.pageY - height - padding; }
                    tooltip.style("left", `${left}px`).style("top", `${top}px`);
                })
                .on("mouseout", () => tooltip.style("opacity", 0))
                .on("click", (event, d) => {
                    event.stopPropagation();
                    const [x, y] = projection(d.coordinates);
                    d3.select("#info-header").html(`<span style="color: var(--secondary2);">${d.name}</span>`);
                    d3.select("#info-demand").html(`<strong>Demand:</strong> ${Math.round(d.annualDemand).toLocaleString()} Units/Yr`);
                    d3.select("#info-annual-cost").html(`<strong>Annual Cost:</strong> ${calculateTotalCostForCity(optimalFactoryLocation, d).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`);
                    d3.select("#info-remove-btn").attr("data-city-name", d.name);
                    infoBox.attr("x", x + 15 + "px").attr("y", y - 15 + "px").style("display", "block");
                })
                .transition().duration(500)
                .attr("r", d => radiusScale(d.annualDemand))
                .attr("transform", d => `translate(${projection(d.coordinates)})`);
        }
    };
    function fetchDemandData() {
        const p50Display = document.getElementById('inv-p50Demand');
        let p10, p50, p90, workingDays;
        if (p50Display && p50Display.textContent && p50Display.textContent.replace(/,/g, '') !== "0") {
            p10 = parseFloat(document.getElementById('inv-p10Demand').value.replace(/,/g, '')) || 0;
            p50 = parseFloat(p50Display.textContent.replace(/,/g, '')) || 0;
            p90 = parseFloat(document.getElementById('inv-p90Demand').value.replace(/,/g, '')) || 0;
            workingDays = parseFloat(document.getElementById('inv-workingDays')?.value || 250);
        } else {
            const daily = parseFloat(document.getElementById('dailyDemand')?.value || 180);
            workingDays = 250;
            const std = 6750;
            p50 = daily * workingDays;
            const halfWidth = 1.28155 * std;
            p90 = p50 + halfWidth;
            p10 = p50 - halfWidth;
        }
        totalDemandCapacity = { p10, p50, p90, workingDays };
        updateDemandCapacityBox();
    }
    function updateDemandCapacityBox() {
        const allocated = Array.from(cityData.values()).reduce((sum, city) => sum + city.annualDemand, 0);
        d3.select("#demand-p10")
            .text(Math.round(totalDemandCapacity.p10).toLocaleString())
            .style("font-weight", allocated > totalDemandCapacity.p10 ? "bold" : null)
            .style("color", allocated > totalDemandCapacity.p10 ? "var(--failure-color)" : null);
        d3.select("#demand-p50")
            .text(Math.round(totalDemandCapacity.p50).toLocaleString())
            .style("font-weight", allocated > totalDemandCapacity.p50 ? "bold" : null)
            .style("color", allocated > totalDemandCapacity.p50 ? "var(--failure-color)" : null);
        d3.select("#demand-p90")
            .text(Math.round(totalDemandCapacity.p90).toLocaleString())
            .style("font-weight", allocated > totalDemandCapacity.p90 ? "bold" : null)
            .style("color", allocated > totalDemandCapacity.p90 ? "var(--failure-color)" : null);
        d3.select("#demand-allocated").text(Math.round(allocated).toLocaleString());
        const percent = totalDemandCapacity.p50 > 0 ? (allocated / totalDemandCapacity.p50) * 100 : 0;
        const bar = d3.select("#demand-bar-fill");
        bar.style("width", `${Math.min(percent, 100)}%`).text(`${Math.round(percent)}%`);
        bar.style("background-color", percent > 100 ? "var(--failure-color)" : "var(--primary)");
    }
    function updateSummaryPanel() {
        let totalCost = 0;
        let totalShipments = 0;
        let totalAllocatedDemand = 0;
        const cities = Array.from(cityData.values());
        let locationText = "  N/A";
        if (optimalFactoryLocation && cities.length > 0) {
            totalCost = calculateTotalCost(optimalFactoryLocation, cities);
            totalShipments = cities.reduce((sum, city) => {
                const shipmentsPerYear = 365.2425 / city.freq;
                const numFTL = Math.floor(city.qty / TRUCK_CAPACITY_UNITS);
                const remainderUnits = city.qty % TRUCK_CAPACITY_UNITS;
                const totalShipmentsForCity = shipmentsPerYear * (numFTL + (remainderUnits > 0 ? 1 : 0));
                return sum + totalShipmentsForCity;
            }, 0);
            totalAllocatedDemand = cities.reduce((sum, city) => sum + city.annualDemand, 0);
            const lat = optimalFactoryLocation[1].toFixed(3);
            const lon = optimalFactoryLocation[0].toFixed(3);
            locationText = `  ${lat}N, ${-1 * lon}W`;
        }
        const avgCostPerUnit = totalAllocatedDemand > 0 ? totalCost / totalAllocatedDemand : 0;
        d3.select("#summary-cost").text("  " + totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
        d3.select("#summary-shipments").text("  " + Math.round(totalShipments).toLocaleString());
        d3.select("#summary-avg-cost").text("  " + avgCostPerUnit.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
        d3.select("#summary-location").text(locationText);
    }
    function updateOptimalFactoryMarker() {
        if (!projection) return;
        const container = d3.select(".optimal-factory-container");
        const tooltip = createTooltip('factory-tooltip');
        const data = optimalFactoryLocation ? [optimalFactoryLocation] : [];
        const marker = container.selectAll(".optimal-factory-marker").data(data);
        marker.exit().transition().duration(300).style("opacity", 0).remove();
        marker.enter()
            .append("path")
            .attr("class", "optimal-factory-marker")
            .attr("d", d3.symbol(d3.symbolStar, 400)) // Star size
            .style("opacity", 0)
            .merge(marker)
            .on("mouseover", (event, d) => {
                tooltip.style("opacity", 1).html(
                    `<div class="tooltip-header">Optimal Location</div>
                     <div class="tooltip-row">
                         <span class="tooltip-key">Est. Yearly Cost:</span>
                         <span>${calculateTotalCost(d, Array.from(cityData.values())).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</span>
                     </div>`
                );
            })
            .on("mousemove", (event) => {
                const tooltipNode = tooltip.node();
                if (!tooltipNode) return;
                const { width, height } = tooltipNode.getBoundingClientRect();
                const padding = 15;
                let left = event.pageX + padding;
                let top = event.pageY + padding;
                if (left + width > window.innerWidth) { left = event.pageX - width - padding; }
                if (top + height > window.innerHeight) { top = event.pageY - height - padding; }
                tooltip.style("left", `${left}px`).style("top", `${top}px`);
            })
            .on("mouseout", () => tooltip.style("opacity", 0))
            .transition().duration(500)
            .attr("transform", d => `translate(${projection(d)})`)
            .style("opacity", 1);
    }
    function updateConnectionLines() {
        if (!projection || !radiusScale) return;
        const lineGroup = d3.select(".connection-lines");
        const cities = Array.from(cityData.values());
        if (!optimalFactoryLocation || cities.length < 1) {
            lineGroup.selectAll(".connection-group").remove();
            return;
        }
        const costs = cities.map(city => calculateTotalCostForCity(optimalFactoryLocation, city));
        const maxCost = d3.max(costs);
        const widthScale = d3.scaleLinear().domain([0, maxCost || 1]).range([1, 8]).clamp(true);
        const dashScale = d3.scaleLinear().domain([1, TRUCK_CAPACITY_UNITS * 3]).range([5, 30]).clamp(true);
        const gapScale = d3.scaleLinear().domain([1, 30]).range([15, 100]).clamp(true);
        const groups = lineGroup.selectAll(".connection-group").data(cities, d => d.name);
        groups.exit().remove();
        const enterGroups = groups.enter()
            .append("g")
            .attr("class", "connection-group");
        enterGroups.append("line").attr("class", "connection-line-bg");
        enterGroups.append("line").attr("class", "connection-line");
        enterGroups.merge(groups)
            .each(function (d) {
                const group = d3.select(this);
                const startPoint = projection(optimalFactoryLocation);
                const endPoint = projection(d.coordinates);
                const radius = radiusScale(d.annualDemand) + 3;
                const dx = endPoint[0] - startPoint[0];
                const dy = endPoint[1] - startPoint[1];
                const lineLength = Math.sqrt(dx * dx + dy * dy);
                if (lineLength === 0) {
                    group.selectAll('line').style('display', 'none');
                    return;
                } else {
                    group.selectAll('line').style('display', null);
                }
                const newEndPointX = endPoint[0] - (dx / lineLength) * radius;
                const newEndPointY = endPoint[1] - (dy / lineLength) * radius;
                const strokeWidth = widthScale(calculateTotalCostForCity(optimalFactoryLocation, d));
                group.select(".connection-line-bg")
                    .attr("x1", startPoint[0]).attr("y1", startPoint[1])
                    .attr("x2", newEndPointX).attr("y2", newEndPointY)
                    .attr("marker-end", "url(#arrowhead)")
                    .style("stroke-width", strokeWidth);
                const animLine = group.select(".connection-line")
                    .attr("x1", startPoint[0]).attr("y1", startPoint[1])
                    .attr("x2", newEndPointX).attr("y2", newEndPointY)
                    .style("stroke-width", strokeWidth)
                    .style("stroke", "var(--secondary1)")
                    .attr("stroke-dasharray", `${dashScale(d.qty)} ${gapScale(d.freq)}`)
                    .attr("marker-end", "url(#arrowhead)");
                animLine.transition();
                function repeat() {
                    const totalLength = dashScale(d.qty) + gapScale(d.freq);
                    animLine.attr("stroke-dashoffset", totalLength)
                        .transition()
                        .ease(d3.easeLinear)
                        .duration(d.freq * 100)
                        .attr("stroke-dashoffset", 0)
                        .on("end", repeat);
                }
                repeat();
            });
    }
    function getShipmentDetails(factoryCoords, city, overrideDistance = null) {
        if (!city) return null;
        if (!factoryCoords && !overrideDistance) return null;
        const distance = overrideDistance || greatCircleDistance(factoryCoords, city.coordinates);
        if (distance <= 10 && !overrideDistance) {
            return { distance, roadDistance: 0, numFTL: 0, costFTL: 0, remainderUnits: city.qty, remainderTons: 0, costRemainder: 0, remainderChoice: 'Local', costPerShipment: 0 };
        }
        const roadDistance = distance * getCircuitryFactor(distance);
        const numFTL = Math.floor(city.qty / TRUCK_CAPACITY_UNITS);
        const remainderUnits = city.qty % TRUCK_CAPACITY_UNITS;
        const remainderTons = (remainderUnits * DEMAND_UNIT_LBS) / 2000;
        // Use the globally set PPI
        const costFTL = (numFTL * PPI * roadDistance) / 51.35;
        let costRemainder = 0, remainderChoice = "N/A";
        if (remainderTons > 0) {
            const ltlCost = calculateLTLCost(roadDistance, remainderTons);
            // Use the globally set PPI
            const ftlCostForRemainder = (PPI * roadDistance) / 51.35;
            costRemainder = Math.min(ltlCost, ftlCostForRemainder);
            remainderChoice = ltlCost < ftlCostForRemainder ? "LTL" : "FTL";
        }
        return { distance, roadDistance, numFTL, costFTL, remainderUnits, remainderTons, costRemainder, remainderChoice, costPerShipment: costFTL + costRemainder };
    }
    function calculateTotalCostForCity(factoryCoords, city) {
        if (factoryCoords && city.coordinates[0] === factoryCoords[0] && city.coordinates[1] === factoryCoords[1]) {
            return 0;
        }
        const details = getShipmentDetails(factoryCoords, city);
        if (!details) return 0;
        const shipmentsPerYear = 365.2425 / city.freq;
        return details.costPerShipment * shipmentsPerYear;
    }
    function calculateTotalCost(factoryCoords, cities) {
        return cities.reduce((total, city) => total + calculateTotalCostForCity(factoryCoords, city), 0);
    }
    const setupListeners = () => {
        // --- MODIFIED: Listen to investment tab inputs ---
        const idsToWatch = [
            'inv-p10Demand', 'inv-p90Demand', 'dailyDemand', 'inv-workingDays',
            'inv-marr', 'inv-taxRate'
        ];
        idsToWatch.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                const eventType = (input.type === 'range' || input.id === 'dailyDemand') ? 'input' : 'change';
                input.addEventListener(eventType, () => {
                    if (document.querySelector('.tab-btn.active')?.dataset.tab === 'location') {
                        const isDemandDriver = ['inv-p10Demand', 'inv-p90Demand', 'dailyDemand', 'inv-workingDays'].includes(id);
                        const isCostDriver = ['inv-workingDays', 'inv-marr', 'inv-taxRate'].includes(id);
                        if (isDemandDriver) {
                            fetchDemandData();
                        }
                        if (isCostDriver) {
                            refreshHoldingCost();
                        }
                    }
                });
            }
        });
        if (resizeObserver) {
            resizeObserver.disconnect();
        }
        const svgContainerNode = d3.select("#svg-container").node();
        if (svgContainerNode) {
            resizeObserver = new ResizeObserver(entries => {
                for (let entry of entries) {
                    if (entry.target === svgContainerNode) {
                        if (document.querySelector('.tab-btn.active')?.dataset.tab === 'location') {
                            draw();
                        }
                    }
                }
            });
            resizeObserver.observe(svgContainerNode);
        } else {
            console.error("LocationTab: Could not find #svg-container to attach resize observer.");
        }
        window.addEventListener('beforeunload', () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
        });
    };
    setTimeout(setupListeners, 1000);
    return { draw };
})();