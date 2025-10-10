/**
* ====================================================================
* EfficiencyTab IIFE Module
*
* Encapsulates all logic for rendering the multi-chart efficiency
* analysis dashboard.
* ====================================================================
*/
const EfficiencyTab = (function () {
    /**
     * @tab Efficiency
     * Draws the efficiency analysis dashboard, including pie charts,
     * idle time clocks, and summary statistics. This is the main
     * public method exposed by the IIFE.
     */
    function draw() {
        // --- INITIAL SETUP ---
        const svg = d3.select("#efficiency-panel");
        // Get the available width and height of the container panel.
        const { clientWidth: panelWidth, clientHeight: panelHeight } = document.getElementById('svg-container');
        // --- DATA CALCULATION ---
        // Gather current operational inputs and calculate all performance metrics.
        const opInputs = { dailyDemand: +dailyDemandInput.value, opHours: +opHoursInput.value, numEmployees: +numEmployeesInput.value };
        const finInputs = { laborCost: +laborCostInput.value };
        const results = calculateMetrics(opInputs, finInputs);
        // If results are invalid or empty, clear the panel and display a message.
        if (!results || !results.workstations || results.workstations.length === 0) {
            svg.selectAll("*").remove();
            svg.append("text").attr("x", panelWidth / 2).attr("y", panelHeight / 2).attr("text-anchor", "middle").text("No data available for efficiency analysis.");
            return;
        }
        // Cancel any previous animation loops to prevent conflicts.
        if (animationState.efficiency && animationState.efficiency.frameId) {
            cancelAnimationFrame(animationState.efficiency.frameId);
            animationState.efficiency.frameId = null;
            animationState.efficiency.isRunning = false;
        }
        // --- ROOT GROUP & RESPONSIVE LAYOUT ---
        // Use a persistent root group ('g') for all elements to help D3 manage transitions.
        const effRoot = svg.selectAll("g#eff-root").data([null]).join("g").attr("id", "eff-root");
        // Define padding and calculate available drawing area.
        const padding = 20;
        const availableWidth = panelWidth - (2 * padding);
        const availableHeight = panelHeight - (2 * padding);
        // Divide the layout into 4 rows: 1 for the summary, 3 for workstation charts.
        const rows = 4;
        const rowHeight = availableHeight / rows;
        // Calculate a uniform radius for all pie and clock charts for a consistent look.
        const maxPieRadius = Math.min(availableWidth / 15, (rowHeight * 0.75) / 2);
        const maxClockRadius = Math.min(availableWidth / 40, (rowHeight * 0.75) / 4);
        const pieRadius = maxPieRadius;
        const clockRadius = maxClockRadius;
        /**
         * Calculates the transform (x, y position) for a workstation chart
         * based on its index, arranging them in a 4-5-4 grid pattern.
         * @param {number} i - The zero-based index of the workstation.
         * @returns {string} The SVG transform string.
         */
        const layoutTransform = (i) => {
            let row, col, colsInRow;
            if (i < 4) { row = 1; col = i; colsInRow = 4; } // First row of workstations
            else if (i < 9) { row = 2; col = i - 4; colsInRow = 5; } // Second row
            else { row = 3; col = i - 9; colsInRow = 4; } // Third row
            const itemWidth = availableWidth / colsInRow;
            const x = padding + col * itemWidth + itemWidth / 2; // Center horizontally in its column.
            const y = padding + row * rowHeight + rowHeight / 2 + rowHeight * 0.05; // Center vertically in its row.
            return `translate(${x},${y})`;
        };
        // --- WORKSTATION GROUPS (Data Binding) ---
        // Bind workstation data to groups. Using a key (d.id) allows D3 to track
        // which elements are new, which are being updated, and which are removed.
        const wsSel = effRoot.selectAll("g.ws").data(results.workstations, d => d.id);
        // Create new groups for any new workstations (the 'enter' selection).
        const wsEnter = wsSel.enter()
            .append("g")
            .attr("class", "ws")
            .attr("transform", (d, i) => layoutTransform(i)); // Set initial position.
        // Define offsets for the pie and clock within each workstation group.
        const centerDistance = (pieRadius + clockRadius) * 1.1;
        const chartsGroupOffset = rowHeight * 0.12;
        const pieOffsetX = chartsGroupOffset - centerDistance / 2;
        const clockOffsetX = chartsGroupOffset + centerDistance / 2;
        // Create subgroups for pie and clock charts on new elements only.
        wsEnter.append("g").attr("class", "pie").attr("transform", `translate(${pieOffsetX}, 0)`);
        wsEnter.append("g").attr("class", "clock").attr("transform", `translate(${clockOffsetX}, 0)`);
        // Add the workstation title heading.
        wsEnter.append("text")
            .attr("class", "ws-heading").attr("x", 0).attr("y", -Math.max(pieRadius + rowHeight * 0.05, rowHeight * 0.35))
            .attr("text-anchor", "middle").style("font-size", `${Math.max(Math.min(rowHeight * 0.08, availableWidth * 0.03), 12)}px`)
            .style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim());
        // Merge the enter selection with the update selection (existing elements).
        const wsMerge = wsEnter.merge(wsSel);
        // Animate all workstations (new and existing) to their correct positions.
        wsMerge.transition().duration(750).attr("transform", (d, i) => layoutTransform(i));
        // Update sub-group positions and heading text for all workstations.
        wsMerge.select("g.pie").attr("transform", `translate(${pieOffsetX}, 0)`);
        wsMerge.select("g.clock").attr("transform", `translate(${clockOffsetX}, 0)`);
        wsMerge.select("text.ws-heading")
            .attr("y", -Math.max(pieRadius + rowHeight * 0.05, rowHeight * 0.35))
            .style("font-size", `${Math.max(Math.min(rowHeight * 0.08, availableWidth * 0.03), 12)}px`)
            .text(d => `Workstation ${d.id}`);
        // Remove any workstation groups that no longer have data (the 'exit' selection).
        wsSel.exit().remove();
        // --- PIE CHARTS (Productive vs. Idle Time) ---
        const arc = d3.arc().innerRadius(0).outerRadius(pieRadius); // Arc generator for the pies.
        wsMerge.each(function (ws) { // Iterate over each workstation group.
            const pieGroup = d3.select(this).select("g.pie");
            const totalOpMinutes = opInputs.opHours * 60;
            const productiveMinutes = ws.cycleTime * results.throughputUnitsPerDay;
            const productiveRatio = totalOpMinutes > 0 ? Math.min(1, productiveMinutes / totalOpMinutes) : 0;
            const productivePercentage = productiveRatio * 100;
            // Define data for two slices: Productive and Idle.
            const workAngle = productiveRatio * 2 * Math.PI;
            const shouldHideIdleSlice = productivePercentage >= 99.5; // Hide idle slice near 100% to avoid visual glitch.
            const data = [
                { label: "Productive", startAngle: 0, endAngle: workAngle, value: Math.min(productivePercentage, 99.99) },
                { label: "Idle", startAngle: workAngle, endAngle: 2 * Math.PI, value: Math.max(100 - productivePercentage, 0.01), hidden: shouldHideIdleSlice }
            ];
            const slices = pieGroup.selectAll("path.slice").data(data, d => d.label); // Bind slice data.
            const slicesEnter = slices.enter().append("path").attr("class", "slice") // Create new paths.
                .attr("fill", d => d.label === "Productive" ? getComputedStyle(root).getPropertyValue('--primary') : getComputedStyle(document.documentElement).getPropertyValue('--secondary1'))
                .attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 1.5)
                .each(function (d) { this._current = { ...d, startAngle: 0, endAngle: 0 }; }) // Store initial state for animation.
                .attr("d", function (d) { return arc(this._current); });
            const slicesMerged = slicesEnter.merge(slices);
            // Animate the shape of the slices.
            slicesMerged.transition("shape").duration(750).attrTween("d", function (d) {
                const i = d3.interpolate(this._current || d, d);
                this._current = i(1);
                return t => arc(i(t));
            });
            // Animate the opacity (fade out idle slice slowly, fade in quickly).
            slicesMerged.each(function (d) {
                const element = d3.select(this);
                const targetOpacity = d.hidden ? 0 : 1;
                const duration = (targetOpacity === 0 && (element.style("opacity") || 1) > 0.5) ? 1600 : 200;
                element.transition("opacity").duration(duration).style("opacity", targetOpacity);
            });
            slices.exit().remove();
            // Percentage text display in the center of the pie.
            const pieTextBg = pieGroup.selectAll("circle.pie-text-bg").data([null]).join("circle") // Background circle.
                .attr("class", "pie-text-bg").attr("r", pieRadius * 0.33).attr("fill", getComputedStyle(root).getPropertyValue('--white'))
                .attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 1.5);
            const pieText = pieGroup.selectAll("text.pie-text").data([productivePercentage]).join("text") // Text element.
                .attr("class", "pie-text").attr("text-anchor", "middle").attr("dy", "0.35em")
                .style("font-size", `${Math.max(Math.min(pieRadius * 0.2, rowHeight * 0.06), 8)}px`)
                .style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent'));
            // Animate the text value counting up/down.
            animateValue(pieText.node(), parseElementValue(pieText.node()), productivePercentage, 800, val => `${val.toFixed(1)}%`);
            pieText.exit().remove();
        });
        // --- IDLE TIME CLOCKS ---
        wsMerge.each(function (ws) { // Iterate over each workstation group.
            const totalOpMinutes = opInputs.opHours * 60;
            const productiveMinutes = ws.cycleTime * results.throughputUnitsPerDay;
            const idleMinutes = Math.max(0, totalOpMinutes - productiveMinutes);
            const idleHours = idleMinutes / 60;
            const clockGroup = d3.select(this).select("g.clock");
            // Draw clock face and markings.
            const clockFaceMerged = clockGroup.selectAll("circle.face").data([null]).join("circle").attr("class", "face").attr("r", clockRadius) // Face.
                .attr("fill", getComputedStyle(root).getPropertyValue('--idle-color')).attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
                .attr("stroke-width", Math.max(clockRadius * 0.04, 1));
            const tickOuterRadius = clockRadius * 0.9,
                tickInnerRadius = clockRadius * 0.75,
                majorTickInnerRadius = clockRadius * 0.65;
            clockGroup.selectAll("line.tick").data(d3.range(0, 360, 30)).join("line").attr("class", "tick") // Ticks.
                .attr("x1", 0).attr("y1", -tickOuterRadius).attr("x2", 0).attr("y2", (d, i) => i % 3 === 0 ? -majorTickInnerRadius : -tickInnerRadius)
                .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", (d, i) => i % 3 === 0 ? Math.max(clockRadius * 0.06, 1.5) : Math.max(clockRadius * 0.04, 1))
                .attr("transform", d => `rotate(${d})`);
            clockGroup.selectAll("circle.center").data([null]).join("circle").attr("class", "center").attr("r", Math.max(clockRadius * 0.06, 2)).attr("fill", getComputedStyle(root).getPropertyValue('--accent')); // Center pin.
            // Calculate the angle for the clock hand based on idle hours.
            const angle = (idleHours / 12) * 2 * Math.PI; // Map 12 hours to 360 degrees.
            const handRadius = clockRadius * 0.8;
            const wsHand = clockGroup.selectAll("line.hand").data([angle]); // Bind angle data.
            // Animate the clock hand rotation.
            wsHand.enter().append("line").attr("class", "hand").attr("x1", 0).attr("y1", 0) // Create hand if it doesn't exist.
                .attr("x2", 0).attr("y2", -handRadius).attr("stroke", getComputedStyle(root).getPropertyValue('--secondary2'))
                .attr("stroke-width", Math.max(clockRadius * 0.08, 2)).attr("stroke-linecap", "round").attr("transform", "rotate(0)")
                .merge(wsHand) // Merge new and existing hands.
                .transition().duration(750)
                .attrTween("transform", function (a) { // Animate from current angle to target angle.
                    const currentTransform = d3.select(this).attr('transform') || "rotate(0)";
                    const startAngleMatch = /rotate\(([-.\d]+)\)/.exec(currentTransform);
                    const startAngle = startAngleMatch ? parseFloat(startAngleMatch[1]) : 0;
                    const endAngle = (a * 180) / Math.PI;
                    const i = d3.interpolate(startAngle, endAngle);
                    return t => `rotate(${i(t)})`;
                });
            wsHand.exit().remove();
            // Add a blinking border if idle time is excessive.
            const clockFace = clockGroup.select("circle.face");
            clockFace.interrupt("blink");
            if (idleHours > 12) {
                function blink() {
                    clockFace.transition("blink").duration(700).attr("stroke", getComputedStyle(root).getPropertyValue('--failure-color').trim()).attr("stroke-width", 3.5)
                        .transition("blink").duration(700).attr("stroke-width", 1.5).on("end", blink);
                }
                blink();
            } else { // Revert to normal border if not excessive.
                clockFace.transition().duration(500).attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", Math.max(clockRadius * 0.04, 1));
            }
            // Digital display for idle time below the clock.
            const idleText = clockGroup.selectAll("text.idle-text").data([idleHours]).join("text")
                .attr("class", "idle-text").attr("text-anchor", "middle").attr("y", clockRadius + clockRadius * 0.4)
                .style("font-size", `${Math.max(Math.min(clockRadius * 0.4, rowHeight * 0.06), 10)}px`)
                .style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent'))
                .text(d => `${d.toFixed(1)}h idle`);
            idleText.exit().remove();
        });
        // --- TOP ROW SUMMARY PANEL ---
        // Define dimensions and position for the summary area.
        const summaryPadding = panelWidth * 0.001;
        const summaryWidth = availableWidth - (2 * summaryPadding);
        const summaryHeight = rowHeight - (2 * summaryPadding);
        const summaryX = panelWidth / 2; // Center horizontally.
        const summaryY = padding + rowHeight / 2; // Center in the first row.
        // Create the summary group and its border.
        const summary = effRoot.selectAll("g#eff-summary").data([null]).join(enter => {
            const summaryGroup = enter.append("g").attr("id", "eff-summary");
            summaryGroup.append("rect").attr("class", "summary-border").attr("fill", "none") // Dashed border.
                .attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 2)
                .attr("stroke-dasharray", "5,5").attr("rx", 10);
            return summaryGroup;
        }).attr("transform", `translate(${summaryX}, ${summaryY})`);
        summary.select("rect.summary-border").attr("x", -summaryWidth / 2).attr("y", -summaryHeight / 2).attr("width", summaryWidth).attr("height", summaryHeight); // Update size on redraw.
        // --- OVERALL EFFICIENCY PIE CHART (CENTER OF SUMMARY) ---
        const arcLine = d3.arc().innerRadius(0).outerRadius(pieRadius);
        const clampedEfficiency = Math.min(results.averageEfficiency, 99.99) / 100;
        const workAngle = clampedEfficiency * 2 * Math.PI;
        const shouldHideSummaryIdleSlice = results.averageEfficiency >= 99.5;
        const linePieData = [
            { label: "Work", startAngle: 0, endAngle: workAngle, value: Math.min(results.averageEfficiency, 99.99) },
            { label: "Idle", startAngle: workAngle, endAngle: 2 * Math.PI, value: Math.max(100 - results.averageEfficiency, 0.01), hidden: shouldHideSummaryIdleSlice }
        ];
        // Create a group for the pie chart elements, centered horizontally.
        const pieGroup = summary.selectAll("g.pie-group").data([null]).join("g").attr("class", "pie-group").attr("transform", "translate(0, 15)");
        const sumSlices = pieGroup.selectAll("path.sum-slice").data(linePieData, d => d.label);
        const sumSlicesEnter = sumSlices.enter().append("path").attr("class", "sum-slice")
            .attr("fill", d => d.label === "Work" ? getComputedStyle(root).getPropertyValue('--primary') : getComputedStyle(root).getPropertyValue('--secondary1'))
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 1.5)
            .each(function (d) { this._current = { ...d, startAngle: 0, endAngle: 0 }; })
            .attr("d", function (d) { return arcLine(this._current); });
        const sumSlicesMerged = sumSlicesEnter.merge(sumSlices);
        sumSlicesMerged.transition("shape").duration(750).attrTween("d", function (d) {
            const i = d3.interpolate(this._current || d, d);
            this._current = i(1);
            return t => arcLine(i(t));
        });
        sumSlicesMerged.each(function (d) {
            const element = d3.select(this);
            const targetOpacity = d.hidden ? 0 : 1;
            const duration = (targetOpacity === 0 && (element.style("opacity") || 1) > 0.5) ? 1500 : 200;
            element.transition("opacity").duration(duration).style("opacity", targetOpacity);
        });
        sumSlices.exit().remove();
        // Center text for the summary pie chart.
        summary.selectAll("circle.summary-pie-text-bg").data([null]).join("circle").attr("class", "summary-pie-text-bg")
            .attr("transform", "translate(0, 15)").attr("r", pieRadius * 0.33).attr("fill", getComputedStyle(root).getPropertyValue('--white'))
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 1.5);
        const summaryPieText = summary.selectAll("text.summary-pie-text").data([results.averageEfficiency]).join("text")
            .attr("class", "summary-pie-text").attr("transform", "translate(0, 15)").attr("text-anchor", "middle").attr("dy", "0.35em")
            .style("font-size", `${Math.max(Math.min(pieRadius * 0.2, rowHeight * 0.06), 10)}px`).style("font-weight", "bold")
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent'));
        animateValue(summaryPieText.node(), parseElementValue(summaryPieText.node()), results.averageEfficiency, 800, val => `${val.toFixed(1)}%`);
        // --- SUMMARY CHARTS (Box Plot & Bar Chart) ---
        // Layout for the three charts within the summary panel.
        const colWidth = summaryWidth / 3;
        const titleAreaHeight = 35;
        const chartAreaHeight = summaryHeight - titleAreaHeight;
        const chartAreaWidth = colWidth * 1.1;
        const labelFontSize = Math.min(summaryHeight * 0.14, 14);
        const chartContainerY = -summaryHeight / 2 + titleAreaHeight + chartAreaHeight / 2;
        // Create a reusable tooltip.
        const tooltip = d3.select("body").selectAll(".efficiency-tooltip").data([null]).join("div")
            .attr("class", "efficiency-tooltip").style("position", "absolute").style("pointer-events", "none")
            .style("background", getComputedStyle(document.documentElement).getPropertyValue('--tooltip-bg').trim()).style("color", "white")
            .style("padding", "8px 12px").style("border-radius", "6px").style("font-size", "12px").style("opacity", 0).style("transition", "opacity 0.2s");
        // Define a gradient fill for the charts.
        const defs = effRoot.selectAll("defs").data([null]).join("defs");
        const boxGradient = defs.selectAll("#box-gradient").data([null]).join("linearGradient").attr("id", "box-gradient").attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
        boxGradient.selectAll("stop").data([{ offset: "0%", color: getComputedStyle(root).getPropertyValue('--secondary2').trim() }, { offset: "100%", color: "#4d337aff" }]).join("stop").attr("offset", d => d.offset).attr("stop-color", d => d.color);
        // --- BOX PLOT (Balance Loss per Cycle) ---
        const boxPlotGroup = summary.selectAll("g.box-plot-group").data([null]).join("g").attr("class", "box-plot-group").attr("transform", `translate(${-colWidth * 0.8}, ${chartContainerY})`);
        const bottleneckCycleTime = d3.max(results.workstations, d => d.cycleTime) || 0;
        const idleTimesPerCycle = results.workstations.map(ws => bottleneckCycleTime - ws.cycleTime);
        const q1 = d3.quantile(idleTimesPerCycle, 0.25) || 0,
            median = d3.quantile(idleTimesPerCycle, 0.5) || 0,
            q3 = d3.quantile(idleTimesPerCycle, 0.75) || 0;
        const min = d3.min(idleTimesPerCycle) || 0,
            max = d3.max(idleTimesPerCycle) || 0;
        const xBox = d3.scaleLinear().domain([0, max * 1.1 || 1]).range([-chartAreaWidth / 2, chartAreaWidth / 2]);
        const boxHeight = chartAreaHeight * 0.4;
        // Draw box plot elements with transitions.
        boxPlotGroup.selectAll("line.center-line").data([null]).join("line").attr("class", "center-line").attr("y1", 0).attr("y2", 0).attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 3).transition().duration(750).attr("x1", xBox(min)).attr("x2", xBox(max));
        boxPlotGroup.selectAll("line.whisker").data([{ val: min, key: 'min' }, { val: max, key: 'max' }], d => d.key).join("line").attr("class", "whisker").attr("y1", -boxHeight / 2).attr("y2", boxHeight / 2).attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 3).attr("stroke-linecap", "round").transition().duration(750).attr("x1", d => xBox(d.val)).attr("x2", d => xBox(d.val));
        boxPlotGroup.selectAll("rect.box").data([null]).join("rect").attr("class", "box").attr("y", -boxHeight / 2).attr("height", boxHeight).attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 4).style("fill", "url(#box-gradient)").transition().duration(750).attr("x", xBox(q1)).attr("width", xBox(q3) - xBox(q1));
        boxPlotGroup.selectAll("line.median-line").data([median]).join("line").attr("class", "median-line").attr("y1", -boxHeight / 2).attr("y2", boxHeight / 2).attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 5).attr("stroke-linecap", "round").transition().duration(750).attr("x1", d => xBox(d)).attr("x2", d => xBox(d));
        const tooltipContent = `<div style="font-weight:bold; margin-bottom: 5px; text-align:center; border-bottom: 1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom: 4px;">Idle Time per Cycle</div><strong>Q1:</strong> ${q1.toFixed(2)} min<br><strong>Median:</strong> ${median.toFixed(2)} min<br><strong>Q3:</strong> ${q3.toFixed(2)} min<br><strong>Max:</strong> ${max.toFixed(2)} min`;
        boxPlotGroup.selectAll("rect.tooltip-receiver").data([null]).join("rect").attr("class", "tooltip-receiver").attr("x", -chartAreaWidth / 2).attr("y", -chartAreaHeight / 2).attr("width", chartAreaWidth).attr("height", chartAreaHeight).style("fill", "transparent")
            .on("mouseover", () => tooltip.style("opacity", 1))
            .on("mousemove", (event) => tooltip.html(tooltipContent).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"))
            .on("mouseout", () => tooltip.style("opacity", 0));
        // --- BAR CHART (Workstation Idle Time) ---
        const barChartMargin = { top: 10, right: 5, bottom: 35, left: 40 };
        const barChartInnerWidth = chartAreaWidth - barChartMargin.left - barChartMargin.right;
        const barChartInnerHeight = chartAreaHeight - barChartMargin.top - barChartMargin.bottom;
        const barChartGroup = summary.selectAll("g.bar-chart-group").data([null]).join("g").attr("class", "bar-chart-group")
            .attr("transform", `translate(${colWidth * 0.8 - chartAreaWidth / 2 + barChartMargin.left}, ${chartContainerY - chartAreaHeight / 2 + barChartMargin.top})`);
        const xBar = d3.scaleBand().domain(results.workstations.map(d => d.id)).range([0, barChartInnerWidth]).padding(0.2);
        const yBar = d3.scaleLinear().domain([0, d3.max(results.workstations, d => d.dailyIdleTime) * 1.1 || 1]).range([barChartInnerHeight, 0]);
        // X and Y axes for bar chart.
        barChartGroup.selectAll(".x-axis").data([null]).join("g").attr("class", "x-axis").attr("transform", `translate(0, ${barChartInnerHeight})`).call(d3.axisBottom(xBar).tickSizeOuter(0))
            .selectAll("text").style("font-size", "12px").style("font-weight", "600").attr("transform", "rotate(-45)").attr("text-anchor", "end").attr("dx", "-0.8em").attr("dy", "0.15em");
        barChartGroup.selectAll(".y-axis").data([null]).join("g").attr("class", "y-axis").call(d3.axisLeft(yBar).ticks(4).tickFormat(d => `${(d / 60).toFixed(1)}h`).tickSizeOuter(0))
            .selectAll("text").style("font-size", "12px").style("font-weight", "600");

        // Draw bars with an animation.
        const allBars = barChartGroup.selectAll("rect.bar").data(results.workstations, d => d.id)
            .join(
                enter => enter.append("rect").attr("class", "bar")
                    .attr("x", d => xBar(d.id)).attr("width", xBar.bandwidth())
                    .attr("y", yBar(0)).attr("height", 0) // Start from height 0 for animation.
                    .style("fill", "url(#box-gradient)").attr("stroke", getComputedStyle(root).getPropertyValue('--accent')).attr("stroke-width", 1.8)
                    .on("mouseover", function (event, d) { tooltip.style("opacity", 1); d3.select(this).style("opacity", 0.8); })
                    .on("mousemove", function (event, d) {
                        const tooltipContent = `<div style="font-weight:bold; margin-bottom: 5px; text-align:center; border-bottom: 1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom: 4px;">Workstation ${d.id}</div><strong>Daily Idle Time:</strong> ${(d.dailyIdleTime / 60).toFixed(2)} hours<br><strong>Idle Time:</strong> ${d.dailyIdleTime.toFixed(1)} minutes<br><strong>Efficiency:</strong> ${d.efficiency.toFixed(1)}%`;
                        tooltip.html(tooltipContent).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
                    })
                    .on("mouseout", function () { tooltip.style("opacity", 0); d3.select(this).style("opacity", 1); })
            );
        allBars.transition().duration(500).ease(d3.easeQuadInOut) // Animate bars growing to their final height.
            .attr("y", d => yBar(d.dailyIdleTime)).attr("height", d => barChartInnerHeight - yBar(d.dailyIdleTime));
        // --- SUMMARY LABELS ---
        // Center Group: Overall Efficiency Title and Total Idle Time value.
        const centerLabelGroup = summary.selectAll("g.center-label-group").data([results]).join("g").attr("class", "center-label-group").attr("transform", `translate(0, ${-summaryHeight / 2 + 18})`);
        centerLabelGroup.selectAll("text.summary-pie-title").data(["Overall Efficiency"]).join("text").attr("class", "summary-pie-title").attr("text-anchor", "middle").style("font-size", `${labelFontSize}px`).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent')).text(d => d);
        const totalIdleTextGroup = centerLabelGroup.selectAll("g.total-idle-text-group").data([null]).join("g").attr("class", "total-idle-text-group").attr("transform", "translate(-18, 20)").attr("text-anchor", "middle");
        totalIdleTextGroup.selectAll("text.total-idle-label").data(["Total Idle Time: "]).join("text").attr("class", "total-idle-label").style("font-size", `${labelFontSize}px`).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent')).text(d => d);
        const idleTimeValue = totalIdleTextGroup.selectAll("text.total-idle-time").data([results]).join("text").attr("class", "total-idle-time").attr("text-anchor", "start").attr("x", 55).style("font-size", `${labelFontSize}px`).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--failure-color'));
        animateValue(idleTimeValue.node(), parseElementValue(idleTimeValue.node()), results.totalIdleTime / 60, 800, val => `${val.toFixed(1)}h`);
        // Left Group: Box Plot Title and Idle Time CV value.
        const boxLabelGroup = summary.selectAll("g.box-label-group").data([results]).join("g").attr("class", "box-label-group").attr("transform", `translate(${-colWidth * 0.9}, ${-summaryHeight / 2 + 18})`);
        boxLabelGroup.selectAll("text.box-plot-title").data(["Balance Loss per Cycle"]).join("text").attr("class", "box-plot-title").attr("text-anchor", "middle").style("font-size", `${labelFontSize}px`).style("font-weight", "bold").text(d => d);
        const idleTimeCVTextGroup = boxLabelGroup.selectAll("g.idle-time-cv-text-group").data([null]).join("g").attr("class", "idle-time-cv-text-group").attr("transform", "translate(-23, 20)").attr("text-anchor", "middle");
        idleTimeCVTextGroup.selectAll("text.box-idle-time-cv-label").data(["Idle Time CV: "]).join("text").attr("class", "box-idle-time-cv-label").style("font-size", `${labelFontSize}px`).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent')).text(d => d);
        const idleTimeCvValue = idleTimeCVTextGroup.selectAll("text.box-idle-cv-value").data([results]).join("text").attr("class", "box-idle-cv-value").attr("text-anchor", "start").attr("x", 47).style("font-size", `${labelFontSize}px`).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--failure-color'));
        animateValue(idleTimeCvValue.node(), parseElementValue(idleTimeCvValue.node()), results.idleTimeCv, 800, val => `${val.toFixed(1)}%`);
        // Right Group: Bar Chart Title and Balance Loss value.
        const barLabelGroup = summary.selectAll("g.bar-label-group").data([results]).join("g").attr("class", "bar-label-group").attr("transform", `translate(${colWidth * 0.9}, ${-summaryHeight / 2 + 18})`);
        barLabelGroup.selectAll("text.bar-chart-title").data(["Total Balance Loss per Workstation"]).join("text").attr("class", "bar-chart-title").attr("text-anchor", "middle").style("font-size", `${labelFontSize}px`).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent')).text(d => d);
        const balanceLossTextGroup = barLabelGroup.selectAll("g.balance-loss-text-group").data([null]).join("g").attr("class", "balance-loss-text-group").attr("transform", "translate(-20, 20)").attr("text-anchor", "middle");
        balanceLossTextGroup.selectAll("text.bar-balance-delay-label").data(["Workstation Balance Loss: "]).join("text").attr("class", "bar-balance-delay-label").style("font-size", `${labelFontSize}px`).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--accent')).text(d => d);
        const balanceDelayValue = balanceLossTextGroup.selectAll("text.bar-balance-delay-value").data([results]).join("text").attr("class", "bar-balance-delay-value").attr("text-anchor", "start").attr("x", 90).style("font-size", `${labelFontSize}px`).style("font-weight", "bold").attr("fill", getComputedStyle(root).getPropertyValue('--failure-color'));
        animateValue(balanceDelayValue.node(), parseElementValue(balanceDelayValue.node()), results.balanceDelay, 800, val => `${val.toFixed(1)}%`);
    }
    // Expose the public draw method.
    return {
        draw: draw
    };
})();