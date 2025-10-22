const LocationTab = (() => {
    // --- Constants and State ---
    const DEMAND_UNIT_LBS = 410;
    const TRUCK_CAPACITY_UNITS = 54;
    const FTL_RATE_PER_MILE = 2.1;

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
        const numerator = 43.78 * q * d;
        const denominator = (q ** (1 / 7) * d ** (15 / 29)) - 3.5;
        if (denominator <= 0) return Infinity;
        return numerator / denominator;
    };

    const runOptimization = () => {
        const cities = Array.from(cityData.values());

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
    };

    // --- D3 Drawing and Updating Functions ---
    let projection;
    let radiusScale;

    const draw = () => {
        const svg = d3.select("#location-panel");
        svg.selectAll("*").remove();

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

        const yShift = height * 0.05;
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

        const demandBox = svg.append("foreignObject")
            .attr("class", "demand-capacity-box")
            .attr("x", 15).attr("y", height - 180)
            .attr("width", 220).attr("height", 165);
        const demandDiv = demandBox.append("xhtml:div");
        demandDiv.append("h4").text("Annual Demand");
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P10 (Low):</span><span id="demand-p10">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P50 (Likely):</span><span id="demand-p50">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P90 (High):</span><span id="demand-p90">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>Allocated:</span><span id="demand-allocated">0</span>`);
        demandDiv.append("div").attr("class", "demand-bar-container")
            .append("div").attr("class", "demand-bar").attr("id", "demand-bar-fill").text("0%");

        const summaryPanel = svg.append("foreignObject").attr("class", "summary-panel")
            .attr("x", width - 235).attr("y", 15)
            .attr("width", 220).attr("height", 165);
        const summaryDiv = summaryPanel.append("xhtml:div");
        const switchGroup = summaryDiv.append("div").attr("class", "inv-button-group");
        switchGroup.append("button").attr("id", "loc-new-btn").text("New");
        switchGroup.append("button").attr("id", "loc-existing-btn").text("Existing");
        summaryDiv.append("h4").text("Optimal Summary");
        summaryDiv.append("div").attr("class", "demand-row").html(`<span><strong>Location:</strong></span><span id="summary-location">N/A</span>`);
        summaryDiv.append("div").attr("class", "demand-row").html(`<span><strong>Annual Cost:</strong></span><span id="summary-cost">$0</span>`);
        summaryDiv.append("div").attr("class", "demand-row").html(`<span><strong>Shipments:</strong></span><span id="summary-shipments">0</span>`);
        summaryDiv.append("div").attr("class", "demand-row").html(`<span><strong>Avg Cost/Unit:</strong></span><span id="summary-avg-cost">$0.00</span>`);

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
            }
        });

        runOptimization();
        updateDemandCapacityBox();

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
                        // Condition 2: LTL is used. Group FTL and LTL.
                        shipmentDetailsHtml = `
                            <div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${details.numFTL}</span></div>
                            <div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${details.costFTL.toLocaleString('en-US', costFormat)}</span></div>
                            <hr>
                            <div class="tooltip-row"><span>LTL Weight/Ship:</span> <span>${details.remainderTons.toFixed(2)} tons</span></div>
                            <div class="tooltip-row"><span>LTL Cost/Ship:</span> <span>${details.costRemainder.toLocaleString('en-US', costFormat)}</span></div>
                        `;
                    } else {
                        // Condition 1: All FTL (full + partial, or just full)
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
                         <hr>
                         ${shipmentDetailsHtml}
                         <hr>
                         <div class="tooltip-row"><span>Annual Qty:</span> <span>${Math.round(d.annualDemand).toLocaleString()}</span></div>
                         <div class="tooltip-row"><span>Annual Cost:</span> <span>${annualCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</span></div>
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
                    infoBox.attr("x", x + 15 + "px").attr("y", y + yShift - 15 + "px").style("display", "block");
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
        let locationText = "  N/A"; 

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
            locationText = `  ${lat}N, ${-1 * lon}W`;
        }

        const avgCostPerUnit = totalAllocatedDemand > 0 ? totalCost / totalAllocatedDemand : 0;

        d3.select("#summary-cost").text("  " + totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
        d3.select("#summary-shipments").text("  " + Math.round(totalShipments).toLocaleString());
        d3.select("#summary-avg-cost").text("  " + avgCostPerUnit.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
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
        const costFTL = numFTL * FTL_RATE_PER_MILE * roadDistance;
        let costRemainder = 0, remainderChoice = "N/A";

        if (remainderTons > 0) {
            const ltlCost = calculateLTLCost(roadDistance, remainderTons);
            const ftlCostForRemainder = FTL_RATE_PER_MILE * roadDistance;
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
        const idsToWatch = ['inv-p10Demand', 'inv-p90Demand', 'dailyDemand', 'inv-workingDays'];
        idsToWatch.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                const eventType = (input.type === 'range' || input.id === 'dailyDemand') ? 'input' : 'change';
                input.addEventListener(eventType, () => {
                    if (document.querySelector('.tab-btn.active')?.dataset.tab === 'location') {
                        fetchDemandData();
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