const LayoutTab = (function () {
    /**
     * @tab Layout
     * Draws the animated U-shaped factory layout visualization.
     * This is the main public method exposed by the IIFE.
     */
    function draw() {
        // --- Setup & Validation ---

        // Halt any simulations f tabs that might be running.
        stopAllSimulations();
        const numEmployees = parseInt(numEmployeesInput.value, 10);

        // Select the SVG container for the visualization and clear any existing content.
        const svg = d3.select("#layout-panel");
        svg.selectAll("*").remove();
        const layoutTooltip = createTooltip('layout-element-tooltip');

        // Get the specific workstation configuration for the given number of employees.
        const config = state.configData[numEmployees];

        // If no configuration data exists, display a message and exit.
        if (!config || Object.keys(config).length === 0) {
            svg
                .append("text")
                .attr("x", "50%")
                .attr("y", "50%")
                .attr("text-anchor", "middle")
                .attr("fill", getComputedStyle(root).getPropertyValue('--accent'))
                .text("No configuration data for this number of workstations.");
            return;
        }

        // Check if any workstation's calculated length is too short, which makes the layout invalid.
        let isLayoutValid = true;
        for (const stationId in config) {
            const elements = config[stationId];
            if (!elements || elements.length === 0) continue;
            // Calculate the total physical length of the station in feet.
            const totalElementTime = elements.reduce(
                (sum, elId) => sum + (state.taskData.get(elId)?.elementTime || 0),
                0
            );
            const stationLengthFt = totalElementTime * 15; // Convert element time to feet.
            // A station must be at least 13 feet long to be valid.
            if (stationLengthFt > 0 && stationLengthFt < 13) {
                isLayoutValid = false;
                break;
            }
        }

        // If the layout is invalid, display an error message and exit.
        if (!isLayoutValid) {
            demandStatusEl.textContent = "Invalid Spacing"; // Update status display.
            demandStatusEl.className = "status failure";
            svg
                .append("text")
                .attr("x", "50%")
                .attr("y", "50%")
                .attr("text-anchor", "middle")
                .attr("fill", getComputedStyle(root).getPropertyValue('--failure-color'))
                .text("Error: A workstation's length is less than 13 feet.");
            return;
        }

        // --- Initial Calculations ---

        // Gather operational and financial inputs to calculate performance metrics.
        const opInputs = {
            dailyDemand: parseInt(dailyDemandInput.value, 10),
            opHours: parseFloat(opHoursInput.value),
            numEmployees: parseInt(numEmployeesInput.value, 10)
        };
        const finInputs = { laborCost: parseFloat(laborCostInput.value) };
        const results = calculateMetrics(opInputs, finInputs);

        // --- LAYOUT CONFIGURATION ---

        // Define the page layout using an 80/20 split for the visualization and the control panel.
        const { clientWidth: containerWidth, clientHeight: containerHeight } = document.getElementById('svg-container');
        const leftPanelWidth = containerWidth * 0.79;
        const rightPanelWidth = containerWidth * 0.2;
        const rightPanelX = leftPanelWidth;
        const uiPadding = containerWidth * 0.01;

        // --- Path and Point Generation ---

        // This section calculates the coordinates for each segment of the U-shaped assembly line.
        const isEven = numEmployees % 2 === 0;
        const numLeft = isEven ? numEmployees / 2 : Math.floor(numEmployees / 2);
        const middleWsId = isEven ? null : numLeft + 1;
        let connectionPoint;
        const allPaths = [];
        const allPoints = [];
        const workstationBorders = [];

        // Loop through each workstation to define its geometry.
        for (let i = 1; i <= numEmployees; i++) {
            const wsId = i;
            const elements = config[wsId];
            if (!elements || elements.length === 0) continue;

            // Calculate total length of the workstation path.
            const totalElementTime = elements.reduce(
                (sum, elId) => sum + (state.taskData.get(elId)?.elementTime || 0),
                0
            );
            const totalLengthFt = totalElementTime * 15;
            let p; // 'p' will hold the array of points for the current workstation path.

            // Handle the unique geometry of the middle station in an odd-numbered layout.
            if (wsId === middleWsId) {
                const startPt = { x: 0, y: numLeft * 10 };
                const endPt = { x: 10, y: numLeft * 10 };
                const horizontal_segment_ft = 10;
                const vertical_leg_ft = Math.max(0, (totalLengthFt - horizontal_segment_ft) / 2);
                p = [
                    startPt,
                    { x: startPt.x, y: startPt.y + vertical_leg_ft },
                    { x: endPt.x, y: endPt.y + vertical_leg_ft },
                    endPt
                ];
            } else {
                let startPt;
                let endPt;
                let out_dx;
                let out_dy;

                if (wsId <= numLeft) {
                    // Left side of the 'U'
                    startPt = { x: 0, y: (wsId - 1) * 10 };
                    endPt = { x: 0, y: wsId * 10 };
                    out_dx = -1;
                    out_dy = 0;
                } else {
                    // Right side of the 'U'
                    const mirroredIndex = (isEven ? numLeft : numLeft + 1) - (wsId - numLeft - 1);
                    startPt = { x: 10, y: mirroredIndex * 10 };
                    endPt = { x: 10, y: (mirroredIndex - 1) * 10 };
                    out_dx = 1;
                    out_dy = 0;
                }

                // Handle the special connection point for even-numbered layouts.
                if (isEven && (wsId === numLeft || wsId === numLeft + 1)) {
                    const leg_to_center = 5;
                    const leg_from_main = 2;
                    const mouth_ft = 6;
                    const extension_ft = Math.max(0, (totalLengthFt - leg_to_center - mouth_ft - leg_from_main) / 2);

                    if (wsId === numLeft) {
                        p = [
                            startPt,
                            { x: startPt.x, y: startPt.y + leg_from_main },
                            { x: startPt.x - extension_ft, y: startPt.y + leg_from_main },
                            { x: startPt.x - extension_ft, y: startPt.y + leg_from_main + mouth_ft },
                            { x: startPt.x, y: startPt.y + leg_from_main + mouth_ft },
                            { x: startPt.x + leg_to_center, y: startPt.y + leg_from_main + mouth_ft }
                        ];
                        connectionPoint = p[p.length - 1]; // Store the connection point for the next station.
                    } else {
                        startPt = connectionPoint;
                        endPt = { x: 10, y: (numLeft - 1) * 10 };
                        p = [
                            startPt,
                            { x: startPt.x + leg_to_center, y: startPt.y },
                            { x: startPt.x + leg_to_center + extension_ft, y: startPt.y },
                            { x: startPt.x + leg_to_center + extension_ft, y: startPt.y - mouth_ft },
                            { x: startPt.x + leg_to_center, y: startPt.y - mouth_ft },
                            endPt
                        ];
                    }
                } else {
                    // Standard U-shaped workstation path.
                    const leg1_ft = 2;
                    const leg2_ft = 2;
                    const mouth_ft = 6;
                    const extension_ft = Math.max(0, (totalLengthFt - leg1_ft - leg2_ft - mouth_ft) / 2);
                    const dx = Math.sign(endPt.x - startPt.x);
                    const dy = Math.sign(endPt.y - startPt.y);
                    p = [
                        startPt,
                        { x: startPt.x + dx * leg1_ft, y: startPt.y + dy * leg1_ft },
                        { x: startPt.x + dx * leg1_ft + out_dx * extension_ft, y: startPt.y + dy * leg1_ft + out_dy * extension_ft },
                        { x: startPt.x + dx * (leg1_ft + mouth_ft) + out_dx * extension_ft, y: startPt.y + dy * (leg1_ft + mouth_ft) + out_dy * extension_ft },
                        { x: endPt.x - dx * leg2_ft, y: endPt.y - dy * leg2_ft },
                        endPt
                    ];
                }
            }

            allPoints.push(...p); // Add generated points to the master list for scaling.

            // Create a border path string for this workstation.
            if (p && p.length > 1) {
                let borderPathString = "M " + p[0].x + " " + p[0].y;
                for (let j = 1; j < p.length; j++) {
                    borderPathString += " L " + p[j].x + " " + p[j].y;
                }
                workstationBorders.push({ wsID: i, path: borderPathString });
            }

            // Generate sub-paths for each individual element within the workstation.
            const elementColorScale = generateElementColorScale(i - 1, numEmployees, elements.length);
            let currentPathPosFt = 0;
            elements.forEach((elId, index) => {
                const task = state.taskData.get(elId);
                allPaths.push({
                    wsId: i,
                    elId: elId,
                    path: generateSubPath(p, currentPathPosFt, (task?.elementTime || 0) * 15),
                    color: elementColorScale(index),
                    lineCap: 'round'
                });
                currentPathPosFt += (task?.elementTime || 0) * 15;
            });
        }

        if (allPoints.length === 0) return; // Exit if no points were generated.

        // --- Scaling and Translation ---

        // Calculate the bounding box of the entire assembly line path.
        const minX_ft = d3.min(allPoints, d => d.x);
        const maxX_ft = d3.max(allPoints, d => d.x);
        const minY_ft = d3.min(allPoints, d => d.y);
        const maxY_ft = d3.max(allPoints, d => d.y);

        if ((maxX_ft - minX_ft) <= 0 || (maxY_ft - minY_ft) <= 0) return; // Exit if path has no area.

        // Determine the scale factor to fit the path within the available SVG panel space.
        const lineBBox = { width: maxX_ft - minX_ft, height: maxY_ft - minY_ft };
        const availableLineWidth = leftPanelWidth - (uiPadding * 2);
        const availableLineHeight = containerHeight - (uiPadding * 2.5);
        const scale = Math.min(availableLineWidth / lineBBox.width, availableLineHeight / lineBBox.height);

        // Calculate translation needed to center the scaled path.
        const scaledLineWidth = lineBBox.width * scale;
        const leftPadding = (leftPanelWidth - scaledLineWidth) / 1.5;
        const translateX = (leftPadding - (minX_ft * scale));
        const translateY = uiPadding - (minY_ft * scale);
        const g = svg.append("g")
            .attr("transform", `translate(${translateX}, ${translateY}) scale(${scale})`)
            .attr("fill", "none"); // Create the main group for the layout.

        // --- UI Element Positioning ---

        const clockY = containerHeight * 0.09;
        const clockX = rightPanelX + (rightPanelWidth / 2) - (containerWidth * 0.02);
        const clockRadius = Math.min(rightPanelWidth * 0.5, containerHeight * 0.15 * 0.5);
        const speedoY = containerHeight * 0.35;
        const speedoX = clockX + (containerWidth * 0.02);
        const speedoRadius = Math.min(rightPanelWidth * 0.5, containerHeight * 0.15 * 0.5);

        // --- Clock ---

        // Draw the clock face and hands.
        const clockGroup = svg.append("g")
            .attr("transform", `translate(${clockX + (containerWidth * 0.01)}, ${clockY})`); // Position the clock group.

        // Clock face
        clockGroup.append("circle")
            .attr("r", clockRadius)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke", getComputedStyle(root).getPropertyValue('--idle-color'))
            .attr("stroke-width", 2);

        // Clock ticks
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * 2 * Math.PI;
            const tickLength = i % 3 === 0 ? 8 : 4;
            clockGroup.append("line")
                .attr("x1", Math.sin(angle) * (clockRadius - tickLength))
                .attr("y1", -Math.cos(angle) * (clockRadius - tickLength))
                .attr("x2", Math.sin(angle) * clockRadius)
                .attr("y2", -Math.cos(angle) * clockRadius)
                .attr("stroke", getComputedStyle(root).getPropertyValue('--idle-color'))
                .attr("stroke-width", i % 3 === 0 ? 2 : 1);
        }

        // Hour hand
        clockGroup.append("line")
            .attr("id", "sim-clock-hour-hand")
            .attr("y2", -clockRadius * 0.5)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--secondary1'))
            .attr("stroke-width", 4)
            .attr("stroke-linecap", "round");

        // Minute hand
        clockGroup.append("line")
            .attr("id", "sim-clock-minute-hand")
            .attr("y2", -clockRadius * 0.8)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--secondary1'))
            .attr("stroke-width", 2)
            .attr("stroke-linecap", "round");

        // Center pin
        clockGroup.append("circle")
            .attr("r", 4)
            .attr("fill", getComputedStyle(root).getPropertyValue('--idle-color'));

        // --- Speed Slider ---

        const sliderTopPadding = uiPadding * 1.1;
        const sliderHeight = (clockRadius * 2) - sliderTopPadding;
        const sliderGroup = svg.append("g")
            .attr("transform", `translate(${clockX + clockRadius + (containerWidth * 0.025)}, ${sliderTopPadding})`);

        // Vertical scale: bottom is slower, top is faster
        const speedScale = d3.scaleLinear()
            .domain([0.1, 8.0])
            .range([sliderHeight, 0])
            .clamp(true);

        // Slider track
        sliderGroup.append("line")
            .attr("class", "track")
            .attr("y1", 0)
            .attr("y2", sliderHeight)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 4)
            .attr("stroke-linecap", "round");

        // Slider handle
        sliderGroup.append("circle")
            .attr("id", "d3-layout-slider-handle")
            .attr("class", "handle")
            .attr("r", 8)
            .attr("fill", getComputedStyle(root).getPropertyValue('--secondary1').trim())
            .attr("stroke", getComputedStyle(root).getPropertyValue('--white').trim())
            .attr("stroke-width", 2)
            .attr("cy", speedScale(animationState.speedMultiplier));

        // Larger invisible area for easier interaction
        const interactionArea = sliderGroup.append("rect")
            .attr("y", 0)
            .attr("height", sliderHeight)
            .attr("x", -10)
            .attr("width", 20)
            .style("fill", "transparent")
            .style("cursor", "grab")
            .style("touch-action", "none");

        // Helper to update speed based on pointer position.
        const setFromPointer = (event) => {
            const getLocalY = (evt) => (evt && evt.sourceEvent && typeof evt.y === 'number')
                ? evt.y
                : d3.pointer(evt && evt.sourceEvent ? evt.sourceEvent : evt, sliderGroup.node())[1];
            const localY = Math.max(0, Math.min(sliderHeight, getLocalY(event)));
            const newValue = speedScale.invert(localY);
            animationState.speedMultiplier = newValue;
            sliderGroup.select(".handle")
                .attr("cy", speedScale(newValue));
        };

        // Speed slider event listeners (drag, click, wheel).
        interactionArea
            .on("mousedown", function () {
                d3.select(this).style("cursor", "grabbing");
            })
            .on("mouseup", function () {
                d3.select(this).style("cursor", "grab");
            })
            .on("click", (event) => {
                const localY = Math.max(0, Math.min(sliderHeight, d3.pointer(event, sliderGroup.node())[1]));
                animationState.speedMultiplier = speedScale.invert(localY);
                sliderGroup.select(".handle")
                    .attr("cy", speedScale(animationState.speedMultiplier));
            })
            .call(d3.drag().on("drag", (event) => {
                const localY = Math.max(0, Math.min(sliderHeight, event.y));
                animationState.speedMultiplier = speedScale.invert(localY);
                sliderGroup.select(".handle")
                    .attr("cy", speedScale(animationState.speedMultiplier));
            }));

        // Add wheel support for fine-tuning speed.
        interactionArea.on("wheel", function (event) {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.1 : 0.1;
            animationState.speedMultiplier = Math.max(0.1, Math.min(8.0, animationState.speedMultiplier + delta));
            d3.select("#d3-layout-slider-handle").attr("cy", speedScale(animationState.speedMultiplier));
        });

        // Add label for the speed slider.
        sliderGroup.append("text")
            .attr("y", sliderHeight + 20)
            .attr("text-anchor", "middle")
            .style("font-size", "0.7rem")
            .style("fill", getComputedStyle(root).getPropertyValue('--accent'))
            .text("Speed");

        // --- Animation Controls (Play/Pause, Reset) ---

        // Position controls below clock
        const controlsGroup = svg.append("g")
            .attr("transform", `translate(${clockX + (containerWidth * 0.01)}, ${clockY + clockRadius + 15})`)

        const playPauseBtn = controlsGroup.append("g")
            .attr("class", "play-pause-btn")
            .attr("transform", `translate(-32, 0)`)
            .style("cursor", "pointer");

        playPauseBtn.append("rect")
            .attr("width", 28)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);

        // Default to pause icon.
        const playPauseIcon = playPauseBtn.append("text")
            .attr("x", 14)
            .attr("y", 13)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "14px")
            .text("⏸");

        const resetBtn = controlsGroup.append("g")
            .attr("class", "reset-btn")
            .attr("transform", "translate(0, 0)")
            .style("cursor", "pointer");

        resetBtn.append("rect")
            .attr("width", 28)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);

        // Reset icon.
        resetBtn.append("text")
            .attr("x", 14)
            .attr("y", 13)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "13px")
            .text("⟳");

        const skipBtn = controlsGroup.append("g")
            .attr("class", "skip-btn")
            .attr("transform", `translate(32, 0)`)
            .style("cursor", "pointer");

        skipBtn.append("rect")
            .attr("width", 28)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);

        // Skip to end icon.
        skipBtn.append("text")
            .attr("x", 14)
            .attr("y", 13)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "13px")
            .text("⏭");

        // --- Speedometer ---

        const speedoGroup = svg.append("g")
            .attr("transform", `translate(${speedoX}, ${speedoY})`); // Position speedometer group.
        const speedoDomain = [0, 15]; // ft/min
        const colorThresholds = { slow: 4, medium: 10 };
        const radianScale = d3.scaleLinear()
            .domain(speedoDomain)
            .range([-Math.PI / 2, Math.PI / 2]); // Map speed to angle.
        const arcGenerator = d3.arc()
            .innerRadius(speedoRadius * 0.7)
            .outerRadius(speedoRadius)
            .cornerRadius(3);
        const arcs = [
            // Define colored arcs for the speedometer face.
            { start: speedoDomain[0], end: colorThresholds.slow, color: getComputedStyle(root).getPropertyValue('--secondary2').trim() },
            { start: colorThresholds.slow, end: colorThresholds.medium, color: getComputedStyle(root).getPropertyValue('--primary').trim() },
            { start: colorThresholds.medium, end: speedoDomain[1], color: getComputedStyle(root).getPropertyValue('--secondary1').trim() }
        ];

        // Draw the arcs
        speedoGroup.selectAll("path.color-arc")
            .data(arcs)
            .join("path")
            .attr("class", "color-arc")
            .attr("fill", d => d.color)
            .attr("d", d => arcGenerator({ startAngle: radianScale(d.start), endAngle: radianScale(d.end) }));

        const ticks = radianScale.ticks(6);

        // Draw tick labels
        speedoGroup.selectAll("text.tick-label")
            .data(ticks)
            .join("text")
            .attr("class", "tick-label")
            .attr("x", d => Math.sin(radianScale(d)) * (speedoRadius + 15))
            .attr("y", d => -Math.cos(radianScale(d)) * (speedoRadius + 15))
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-size", "12px")
            .style("font-weight", "700")
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent'))
            .text(d => d3.format("d")(d));

        // Calculate target angle for the needle
        const targetAngleDeg = (radianScale(Math.min(speedoDomain[1], results.conveyorSpeed || 0)) * 180 / Math.PI);
        const needle = speedoGroup.selectAll("line.speedo-needle")
            .data([targetAngleDeg]);

        // Create needle at previous angle then animate to target.
        needle.enter()
            .append("line")
            .attr("class", "speedo-needle")
            .attr("id", "speedo-needle")
            .attr("y1", 10)
            .attr("y2", -speedoRadius * 0.9)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 4)
            .attr("stroke-linecap", "round")
            .attr("transform", `rotate(${animationState.speedo.currentAngle})`) // Start at previous angle.
            .merge(needle)
            .transition()
            .duration(750)
            .attrTween("transform", function (d) {
                // Animate rotation from old angle to new.
                const startAngle = animationState.speedo.currentAngle;
                const i = d3.interpolate(startAngle, d);
                return t => `rotate(${i(t)})`;
            })
            .on("end", () => {
                animationState.speedo.currentAngle = targetAngleDeg; // Store the new angle for next update.
            });

        needle.exit().remove();

        // Needle center pin
        speedoGroup.append("circle")
            .attr("r", 8)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke", getComputedStyle(root).getPropertyValue('--white'))
            .attr("stroke-width", 2);

        // Digital speed readout
        speedoGroup.append("text")
            .text(`${(results.conveyorSpeed || 0).toFixed(1)}`)
            .attr("y", speedoRadius * 0.5)
            .attr("text-anchor", "middle")
            .style("font-size", `${speedoRadius * 0.25}px`)
            .style("font-weight", "bold")
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent'));

        // Units label
        speedoGroup.append("text")
            .text("ft/min")
            .attr("y", speedoRadius * 0.75)
            .attr("text-anchor", "middle")
            .style("font-size", `${speedoRadius * 0.2}px`)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent'));

        // --- Finished Goods Bin ---

        const binAreaTopY = speedoY + speedoRadius - (uiPadding * 0.75);
        const binAreaHeight = (containerHeight - uiPadding) - binAreaTopY;
        const maxContentWidth = rightPanelWidth - (uiPadding * 2);
        const maxContentHeight = binAreaHeight;

        // Calculate a grid layout for finished products.
        const capacity = 552;
        const aspectRatio = maxContentWidth / maxContentHeight;
        let numRows = Math.round(Math.sqrt(capacity / aspectRatio));
        if (numRows < 1) numRows = 1;
        let numCols = Math.ceil(capacity / numRows);
        if (numCols < 1) numCols = 1;

        const itemSizeWithPadding = Math.min(maxContentWidth / numCols, maxContentHeight / numRows);
        const itemPadding = itemSizeWithPadding * 0.1;
        const finalItemSize = itemSizeWithPadding - itemPadding;

        const finalContentWidth = numCols * itemSizeWithPadding;
        const correctedVisualWidth = finalContentWidth - (itemSizeWithPadding);

        // Center the bin within the right panel.
        const rightPanelCenterX = rightPanelX + (rightPanelWidth / 2);
        const binContentStartX = rightPanelCenterX - (correctedVisualWidth / 2);
        const finalContentHeight = numRows * itemSizeWithPadding;
        const binAreaCenterY = binAreaTopY + (binAreaHeight / 2);
        const binContentStartY = binAreaCenterY - (finalContentHeight / 2);

        // Store bin configuration for the simulation.
        const binConfig = {
            productPixelSize: finalItemSize,
            itemsPerRow: numCols,
            padding: itemPadding,
            binPixelX: rightPanelCenterX - (finalContentWidth / 2),
            binPixelY_bottom: binContentStartY + finalContentHeight
        };

        // Draw the visual rectangle for the bin.
        svg.append("rect")
            .attr("x", binContentStartX)
            .attr("y", binContentStartY)
            .attr("width", correctedVisualWidth)
            .attr("height", finalContentHeight)
            .attr("fill", getComputedStyle(root).getPropertyValue('--idle-color'))
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke-width", 1);

        // Draw the bin title.
        svg.append("text")
            .text("Finished Goods")
            .attr("x", rightPanelCenterX)
            .attr("y", binContentStartY * 1.1)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .style("font-weight", "bold")
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent'));

        // --- Legend and Grid ---
        const legendWidth = 160;
        const legendHeight = 110;
        const legendX = containerWidth * 0.01;
        const legendY = binContentStartY + finalContentHeight - legendHeight;
        const legendGroup = svg.append("g")
            .attr("transform", `translate(${legendX}, ${legendY})`);
        legendGroup.append("rect")
            .attr("width", legendWidth)
            .attr("height", legendHeight)
            .attr("rx", 5)
            .classed("legend-box", true);

        legendGroup.append("text")
            .text("Legend")
            .attr("x", legendWidth / 2)
            .attr("y", 20)
            .attr("text-anchor", "middle")
            .classed("legend-title", true);

        const itemsGrid = [
            [
                { label: "Super", color: getComputedStyle(root).getPropertyValue('--super-color').trim() },
                { label: "Ultra", color: getComputedStyle(root).getPropertyValue('--ultra-color').trim() }
            ],
            [
                { label: "Mega", color: getComputedStyle(root).getPropertyValue('--mega-color').trim() },
                { label: "Idle", color: getComputedStyle(root).getPropertyValue('--idle-color').trim() }
            ]
        ];

        const gridStartX = 15;
        const gridStartY = 45;
        const rowGap = 25;
        const colGap = 75;

        itemsGrid.forEach((rowItems, rowIndex) => {
            rowItems.forEach((item, colIndex) => {
                const xPos = gridStartX + colIndex * colGap;
                const yPos = gridStartY + rowIndex * rowGap;

                legendGroup.append("rect")
                    .attr("x", xPos)
                    .attr("y", yPos - 8)
                    .attr("width", 10)
                    .attr("height", 10)
                    .attr("fill", item.color)
                    .attr("rx", 2);

                legendGroup.append("text")
                    .text(item.label)
                    .attr("x", xPos + 15)
                    .attr("y", yPos + 1)
                    .classed("legend-item-text", true)
                    .style("font-size", "12px")
                    .style("fill", getComputedStyle(root).getPropertyValue('--accent').trim());
            });
        });

        const squareGroup = legendGroup.append("g")
            .attr("transform", `translate(0, ${legendHeight - 15})`);

        squareGroup.append("rect")
            .attr("x", gridStartX)
            .attr("y", -8)
            .attr("width", 10)
            .attr("height", 10)
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 2);

        squareGroup.append("text")
            .attr("x", gridStartX + 15)
            .attr("y", 1)
            .classed("legend-item-text", true)
            .text("Grid Size: 10 ft x 10 ft")
            .style("font-size", "12px")
            .style("fill", getComputedStyle(root).getPropertyValue('--accent').trim());

        // Draw the background grid for scale reference.
        const gridGroup = g.append("g");
        const gridBounds = {
            x1: (0 - translateX) / scale,
            y1: (0 - translateY) / scale,
            x2: (containerWidth - translateX) / scale,
            y2: (containerHeight - translateY) / scale
        };
        for (let x = Math.floor(gridBounds.x1 / 10) * 10; x <= gridBounds.x2; x += 10) {
            gridGroup.append("line")
                .attr("x1", x)
                .attr("y1", gridBounds.y1)
                .attr("x2", x)
                .attr("y2", gridBounds.y2);
        }
        for (let y = Math.floor(gridBounds.y1 / 10) * 10; y <= gridBounds.y2; y += 10) {
            gridGroup.append("line")
                .attr("x1", gridBounds.x1)
                .attr("y1", y)
                .attr("x2", gridBounds.x2)
                .attr("y2", y);
        }

        // Style the grid lines
        gridGroup.selectAll("line")
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke-width", 0.2)
            .attr("opacity", 0.1);

        // --- Draw Layout Paths ---

        const reversedPaths = [...allPaths].reverse();
        g.selectAll("g.element-group")
            .data(reversedPaths, d => `${d.wsId}-${d.elId}`)
            .join("g")
            .attr("class", "element-group")
            .each(function (d) {
                // 'this' is the <g> element
                const group = d3.select(this);

                // Draw the outer border path (this will be the main hover target)
                // Increased stroke-width slightly to make hovering easier
                group.append("path")
                    .attr("d", d.path)
                    .attr("stroke", "transparent") // Make it invisible
                    .attr("stroke-width", 4) // Give it a wide hover area
                    .attr("stroke-linecap", d.lineCap)
                    .style("pointer-events", "stroke"); // Only trigger on the stroke area

                // Draw the visible accent border
                group.append("path")
                    .attr("d", d.path)
                    .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
                    .attr("stroke-width", 2.25)
                    .attr("stroke-linecap", d.lineCap)
                    .style("pointer-events", "none"); // Pass clicks through

                // Draw the inner colored path
                group.append("path")
                    .attr("d", d.path)
                    .attr("stroke", d.color)
                    .attr("stroke-width", 1.75)
                    .attr("stroke-linecap", d.lineCap)
                    .style("pointer-events", "none"); // Pass clicks through
            })
            // Add the new tooltip events to the group itself
            .on("mouseover", (event, d) => {
                const task = state.taskData.get(d.elId);
                // Use fallback for labor time, consistent with Precedence tab
                const laborTime = (task?.laborTime || PERT_LABOR_FALLBACK[d.elId] || 0).toFixed(2);
                const description = task?.description || "No description available";

                layoutTooltip.style("opacity", 1)
                    .html(
                        `<div class="tooltip-header">Element ${d.elId} (WorkStation ${d.wsId})</div>
<div class="tooltip-row"><span>Description:</span> <span>${description}</span></div>`
                    );
            })
            .on("mousemove", (event) => {
                // Use standard tooltip positioning logic
                const tooltipNode = layoutTooltip.node();
                if (!tooltipNode) return;
                const { width, height } = tooltipNode.getBoundingClientRect();
                const padding = 15;
                let left = event.pageX + padding;
                let top = event.pageY + padding;
                if (left + width > window.innerWidth) { left = event.pageX - width - padding; }
                if (top + height > window.innerHeight) { top = event.pageY - height - padding; }
                layoutTooltip.style("left", `${left}px`).style("top", `${top}px`);
            })
            .on("mouseout", () => {
                layoutTooltip.style("opacity", 0);
            });

        g.selectAll("path.workstation-border")
            .data(workstationBorders, d => d.wsId)
            .join("path")
            .attr("class", "workstation-border")
            .attr("d", d => d.path)
            .attr("fill", "none")
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke-width", 0.3)
            .attr("stroke-linecap", "butt")
            .attr("opacity", 0.6); // Faint workstation outlines.

        // --- Simulation Setup and Initialization ---

        const totalDurationMin = (ASSEMBLY_LINE_LENGTH / results.conveyorSpeed);
        const launchDelayMin = (results.productSpacing / results.conveyorSpeed);

        // Only start the simulation if the calculated times are valid.
        if (isFinite(totalDurationMin) && totalDurationMin > 0 && isFinite(launchDelayMin) && launchDelayMin > 0) {
            // Create a single master path for animating the products.
            let masterPathString = "";
            allPaths.forEach((pathData, i) => {
                masterPathString += i === 0 ? pathData.path : pathData.path.replace('M', ' ');
            });
            const masterPathNode = g.append("path").attr("d", masterPathString).node();

            // Map element IDs to their start/end distances along the master path.
            let cumulativeDist = 0;
            const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const elementMap = allPaths.map(p => {
                tempPath.setAttribute('d', p.path);
                const len = tempPath.getTotalLength();
                const segment = { elementId: p.elId, startDist: cumulativeDist, endDist: cumulativeDist + len };
                cumulativeDist += len;
                return segment;
            });

            // The main configuration object passed to the animation engine.
            const simulationConfig = {
                svg,
                g,
                masterPathNode,
                elementMap,
                opHours: opInputs.opHours,
                productionQueue: generateProductionQueue(opInputs.dailyDemand),
                totalDurationMs: (ASSEMBLY_LINE_LENGTH / results.conveyorSpeed) * 1000 * 60, // Adjusted for matching time scale
                launchDelayMs: (results.productSpacing / results.conveyorSpeed) * 1000 * 60, // Adjusted for matching time scale
                binConfig,
                scale
            };

            // Add event listeners for the play/pause and reset buttons.
            playPauseBtn.on("click", () => {
                animationState.layout.isPaused = !animationState.layout.isPaused;
                animationState.layout.isManuallyPaused = animationState.layout.isPaused;
                playPauseBtn.select('text').text(animationState.layout.isPaused ? "▶" : "⏸");
                if (!animationState.layout.isPaused && !animationState.layout.isRunning) {
                    svg.selectAll(".product-shape").remove();
                    startSimulation(simulationConfig);
                }
            });

            resetBtn.on("click", () => {
                stopAllSimulations();
                animationState.layout.isPaused = false;
                animationState.layout.isManuallyPaused = false;
                playPauseBtn.select('text').text("⏸");
                svg.selectAll(".product-shape").remove();
                startSimulation(simulationConfig);
            });

            skipBtn.on("click", () => {
                // Stop current simulation
                const layout = animationState.layout || {};
                if (layout.frameId) {
                    cancelAnimationFrame(layout.frameId);
                    layout.frameId = null;
                }
                layout.isRunning = false;

                // Clear any products on the line
                if (Array.isArray(layout.productsOnLine)) {
                    layout.productsOnLine.forEach(p => p.element && p.element.remove());
                    layout.productsOnLine = [];
                }

                // Remove any existing products in bin
                svg.selectAll(".product-shape").remove();

                // Place all products in bin (use the runtime layout.binConfig; fallback to local binConfig if present)
                const queue = Array.isArray(layout.productionQueue) ? layout.productionQueue : [];
                const binCfg = layout.binConfig || (typeof binConfig !== 'undefined' ? binConfig : null);
                for (let i = 0; i < queue.length; i++) {
                    const modelId = queue[i];
                    const element = createProductShape(g, modelId);
                    if (binCfg) {
                        placeInBin(element, i, binCfg, svg);
                    } else {
                        // If no bin config available, just remove any created element to avoid dangling shapes
                        element && element.remove();
                    }
                }

                layout.finishedGoodsCount = queue.length;
                layout.queueIndex = queue.length;

                // Set clock to end time using the layout's timing values (guard against missing values)
                const launchMs = layout.launchDelayMs || 0;
                const totalDurMs = layout.totalDurationMs || 0;
                const totalSimTimeMs = (launchMs * Math.max(0, queue.length - 1)) + totalDurMs;
                layout.totalSimTimeMs = totalSimTimeMs;
                const simMinutes = (totalSimTimeMs / 1000) / 60;
                const simHours = simMinutes / 60;
                d3.select("#sim-clock-minute-hand").attr("transform", `rotate(${(simMinutes % 60) / 60 * 360})`);
                d3.select("#sim-clock-hour-hand").attr("transform", `rotate(${(simHours % 12) / 12 * 360})`);

                // Set to paused state
                layout.isPaused = true;
                layout.isManuallyPaused = true;
                animationState.layout = layout;
                playPauseBtn.select('text').text("▶");
            });

            // Start the simulation automatically.
            startSimulation(simulationConfig);
        }
    }

    // --- INNER HELPER FUNCTIONS ---

    /**
     * Creates an SVG shape (circle, square, or triangle) for a product model.
     * @param {d3.Selection} container - The parent D3 selection to append the shape to.
     * @param {number} modelId - The ID of the model (1=Super, 2=Ultra, 3=Mega).
     * @returns {d3.Selection} The created shape selection.
     */
    function createProductShape(container, modelId) {
        // Map model IDs to colors and shapes.
        const modelColors = {
            1: getComputedStyle(root).getPropertyValue('--super-color'),
            2: getComputedStyle(root).getPropertyValue('--ultra-color'),
            3: getComputedStyle(root).getPropertyValue('--mega-color')
        };
        const modelBorders = {
            1: getComputedStyle(root).getPropertyValue('--secondary1'),
            2: getComputedStyle(root).getPropertyValue('--secondary2'),
            3: getComputedStyle(root).getPropertyValue('--primary')
        };
        const modelShapes = { 1: 'square', 2: 'triangle', 3: 'circle' };
        const shapeType = modelShapes[modelId];

        // Define shape-specific dimensions.
        let shapeSize = 1.5;
        let shape;
        if (shapeType === 'circle') {
            shapeSize = 1.55;
            shape = container.append("circle").attr("r", shapeSize / 2);
        } else if (shapeType === 'square') {
            shapeSize = 1.55;
            shape = container.append("rect")
                .attr("x", -shapeSize / 2)
                .attr("y", -shapeSize / 2)
                .attr("width", shapeSize)
                .attr("height", shapeSize);
        } else if (shapeType === 'triangle') {
            shapeSize = 1.47;
            const h = shapeSize * (Math.sqrt(3) / 2);
            shape = container.append("polygon")
                .attr("points", `0,${-h / 1.5} ${shapeSize / 1.5},${h / 2} ${-shapeSize / 1.5},${h / 2}`);
        }

        // Apply common styles to the created shape.
        if (shape) {
            shape
                .attr("fill", modelColors[modelId])
                .attr("stroke", modelBorders[modelId])
                .attr("stroke-width", 0.2)
                .attr("class", "product-shape")
                .style("pointer-events", "none");
        }
        return shape;
    }

    /**
     * Moves a product shape to its final position in the finished goods bin.
     * @param {d3.Selection} element - The product shape to move.
     * @param {number} count - The zero-indexed count of finished goods.
     * @param {object} binConfig - The configuration object for the bin layout.
     * @param {d3.Selection} svg - The main SVG container.
     */
    function placeInBin(element, count, binConfig, svg) {
        const { binPixelX, binPixelY_bottom, itemsPerRow, productPixelSize, padding } = binConfig;
        const row = Math.floor(count / itemsPerRow);
        const col = count % itemsPerRow;

        // Move the element from the main 'g' group to the top-level 'svg' to escape the scaling transform.
        svg.node().appendChild(element.node());

        // Calculate the new pixel coordinates within the bin.
        const newX = binPixelX + (padding / 2) + (col * productPixelSize) + (productPixelSize / 2) + (productPixelSize * 0.75); // Adjusted for centering
        const newY = binPixelY_bottom - (padding / 2) - (row * productPixelSize) - (productPixelSize / 2);
        const newScale = productPixelSize / 1.8; // Scale the shape to fit the bin slot.

        // Animate the element to its final position and scale.
        element.transition().duration(300).attr('transform', `translate(${newX}, ${newY}) rotate(0) scale(${newScale})`);
    }

    /**
     * Generates an SVG path string for a portion of a larger path.
     * @param {Array<object>} points - The array of {x, y} points defining the full path.
     * @param {number} startFt - The starting distance in feet.
     * @param {number} lengthFt - The length of the sub-path in feet.
     * @returns {string} The SVG path data string.
     */
    function generateSubPath(points, startFt, lengthFt) {
        let pathString = "M ";
        let traveledFt = 0;
        let started = false;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const segLenFt = Math.sqrt(Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2));

            // Find the start point of the sub-path.
            if (!started && traveledFt + segLenFt >= startFt) {
                const ratio = segLenFt > 0 ? (startFt - traveledFt) / segLenFt : 0;
                pathString += `${prev.x + ratio * (curr.x - prev.x)} ${prev.y + ratio * (curr.y - prev.y)}`;
                started = true;
            }

            // Add points to the path until the desired length is reached.
            if (started) {
                if (traveledFt + segLenFt <= startFt + lengthFt) {
                    pathString += ` L ${curr.x} ${curr.y}`;
                } else {
                    const ratio = segLenFt > 0 ? (startFt + lengthFt - traveledFt) / segLenFt : 0;
                    pathString += ` L ${prev.x + ratio * (curr.x - prev.x)} ${prev.y + ratio * (curr.y - prev.y)}`;
                    return pathString; // End the path here.
                }
            }
            traveledFt += segLenFt;
        }
        return pathString;
    }

    /**
     * Initializes and runs the main animation loop for the layout simulation.
     * @param {object} config - The master configuration object for the simulation.
     */
    function startSimulation(config) {
        stopAllSimulations(); // Ensure no other loops are running.
        let { svg, g, masterPathNode, productionQueue, totalDurationMs, launchDelayMs, binConfig, elementMap } = config;
        if (!masterPathNode || totalDurationMs <= 0 || launchDelayMs <= 0) return; // Validate inputs.

        // Initialize the animation state object.
        const now = performance.now();
        animationState.layout = {
            ...config,
            isRunning: true,
            isPaused: false,
            lastFrameTime: now,
            totalSimTimeMs: 0,
            nextLaunchTime: 0,
            productsOnLine: [],
            queueIndex: 0,
            finishedGoodsCount: 0,
            pathLength: masterPathNode.getTotalLength()
        };

        // The core animation loop.
        function animationLoop(currentTime) {
            if (!animationState.layout.isRunning) return;

            const speedMultiplier = animationState.speedMultiplier;
            const realDeltaMs = currentTime - animationState.layout.lastFrameTime;
            animationState.layout.lastFrameTime = currentTime;

            // Advance simulation time if not paused.
            if (!animationState.layout.isPaused) {
                const simDeltaMs = realDeltaMs * speedMultiplier * 60; // Match Schedule.js acceleration
                animationState.layout.totalSimTimeMs += simDeltaMs;
            }

            // Update the clock display.
            const elapsedSimTimeMs = animationState.layout.totalSimTimeMs;
            const simMinutes = (elapsedSimTimeMs / 1000) / 60;
            const simHours = simMinutes / 60;
            d3.select("#sim-clock-minute-hand").attr("transform", `rotate(${(simMinutes % 60) / 60 * 360})`);
            d3.select("#sim-clock-hour-hand").attr("transform", `rotate(${(simHours % 12) / 12 * 360})`);

            // Launch a new product if it's time.
            if (
                animationState.layout.totalSimTimeMs >= animationState.layout.nextLaunchTime &&
                animationState.layout.queueIndex < animationState.layout.productionQueue.length
            ) {
                const modelId = animationState.layout.productionQueue[animationState.layout.queueIndex];
                animationState.layout.productsOnLine.push({
                    modelId: modelId,
                    launchTime: animationState.layout.totalSimTimeMs,
                    element: createProductShape(g, modelId)
                });
                animationState.layout.queueIndex++;
                animationState.layout.nextLaunchTime += animationState.layout.launchDelayMs;
            }

            // Update the position of each product on the line.
            for (let i = animationState.layout.productsOnLine.length - 1; i >= 0; i--) {
                const product = animationState.layout.productsOnLine[i];
                const progress = (animationState.layout.totalSimTimeMs - product.launchTime) / animationState.layout.totalDurationMs;

                if (progress >= 1) {
                    // Product has reached the end of the line.
                    placeInBin(product.element, animationState.layout.finishedGoodsCount, animationState.layout.binConfig, svg);
                    animationState.layout.finishedGoodsCount++;
                    animationState.layout.productsOnLine.splice(i, 1);
                } else {
                    // Product is still on the line.
                    const distance = animationState.layout.pathLength * progress;
                    const pos = animationState.layout.masterPathNode.getPointAtLength(distance); // Get current point on path.
                    const nextPos = animationState.layout.masterPathNode.getPointAtLength(distance + 1); // Get next point to calculate angle.
                    const angle = Math.atan2(nextPos.y - pos.y, nextPos.x - pos.x) * 180 / Math.PI; // Calculate rotation.

                    // Add shape-specific offset to better center shapes on the path.
                    const modelShapes = { 1: 'square', 2: 'triangle', 3: 'circle' };
                    const shapeType = modelShapes[product.modelId];
                    let offset = 0.1;
                    if (shapeType === 'circle') offset = 0;
                    if (shapeType === 'square') offset = 0.01;
                    if (shapeType === 'triangle') offset = 0.14;

                    const perpAngle = angle + 90; // Perpendicular angle for offset.
                    const offsetX = Math.cos(perpAngle * Math.PI / 180) * offset;
                    const offsetY = Math.sin(perpAngle * Math.PI / 180) * offset;

                    product.element.attr('transform', `translate(${pos.x + offsetX},${pos.y + offsetY}) rotate(${angle})`);

                    // Change product color to idle if the current element isn't used for its model type.
                    const currentSegment = elementMap.find(e => distance >= e.startDist && distance < e.endDist);
                    product.element.attr(
                        'fill',
                        (currentSegment && doesElementBuildModel(currentSegment.elementId, product.modelId))
                            ? getComputedStyle(root).getPropertyValue(`--${modelShapes[product.modelId] === 'square' ? 'super' : modelShapes[product.modelId] === 'triangle' ? 'ultra' : 'mega'}-color`).trim()
                            : getComputedStyle(root).getPropertyValue('--idle-color')
                    );
                }
            }

            // Continue the loop if there are products on the line or in the queue.
            if (animationState.layout.productsOnLine.length > 0 || animationState.layout.queueIndex < animationState.layout.productionQueue.length) {
                animationState.layout.frameId = requestAnimationFrame(animationLoop);
            } else {
                animationState.layout.isRunning = false;
            }
        }

        animationState.layout.frameId = requestAnimationFrame(animationLoop); // Start the first frame.
    }

    // Expose the public draw method.
    return {
        draw: draw
    };
})();