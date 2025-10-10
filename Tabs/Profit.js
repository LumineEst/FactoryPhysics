/**
* ====================================================================
* ProfitTab IIFE Module
*
* Encapsulates all logic for rendering the Profit Maximization
* and Financial Breakdown dashboard.
* ====================================================================
*/
const ProfitTab = (function () {
    /**
     * @tab Profit
     * Draws the profit and margin optimization charts and financial breakdown.
     * This is the main public method exposed by the IIFE.
     */
    function draw() {
        // --- INITIAL SETUP ---
        // Select the SVG container and clear any previous renderings.
        const svg = d3.select("#profit-panel");
        const { clientWidth: width, clientHeight: height } = document.getElementById('svg-container');
        svg.selectAll("*").remove();
        // Access the pre-calculated profit data from the global cache.
        const data = profitMaximizationCache.data;
        // If data is not yet available, display a loading message and exit.
        if (!data) {
            svg.append("text").attr("x", width / 2).attr("y", height / 2).attr("text-anchor", "middle").text("Calculating profit data, please wait...");
            return;
        }
        // --- LAYOUT & SCALES ---
        // Define margins and dimensions for the charts and breakdown panel.
        const margin = { top: 40, right: 60, bottom: 40, left: 80 };
        const breakdownWidth = Math.max(280, width * 0.32); // Right-side panel.
        const chartsWidth = width - breakdownWidth; // Left-side area for line charts.
        const chartWidth = chartsWidth - margin.left - margin.right;
        const chartHeight = (height / 2) - margin.top - margin.bottom; // Each line chart gets half the height.
        // Create main groups for the two sections.
        const chartsGroup = svg.append("g");
        const breakdownGroup = svg.append("g").attr("transform", `translate(${chartsWidth},0)`);
        // Calculate current metrics based on user inputs to overlay on the charts.
        const op = { dailyDemand: +dailyDemandInput.value, opHours: +opHoursInput.value, numEmployees: +numEmployeesInput.value };
        const fin = { laborCost: +laborCostInput.value, superSell: +superSellInput.value, superCogs: +superCogsInput.value, ultraSell: +ultraSellInput.value, ultraCogs: +ultraCogsInput.value, megaSell: +megaSellInput.value, megaCogs: +megaCogsInput.value };
        const m = calculateMetrics(op, fin);
        // D3 scales for mapping data to pixel values.
        const x = d3.scaleLinear().domain([50, 552]).range([0, chartWidth]); // Demand -> X position.
        const currentProfit = m.dailyGrossProfit;
        const yProfit = d3.scaleLinear().domain([Math.min(currentProfit, d3.min(data.profitData, d => d.value)), Math.max(currentProfit, d3.max(data.profitData, d => d.value))]).nice().range([chartHeight, 0]); // Profit -> Y position.
        const filteredMarginData = data.marginData.filter(d => d.demand > 50);
        const yMargin = d3.scaleLinear().domain([Math.min(m.grossProfitMargin, d3.min(filteredMarginData, d => d.value)), Math.max(m.grossProfitMargin, d3.max(filteredMarginData, d => d.value))]).nice().range([chartHeight, 0]); // Margin -> Y position.
        // --- HELPERS & FORMATTERS ---
        const bisect = d3.bisector(d => d.demand).left; // Helper for finding data points on mouseover.
        const fmtMoney = d3.format("$,.0f"); // Formatter for currency.
        const fmtPct = v => `${d3.format(".1f")(v)}%`; // Formatter for percentages.
        const reqX = x(op.dailyDemand); // X position for required demand.
        const actX = x(m.throughputUnitsPerDay); // X position for actual production.
        // Reusable tooltip for the line charts.
        const tooltip = createTooltip('profit-tooltip').style("position", "fixed");
        const showTT = (html, ev) => tooltip.html(html).style("opacity", 1).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px");
        const hideTT = () => tooltip.style("opacity", 0);
        /**
         * Draws axes and grid lines for a chart.
         * @param {d3.Selection} g - The D3 group to draw in.
         * @param {d3.Scale} xScale - The scale for the x-axis.
         * @param {d3.Scale} yScale - The scale for the y-axis.
         */
        function drawAxesWithGrid(g, xScale, yScale) {
            // Draw faint grid lines for reference.
            g.append("g").attr("class", "grid-minor").call(d3.axisLeft(yScale).ticks(8).tickSize(-chartWidth).tickFormat(""));
            g.append("g").attr("class", "grid-major").attr("transform", `translate(0,${chartHeight})`).call(d3.axisBottom(xScale).ticks(12).tickSize(-chartHeight).tickFormat(""));
            // Draw the main axis lines and labels.
            g.append("g").attr("class", "axis").attr("transform", `translate(0,${chartHeight})`).call(d3.axisBottom(xScale).ticks(12).tickFormat(d3.format("d")));
            g.append("g").attr("class", "axis").call(d3.axisLeft(yScale).ticks(6).tickFormat(yScale === yProfit ? fmtMoney : d => fmtPct(d)));
        }
        // --- PROFIT CHART (TOP) ---
        const gP = chartsGroup.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        drawAxesWithGrid(gP, x, yProfit);
        // Interactive crosshair lines for the tooltip.
        const vGuideP = gP.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideP = gP.append("line").attr("class", "crosshair-h").style("display", "none");
        // Draw the main line representing optimal profit at each demand level.
        gP.append("path").datum(data.profitData.filter(d => d.demand > 50)).attr("class", "line-profit").attr("fill", "none").attr("stroke-width", 2.6).attr("d", d3.line().x(d => x(d.demand)).y(d => yProfit(d.value)));
        // --- CURRENT PERFORMANCE OVERLAYS (PROFIT) ---
        // Find the optimal profit at the actual production level.
        const y_at_act_profit = yProfit(data.profitData[Math.max(0, bisect(data.profitData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_profit = yProfit(m.dailyGrossProfit);
        // Draw a vertical line connecting the current profit to the optimal profit line.
        gP.append("line").attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 1.5).attr("x1", actX).attr("x2", actX).attr("y1", y_at_act_profit).attr("y2", y_current_profit);
        // If demand is not met, highlight the area of lost potential profit.
        if (op.dailyDemand > m.throughputUnitsPerDay) {
            const y_at_req = yProfit(data.profitData[Math.max(0, bisect(data.profitData, op.dailyDemand, 1) - 1)].value);
            gP.append("path").attr("d", `M ${actX},${y_at_act_profit} L ${reqX},${y_at_req} L ${reqX},${y_current_profit} L ${actX},${y_current_profit} Z`).attr("class", "lost-profit-area");
            gP.append("line").attr("stroke", getComputedStyle(root).getPropertyValue('--failure-color').trim()).attr("stroke-width", 1.5).attr("x1", reqX).attr("x2", reqX).attr("y1", y_at_req).attr("y2", y_current_profit);
        }
        // Draw a point indicating the current operating performance.
        gP.append("circle").attr("class", "point-now").attr("cx", actX).attr("cy", y_current_profit).attr("r", 5);
        // Chart title.
        gP.append("text").attr("x", chartWidth / 2).attr("y", -14).attr("text-anchor", "middle").style("font-weight", 800).text("Max Gross Profit vs Daily Demand");
        // Add an invisible rectangle to capture mouse events for the tooltip.
        gP.append("rect").attr("width", chartWidth).attr("height", chartHeight).attr("fill", "transparent").style("pointer-events", "all")
            .on("mousemove", (ev) => {
                const d = data.profitData[Math.max(0, bisect(data.profitData, Math.round(x.invert(d3.pointer(ev)[0])), 1) - 1)];
                if (!d) return;
                // Update crosshair positions.
                vGuideP.style("display", null).attr("x1", x(d.demand)).attr("x2", x(d.demand)).attr("y1", 0).attr("y2", chartHeight);
                hGuideP.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yProfit(d.value)).attr("y2", yProfit(d.value));
                // Show tooltip with optimal configuration details.
                showTT(`<div class="tooltip-header">Demand: ${d.demand}</div><div class="tooltip-row"><span class="tooltip-key">Optimal Profit</span><span>${fmtMoney(d.value)}</span></div><div class="tooltip-row"><span class="tooltip-key"># Workstations</span><span>${d.config.emp}</span></div><div class="tooltip-row"><span class="tooltip-key">Oper Hours</span><span>${d.config.hrs}</span></div>`, ev);
            }).on("mouseleave", () => {
                vGuideP.style("display", "none");
                hGuideP.style("display", "none");
                hideTT();
            });
        // --- MARGIN CHART (BOTTOM) ---
        const gM = chartsGroup.append("g").attr("transform", `translate(${margin.left},${margin.top + height / 2})`);
        drawAxesWithGrid(gM, x, yMargin);
        // Interactive crosshair lines.
        const vGuideM = gM.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideM = gM.append("line").attr("class", "crosshair-h").style("display", "none");
        // Draw the main line representing optimal profit margin.
        gM.append("path").datum(filteredMarginData).attr("class", "line-margin").attr("fill", "none").attr("stroke-width", 2.6).attr("d", d3.line().x(d => x(d.demand)).y(d => yMargin(d.value)));
        // --- CURRENT PERFORMANCE OVERLAYS (MARGIN) ---
        const y_at_act_margin = yMargin(data.marginData[Math.max(0, bisect(data.marginData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_margin = yMargin(m.grossProfitMargin);
        // Draw a vertical line connecting current margin to the optimal line.
        gM.append("line").attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 1.5).attr("x1", actX).attr("x2", actX).attr("y1", y_at_act_margin).attr("y2", y_current_margin);
        // Highlight lost potential margin if demand is not met.
        if (op.dailyDemand > m.throughputUnitsPerDay) {
            const y_at_req_margin = yMargin(data.marginData[Math.max(0, bisect(data.marginData, op.dailyDemand, 1) - 1)].value);
            gM.append("path").attr("d", `M ${actX},${y_at_act_margin} L ${reqX},${y_at_req_margin} L ${reqX},${y_current_margin} L ${actX},${y_current_margin} Z`).attr("class", "lost-profit-area");
            gM.append("line").attr("stroke", "red").attr("stroke-width", 1.5).attr("x1", reqX).attr("x2", reqX).attr("y1", y_at_req_margin).attr("y2", y_current_margin);
        }
        // Draw a point indicating current operating margin.
        gM.append("circle").attr("class", "point-now").attr("cx", actX).attr("cy", y_current_margin).attr("r", 5);
        // Chart title and axis labels.
        gM.append("text").attr("x", chartWidth / 2).attr("y", -14).attr("text-anchor", "middle").style("font-weight", 800).text("Max Gross Profit Margin vs Daily Demand");
        gM.append("text").attr("class", "axis-label").attr("x", chartWidth / 2).attr("y", chartHeight + 40).attr("text-anchor", "middle").text("Daily Demand (units)");
        // Mouse event rectangle for the margin chart tooltip.
        gM.append("rect").attr("width", chartWidth).attr("height", chartHeight).attr("fill", "transparent").style("pointer-events", "all")
            .on("mousemove", (ev) => {
                const d = data.marginData[Math.max(0, bisect(data.marginData, Math.round(x.invert(d3.pointer(ev)[0])), 1) - 1)];
                if (!d) return;
                vGuideM.style("display", null).attr("x1", x(d.demand)).attr("x2", x(d.demand)).attr("y1", 0).attr("y2", chartHeight);
                hGuideM.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yMargin(d.value)).attr("y2", yMargin(d.value));
                showTT(`<div class="tooltip-header">Demand: ${d.demand}</div><div class="tooltip-row"><span class="tooltip-key">Optimal Margin</span><span>${fmtPct(d.value)}</span></div><div class="tooltip-row"><span class="tooltip-key"># Workstations</span><span>${d.config.emp}</span></div><div class="tooltip-row"><span class="tooltip-key">Oper Hours</span><span>${d.config.hrs}</span></div>`, ev);
            }).on("mouseleave", () => {
                vGuideM.style("display", "none");
                hGuideM.style("display", "none");
                hideTT();
            });
        // --- BREAKDOWN PANEL (RIGHT SIDE) ---
        const totalLabor = op.numEmployees * op.opHours * fin.laborCost;
        // Calculate sales, COGS, labor, and profit for each model.
        const perModel = ["super", "ultra", "mega"].map(key => {
            const units = m.throughputUnitsPerDay * BUILD_RATIOS[key];
            const sales = units * fin[`${key}Sell`];
            const cogs = units * fin[`${key}Cogs`];
            const labor = totalLabor * BUILD_RATIOS[key];
            const profit = sales - cogs - labor;
            return { label: key[0].toUpperCase() + key.slice(1), sales, cogs, labor, profit, margin: sales > 0 ? (profit / sales) * 100 : 0 };
        });
        const totalProfit = d3.sum(perModel, d => d.profit);
        const pad = Math.max(16, breakdownWidth * 0.10); // Padding for the panel.
        // --- PIE CHARTS (TOP HALF OF BREAKDOWN) ---
        const topHalf = breakdownGroup.append("g");
        topHalf.append("rect").attr("class", "breakdown-border").attr("x", pad / 2).attr("y", pad / 2).attr("width", breakdownWidth - pad).attr("height", height / 2 - pad); // Border.
        const pies = [{ title: "Overall", data: { Profit: totalProfit, Labor: totalLabor, COGS: d3.sum(perModel, d => d.cogs) } }, ...perModel.map(d => ({ title: d.label, data: { Profit: d.profit, Labor: d.labor, COGS: d.cogs } }))];
        const pieColors = { Profit: getComputedStyle(root).getPropertyValue('--primary').trim(), Labor: getComputedStyle(root).getPropertyValue('--secondary1').trim(), COGS: getComputedStyle(root).getPropertyValue('--secondary2').trim(), Loss: getComputedStyle(root).getPropertyValue('--failure-color').trim() };
        const R = Math.min((breakdownWidth - 2 * pad) / 4, (height / 2 - 2 * pad) / 4) * 0.78; // Pie chart radius.
        const pie = d3.pie().value(d => d.value).sort(null);
        const arc = d3.arc().innerRadius(0).outerRadius(R);
        const ttPie = createTooltip('profit-pie-tooltip');
        // Draw a pie chart for "Overall" and each model type.
        pies.forEach((pd, i) => {
            const g = topHalf.append("g").attr("transform", `translate(${pad + ((breakdownWidth - 2 * pad) * (i % 2 === 0 ? 0.25 : 0.75))}, ${pad + ((height / 2 - 2 * pad) * (i < 2 ? 0.3 : 0.78)) - 10})`);
            const isLoss = pd.data.Profit < 0;
            // If there's a loss, replace 'Profit' with 'Loss' for the chart data.
            const chartData = Object.entries(isLoss ? { Loss: -pd.data.Profit, Labor: pd.data.Labor, COGS: pd.data.COGS } : { Profit: pd.data.Profit, Labor: pd.data.Labor, COGS: pd.data.COGS }).map(([k, v]) => ({ label: k, value: v })).filter(d => d.value > 1e-6);
            const total = d3.sum(chartData, r => r.value);
            g.selectAll("path").data(pie(chartData)).join("path").attr("d", arc).attr("fill", d => pieColors[d.data.label])
                .on("mouseenter", () => ttPie.style("opacity", 1))
                .on("mouseleave", () => ttPie.style("opacity", 0))
                .on("mousemove", (ev, d) => { // Pie chart tooltip.
                    const amountValue = d.data.label === 'Loss' ? `-${fmtMoney(d.data.value)}` : fmtMoney(d.data.value);
                    ttPie.html(`<div class="tooltip-header">${pd.title}: ${d.data.label}</div><div class="tooltip-row"><span class="tooltip-key">Amount</span><span>${amountValue}</span></div><div class="tooltip-row"><span class="tooltip-key">${isLoss ? 'Share of Costs & Loss' : 'Share'}</span><span>${(total > 0 ? (d.data.value / total * 100) : 0).toFixed(1)}%</span></div>`).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px");
                });
            g.append("text").attr("class", "pie-title").attr("y", -R - 10).text(pd.title); // Pie chart title.
        });
        // Pie chart legend.
        const legend = topHalf.append("g").attr("transform", `translate(${pad},${height / 2 - pad - 14})`);
        const legData = Object.entries({ Profit: getComputedStyle(root).getPropertyValue('--primary').trim(), Loss: getComputedStyle(root).getPropertyValue('--failure-color').trim(), Labor: getComputedStyle(root).getPropertyValue('--secondary1').trim(), COGS: getComputedStyle(root).getPropertyValue('--secondary2').trim() }).map(([label, color]) => ({ label, color }));
        const li = legend.selectAll(".li").data(legData).join("g").attr("class", "li").attr("transform", (d, i) => `translate(${i * ((breakdownWidth - 2 * pad) / legData.length)},0)`);
        li.append("rect").attr("width", 12).attr("height", 12).attr("fill", d => d.color).attr("rx", 2);
        li.append("text").attr("x", 16).attr("y", 10.5).style("font-size", "12px").style("font-weight", 700).text(d => d.label);
        // --- BAR CHART (BOTTOM HALF OF BREAKDOWN) ---
        const bottomHalf = breakdownGroup.append("g").attr("transform", `translate(0,${height / 2})`);
        bottomHalf.append("rect").attr("class", "breakdown-border").attr("x", pad / 2).attr("y", pad / 2).attr("width", breakdownWidth - pad).attr("height", height / 2 - pad); // Border.
        const barM = { top: 30, right: 22, bottom: 40, left: 20 };
        const barH = height / 2 - 2 * pad - barM.top - barM.bottom;
        const yBar = d3.scaleLinear().domain([Math.min(0, d3.min(perModel, d => d.profit)), d3.max(perModel, d => d.profit)]).nice().range([barH, 0]);
        // Dynamically calculate space needed for Y-axis labels.
        let maxLabelWidth = 0;
        const tempText = svg.append("text").attr("class", "axis").style("opacity", 0);
        yBar.ticks(5).forEach(tick => { maxLabelWidth = Math.max(maxLabelWidth, tempText.text(fmtMoney(tick)).node().getBBox().width); });
        tempText.remove();
        const yAxisSpace = maxLabelWidth + 10;
        const barW = breakdownWidth - 2 * pad - barM.right - yAxisSpace;
        const gB = bottomHalf.append("g").attr("transform", `translate(${pad},${pad + barM.top})`);
        const xBand = d3.scaleBand().domain(perModel.map(d => d.label)).range([yAxisSpace, yAxisSpace + barW]).padding(0.25); // X-axis for models.
        // Draw bar chart axes.
        gB.append("g").attr("class", "axis").attr("transform", `translate(${yAxisSpace},0)`).call(d3.axisLeft(yBar).ticks(5).tickFormat(fmtMoney));
        gB.append("g").attr("class", "axis").attr("transform", `translate(0,${barH})`).call(d3.axisBottom(xBand));
        if (yBar.domain()[0] < 0) { gB.append("line").attr("x1", yAxisSpace).attr("x2", yAxisSpace + barW).attr("y1", yBar(0)).attr("y2", yBar(0)).attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 1.5).attr("stroke-dasharray", "3,3"); } // Zero-line for negative profits.
        // Bar chart labels.
        gB.append("text").attr("class", "axis-label").attr("transform", "rotate(-90)").attr("x", -barH / 2).attr("y", 0).attr("text-anchor", "middle").text("Gross Profit");
        gB.append("text").attr("class", "axis-label").attr("x", yAxisSpace + barW / 2).attr("y", barH + barM.bottom - 6).attr("text-anchor", "middle").text("Model");
        // Draw the bars.
        const modelColor = { Super: getComputedStyle(root).getPropertyValue('--super-color').trim(), Ultra: getComputedStyle(root).getPropertyValue('--ultra-color').trim(), Mega: getComputedStyle(root).getPropertyValue('--mega-color').trim() };
        const ttBar = createTooltip('profit-bar-tooltip');
        gB.selectAll("rect").data(perModel).join("rect")
            .attr("x", d => xBand(d.label))
            .attr("width", xBand.bandwidth())
            .attr("y", d => d.profit < 0 ? yBar(0) : yBar(d.profit)) // Start from zero for negative bars.
            .attr("height", d => Math.abs(yBar(d.profit) - yBar(0)))
            .attr("rx", 4)
            .attr("fill", d => modelColor[d.label] || getComputedStyle(root).getPropertyValue('--accent'))
            .on("mouseenter", () => ttBar.style("opacity", 1))
            .on("mouseleave", () => ttBar.style("opacity", 0))
            .on("mousemove", (ev, d) => { // Bar chart tooltip.
                ttBar.html(`<div class="tooltip-header">${d.label}</div><div class="tooltip-row"><span class="tooltip-key">Profit</span><span>${fmtMoney(d.profit)}</span></div><div class="tooltip-row"><span class="tooltip-key">Margin</span><span>${fmtPct(d.margin)}</span></div>`).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px");
            });
    }
    // Expose the public draw method.
    return {
        draw: draw
    };
})();