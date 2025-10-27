const ProfitTab = (function () {
    function draw() {
        // --- INITIAL SETUP ---
        const svg = d3.select("#profit-panel");
        const { clientWidth: width, clientHeight: height } = document.getElementById('svg-container');
        svg.selectAll("*").remove();

        const data = profitMaximizationCache.data;
        if (!data) {
            svg.append("text")
               .attr("x", width / 2)
               .attr("y", height / 2)
               .attr("text-anchor", "middle")
               .text("Calculating profit data, please wait...");
            return;
        }

        // --- LAYOUT & SCALES ---
        const margin = { top: 40, right: 60, bottom: 60, left: 80 };

        // Right panel base split (will be adjusted after measuring legend)
        const breakdownWidth = Math.max(280, width * 0.32);
        const chartsWidth = width - breakdownWidth;
        const chartWidth = chartsWidth - margin.left - margin.right;
        const chartHeight = (height / 2) - margin.top - margin.bottom;

        const chartsGroup = svg.append("g");
        const breakdownGroup = svg.append("g").attr("transform", `translate(${chartsWidth},0)`);

        // --- INPUTS / METRICS ---
        const op = {
            dailyDemand: +dailyDemandInput.value,
            opHours: +opHoursInput.value,
            numEmployees: +numEmployeesInput.value
        };
        const fin = {
            laborCost: +laborCostInput.value,
            superSell: +superSellInput.value,
            superCogs: +superCogsInput.value,
            ultraSell: +ultraSellInput.value,
            ultraCogs: +ultraCogsInput.value,
            megaSell: +megaSellInput.value,
            megaCogs: +megaCogsInput.value,
        };
        const m = calculateMetrics(op, fin);

        const x = d3.scaleLinear().domain([50, 552]).range([0, chartWidth]);

        const currentProfit = m.dailyGrossProfit;
        const yProfit = d3.scaleLinear()
            .domain([
                Math.min(currentProfit, d3.min(data.profitData, d => d.value)),
                Math.max(currentProfit, d3.max(data.profitData, d => d.value))
            ])
            .nice()
            .range([chartHeight, 0]);

        const filteredMarginData = data.marginData.filter(d => d.demand > 50);
        const yMargin = d3.scaleLinear()
            .domain([
                Math.min(m.grossProfitMargin, d3.min(filteredMarginData, d => d.value)),
                Math.max(m.grossProfitMargin, d3.max(filteredMarginData, d => d.value))
            ])
            .nice()
            .range([chartHeight, 0]);

        // --- HELPERS & FORMATTERS ---
        const bisect = d3.bisector(d => d.demand).left;
        const fmtMoney = d3.format("$,.0f");
        const fmtPct = v => `${d3.format(".1f")(v)}%`;

        const reqX = x(op.dailyDemand);
        const actX = x(m.throughputUnitsPerDay);

        const tooltip = createTooltip('profit-tooltip').style("position", "fixed");
        const showTT = (html, ev) => tooltip.html(html).style("opacity", 1)
            .style("left", (ev.clientX + 14) + "px")
            .style("top", (ev.clientY - 24) + "px");
        const hideTT = () => tooltip.style("opacity", 0);

        // Total Lost Profit = (demand × optimal profit at that demand) − (met demand × current-config profit)
        function computeTotalLostProfit(demand, optimalDailyProfitAtDemand) {
            const metDemand = Math.min(demand, m.throughputUnitsPerDay);
            const perUnitCurrent = (m.throughputUnitsPerDay > 0)
                ? (m.dailyGrossProfit / m.throughputUnitsPerDay)
                : 0;
            const currentAtMet = perUnitCurrent * metDemand;
            return Math.max(0, (optimalDailyProfitAtDemand || 0) - currentAtMet);
        }

        // Show Total Lost Profit only when unmet demand exists.
        const unmetExists = op.dailyDemand > m.throughputUnitsPerDay;

        function drawAxesWithGrid(g, xScale, yScale) {
            g.append("g")
                .attr("class", "grid-major")
                .call(d3.axisLeft(yScale).ticks(8).tickSize(-chartWidth).tickFormat(""));
            g.append("g")
                .attr("class", "grid-major")
                .attr("transform", `translate(0,${chartHeight})`)
                .call(d3.axisBottom(xScale).ticks(12).tickSize(-chartHeight).tickFormat(""));
            g.append("g")
                .attr("class", "axis")
                .attr("transform", `translate(0,${chartHeight})`)
                .call(d3.axisBottom(xScale).ticks(12).tickFormat(d3.format("d")));
            g.append("g")
                .attr("class", "axis")
                .call(d3.axisLeft(yScale).ticks(6).tickFormat(yScale === yProfit ? fmtMoney : d => fmtPct(d)));
        }

        // --- PROFIT CHART (TOP) ---
        const gP = chartsGroup.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        drawAxesWithGrid(gP, x, yProfit);

        const vGuideP = gP.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideP = gP.append("line").attr("class", "crosshair-h").style("display", "none");

        gP.append("path")
            .datum(data.profitData.filter(d => d.demand > 50))
            .attr("class", "line-profit")
            .attr("fill", "none")
            .attr("stroke-width", 2.6)
            .attr("d", d3.line().x(d => x(d.demand)).y(d => yProfit(d.value)));

        const y_at_act_profit = yProfit(data.profitData[Math.max(0, bisect(data.profitData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_profit = yProfit(m.dailyGrossProfit);

        gP.append("line")
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 1.5)
            .attr("x1", actX).attr("x2", actX)
            .attr("y1", y_at_act_profit).attr("y2", y_current_profit);

        let areaPath = null;
        if (unmetExists) {
            const y_at_req = yProfit(data.profitData[Math.max(0, bisect(data.profitData, op.dailyDemand, 1) - 1)].value);
            areaPath = gP.append("path")
                .attr("d", `M ${actX},${y_at_act_profit} L ${reqX},${y_at_req} L ${reqX},${y_current_profit} L ${actX},${y_current_profit} Z`)
                .attr("class", "lost-profit-area");

            gP.append("line")
                .attr("stroke", getComputedStyle(root).getPropertyValue('--failure-color').trim())
                .attr("stroke-width", 1.5)
                .attr("x1", reqX).attr("x2", reqX)
                .attr("y1", y_at_req).attr("y2", y_current_profit);

            // Tooltip over the red area (includes Total Lost Profit)
            areaPath
                .on("mousemove", (ev) => {
                    const demandHover = Math.round(x.invert(d3.pointer(ev)[0]));
                    const idx = Math.max(0, bisect(data.profitData, demandHover, 1) - 1);
                    const opt = data.profitData[idx];
                    const tlp = computeTotalLostProfit(demandHover, opt?.value);
                    showTT(
                        `<div class="tooltip-header">Unmet Demand</div>
                         <div class="tooltip-row"><span class="tooltip-key">Demand</span><span>${demandHover}</span></div>
                         <div class="tooltip-row"><span class="tooltip-key">Optimal Profit @ demand</span><span>${fmtMoney(opt?.value ?? 0)}</span></div>
                         <div class="tooltip-row"><span class="tooltip-key">Current Config @ met demand</span><span>${fmtMoney((m.throughputUnitsPerDay > 0) ? (m.dailyGrossProfit / m.throughputUnitsPerDay) * Math.min(demandHover, m.throughputUnitsPerDay) : 0)}</span></div>
                         <div class="tooltip-row"><span class="tooltip-key">Total Lost Profit</span><span>${fmtMoney(tlp)}</span></div>`,
                        ev
                    );
                })
                .on("mouseleave", hideTT);
        }

        // Current profit point (red dot)
        gP.append("circle")
            .attr("class", "point-now")
            .attr("cx", actX)
            .attr("cy", y_current_profit)
            .attr("r", 5)
            .on("mouseenter", (ev) => {
                showTT(
                    `<div class="tooltip-header">Current Profit</div>
                     <div class="tooltip-row"><span class="tooltip-key">Red dot</span><span>Your current gross profit at today's throughput</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Value</span><span>${fmtMoney(m.dailyGrossProfit)}</span></div>`,
                    ev
                );
            })
            .on("mouseleave", hideTT);

        gP.append("text")
            .attr("x", chartWidth / 2)
            .attr("y", -14)
            .attr("text-anchor", "middle")
            .style("font-weight", 800)
            .text("Max Gross Profit vs Daily Demand");

        const vGuideP2 = gP.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideP2 = gP.append("line").attr("class", "crosshair-h").style("display", "none");

        // General hover (show TLP row only if unmetExists)
        gP.append("rect")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "transparent")
            .style("pointer-events", "all")
            .on("mousemove", (ev) => {
                if (areaPath) {
                    const el = document.elementFromPoint(ev.clientX, ev.clientY);
                    if (el && el === areaPath.node()) return;
                }
                const demandHover = Math.round(x.invert(d3.pointer(ev)[0]));
                const idx = Math.max(0, bisect(data.profitData, demandHover, 1) - 1);
                const d = data.profitData[idx];
                if (!d) return;

                const tlpRow = unmetExists
                    ? `<div class="tooltip-row"><span class="tooltip-key">Total Lost Profit</span><span>${fmtMoney(computeTotalLostProfit(demandHover, d.value))}</span></div>`
                    : "";

                vGuideP.style("display", null).attr("x1", x(d.demand)).attr("x2", x(d.demand)).attr("y1", 0).attr("y2", chartHeight);
                hGuideP.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yProfit(d.value)).attr("y2", yProfit(d.value));
                vGuideP2.style("display", null).attr("x1", x(d.demand)).attr("x2", x(d.demand)).attr("y1", 0).attr("y2", chartHeight);
                hGuideP2.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yProfit(d.value)).attr("y2", yProfit(d.value));

                showTT(
                    `<div class="tooltip-header">Demand: ${demandHover}</div>
                     <div class="tooltip-row"><span class="tooltip-key">Optimal Profit</span><span>${fmtMoney(d.value)}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key"># Workstations</span><span>${d.config.emp}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Oper Hours</span><span>${d.config.hrs}</span></div>
                     ${tlpRow}`,
                    ev
                );
            })
            .on("mouseleave", () => { vGuideP.style("display", "none"); hGuideP.style("display", "none"); vGuideP2.style("display", "none"); hGuideP2.style("display", "none"); hideTT(); });

        // --- MARGIN CHART (BOTTOM) ---
        const gM = chartsGroup.append("g").attr("transform", `translate(${margin.left},${margin.top + height / 2})`);
        drawAxesWithGrid(gM, x, yMargin);

        const vGuideM = gM.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideM = gM.append("line").attr("class", "crosshair-h").style("display", "none");

        gM.append("path")
            .datum(filteredMarginData)
            .attr("class", "line-margin")
            .attr("fill", "none")
            .attr("stroke-width", 2.6)
            .attr("d", d3.line().x(d => x(d.demand)).y(d => yMargin(d.value)));

        const y_at_act_margin = yMargin(data.marginData[Math.max(0, bisect(data.marginData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_margin = yMargin(m.grossProfitMargin);

        gM.append("line")
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 1.5)
            .attr("x1", actX).attr("x2", actX)
            .attr("y1", y_at_act_margin).attr("y2", y_current_margin);

        if (unmetExists) {
            const y_at_req_margin = yMargin(data.marginData[Math.max(0, bisect(data.marginData, op.dailyDemand, 1) - 1)].value);
            const areaPathM = gM.append("path")
                .attr("d", `M ${actX},${y_at_act_margin} L ${reqX},${y_at_req_margin} L ${reqX},${y_current_margin} L ${actX},${y_current_margin} Z`)
                .attr("class", "lost-profit-area");
            gM.append("line")
                .attr("stroke", "red")
                .attr("stroke-width", 1.5)
                .attr("x1", reqX).attr("x2", reqX)
                .attr("y1", y_at_req_margin).attr("y2", y_current_margin);

            // Margin chart red area tooltip — include Total Lost Profit (using profit curve)
            areaPathM
                .on("mousemove", (ev) => {
                    const demandHover = Math.round(x.invert(d3.pointer(ev)[0]));
                    const idx = Math.max(0, bisect(data.profitData, demandHover, 1) - 1);
                    const optProfitAtDemand = data.profitData[idx]?.value ?? 0;
                    const tlp = computeTotalLostProfit(demandHover, optProfitAtDemand);

                    showTT(
                        `<div class="tooltip-header">Unmet Demand</div>
                         <div class="tooltip-row"><span class="tooltip-key">Demand</span><span>${demandHover}</span></div>
                         <div class="tooltip-row"><span class="tooltip-key">Total Lost Profit</span><span>${fmtMoney(tlp)}</span></div>
                         <div class="tooltip-row"><span class="tooltip-key">Note</span><span>Margin line shows %; lost profit shown in $ using profit curve</span></div>`,
                        ev
                    );
                })
                .on("mouseleave", hideTT);
        }

        gM.append("circle").attr("class", "point-now").attr("cx", actX).attr("cy", y_current_margin).attr("r", 5)
            .on("mouseenter", (ev) => {
                showTT(
                    `<div class="tooltip-header">Current Margin</div>
                     <div class="tooltip-row"><span class="tooltip-key">Red dot</span><span>Your current gross profit margin at today's throughput</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Value</span><span>${fmtPct(m.grossProfitMargin)}</span></div>`,
                    ev
                );
            })
            .on("mouseleave", hideTT);

        gM.append("text")
            .attr("x", chartWidth / 2)
            .attr("y", -14)
            .attr("text-anchor", "middle")
            .style("font-weight", 800)
            .text("Max Gross Profit Margin vs Daily Demand");

        gM.append("text")
            .attr("class", "axis-label")
            .attr("x", chartWidth / 2)
            .attr("y", chartHeight + (margin.bottom - 12))
            .attr("text-anchor", "middle")
            .text("Daily Demand (units)");

        // General hover for margin chart (conditionally include TLP row)
        gM.append("rect")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "transparent")
            .style("pointer-events", "all")
            .on("mousemove", (ev) => {
                const demandHover = Math.round(x.invert(d3.pointer(ev)[0]));
                const idxM = Math.max(0, bisect(data.marginData, demandHover, 1) - 1);
                const dM = data.marginData[idxM];
                if (!dM) return;

                // compute TLP from profitData for the same hover demand
                const idxP = Math.max(0, bisect(data.profitData, demandHover, 1) - 1);
                const optProfitAtDemand = data.profitData[idxP]?.value ?? 0;
                const tlpRow = unmetExists
                    ? `<div class="tooltip-row"><span class="tooltip-key">Total Lost Profit</span><span>${fmtMoney(computeTotalLostProfit(demandHover, optProfitAtDemand))}</span></div>`
                    : "";

                vGuideM.style("display", null).attr("x1", x(dM.demand)).attr("x2", x(dM.demand)).attr("y1", 0).attr("y2", chartHeight);
                hGuideM.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yMargin(dM.value)).attr("y2", yMargin(dM.value));
                showTT(
                    `<div class="tooltip-header">Demand: ${demandHover}</div>
                     <div class="tooltip-row"><span class="tooltip-key">Optimal Margin</span><span>${fmtPct(dM.value)}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key"># Workstations</span><span>${dM.config.emp}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Oper Hours</span><span>${dM.config.hrs}</span></div>
                     ${tlpRow}`,
                    ev
                );
            })
            .on("mouseleave", () => { vGuideM.style("display", "none"); hGuideM.style("display", "none"); hideTT(); });

        // --- BREAKDOWN PANEL (RIGHT SIDE) ---
        const totalLabor = op.numEmployees * op.opHours * fin.laborCost;
        const perModel = ["super", "ultra", "mega"].map(key => {
            const units = m.throughputUnitsPerDay * BUILD_RATIOS[key];
            const sales = units * fin[`${key}Sell`];
            const cogs = units * fin[`${key}Cogs`];
            const labor = totalLabor * BUILD_RATIOS[key];
            const profit = sales - cogs - labor;
            return {
                label: key[0].toUpperCase() + key.slice(1),
                sales, cogs, labor, profit,
                margin: sales > 0 ? (profit / sales) * 100 : 0
            };
        });
        const totalProfit = d3.sum(perModel, d => d.profit);
        const pad = Math.max(16, breakdownWidth * 0.10);

        // ---------- TOP (Legend) ----------
        // Build legend first, then MEASURE it to compute layout.
        const keyGroup = breakdownGroup.append("g");
        const legendBorder = keyGroup.append("rect")
            .attr("class", "breakdown-border")
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", breakdownWidth - pad)
            .attr("height", 1); // temp, will resize after measuring

        const titleY = pad / 2 + 20;
        keyGroup.append("text")
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", titleY)
            .attr("text-anchor", "middle")
            .attr("class", "panel-title")
            .style("font-weight", 800)
            .text("Profit Margin Indicators");

        const legendCard = keyGroup.append("g")
            .attr("transform", `translate(${pad},${titleY + 12})`);

        function addLegendItem(g, y, drawIcon, label) {
            const item = g.append("g").attr("transform", `translate(0,${y})`);
            drawIcon(item);
            item.append("text")
                .attr("x", 22)
                .attr("y", 10)
                .style("font-size", "12px")
                .style("font-weight", 600)
                .text(label);
            return item;
        }

        const rowHeight = 22;
        addLegendItem(
            legendCard, 0,
            (r) => r.append("circle").attr("class", "point-now").attr("r", 6).attr("cx", 6).attr("cy", 6),
            "Current profit/margin"
        );
        addLegendItem(
            legendCard, rowHeight,
            (r) => r.append("rect").attr("class", "lost-profit-area").attr("x", 1).attr("y", 0).attr("width", 12).attr("height", 12),
            "Unmet demand (lost profit)"
        );

        // Measure legend's true height and compute panel splits safely (added a bit more bottom space)
        const legendBBox = keyGroup.node().getBBox();
        const legendOuterBottom = legendBBox.y + legendBBox.height + pad / 2 + 8; // include bottom breathing space
        const baseTopH = Math.round(height * 0.10);
        const rightTopH = Math.max(baseTopH, Math.ceil(legendOuterBottom)); // final legend section height

        // Resize the border to the final height
        legendBorder.attr("height", rightTopH - pad);

        // Now compute mid/bottom based on remaining space (≈50/40)
        const rightMidH = Math.round((height - rightTopH) * 0.55);
        const rightBotH = height - rightTopH - rightMidH;

        // ---------- MIDDLE (Pies) ----------
        const topHalf = breakdownGroup.append("g").attr("transform", `translate(0, ${rightTopH})`);
        topHalf.append("rect")
            .attr("class", "breakdown-border")
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", breakdownWidth - pad)
            .attr("height", rightMidH - pad);

        topHalf.append("text")
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", pad / 2 + 20)
            .attr("text-anchor", "middle")
            .attr("class", "panel-title")
            .style("font-weight", 800)
            .text("Cost & Profit Composition");

        const pieColors = {
            Profit: getComputedStyle(root).getPropertyValue('--primary').trim(),
            Labor: getComputedStyle(root).getPropertyValue('--secondary1').trim(),
            Material: getComputedStyle(root).getPropertyValue('--secondary2').trim(),
            Loss: getComputedStyle(root).getPropertyValue('--failure-color').trim()
        };

        const innerW = breakdownWidth - 2 * pad;
        const innerH = rightMidH - 2 * pad;
        const R = Math.min(innerW / 4, innerH / 4) * 0.85;

        const pie = d3.pie().value(d => d.value).sort(null);
        const arc = d3.arc().innerRadius(0).outerRadius(R);
        const ttPie = createTooltip('profit-pie-tooltip');

        const pies = [
            { title: "Overall", data: { Profit: totalProfit, Labor: totalLabor, Material: d3.sum(perModel, d => d.cogs) } },
            ...perModel.map(d => ({ title: d.label, data: { Profit: d.profit, Labor: d.labor, Material: d.cogs } }))
        ];

        pies.forEach((pd, i) => {
            const cx = pad + innerW * (i % 2 === 0 ? 0.25 : 0.75);
            const cy = pad + innerH * (i < 2 ? 0.31 : 0.78);
            const g = topHalf.append("g").attr("transform", `translate(${cx}, ${cy})`);

            const isLoss = pd.data.Profit < 0;
            const chartData = Object.entries(
                isLoss
                    ? { Loss: -pd.data.Profit, Labor: pd.data.Labor, Material: pd.data.Material }
                    : { Profit: pd.data.Profit, Labor: pd.data.Labor, Material: pd.data.Material }
            )
                .map(([k, v]) => ({ label: k, value: v }))
                .filter(d => d.value > 1e-6);

            const total = d3.sum(chartData, r => r.value);

            g.selectAll("path")
                .data(pie(chartData))
                .join("path")
                .attr("d", arc)
                .attr("fill", d => pieColors[d.data.label])
                .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
                .attr("stroke-width", 1.2)
                .on("mouseenter", () => ttPie.style("opacity", 1))
                .on("mouseleave", () => ttPie.style("opacity", 0))
                .on("mousemove", (ev, d) => {
                    const amountValue = d.data.label === 'Loss' ? `-${fmtMoney(d.data.value)}` : fmtMoney(d.data.value);
                    ttPie.html(
                        `<div class="tooltip-header">${pd.title}: ${d.data.label}</div>
                         <div class="tooltip-row"><span class="tooltip-key">Amount</span><span>${amountValue}</span></div>
                         <div class="tooltip-row"><span class="tooltip-key">${isLoss ? 'Share of Costs & Loss' : 'Share'}</span><span>${(total > 0 ? (d.data.value / total * 100) : 0).toFixed(1)}%</span></div>`
                    ).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px");
                });

            g.append("text").attr("class", "pie-title").attr("y", -R - 10).text(pd.title);
        });

                // --- LEGEND (wider + wrapped layout) ---
        const legend = topHalf.append("g");
        const legendYBase = height / 2 - pad - 30;
        const legendXStart = pad / 2 + 6;
        const innerWidth = breakdownWidth - pad;

        const legData = Object.entries({
            Profit: getComputedStyle(root).getPropertyValue('--primary').trim(),
            Loss: getComputedStyle(root).getPropertyValue('--failure-color').trim(),
            Labor: getComputedStyle(root).getPropertyValue('--secondary1').trim(),
            Material: getComputedStyle(root).getPropertyValue('--secondary2').trim()
        }).map(([label, color]) => ({ label, color }));

        // width measurement for flow layout
        const measurer = svg.append("text").style("font-size", "12px").style("font-weight", 700).style("opacity", 0);
        const itemWidths = legData.map(d => {
            measurer.text(d.label);
            return 12 + 4 + measurer.node().getBBox().width + 8; // rect + gap + text + trailing pad
        });
        measurer.remove();

                // --- CONSISTENT ROW HEIGHT & CUSTOM EXTRA GAPS ---
        const legendRowHeight = 22;          // base row height
        const extraGap12 = 8;                // extra space between rows 1 -> 2
        const extraGap34 = 8;                // extra space between rows 3 -> 4

        let xCursor = legendXStart;
        let yCursor = legendYBase;
        let currentRow = 0;                  // 0-based row index (0=first row)

        const rectY = (legendRowHeight - 12) / 2; // center 12px swatch in the row
        const textY = rectY + 10.5;               // text baseline aligned to swatch

        const li = legend.selectAll(".li")
            .data(legData)
            .join("g")
            .attr("class", "li")
            .attr("transform", (d, i) => {
                const w = itemWidths[i];

                if (xCursor + w > legendXStart + innerWidth) {
                    xCursor = legendXStart;
                    currentRow += 1; // wrapped to next row

                    // add base row height + targeted extra gaps
                    let extra = 0;
                    if (currentRow === 1) extra = extraGap12; // after first row
                    if (currentRow === 3) extra = extraGap34; // after third row
                    yCursor += legendRowHeight + extra;
                }

                const tx = xCursor;
                xCursor += w;
                return `translate(${tx},${yCursor})`;
            });

        li.append("rect")
            .attr("y", rectY)
            .attr("width", 12)
            .attr("height", 12)
            .attr("fill", d => d.color)
            .attr("rx", 2);

        li.append("text")
            .attr("x", 16)
            .attr("y", textY)
            .style("font-size", "12px")
            .style("font-weight", 700)
            .text(d => d.label);

        // ---------- BOTTOM (Bars) ----------
        const bottomHalf = breakdownGroup.append("g").attr("transform", `translate(0, ${rightTopH + rightMidH})`);
        bottomHalf.append("rect")
            .attr("class", "breakdown-border")
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", breakdownWidth - pad)
            .attr("height", height - (rightTopH + rightMidH) - pad);

        const barM = { top: 38, right: 22, bottom: 40, left: 20 };
        bottomHalf.append("text")
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", pad / 2 + 22)
            .attr("text-anchor", "middle")
            .attr("class", "panel-title")
            .style("font-weight", 800)
            .text("Profit by Model");

        // --- FIXED BAR PANEL (guardrails: include zero, clamp, clip) ---
        const barH = (height - (rightTopH + rightMidH)) - 2 * pad - barM.top - barM.bottom;

        const minP = d3.min(perModel, d => d.profit);
        const maxP = d3.max(perModel, d => d.profit);
        const yBar = d3.scaleLinear()
            .domain([Math.min(0, minP), Math.max(0, maxP)]) // always include $0 inside domain
            .nice()
            .range([barH, 0])
            .clamp(true); // keep geometry inside the box

        // measure y tick label width
        let maxLabelWidth = 0;
        const tempText = svg.append("text").attr("class", "axis").style("opacity", 0);
        yBar.ticks(5).forEach(t => {
            maxLabelWidth = Math.max(maxLabelWidth, tempText.text(fmtMoney(t)).node().getBBox().width);
        });
        tempText.remove();

        const yAxisSpace = maxLabelWidth + 10;
        const barW = breakdownWidth - 2 * pad - barM.right - yAxisSpace;

        const gB = bottomHalf.append("g").attr("transform", `translate(${pad},${pad + barM.top})`);
        const xBand = d3.scaleBand()
            .domain(perModel.map(d => d.label))
            .range([yAxisSpace, yAxisSpace + barW])
            .padding(0.25);

        // axes
        gB.append("g").attr("class", "axis")
            .attr("transform", `translate(${yAxisSpace},0)`)
            .call(d3.axisLeft(yBar).ticks(5).tickFormat(fmtMoney));
        gB.append("g").attr("class", "axis")
            .attr("transform", `translate(0,${barH})`)
            .call(d3.axisBottom(xBand));

        // Always draw baseline (now guaranteed to be inside thanks to domain including 0)
        const zeroY = yBar(0);
        gB.append("line")
            .attr("x1", yAxisSpace).attr("x2", yAxisSpace + barW)
            .attr("y1", zeroY).attr("y2", zeroY)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", "3,3");

        // Clip so bars can’t bleed outside their panel
        const clipId = `clip-bars-${Math.random().toString(36).slice(2)}`;
        gB.append("defs").append("clipPath")
            .attr("id", clipId)
            .append("rect")
            .attr("x", yAxisSpace)
            .attr("y", 0)
            .attr("width", barW)
            .attr("height", barH);

        // Bars
        const modelColor = {
            Super: getComputedStyle(root).getPropertyValue('--super-color').trim(),
            Ultra: getComputedStyle(root).getPropertyValue('--ultra-color').trim(),
            Mega: getComputedStyle(root).getPropertyValue('--mega-color').trim()
        };
        const ttBar = createTooltip('profit-bar-tooltip');

        const barsG = gB.append("g").attr("clip-path", `url(#${clipId})`);
        barsG.selectAll("rect")
            .data(perModel)
            .join("rect")
            .attr("x", d => xBand(d.label))
            .attr("width", xBand.bandwidth())
            .attr("y", d => (d.profit >= 0 ? yBar(d.profit) : zeroY))
            .attr("height", d => Math.abs(yBar(d.profit) - zeroY))
            .attr("rx", 4)
            .attr("fill", d => modelColor[d.label] || getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke-width", 1.5)
            .on("mouseenter", () => ttBar.style("opacity", 1))
            .on("mouseleave", () => ttBar.style("opacity", 0))
            .on("mousemove", (ev, d) => {
                ttBar.html(
                    `<div class="tooltip-header">${d.label}</div>
                     <div class="tooltip-row"><span class="tooltip-key">Profit</span><span>${fmtMoney(d.profit)}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Margin</span><span>${fmtPct(d.margin)}</span></div>`
                ).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px");
            });

        // Axis labels
        gB.append("text").attr("class", "axis-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -barH / 2).attr("y", 0)
            .attr("text-anchor", "middle")
            .text("Gross Profit");
        gB.append("text").attr("class", "axis-label")
            .attr("x", yAxisSpace + barW / 2)
            .attr("y", barH + barM.bottom - 6)
            .attr("text-anchor", "middle")
            .text("Model");
    }

    return { draw };
})();