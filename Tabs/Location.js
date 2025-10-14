const LocationTab = (() => {
    // --- Constants and State ---
    const EARTH_RADIUS_MILES = 3963.34;
    const DEMAND_UNIT_LBS = 410;
    const LBS_PER_TON = 2000;
    const CUBE_OUT_DENSITY = 56; // lbs/ft³
    const TRUCK_WEIGHT_CAPACITY_TONS = 25;
    const TRUCK_CUBE_CAPACITY_CFT = 2750;
    const FTL_RATE_PER_MILE = 2.50;

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
        "San Jose, CA": [-121.8863, 37.3382],
        "Austin, TX": [-97.7431, 30.2672],
        "Jacksonville, FL": [-81.6557, 30.3322],
        "San Francisco, CA": [-122.4194, 37.7749],
        "Indianapolis, IN": [-86.1581, 39.7684],
        "Seattle, WA": [-122.3321, 47.6062],
        "Denver, CO": [-104.9903, 39.7392],
        "Washington, D.C.": [-77.0369, 38.9072],
        "Boston, MA": [-71.0589, 42.3601],
        "Detroit, MI": [-83.0458, 42.3314],
        "Nashville, TN": [-86.7816, 36.1627],
        "Miami, FL": [-80.1918, 25.7617],
        "Atlanta, GA": [-84.3880, 33.7490]
    };

    const cityData = new Map();
    let optimalFactoryLocation = null;
    let totalDemandCapacity = { p10: 0, p50: 0, p90: 0, workingDays: 250 };
    let optimizationMode = 'New'; // 'New' or 'Existing'

    // --- Helper and Calculation Functions ---
    const toRadians = (deg) => deg * (Math.PI / 180);

    const greatCircleDistance = (coords1, coords2) => {
        const [lon1, lat1] = coords1.map(toRadians);
        const [lon2, lat2] = coords2.map(toRadians);
        const distanceRad = Math.acos(
            (Math.sin(lat1) * Math.sin(lat2)) +
            (Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2))
        );
        const meanLat = (coords1[1] + coords2[1]) / 2;
        const radius = EARTH_RADIUS_MILES - (13.35 * Math.sin(toRadians(meanLat)));
        return distanceRad * radius;
    };

    const getCircuitryFactor = (distance) => {
        if (distance >= 250) return 1.2;
        return 1.35;
    };

    const getLTLRate = (distance) => {
        const s = CUBE_OUT_DENSITY;
        const PPI_TL = 250;
        const numerator = PPI_TL * (((s ** 2) / 8) + 14);
        const denominator = (distance ** 0.29 - (7 / 2)) * (s ** 2 + (2 * s) + 14);
        return numerator / denominator;
    };

    const calculateEffectiveRate = (shipmentQty) => {
        const ftl_payload_tons = Math.min(TRUCK_WEIGHT_CAPACITY_TONS, (TRUCK_CUBE_CAPACITY_CFT * CUBE_OUT_DENSITY) / LBS_PER_TON);
        const tonsPerShipment = (shipmentQty * DEMAND_UNIT_LBS) / LBS_PER_TON;
        if (tonsPerShipment <= 0) return 0;

        const numFTL = Math.floor(tonsPerShipment / ftl_payload_tons);
        const remainingTons = tonsPerShipment % ftl_payload_tons;

        const avg_ltl_rate = getLTLRate(1000);

        const costPerShipmentPerMile = (numFTL * FTL_RATE_PER_MILE) + (remainingTons * avg_ltl_rate);
        const effectiveRatePerTonMile = costPerShipmentPerMile / tonsPerShipment;

        return effectiveRatePerTonMile;
    };

    const runOptimization = () => {
        const cities = Array.from(cityData.values());

        if (optimizationMode === 'New') {
            if (cities.length < 2) {
                optimalFactoryLocation = null;
            } else {
                cities.forEach(c => {
                    const tons = (c.annualDemand * DEMAND_UNIT_LBS) / LBS_PER_TON;
                    c.monetaryWeight = tons * c.effectiveRate;
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
                optimalFactoryLocation = currentLocation;
            }
        } else { // 'Existing' mode
            if (cities.length < 1) {
                optimalFactoryLocation = null;
            } else {
                let bestLocation = null;
                let minCost = Infinity;
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
    };

    // --- D3 Drawing and Updating Functions ---
    let projection;

    const draw = () => {
        const svg = d3.select("#location-panel");
        svg.selectAll("*").remove();

        const svgContainer = d3.select("#svg-container").node();
        const width = svgContainer.getBoundingClientRect().width;
        const height = svgContainer.getBoundingClientRect().height;

        projection = d3.geoAlbersUsa().scale(width * 1.1).translate([width / 2, height / 2]);
        const path = d3.geoPath().projection(projection);
        const radiusScale = d3.scaleSqrt().domain([100, 100000]).range([4, 25]).clamp(true);

        svg.append("g").attr("class", "us-map").on("click", () => infoBox.style("display", "none"));
        svg.append("g").attr("class", "optimal-factory-container");
        svg.append("g").attr("class", "city-markers");

        const infoBox = svg.append("foreignObject")
            .attr("width", 200).attr("height", 120).attr("class", "city-info-box").style("display", "none");
        const infoDiv = infoBox.append("xhtml:div");
        infoDiv.append("h4").attr("id", "info-header");
        infoDiv.append("p").attr("id", "info-demand");
        infoDiv.append("p").attr("id", "info-annual-cost");
        infoDiv.append("button").text("Remove City").attr("id", "info-remove-btn");

        d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
            svg.select(".us-map").selectAll("path")
                .data(topojson.feature(us, us.objects.states).features)
                .enter().append("path")
                .attr("d", path)
                .attr("class", "state-boundary");
        });

        const controls = svg.append("foreignObject").attr("x", 15).attr("y", 15).attr("width", 550).attr("height", 100);
        const controlsDiv = controls.append("xhtml:div").attr("class", "location-controls");

        const cityGroup = controlsDiv.append("div").attr("class", "input-group");
        cityGroup.append("label").text("City");
        const citySelect = cityGroup.append("select").attr("id", "city-select");
        Object.keys(majorCities).forEach(city => citySelect.append("option").attr("value", city).text(city));

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

        controlsDiv.append("button").text("Add City").on("click", addCity);

        const demandBox = svg.append("foreignObject")
            .attr("class", "demand-capacity-box")
            .attr("x", width - 235).attr("y", 15)
            .attr("width", 220).attr("height", 200);
        const demandDiv = demandBox.append("xhtml:div");
        demandDiv.append("h4").text("Annual Demand");
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P10 (Low):</span><span id="demand-p10">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P50 (Likely):</span><span id="demand-p50">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>P90 (High):</span><span id="demand-p90">0</span>`);
        demandDiv.append("div").attr("class", "demand-row").html(`<span>Allocated:</span><span id="demand-allocated">0</span>`);
        demandDiv.append("div").attr("class", "demand-bar-container")
            .append("div").attr("class", "demand-bar").attr("id", "demand-bar-fill").text("0%");

        const switchGroup = demandDiv.append("div").attr("class", "inv-button-group");
        switchGroup.append("button").attr("id", "loc-new-btn").text("New");
        switchGroup.append("button").attr("id", "loc-existing-btn").text("Existing");

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
                const effectiveRate = calculateEffectiveRate(qty);
                cityData.set(name, { name, coordinates: majorCities[name], annualDemand, effectiveRate, qty, freq });
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

        function updateCityMarkers() {
            const tooltip = createTooltip('city-calc-tooltip');
            const markers = d3.select(".city-markers").selectAll(".city-marker").data(Array.from(cityData.values()), d => d.name);
            markers.exit().transition().duration(300).attr("r", 0).remove();
            markers.enter()
                .append("circle").attr("class", "city-marker").attr("r", 0)
                .merge(markers)
                .on("mouseover", (event, d) => {
                    const details = getShipmentDetails(optimalFactoryLocation, d);
                    if (!details) return;

                    tooltip.style("opacity", 1).html(
                        `<strong>${d.name} Calcs:</strong><br>
                         GCD: ${details.distance.toFixed(1)} mi<br>
                         Road Dist: ${details.roadDistance.toFixed(1)} mi<br>
                         - TL Shipments: ${details.numFTL}<br>
                         - TL Weight: ${details.weightFTL.toFixed(2)} tons<br>
                         - TL Cost/Ship: ${details.costFTL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}<br>
                         - LTL Shipments: ${details.numLTL}<br>
                         - LTL Weight: ${details.weightLTL.toFixed(2)} tons<br>
                         - LTL Cost/Ship: ${details.costLTL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
                    );
                })
                .on("mousemove", (event) => tooltip.style("left", `${event.pageX + 15}px`).style("top", `${event.pageY - 28}px`))
                .on("mouseout", () => tooltip.style("opacity", 0))
                .on("click", (event, d) => {
                    event.stopPropagation();
                    const [x, y] = projection(d.coordinates);
                    d3.select("#info-header").text(d.name);
                    d3.select("#info-demand").html(`<strong>Demand:</strong> ${Math.round(d.annualDemand).toLocaleString()} Units/Yr`);
                    d3.select("#info-annual-cost").html(`<strong>Annual Cost:</strong> ${calculateTotalCostForCity(optimalFactoryLocation, d).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`);
                    d3.select("#info-remove-btn").attr("data-city-name", d.name);
                    infoBox.attr("x", x + 15).attr("y", y - 15).style("display", "block");
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
        d3.select("#demand-p10").text(Math.round(totalDemandCapacity.p10).toLocaleString());
        d3.select("#demand-p50").text(Math.round(totalDemandCapacity.p50).toLocaleString());
        d3.select("#demand-p90").text(Math.round(totalDemandCapacity.p90).toLocaleString());
        d3.select("#demand-allocated").text(Math.round(allocated).toLocaleString());
        const percent = totalDemandCapacity.p50 > 0 ? Math.min((allocated / totalDemandCapacity.p50) * 100, 100) : 0;
        const bar = d3.select("#demand-bar-fill");
        bar.style("width", `${percent}%`).text(`${Math.round(percent)}%`);
        bar.style("background-color", allocated > totalDemandCapacity.p50 ? "var(--failure-color)" : "var(--primary)");
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
            .attr("d", d3.symbol(d3.symbolStar, 250))
            .style("opacity", 0)
            .merge(marker)
            .on("mouseover", (event, d) => {
                tooltip.style("opacity", 1).html(
                    `<div class="tooltip-header">Optimal Location</div>
                     <div class="tooltip-row">
                         <span class="tooltip-key">Est. Yearly Cost:</span>
                         <span>${calculateTotalCost(d, Array.from(cityData.values())).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}</span>
                     </div>`
                );
            })
            .on("mousemove", (event) => tooltip.style("left", `${event.pageX + 15}px`).style("top", `${event.pageY - 28}px`))
            .on("mouseout", () => tooltip.style("opacity", 0))
            .transition().duration(500)
            .attr("transform", d => `translate(${projection(d)})`)
            .style("opacity", 1);
    }

    function getShipmentDetails(factoryCoords, city) {
        if (!factoryCoords) return null;

        const distance = greatCircleDistance(factoryCoords, city.coordinates);
        const roadDistance = distance * getCircuitryFactor(distance);

        const ftl_payload_tons = Math.min(TRUCK_WEIGHT_CAPACITY_TONS, (TRUCK_CUBE_CAPACITY_CFT * CUBE_OUT_DENSITY) / LBS_PER_TON);
        const tonsPerShipment = (city.qty * DEMAND_UNIT_LBS) / LBS_PER_TON;

        const numFTL = Math.floor(tonsPerShipment / ftl_payload_tons);
        const remainingTonsLTL = tonsPerShipment % ftl_payload_tons;
        const ltl_rate = getLTLRate(roadDistance);

        const costFTL = numFTL * FTL_RATE_PER_MILE * roadDistance;
        const costLTL = remainingTonsLTL > 0 ? ltl_rate * remainingTonsLTL * roadDistance : 0;

        return {
            distance: distance,
            roadDistance: roadDistance,
            numFTL: numFTL,
            weightFTL: numFTL * ftl_payload_tons,
            costFTL: costFTL,
            numLTL: remainingTonsLTL > 0 ? 1 : 0,
            weightLTL: remainingTonsLTL,
            costLTL: costLTL
        };
    }

    function calculateTotalCostForCity(factoryCoords, city) {
        const details = getShipmentDetails(factoryCoords, city);
        if (!details) return 0;

        const shipmentsPerYear = totalDemandCapacity.workingDays / city.freq;
        return (details.costFTL + details.costLTL) * shipmentsPerYear;
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
    };

    setTimeout(setupListeners, 1000);

    return { draw };
})();
