/**
* ====================================================================
* ScheduleTab IIFE Module
*
* Encapsulates all logic for rendering and animating the Schedule
* Gantt chart visualization.
* ====================================================================
*/
const ScheduleTab = (function () {
    /**
     * @tab Schedule
     * Draws the animated Gantt chart for the production schedule.
     * This is the main public method exposed by the IIFE.
     */
    function draw() {
        // --- INITIAL SETUP ---
        // Filter state for toggling product visibility on the chart.
        let activeProductFilters = {
            1: true, // Super (modelId 1)
            2: true, // Ultra (modelId 2)
            3: true // Mega (modelId 3)
        };
        // The default duration of the animated view window in simulation minutes.
        const VIEW_WINDOW_MINS = 10;
        // State for managing the view's zoom level and pause state.
        let zoomLevel = 1.0; // 1.0 = normal, >1 = zoom in, <1 = zoom out.
        let isPaused = false;
        let currentViewWindow = VIEW_WINDOW_MINS; // The current view window, adjusted by zoom.
        // --- SVG & DATA PREPARATION ---
        // Select the SVG container and clear any previous renderings.
        const svg = d3.select("#schedule-panel");
        svg.selectAll("*").remove();
        svg.selectAll(".workstation-schedule-label").remove(); // Clear any lingering labels.
        // Run the Gantt simulation to get task data.
        const simulationResult = runGanttSimulation();
        const { clientWidth: containerWidth, clientHeight: containerHeight } = document.getElementById('svg-container');
        // If the simulation returns no tasks, display a message and exit.
        if (!simulationResult || simulationResult.tasks.length === 0) {
            svg.append("text").attr("x", containerWidth / 2).attr("y", containerHeight / 2).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
                .text("No data to display. Check configuration or inputs.");
            return;
        }
        const { tasks } = simulationResult;
        const opHours = parseFloat(opHoursInput.value);
        // Define chart margins and dimensions.
        const margin = { top: 40, right: 20, bottom: 40, left: 100 };
        const width = containerWidth - margin.left - margin.right;
        const height = containerHeight - margin.top - margin.bottom;
        // Create the main chart group, translated by the margin.
        const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const controlsY = height + margin.top - 35;
        const controlsStartX = margin.left;
        // --- UI CONTROLS & DISPLAYS ---
        // Timer display for the simulation clock.
        const clockGroup = svg.append("g").attr("transform", `translate(${controlsStartX}, ${controlsY})`);
        clockGroup.append("rect").attr("x", 10).attr("y", -10).attr("width", 70).attr("height", 18).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("rx", 3); // Background rect
        const clockDisplay = clockGroup.append("text").attr("id", "sim-clock-display").attr("x", 26).attr("y", 3).attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "14px").style("font-family", "monospace").text("00:00"); // Time text
        // Production counters for each model type.
        const superCounter = svg.append("text").attr("id", "super-counter").attr("x", controlsStartX + 14).attr("y", controlsY + -60).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).style("font-size", "16px").text("Super: 0");
        const ultraCounter = svg.append("text").attr("id", "ultra-counter").attr("x", controlsStartX + 14).attr("y", controlsY + -40).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).style("font-size", "16px").text("Ultra: 0");
        const megaCounter = svg.append("text").attr("id", "mega-counter").attr("x", controlsStartX + 14).attr("y", controlsY + -20).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).style("font-size", "16px").text("Mega: 0");
        svg.append("text").attr("class", "product-title").attr("x", controlsStartX + 14).attr("y", controlsY + -80).attr("text-anchor", "start").attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).style("font-size", "14px").style("font-weight", "bold").text("Product"); // Section title
        // Product type filter controls (checkboxes).
        const superFilterGroup = svg.append("g").attr("class", "super-filter").attr("transform", `translate(${controlsStartX + 120}, ${controlsY - 71})`).style("cursor", "pointer"); // Super filter
        superFilterGroup.append("rect").attr("width", 12).attr("height", 12).attr("fill", activeProductFilters[1] ? getComputedStyle(root).getPropertyValue('--super-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim()).attr("stroke", getComputedStyle(root).getPropertyValue('--super-color').trim()).attr("stroke-width", 2).attr("rx", 2);
        if (activeProductFilters[1]) { superFilterGroup.append("text").attr("x", 6).attr("y", 9).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "10px").style("font-weight", "bold").text("✓"); } // Checkmark
        const ultraFilterGroup = svg.append("g").attr("class", "ultra-filter").attr("transform", `translate(${controlsStartX + 120}, ${controlsY - 51})`).style("cursor", "pointer"); // Ultra filter
        ultraFilterGroup.append("rect").attr("width", 12).attr("height", 12).attr("fill", activeProductFilters[2] ? getComputedStyle(root).getPropertyValue('--ultra-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim()).attr("stroke", getComputedStyle(root).getPropertyValue('--ultra-color').trim()).attr("stroke-width", 2).attr("rx", 2);
        if (activeProductFilters[2]) { ultraFilterGroup.append("text").attr("x", 6).attr("y", 9).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "10px").style("font-weight", "bold").text("✓"); } // Checkmark
        const megaFilterGroup = svg.append("g").attr("class", "mega-filter").attr("transform", `translate(${controlsStartX + 120}, ${controlsY - 31})`).style("cursor", "pointer"); // Mega filter
        megaFilterGroup.append("rect").attr("width", 12).attr("height", 12).attr("fill", activeProductFilters[3] ? getComputedStyle(root).getPropertyValue('--mega-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim()).attr("stroke", getComputedStyle(root).getPropertyValue('--mega-color').trim()).attr("stroke-width", 2).attr("rx", 2);
        if (activeProductFilters[3]) { megaFilterGroup.append("text").attr("x", 6).attr("y", 9).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "10px").style("font-weight", "bold").text("✓"); } // Checkmark
        svg.append("text").attr("class", "filter-title").attr("x", controlsStartX + 110).attr("y", controlsY - 80).attr("text-anchor", "start").attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).style("font-size", "14px").style("font-weight", "bold").text("Filter"); // Section title
        // Animation control buttons (Play/Pause, Reset).
        const controlsGroup = svg.append("g").attr("transform", `translate(${controlsStartX + 85}, ${controlsY - 10})`);
        const playPauseBtn = controlsGroup.append("g").attr("class", "play-pause-btn").style("cursor", "pointer"); // Play/Pause button
        playPauseBtn.append("rect").attr("width", 28).attr("height", 18).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("rx", 3);
        const playPauseIcon = playPauseBtn.append("text").attr("x", 14).attr("y", 13).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "14px").text("⏸");
        const resetBtn = controlsGroup.append("g").attr("class", "reset-btn").attr("transform", "translate(32, 0)").style("cursor", "pointer"); // Reset button
        resetBtn.append("rect").attr("width", 28).attr("height", 18).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("rx", 3);
        resetBtn.append("text").attr("x", 14).attr("y", 13).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "13px").text("⟳");
        // Filter reset button.
        const filterResetBtn = controlsGroup.append("g").attr("class", "filter-reset-btn").attr("transform", "translate(64, 0)").style("cursor", "pointer");
        filterResetBtn.append("rect").attr("width", 28).attr("height", 18).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("rx", 3);
        filterResetBtn.append("text").attr("x", 14).attr("y", 12).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "10px").text("RST");
        // Zoom controls.
        const zoomGroup = svg.append("g").attr("transform", `translate(${controlsStartX + 150}, ${controlsY - 10})`);
        const zoomInBtn = zoomGroup.append("g").attr("class", "zoom-in-btn").style("cursor", "pointer"); // Zoom In button
        zoomInBtn.append("rect").attr("width", 28).attr("height", 18).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("rx", 3);
        zoomInBtn.append("text").attr("x", 13.5).attr("y", 13).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "14px").text("+");
        const zoomOutBtn = zoomGroup.append("g").attr("class", "zoom-out-btn").attr("transform", "translate(32, 0)").style("cursor", "pointer"); // Zoom Out button
        zoomOutBtn.append("rect").attr("width", 28).attr("height", 18).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("rx", 3);
        zoomOutBtn.append("text").attr("x", 13.5).attr("y", 13).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "14px").text("-");
        // --- CONTROL EVENT LISTENERS ---
        // Play/Pause button functionality.
        playPauseBtn.on("click", function () {
            isPaused = !isPaused;
            animationState.schedule.isPaused = isPaused;
            playPauseIcon.text(isPaused ? "▶" : "⏸"); // Toggle icon.
            // If resuming, restart the animation loop if it's not already running.
            if (!isPaused && !animationState.schedule.isRunning) {
                animationState.schedule.isRunning = true;
                animationState.schedule.lastFrameTime = performance.now();
                animationState.schedule.frameId = requestAnimationFrame(animationLoop);
            }
        });
        // Reset button functionality.
        resetBtn.on("click", function () {
            animationState.schedule.totalSimTimeMins = 0; // Reset time to zero.
            animationState.schedule.lastFrameTime = performance.now();
            isPaused = false;
            animationState.schedule.isPaused = false;
            playPauseIcon.text("⏸");
            clockDisplay.text("00:00");
            // Restart animation loop if it was stopped.
            if (!animationState.schedule.isRunning) {
                animationState.schedule.isRunning = true;
                animationState.schedule.frameId = requestAnimationFrame(animationLoop);
            }
        });
        // Zoom In/Out functionality.
        zoomInBtn.on("click", function () {
            zoomLevel = Math.min(zoomLevel * 1.5, 4.0); // Increase zoom, max 4x.
            currentViewWindow = VIEW_WINDOW_MINS / zoomLevel; // Decrease view window duration.
        });
        zoomOutBtn.on("click", function () {
            zoomLevel = Math.max(zoomLevel / 1.5, 0.25); // Decrease zoom, min 0.25x.
            currentViewWindow = VIEW_WINDOW_MINS / zoomLevel; // Increase view window duration.
        });
        // Filter reset functionality.
        filterResetBtn.on("click", function () {
            // Reset all product filters to active.
            activeProductFilters[1] = true;
            activeProductFilters[2] = true;
            activeProductFilters[3] = true;
            updateFilterUI(); // Update checkbox visuals.
            updateTaskVisibility(); // Update task bar visibility.
        });
        // Individual product filter functionality.
        superFilterGroup.on("click", function () {
            activeProductFilters[1] = !activeProductFilters[1];
            updateFilterUI();
            updateTaskVisibility();
        });
        ultraFilterGroup.on("click", function () {
            activeProductFilters[2] = !activeProductFilters[2];
            updateFilterUI();
            updateTaskVisibility();
        });
        megaFilterGroup.on("click", function () {
            activeProductFilters[3] = !activeProductFilters[3];
            updateFilterUI();
            updateTaskVisibility();
        });
        // --- FILTER HELPER FUNCTIONS ---
        /**
         * Updates the visual state of the filter checkboxes.
         */
        function updateFilterUI() {
            // Update Super filter checkbox and checkmark.
            superFilterGroup.select("rect").attr("fill", activeProductFilters[1] ? getComputedStyle(root).getPropertyValue('--super-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim());
            superFilterGroup.selectAll("text").remove();
            if (activeProductFilters[1]) { superFilterGroup.append("text").attr("x", 6).attr("y", 9).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "10px").style("font-weight", "bold").text("✓"); }
            // Update Ultra filter checkbox and checkmark.
            ultraFilterGroup.select("rect").attr("fill", activeProductFilters[2] ? getComputedStyle(root).getPropertyValue('--ultra-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim());
            ultraFilterGroup.selectAll("text").remove();
            if (activeProductFilters[2]) { ultraFilterGroup.append("text").attr("x", 6).attr("y", 9).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "10px").style("font-weight", "bold").text("✓"); }
            // Update Mega filter checkbox and checkmark.
            megaFilterGroup.select("rect").attr("fill", activeProductFilters[3] ? getComputedStyle(root).getPropertyValue('--mega-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim());
            megaFilterGroup.selectAll("text").remove();
            if (activeProductFilters[3]) { megaFilterGroup.append("text").attr("x", 6).attr("y", 9).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--white').trim()).style("font-size", "10px").style("font-weight", "bold").text("✓"); }
        }
        /**
         * Animates the visibility of task bars based on the active filters.
         */
        function updateTaskVisibility() {
            // Select bars that should be visible.
            const visibleBars = contentGroup.selectAll(".bar").filter(d => activeProductFilters[d.modelId]);
            // Select bars that should be hidden.
            const hiddenBars = contentGroup.selectAll(".bar").filter(d => !activeProductFilters[d.modelId]);
            // Animate visible bars into view.
            visibleBars.style("display", "block").transition().duration(300).ease(d3.easeQuadOut).style("opacity", 0.9).style("transform", "scale(1)");
            // Animate hidden bars out of view.
            hiddenBars.transition().duration(300).ease(d3.easeQuadIn).style("opacity", 0.0).style("transform", "scale(0.95)").on("end", function () { d3.select(this).style("display", "none"); });
        }
        // --- CHART & ANIMATION SETUP ---
        // Timeline scrubbing: click on the chart to jump to a specific time.
        chart.append("rect")
            .attr("class", "timeline-scrubber").attr("width", width).attr("height", height)
            .attr("fill", "transparent").style("cursor", "crosshair")
            .on("click", function (event) {
                const [mouseX] = d3.pointer(event);
                const clickedTime = xScale.invert(mouseX); // Convert pixel position to simulation time.
                // Update simulation time if the click is within valid bounds.
                if (clickedTime >= 0 && clickedTime <= totalSimDurationMinutes) {
                    animationState.schedule.totalSimTimeMins = clickedTime;
                    const h = String(Math.floor(clickedTime / 60)).padStart(2, '0');
                    const m = String(Math.floor(clickedTime % 60)).padStart(2, '0');
                    clockDisplay.text(`${h}:${m}`); // Update clock display immediately.
                }
            });
        // Speed slider.
        const sliderWidth = Math.max(40, Math.min(100, containerWidth * 0.12));
        const sliderGroup = svg.append("g").attr("transform", `translate(${controlsStartX + 220}, ${controlsY})`);
        const speedScale = d3.scaleLinear().domain([0.1, 8.0]).range([0, sliderWidth]).clamp(true); // Map speed value to pixel position.
        sliderGroup.append("text").attr("x", sliderWidth / 2).attr("y", -8).attr("text-anchor", "middle").style("font-size", "12px").style("font-weight", "bold").style("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).text("Speed"); // Label.
        sliderGroup.append("line").attr("class", "track").attr("x1", 0).attr("x2", sliderWidth).attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 3).attr("stroke-linecap", "round"); // Track.
        sliderGroup.append("circle").attr("id", "d3-schedule-slider-handle").attr("class", "handle").attr("r", 6).attr("fill", getComputedStyle(root).getPropertyValue('--secondary2').trim()).attr("stroke", getComputedStyle(root).getPropertyValue('--white').trim()).attr("stroke-width", 2).attr("cx", speedScale(animationState.speedMultiplier)); // Handle.
        const speedInteractionArea = sliderGroup.append("rect").attr("x", -10).attr("width", sliderWidth + 20).attr("y", -10).attr("height", 20).style("fill", "transparent").style("cursor", "grab").style("touch-action", "none"); // Interaction area.
        // Speed slider event listeners (drag, click, wheel).
        speedInteractionArea
            .on("mousedown", function () { d3.select(this).style("cursor", "grabbing"); })
            .on("mouseup", function () { d3.select(this).style("cursor", "grab"); })
            .on("click", (event) => {
                const localX = Math.max(0, Math.min(sliderWidth, d3.pointer(event, sliderGroup.node())[0]));
                animationState.speedMultiplier = speedScale.invert(localX);
                sliderGroup.select(".handle").attr("cx", speedScale(animationState.speedMultiplier));
            })
            .call(d3.drag().on("drag", (event) => {
                const localX = Math.max(0, Math.min(sliderWidth, event.x));
                animationState.speedMultiplier = speedScale.invert(localX);
                sliderGroup.select(".handle").attr("cx", speedScale(animationState.speedMultiplier));
            }));
        // --- CHART DRAWING ---
        // Main content group for chart elements (bars, lines). This group is translated by the sidebar scroll.
        const contentGroup = chart.append("g").attr("class", "schedule-content-group");
        const yOffset = document.getElementById('svg-container').getBoundingClientRect().top + margin.top;
        // Map task IDs to their vertical position based on the sidebar layout.
        const elementGeometry = new Map();
        document.querySelectorAll('.element-row').forEach(elRow => {
            const taskId = parseInt(elRow.dataset.taskId);
            const rect = elRow.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const barHeight = rect.height * 0.8;
            const barY = (centerY - barHeight / 2) - yOffset;
            elementGeometry.set(taskId, { y: barY, height: barHeight });
        });
        // Add workstation labels and separator lines.
        document.querySelectorAll('.workstation-title').forEach(title => {
            const rect = title.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const lineY = centerY - yOffset;
            contentGroup.append("line").attr("x1", -margin.left).attr("x2", width + margin.right).attr("y1", lineY).attr("y2", lineY).attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 2).attr("stroke-opacity", 0.3); // Separator line.
            const workstationMatch = title.textContent.match(/\d+/);
            if (workstationMatch) { // Label.
                contentGroup.append("text").attr("class", "workstation-schedule-label").attr("x", -10).attr("y", lineY + 2).attr("text-anchor", "end").attr("dominant-baseline", "hanging").style("font-size", "14px").style("font-weight", "bold").style("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).text(`WS ${workstationMatch[0]}`);
            }
        });
        // D3 scales for mapping data to visual properties.
        const xScale = d3.scaleLinear().range([0, width]); // Time -> X position.
        const modelColors = d3.scaleOrdinal().domain([1, 2, 3]).range([getComputedStyle(root).getPropertyValue('--super-color').trim(), getComputedStyle(root).getPropertyValue('--ultra-color').trim(), getComputedStyle(root).getPropertyValue('--mega-color').trim()]); // Model ID -> color.
        // --- PERFORMANCE OVERLAYS ---
        // Add utilization bars and bottleneck highlighting.
        try {
            const metrics = calculateMetrics({ dailyDemand: +dailyDemandInput.value, opHours: +opHoursInput.value, numEmployees: +numEmployeesInput.value }, { laborCost: +laborCostInput.value });
            if (metrics && Array.isArray(metrics.workstations) && metrics.workstations.length > 0) {
                // Find the bottleneck workstation (longest cycle time).
                const bottleneckWS = metrics.workstations.reduce((max, ws) => (ws.cycleTime > (max.cycleTime || 0) ? ws : max), metrics.workstations[0]);
                document.querySelectorAll('.workstation-title').forEach(title => {
                    const wsMatch = title.textContent && title.textContent.match(/\d+/);
                    if (!wsMatch) return;
                    const wsId = wsMatch[0];
                    const wsInfo = metrics.workstations.find(w => String(w.id) === String(wsId));
                    if (!wsInfo) return;
                    const rect = title.getBoundingClientRect();
                    const lineY = (rect.top + rect.height / 2) - yOffset;
                    // Highlight the bottleneck row.
                    if (wsInfo === bottleneckWS) {
                        contentGroup.append('rect').attr('x', -margin.left).attr('y', lineY).attr('width', width + margin.right + margin.left).attr('height', rect.height + 8).attr('fill', getComputedStyle(root).getPropertyValue('--failure-color').trim()).attr('opacity', 0.12).lower();
                    }
                    // Calculate and display utilization percentage.
                    const totalOpMinutes = opHours * 60;
                    const productiveMinutes = (wsInfo.cycleTime || 0) * (metrics.throughputUnitsPerDay || 0);
                    const actualUtilization = totalOpMinutes > 0 ? (productiveMinutes / totalOpMinutes) : 0;
                    contentGroup.append('text').attr('class', 'ws-efficiency-label').attr('x', 65).attr("y", lineY + 13).attr('text-anchor', 'start').style('font-size', '11px').style('font-weight', '600').style('fill', getComputedStyle(root).getPropertyValue('--accent').trim()).text(`Util: ${(actualUtilization * 100).toFixed(1)}%`);
                    // Draw the utilization bar.
                    const barWidth = 50;
                    const barHeight = 4;
                    contentGroup.append('rect').attr('class', 'ws-utilization-bar-bg').attr('x', 8).attr("y", lineY + 7).attr('width', barWidth).attr('height', barHeight).attr('fill', getComputedStyle(root).getPropertyValue('--idle-color').trim()).attr('stroke', getComputedStyle(root).getPropertyValue('--white').trim()).attr('stroke-width', 0.5).attr('rx', 1); // Background.
                    contentGroup.append('rect').attr('class', 'ws-utilization-bar').attr('x', 8).attr("y", lineY + 7).attr('width', barWidth * actualUtilization).attr('height', barHeight).attr('fill', getComputedStyle(root).getPropertyValue('--primary').trim()).attr('rx', 1); // Foreground.
                });
            }
        } catch (e) { console.warn('Could not render performance overlays:', e); }
        // --- TIME AXIS & MARKERS ---
        const timeGridGroup = chart.append("g").attr("class", "time-grid"); // Group for grid lines.
        const timeAxis = chart.append("g").attr("class", "time-axis").attr("transform", `translate(0, ${height - 10})`); // Group for the bottom time axis.
        svg.append("text").attr("class", "time-axis-label").attr("x", margin.left + width / 2).attr("y", containerHeight - 15).attr("text-anchor", "middle").style("font-size", "12px").style("font-weight", "bold").style("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).text("Time (Hours:Minutes)"); // Axis label.
        const timeMarker = chart.append("line").attr("x1", 0).attr("x2", 0).attr("y1", -margin.top).attr("y2", height + margin.bottom).attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 2); // Vertical line for current time.
        timeMarker.append("title").text("Current Simulation Time"); // Tooltip for the time marker.
        // --- TOOLTIP & TASK BARS ---
        const scheduleTooltip = createTooltip('schedule-tooltip'); // Create a reusable tooltip.
        // Helper function to get product type name from model ID.
        const getProductTypeName = (modelId) => ({ 1: 'Super', 2: 'Ultra', 3: 'Mega' })[modelId] || 'Unknown';
        // Helper function to format time duration nicely.
        const formatDuration = (minutes) => (minutes < 1) ? `${(minutes * 60).toFixed(0)}s` : `${minutes.toFixed(2)}m`;
        // Bind task data and create the Gantt bars.
        contentGroup.append("g").attr("class", "task-bars")
            .selectAll(".bar").data(tasks).enter().append("rect")
            .attr("class", "bar")
            .attr("y", d => elementGeometry.get(d.taskId)?.y || -100) // Set Y position based on element geometry map.
            .attr("height", d => elementGeometry.get(d.taskId)?.height || 0) // Set height similarly.
            .attr("fill", d => modelColors(d.modelId)) // Set fill color based on product model.
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 1).attr("rx", 2).attr("ry", 2) // Styling.
            .style("opacity", d => (activeProductFilters[d.modelId] ? 0.9 : 0.0)) // Set initial opacity based on filters.
            .style("display", d => (activeProductFilters[d.modelId] ? "block" : "none")) // Set initial display based on filters.
            .style("transform", d => (activeProductFilters[d.modelId] ? "scale(1)" : "scale(0.95)"))
            .style("cursor", "pointer")
            .on("mouseenter", function (event, d) { // Tooltip mouseover behavior.
                d3.select(this).style("opacity", 1).style("stroke-width", 2); // Highlight bar.
                const productType = getProductTypeName(d.modelId);
                const duration = formatDuration(d.endTime - d.startTime);
                const startTime = `${Math.floor(d.startTime / 60).toString().padStart(2, '0')}:${Math.floor(d.startTime % 60).toString().padStart(2, '0')}`;
                const endTime = `${Math.floor(d.endTime / 60).toString().padStart(2, '0')}:${Math.floor(d.endTime % 60).toString().padStart(2, '0')}`;
                // Populate and show tooltip.
                scheduleTooltip.html(`
                <div class="tooltip-header" style="color: ${modelColors(d.modelId)};">${productType} Refrigerator</div>
                <div class="tooltip-row"><span>Element:</span> <strong>${d.taskId}</strong></div>
                <div class="tooltip-row"><span>Workstation:</span> <strong>${d.workstationId}</strong></div>
                <div class="tooltip-row"><span>Duration:</span> <strong>${duration}</strong></div>
                <div class="tooltip-row"><span>Start:</span> <strong>${startTime}</strong></div>
                <div class="tooltip-row"><span>End:</span> <strong>${endTime}</strong></div>
            `).style("opacity", 1);
            })
            .on("mousemove", function (event) { // Update tooltip position.
                scheduleTooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 10) + "px");
            })
            .on("mouseleave", function () { // Hide tooltip and de-highlight bar.
                d3.select(this).style("opacity", 0.9).style("stroke-width", 1);
                scheduleTooltip.style("opacity", 0);
            });
        // --- ANIMATION LOOP ---
        const maxTime = tasks.length > 0 ? d3.max(tasks, d => d.endTime) : (opHours * 60);
        const totalSimDurationMinutes = maxTime;
        // Initialize the global animation state for this tab.
        animationState.schedule = {
            isRunning: true,
            lastFrameTime: performance.now(),
            totalSimTimeMins: 0,
            frameId: null,
            isPaused: false
        };
        /**
         * The main animation loop, called via requestAnimationFrame.
         * @param {number} currentTime - The current timestamp provided by the browser.
         */
        function animationLoop(currentTime) {
            if (!animationState.schedule.isRunning) return; // Exit if stopped.
            // Calculate time passed since last frame.
            const speedMultiplier = animationState.speedMultiplier;
            const realDeltaMs = currentTime - animationState.schedule.lastFrameTime;
            animationState.schedule.lastFrameTime = currentTime;
            // Advance simulation time if not paused.
            if (!isPaused && !animationState.schedule.isPaused) {
                const simDeltaMs = realDeltaMs * 60 * speedMultiplier;
                animationState.schedule.totalSimTimeMins += simDeltaMs / 60000;
            }
            // Stop the animation if the simulation time exceeds the total duration.
            const elapsedSimTimeMinutes = animationState.schedule.totalSimTimeMins;
            if (elapsedSimTimeMinutes > totalSimDurationMinutes) {
                animationState.schedule.isRunning = false;
                const finalHours = String(Math.floor(totalSimDurationMinutes / 60)).padStart(2, '0');
                const finalMinutes = String(Math.floor(totalSimDurationMinutes % 60)).padStart(2, '0');
                clockDisplay.text(`${finalHours}:${finalMinutes}`); // Display final time.
                return;
            }
            // Update clock and counters.
            const h = String(Math.floor(elapsedSimTimeMinutes / 60)).padStart(2, '0');
            const m = String(Math.floor(elapsedSimTimeMinutes % 60)).padStart(2, '0');
            clockDisplay.text(`${h}:${m}`);
            const completedSuper = tasks.filter(t => t.endTime <= elapsedSimTimeMinutes && t.modelId === 1 && t.taskId === 31).length;
            const completedUltra = tasks.filter(t => t.endTime <= elapsedSimTimeMinutes && t.modelId === 2 && t.taskId === 31).length;
            const completedMega = tasks.filter(t => t.endTime <= elapsedSimTimeMinutes && t.modelId === 3 && t.taskId === 31).length;
            superCounter.text(`Super: ${completedSuper}`);
            ultraCounter.text(`Ultra: ${completedUltra}`);
            megaCounter.text(`Mega: ${completedMega}`);
            // Update the time domain of the x-axis to create the scrolling effect.
            const viewStartTime = elapsedSimTimeMinutes;
            xScale.domain([viewStartTime, viewStartTime + currentViewWindow]);
            // Update the position and width of all task bars based on the new xScale.
            contentGroup.selectAll(".bar")
                .attr("x", d => xScale(d.startTime))
                .attr("width", d => Math.max(0, xScale(d.endTime) - xScale(d.startTime)));
            // Update the time grid lines.
            const gridTicks = xScale.ticks(20);
            const gridLines = timeGridGroup.selectAll(".grid-line").data(gridTicks);
            gridLines.enter().append("line").attr("class", "grid-line")
                .merge(gridLines)
                .attr("x1", d => xScale(d)).attr("x2", d => xScale(d)).attr("y1", 0).attr("y2", height)
                .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 0.5).attr("stroke-dasharray", "2,2").style("opacity", 0.6);
            gridLines.exit().remove();
            // Redraw the bottom time axis.
            const timeTickFormat = (d) => `${Math.floor(d / 60).toString().padStart(2, '0')}:${Math.floor(d % 60).toString().padStart(2, '0')}`;
            timeAxis.call(d3.axisBottom(xScale).ticks(10).tickFormat(timeTickFormat).tickSizeOuter(0))
                .selectAll("text").style("font-size", "11px").style("font-weight", "500");
            // Request the next frame.
            animationState.schedule.frameId = requestAnimationFrame(animationLoop);
        }
        // --- FINALIZATION ---
        // Trigger a scroll event to correctly position the content group initially.
        workstationList.dispatchEvent(new Event('scroll'));
        // Start the animation loop.
        animationState.schedule.frameId = requestAnimationFrame(animationLoop);
        // --- LEGEND ---
        const legendX = containerWidth - 200;
        const legendY = containerHeight - 180;
        const legend = svg.append("g").attr("transform", `translate(${legendX + 30}, ${legendY - 20})`);
        legend.append("rect").attr("width", 150).attr("height", 140).attr("fill", getComputedStyle(root).getPropertyValue('--white')).attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("rx", 5); // Legend box
        legend.append("text").text("Schedule Legend").attr("x", 10).attr("y", 20).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent')); // Title
        const legendItems = [
            { label: "Super Product", color: getComputedStyle(root).getPropertyValue('--super-color') },
            { label: "Ultra Product", color: getComputedStyle(root).getPropertyValue('--ultra-color') },
            { label: "Mega Product", color: getComputedStyle(root).getPropertyValue('--mega-color') },
            { label: "Bottleneck WS", color: getComputedStyle(root).getPropertyValue('--failure-color'), type: "bg" },
            { label: "Utilization Bar", color: getComputedStyle(root).getPropertyValue('--primary'), type: "bar" }
        ];
        // Create an entry for each item in the legend.
        legendItems.forEach((item, i) => {
            const yPos = 45 + i * 20;
            if (item.type === "bg") {
                legend.append("rect").attr("x", 10).attr("y", yPos - 8).attr("width", 10).attr("height", 10).attr("fill", item.color).attr("opacity", 0.3);
            } else if (item.type === "bar") {
                legend.append("rect").attr("x", 10).attr("y", yPos - 2).attr("width", 10).attr("height", 4).attr("fill", item.color).attr("rx", 1);
            } else {
                legend.append("rect").attr("x", 10).attr("y", yPos - 8).attr("width", 10).attr("height", 10).attr("fill", item.color);
            }
            legend.append("text").text(item.label).attr("x", 25).attr("y", yPos + 2).style("font-size", "11px").attr("fill", getComputedStyle(root).getPropertyValue('--accent'));
        });
    }
    // Expose the public draw method to be called from the main script.
    return {
        draw: draw
    };
})();