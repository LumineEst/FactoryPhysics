const ProfitTab = (function () {
    function draw() {
        // --- INITIAL SETUP ---
        const svg = d3.select("#profit-panel");
        const { clientWidth: width, clientHeight: height } = document.getElementById('svg-container');
        svg.selectAll("*").remove();

        const data = profitMaximizationCache.data;
        if (!data) {
            svg.append("text")
                .attr("class", "profit-calculating-text") // Use CSS class
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

        const x = d3.scaleLinear().domain([50, 552]).range([0, chartWidth]).clamp(true);

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

        // Show Total Lost Profit only when unmet demand exists.
        const unmetExists = op.dailyDemand > m.throughputUnitsPerDay;

        // Calculate the specific TLP for the *current* demand, as requested.
        const optimalProfitAtCurrentDemand = data.profitData[Math.max(0, bisect(data.profitData, op.dailyDemand, 1) - 1)].value;
        const currentDemandLostProfit = Math.max(0, optimalProfitAtCurrentDemand - m.dailyGrossProfit);

        // --- Create the singular "Missed Profit" tooltip HTML ---
        const missedProfitTooltipHtml = `<div class="tooltip-header">Missed Profit</div>
<div class="tooltip-row"><span class="tooltip-key">Max Throughput</span><span>${m.throughputUnitsPerDay.toFixed(0)} units</span></div>
<div class="tooltip-row"><span class="tooltip-key">Lost Profit</span><span>${fmtMoney(currentDemandLostProfit)}</span></div>`;


        function drawAxesWithGrid(g, xScale, yScale) {
            g.append("g")
                .attr("class", "grid-major") // Uses .grid-major style
                .call(d3.axisLeft(yScale).ticks(8).tickSize(-chartWidth).tickFormat(""));
            g.append("g")
                .attr("class", "grid-major") // Uses .grid-major style
                .attr("transform", `translate(0,${chartHeight})`)
                .call(d3.axisBottom(xScale).ticks(12).tickSize(-chartHeight).tickFormat(""));
            g.append("g")
                .attr("class", "axis") // Uses .axis style
                .attr("transform", `translate(0,${chartHeight})`)
                .call(d3.axisBottom(xScale).ticks(12).tickFormat(d3.format("d")));
            g.append("g")
                .attr("class", "axis") // Uses .axis style
                .call(d3.axisLeft(yScale).ticks(6).tickFormat(yScale === yProfit ? fmtMoney : d => fmtPct(d)));
        }

        // --- PROFIT CHART (TOP) ---
        const gP = chartsGroup.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        drawAxesWithGrid(gP, x, yProfit);

        const vGuideP = gP.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideP = gP.append("line").attr("class", "crosshair-h").style("display", "none");
        const vGuideP2 = gP.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideP2 = gP.append("line").attr("class", "crosshair-h").style("display", "none");

        // *** TOOLTIP FIX: Draw main hover rect FIRST ***
        const profitHoverRect = gP.append("rect")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "transparent")
            .style("pointer-events", "all");

        // Draw optimal line
        gP.append("path")
            .datum(data.profitData.filter(d => d.demand > 50))
            .attr("class", "profit-line-profit") // Uses .line-profit style
            .attr("fill", "none")
            .attr("d", d3.line().x(d => x(d.demand)).y(d => yProfit(d.value)));

        const y_at_act_profit = yProfit(data.profitData[Math.max(0, bisect(data.profitData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_profit = yProfit(m.dailyGrossProfit);

        // Draw connector line
        gP.append("line")
            .attr("class", "profit-connector-line") // Use CSS class
            .attr("x1", actX).attr("x2", actX)
            .attr("y1", y_at_act_profit).attr("y2", y_current_profit);

        // *** TOOLTIP FIX: Draw red area SECOND ***
        let areaPath = null;
        if (unmetExists) {

            // --- NEW AREA LOGIC ---
            const profitAreaGenerator = d3.area()
                .x(d => x(d.demand))
                .y1(d => yProfit(d.value)) // Top line = optimal profit line
                .y0(y_current_profit);      // Bottom line = current profit

            // Get all data points *between* actual throughput and required demand
            const startIndex = Math.max(0, bisect(data.profitData, m.throughputUnitsPerDay, 1) - 1);
            const endIndex = bisect(data.profitData, op.dailyDemand, 1);
            const areaData = data.profitData.slice(startIndex, endIndex + 1);

            // Create the precise start and end points for the area
            const startPoint = { demand: m.throughputUnitsPerDay, value: yProfit.invert(y_at_act_profit) };
            const endPoint = { demand: op.dailyDemand, value: yProfit.invert(yProfit(data.profitData[Math.max(0, bisect(data.profitData, op.dailyDemand, 1) - 1)].value)) };

            // Combine all points to form the exact shape
            const finalAreaData = [
                startPoint,
                ...areaData.filter(d => d.demand > m.throughputUnitsPerDay && d.demand < op.dailyDemand),
                endPoint
            ];

            areaPath = gP.append("path")
                .datum(finalAreaData)
                .attr("class", "lost-profit-area")
                .attr("d", profitAreaGenerator);
            // --- END NEW AREA LOGIC ---

            // Tooltip over the red area
            areaPath
                .on("mousemove", (ev) => {
                    if (unmetExists) showTT(missedProfitTooltipHtml, ev);
                })
                .on("mouseleave", hideTT);
        }

        // *** TOOLTIP FIX: Draw red dot THIRD ***
        gP.append("circle")
            .attr("class", "point-now") // Uses .point-now style
            .attr("cx", actX)
            .attr("cy", y_current_profit)
            .attr("r", 5)
            .on("mouseenter", (ev) => {
                if (unmetExists) {
                    showTT(missedProfitTooltipHtml, ev);
                } else {
                    // Show regular tooltip if there is no missed profit
                    showTT(
                        `<div class="tooltip-header">Current Profit</div>
                     <div class="tooltip-row"><span class="tooltip-key">Value</span><span>${fmtMoney(m.dailyGrossProfit)}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Throughput</span><span>${m.throughputUnitsPerDay.toFixed(0)} units</span></div>`,
                        ev);
                }
            })
            .on("mouseleave", hideTT);

        // Add title
        gP.append("text")
            .attr("class", "profit-chart-title") // Use CSS class
            .attr("x", chartWidth / 2)
            .attr("y", -14)
            .attr("text-anchor", "middle")
            .text("Max Gross Profit vs Daily Demand");

        // Add main hover rect logic
        profitHoverRect.on("mousemove", (ev) => {
            const demandHover = Math.round(x.invert(d3.pointer(ev)[0]));
            const idx = Math.max(0, bisect(data.profitData, demandHover, 1) - 1);
            const d = data.profitData[idx];
            if (!d) return;

            vGuideP.style("display", null).attr("x1", x(d.demand)).attr("x2", x(d.demand)).attr("y1", 0).attr("y2", chartHeight);
            hGuideP.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yProfit(d.value)).attr("y2", yProfit(d.value));
            vGuideP2.style("display", null).attr("x1", x(d.demand)).attr("x2", x(d.demand)).attr("y1", 0).attr("y2", chartHeight);
            hGuideP2.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yProfit(d.value)).attr("y2", yProfit(d.value));

            showTT(
                `<div class="tooltip-header">Demand: ${demandHover}</div>
                     <div class="tooltip-row"><span class="tooltip-key">Optimal Profit</span><span>${fmtMoney(d.value)}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key"># Workstations</span><span>${d.config.emp}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Oper Hours</span><span>${d.config.hrs}</span></div>`,
                ev
            );
        })
            .on("mouseleave", () => { vGuideP.style("display", "none"); hGuideP.style("display", "none"); vGuideP2.style("display", "none"); hGuideP2.style("display", "none"); hideTT(); });


        // --- MARGIN CHART (BOTTOM) ---
        const gM = chartsGroup.append("g").attr("transform", `translate(${margin.left},${margin.top + height / 2})`);
        drawAxesWithGrid(gM, x, yMargin);

        const vGuideM = gM.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideM = gM.append("line").attr("class", "crosshair-h").style("display", "none");

        // *** TOOLTIP FIX: Draw main hover rect FIRST ***
        const marginHoverRect = gM.append("rect")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "transparent")
            .style("pointer-events", "all");

        // Draw optimal line
        gM.append("path")
            .datum(filteredMarginData)
            .attr("class", "profit-line-margin") // Uses .line-margin style
            .attr("fill", "none")
            .attr("d", d3.line().x(d => x(d.demand)).y(d => yMargin(d.value)));

        const y_at_act_margin = yMargin(data.marginData[Math.max(0, bisect(data.marginData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_margin = yMargin(m.grossProfitMargin);

        // Draw connector line
        gM.append("line")
            .attr("class", "profit-connector-line") // Use CSS class
            .attr("x1", actX).attr("x2", actX)
            .attr("y1", y_at_act_margin).attr("y2", y_current_margin);

        // *** TOOLTIP FIX: Draw red area SECOND ***
        if (unmetExists) {

            // --- NEW AREA LOGIC ---
            const marginAreaGenerator = d3.area()
                .x(d => x(d.demand))
                .y1(d => yMargin(d.value)) // Top line = optimal margin line
                .y0(y_current_margin);      // Bottom line = current margin

            const startIndex = Math.max(0, bisect(data.marginData, m.throughputUnitsPerDay, 1) - 1);
            const endIndex = bisect(data.marginData, op.dailyDemand, 1);
            const areaData = data.marginData.slice(startIndex, endIndex + 1);

            const startPoint = { demand: m.throughputUnitsPerDay, value: yMargin.invert(y_at_act_margin) };
            const endPoint = { demand: op.dailyDemand, value: yMargin.invert(yMargin(data.marginData[Math.max(0, bisect(data.marginData, op.dailyDemand, 1) - 1)].value)) };

            const finalAreaData = [
                startPoint,
                ...areaData.filter(d => d.demand > m.throughputUnitsPerDay && d.demand < op.dailyDemand),
                endPoint
            ];

            const areaPathM = gM.append("path")
                .datum(finalAreaData)
                .attr("class", "lost-profit-area")
                .attr("d", marginAreaGenerator);
            // --- END NEW AREA LOGIC ---

            // Margin chart red area tooltip
            areaPathM
                .on("mousemove", (ev) => {
                    if (unmetExists) showTT(missedProfitTooltipHtml, ev);
                })
                .on("mouseleave", hideTT);
        }

        // *** TOOLTIP FIX: Draw red dot THIRD ***
        gM.append("circle").attr("class", "point-now").attr("cx", actX).attr("cy", y_current_margin).attr("r", 5) // Uses .point-now style
            .on("mouseenter", (ev) => {
                if (unmetExists) {
                    showTT(missedProfitTooltipHtml, ev);
                } else {
                    showTT(
                        `<div class="tooltip-header">Current Margin</div>
                     <div class="tooltip-row"><span class="tooltip-key">Value</span><span>${fmtPct(m.grossProfitMargin)}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Throughput</span><span>${m.throughputUnitsPerDay.toFixed(0)} units</span></div>`,
                        ev);
                }
            })
            .on("mouseleave", hideTT);

        // Add title and axis label
        gM.append("text")
            .attr("class", "profit-chart-title") // Use CSS class
            .attr("x", chartWidth / 2)
            .attr("y", -14)
            .attr("text-anchor", "middle")
            .text("Max Gross Profit Margin vs Daily Demand");

        gM.append("text")
            .attr("class", "axis-label") // Uses .axis-label style
            .attr("x", chartWidth / 2)
            .attr("y", chartHeight + (margin.bottom - 12))
            .attr("text-anchor", "middle")
            .text("Daily Demand (units)");

        // Add main hover rect logic
        marginHoverRect.on("mousemove", (ev) => {
            const demandHover = Math.round(x.invert(d3.pointer(ev)[0]));
            const idxM = Math.max(0, bisect(data.marginData, demandHover, 1) - 1);
            const dM = data.marginData[idxM];
            if (!dM) return;

            vGuideM.style("display", null).attr("x1", x(dM.demand)).attr("x2", x(dM.demand)).attr("y1", 0).attr("y2", chartHeight);
            hGuideM.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yMargin(dM.value)).attr("y2", yMargin(dM.value));
            showTT(
                `<div class="tooltip-header">Demand: ${demandHover}</div>
                     <div class="tooltip-row"><span class="tooltip-key">Optimal Margin</span><span>${fmtPct(dM.value)}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key"># Workstations</span><span>${dM.config.emp}</span></div>
                     <div class="tooltip-row"><span class="tooltip-key">Oper Hours</span><span>${dM.config.hrs}</span></div>`,
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
            .attr("class", "breakdown-border") // Uses .breakdown-border style
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", breakdownWidth - pad)
            .attr("height", 1); // temp, will resize after measuring

        const titleY = pad / 2 + 20;
        keyGroup.append("text")
            .attr("class", "profit-panel-title") // Use CSS class
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", titleY)
            .attr("text-anchor", "middle")
            .text("Profit Margin Indicators");

        const legendCard = keyGroup.append("g")
            .attr("transform", `translate(${pad},${titleY + 12})`);

        function addLegendItem(g, y, drawIcon, label) {
            const item = g.append("g").attr("transform", `translate(0,${y})`);
            drawIcon(item);
            item.append("text")
                .attr("class", "profit-legend-text") // Use CSS class
                .attr("x", 22)
                .attr("y", 10)
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
        const topHalfBorder = topHalf.append("rect")
            .attr("class", "breakdown-border") // Uses .breakdown-border style
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", breakdownWidth - pad)
            .attr("height", rightMidH - pad);

        topHalf.append("text")
            .attr("class", "profit-panel-title") // Use CSS class
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", pad / 2 + 20)
            .attr("text-anchor", "middle")
            .text("Cost & Profit Composition");

        const pieColors = {
            Profit: getComputedStyle(root).getPropertyValue('--primary').trim(),
            Labor: getComputedStyle(root).getPropertyValue('--secondary1').trim(),
            Material: getComputedStyle(root).getPropertyValue('--secondary2').trim(),
            Loss: getComputedStyle(root).getPropertyValue('--failure-color').trim()
        };

        const innerW = breakdownWidth - 2 * pad;
        const innerH = rightMidH - 2 * pad;
        const R = Math.min(innerW / 4, innerH / 4) * 0.80; // Reduced from 0.85

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
                .attr("class", "profit-pie-slice") // Use CSS class
                .attr("d", arc)
                .attr("fill", d => pieColors[d.data.label])
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

            g.append("text").attr("class", "pie-title").attr("y", -R - 10).text(pd.title); // Uses .pie-title style
        });

        // --- START: Legend Centering & Bottom Align Logic ---
        const legend = topHalf.append("g");
        const legendRowHeight = pad/6; // base row height
        const legendMaxWidth = breakdownWidth - 2 * pad; // Max width for a row

        const legData = Object.entries({
            Profit: getComputedStyle(root).getPropertyValue('--primary').trim(),
            Loss: getComputedStyle(root).getPropertyValue('--failure-color').trim(),
            Labor: getComputedStyle(root).getPropertyValue('--secondary1').trim(),
            Material: getComputedStyle(root).getPropertyValue('--secondary2').trim()
        }).map(([label, color]) => ({ label, color }));

        // width measurement for flow layout
        const measurer = svg.append("text").attr("class", "profit-legend-text").style("opacity", 0);
        const itemWidths = legData.map(d => {
            measurer.text(d.label);
            return 12 + 4 + measurer.node().getBBox().width + 12; // rect + gap + text + trailing pad
        });
        measurer.remove();

        const rectY = (legendRowHeight - 12) / 2; // center 12px swatch in the row
        const textY = rectY + 10.5; // text baseline aligned to swatch

        // --- Build rows first ---
        let rows = [];
        let currentRowItems = [];
        let currentRowWidth = 0;

        legData.forEach((d, i) => {
            const w = itemWidths[i];
            if (currentRowWidth + w > legendMaxWidth && currentRowItems.length > 0) {
                // Finish current row
                rows.push({ items: currentRowItems, width: currentRowWidth });
                // Start new row
                currentRowItems = [{ data: d, width: w }];
                currentRowWidth = w;
            } else {
                // Add to current row
                currentRowItems.push({ data: d, width: w });
                currentRowWidth += w;
            }
        });
        // Add the last row
        if (currentRowItems.length > 0) {
            rows.push({ items: currentRowItems, width: currentRowWidth });
        }

        const totalLegendHeight = rows.length * legendRowHeight;
        // **LEGEND FIX:** Align legend block to the bottom of the container border
        const legendYBase = (rightMidH - pad / 2) - totalLegendHeight - 10; // -10 for extra bottom margin

        // --- Now draw the centered rows ---
        rows.forEach((row, rowIndex) => {
            const y = legendYBase + (rowIndex * legendRowHeight);
            let xCursor = (breakdownWidth - row.width) / 2; // Center the row block

            row.items.forEach(item => {
                const g = legend.append("g")
                    .attr("transform", `translate(${xCursor}, ${y})`);

                g.append("rect")
                    .attr("y", rectY)
                    .attr("width", 12)
                    .attr("height", 12)
                    .attr("fill", item.data.color)
                    .attr("rx", 2);

                g.append("text")
                    .attr("class", "profit-legend-text")
                    .attr("x", 16)
                    .attr("y", textY)
                    .text(item.data.label);

                xCursor += item.width;
            });
        });
        // --- END: New Legend Centering Logic ---


        // ---------- BOTTOM (Bars) ----------
        const bottomHalf = breakdownGroup.append("g").attr("transform", `translate(0, ${rightTopH + rightMidH})`);
        bottomHalf.append("rect")
            .attr("class", "breakdown-border") // Uses .breakdown-border style
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", breakdownWidth - pad)
            .attr("height", height - (rightTopH + rightMidH) - pad);

        const barM = { top: 38, right: 22, bottom: 40, left: 20 };
        bottomHalf.append("text")
            .attr("class", "profit-panel-title") // Use CSS class
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", pad / 2 + 22)
            .attr("text-anchor", "middle")
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
        gB.append("g").attr("class", "axis") // Uses .axis style
            .attr("transform", `translate(${yAxisSpace},0)`)
            .call(d3.axisLeft(yBar).ticks(5).tickFormat(fmtMoney));
        gB.append("g").attr("class", "axis") // Uses .axis style
            .attr("transform", `translate(0,${barH})`)
            .call(d3.axisBottom(xBand));

        // Always draw baseline (now guaranteed to be inside thanks to domain including 0)
        const zeroY = yBar(0);
        gB.append("line")
            .attr("class", "profit-bar-baseline") // Use CSS class
            .attr("x1", yAxisSpace).attr("x2", yAxisSpace + barW)
            .attr("y1", zeroY).attr("y2", zeroY);

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
            .attr("class", "profit-bar") // Use CSS class
            .attr("x", d => xBand(d.label))
            .attr("width", xBand.bandwidth())
            .attr("y", d => (d.profit >= 0 ? yBar(d.profit) : zeroY))
            .attr("height", d => Math.abs(yBar(d.profit) - zeroY))
            .attr("rx", 4)
            .attr("fill", d => modelColor[d.label] || getComputedStyle(root).getPropertyValue('--accent'))
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
        gB.append("text").attr("class", "axis-label") // Uses .axis-label style
            .attr("transform", "rotate(-90)")
            .attr("x", -barH / 2).attr("y", 0)
            .attr("text-anchor", "middle")
            .text("Gross Profit");
        gB.append("text").attr("class", "axis-label") // Uses .axis-label style
            .attr("x", yAxisSpace + barW / 2)
            .attr("y", barH + barM.bottom - 6)
            .attr("text-anchor", "middle")
            .text("Model");
    }

    // Add a resize function that simply calls draw()
    function resize() {
        draw();
    }

    return { draw, resize }; // Expose both draw and resize
})();