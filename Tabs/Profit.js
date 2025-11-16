const ProfitTab = (function () {
    function draw() {
        // --- INITIAL SETUP ---
        const svg = d3.select("#profit-panel");
        const container = document.getElementById('svg-container');
        const { clientWidth: width, clientHeight: height } = container;
        svg.selectAll("*").remove();

        // NOTE: The @keyframes for blinking are now assumed to be in your CSS file.
        // We just need to add the <defs> for gradients, etc.
        svg.append("defs"); // Placeholder in case gradients are added later

        // global scale based on window width so resizing the window actually shows change
        const viewportW = Math.max(320, window.innerWidth || width);
        // allow scaling down AND up
        const uiScale = Math.max(0.7, Math.min(1.8, viewportW / 1440));

        // centralized sizes
        const sizes = {
            title: 14 * uiScale,
            subtitle: 13 * uiScale,
            axis: 11 * uiScale,
            body: 11 * uiScale,
            small: 10 * uiScale
        };

        // optional: expose to CSS for HTML tooltips
        document.documentElement.style.setProperty('--profit-ui-scale', uiScale);

        const data = profitMaximizationCache.data;
        if (!data) {
            svg.append("text")
                .attr("x", width / 2)
                .attr("y", height / 2)
                .attr("text-anchor", "middle")
                .attr("font-size", sizes.body)
                .attr("font-weight", "bold")
                .text("Calculating profit data, please wait...");
            return;
        }

        // --- LAYOUT & SCALES ---
        const margin = {
            top: 40 * uiScale,
            right: 60 * uiScale,
            bottom: 60 * uiScale,
            left: 80 * uiScale
        };

        const breakdownWidth = Math.max(280 * uiScale, width * 0.32);
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

        // --- Grab all financial inputs, including Rework ---
        const fin = {
            laborCost: +laborCostInput.value,
            superSell: +superSellInput.value,
            superCogs: +superCogsInput.value,
            ultraSell: +ultraSellInput.value,
            ultraCogs: +ultraCogsInput.value,
            megaSell: +megaSellInput.value,
            megaCogs: +megaCogsInput.value,
            superRework: +superReworkInput.value,
            ultraRework: +ultraReworkInput.value,
            megaRework: +megaReworkInput.value
        };
        // m.qualityYield is correct from the main script
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

        const actX = x(m.throughputUnitsPerDay);

        const tooltip = createTooltip('profit-tooltip').style("position", "fixed");
        const showTT = (html, ev) => tooltip.html(html).style("opacity", 1)
            .style("left", (ev.clientX + 14) + "px")
            .style("top", (ev.clientY - 24) + "px");
        const hideTT = () => tooltip.style("opacity", 0);

        const unmetExists = op.dailyDemand > m.throughputUnitsPerDay;

        const optimalProfitAtCurrentDemand = data.profitData[Math.max(0, bisect(data.profitData, op.dailyDemand, 1) - 1)].value;
        const currentDemandLostProfit = Math.max(0, optimalProfitAtCurrentDemand - m.dailyGrossProfit);

        const missedProfitTooltipHtml = `<div class="tooltip-header">Missed Profit</div>
<div class="tooltip-row"><span class="tooltip-key">Max Throughput</span><span>${m.throughputUnitsPerDay.toFixed(0)} units</span></div>
<div class="tooltip-row"><span class="tooltip-key">Lost Profit</span><span>${fmtMoney(currentDemandLostProfit)}</span></div>`;

        function drawAxesWithGrid(g, xScale, yScale, isProfit) {
            g.append("g")
                .attr("class", "grid-major")
                .call(d3.axisLeft(yScale).ticks(8).tickSizeOuter(0).tickSize(-chartWidth).tickFormat(""))
                .selectAll("text")
                .attr("font-size", sizes.small);
            g.append("g")
                .attr("class", "grid-major")
                .attr("transform", `translate(0,${chartHeight})`)
                .call(d3.axisBottom(xScale).ticks(12).tickSizeOuter(0).tickSize(-chartHeight).tickFormat(""))
                .selectAll("text")
                .attr("font-size", sizes.small);
            g.append("g")
                .attr("class", "axis")
                .attr("transform", `translate(0,${chartHeight})`)
                .call(d3.axisBottom(xScale).ticks(12).tickSizeOuter(0).tickFormat(d3.format("d")))
                .selectAll("text")
                .attr("font-size", sizes.axis);
            g.append("g")
                .attr("class", "axis")
                .call(d3.axisLeft(yScale).ticks(6).tickSizeOuter(0).tickFormat(isProfit ? fmtMoney : d => fmtPct(d)))
                .selectAll("text")
                .attr("font-size", sizes.axis);
        }

        // --- PROFIT CHART (TOP) ---
        const gP = chartsGroup.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        drawAxesWithGrid(gP, x, yProfit, true);

        const vGuideP = gP.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideP = gP.append("line").attr("class", "crosshair-h").style("display", "none");
        const vGuideP2 = gP.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideP2 = gP.append("line").attr("class", "crosshair-h").style("display", "none");

        const profitHoverRect = gP.append("rect")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "transparent")
            .style("pointer-events", "all");

        gP.append("path")
            .datum(data.profitData.filter(d => d.demand > 50))
            .attr("class", "profit-line-profit")
            .attr("fill", "none")
            .attr("d", d3.line().x(d => x(d.demand)).y(d => yProfit(d.value)));

        const y_at_act_profit = yProfit(data.profitData[Math.max(0, bisect(data.profitData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_profit = yProfit(m.dailyGrossProfit);

        gP.append("line")
            .attr("class", "profit-connector-line")
            .attr("x1", actX).attr("x2", actX)
            .attr("y1", y_at_act_profit).attr("y2", y_current_profit);

        if (unmetExists) {
            const profitAreaGenerator = d3.area()
                .x(d => x(d.demand))
                .y1(d => yProfit(d.value))
                .y0(y_current_profit);

            const startIndex = Math.max(0, bisect(data.profitData, m.throughputUnitsPerDay, 1) - 1);
            const endIndex = bisect(data.profitData, op.dailyDemand, 1);
            const areaData = data.profitData.slice(startIndex, endIndex + 1);

            const startPoint = { demand: m.throughputUnitsPerDay, value: yProfit.invert(y_at_act_profit) };
            const endPoint = { demand: op.dailyDemand, value: yProfit.invert(yProfit(data.profitData[Math.max(0, bisect(data.profitData, op.dailyDemand, 1) - 1)].value)) };

            const finalAreaData = [
                startPoint,
                ...areaData.filter(d => d.demand > m.throughputUnitsPerDay && d.demand < op.dailyDemand),
                endPoint
            ];

            gP.append("path")
                .datum(finalAreaData)
                .attr("class", "lost-profit-area")
                .attr("d", profitAreaGenerator)
                .on("mousemove", (ev) => showTT(missedProfitTooltipHtml, ev))
                .on("mouseleave", hideTT);
        }

        gP.append("circle")
            .attr("class", "point-now")
            .attr("cx", actX)
            .attr("cy", y_current_profit)
            .attr("r", 5 * uiScale)
            .on("mouseenter", (ev) => {
                if (unmetExists) {
                    showTT(missedProfitTooltipHtml, ev);
                } else {
                    showTT(
                        `<div class="tooltip-header">Current Profit</div>
                         <div class="tooltip-row"><span class="tooltip-key">Value</span><span>${fmtMoney(m.dailyGrossProfit)}</span></div>
                         <div class="tooltip-row"><span class="tooltip-key">Throughput</span><span>${m.throughputUnitsPerDay.toFixed(0)} units</span></div>`,
                        ev);
                }
            })
            .on("mouseleave", hideTT);

        gP.append("text")
            .attr("x", chartWidth / 2)
            .attr("y", -14 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.title)
            .attr("font-weight", "bold")
            .text("Max Gross Profit vs Daily Demand");

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
        }).on("mouseleave", () => {
            vGuideP.style("display", "none");
            hGuideP.style("display", "none");
            vGuideP2.style("display", "none");
            hGuideP2.style("display", "none");
            hideTT();
        });

        // --- MARGIN CHART (BOTTOM) ---
        const gM = chartsGroup.append("g").attr("transform", `translate(${margin.left},${margin.top + height / 2})`);
        drawAxesWithGrid(gM, x, yMargin, false);

        const vGuideM = gM.append("line").attr("class", "crosshair").style("display", "none");
        const hGuideM = gM.append("line").attr("class", "crosshair-h").style("display", "none");

        const marginHoverRect = gM.append("rect")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "transparent")
            .style("pointer-events", "all");

        gM.append("path")
            .datum(filteredMarginData)
            .attr("class", "profit-line-margin")
            .attr("fill", "none")
            .attr("d", d3.line().x(d => x(d.demand)).y(d => yMargin(d.value)));

        const y_at_act_margin = yMargin(data.marginData[Math.max(0, bisect(data.marginData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_margin = yMargin(m.grossProfitMargin);

        gM.append("line")
            .attr("class", "profit-connector-line")
            .attr("x1", actX).attr("x2", actX)
            .attr("y1", y_at_act_margin).attr("y2", y_current_margin);

        if (unmetExists) {
            const marginAreaGenerator = d3.area()
                .x(d => x(d.demand))
                .y1(d => yMargin(d.value))
                .y0(y_current_margin);

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

            gM.append("path")
                .datum(finalAreaData)
                .attr("class", "lost-profit-area")
                .attr("d", marginAreaGenerator)
                .on("mousemove", (ev) => showTT(missedProfitTooltipHtml, ev))
                .on("mouseleave", hideTT);
        }

        gM.append("circle")
            .attr("class", "point-now")
            .attr("cx", actX)
            .attr("cy", y_current_margin)
            .attr("r", 5 * uiScale)
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

        gM.append("text")
            .attr("x", chartWidth / 2)
            .attr("y", -14 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.title)
            .attr("font-weight", "bold")
            .text("Max Gross Profit Margin vs Daily Demand");

        gM.append("text")
            .attr("x", chartWidth / 2)
            .attr("y", chartHeight + (margin.bottom - 12 * uiScale))
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.axis)
            .text("Daily Demand (units)");

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
        }).on("mouseleave", () => {
            vGuideM.style("display", "none");
            hGuideM.style("display", "none");
            hideTT();
        });

        // --- BREAKDOWN PANEL (RIGHT SIDE) ---
        const totalLabor = op.numEmployees * op.opHours * fin.laborCost;

        // --- Correctly calculate breakdown with Rework ---
        const qualityYield = m.qualityYield; // This is the correct, final yield
        const totalStress = 1.0 - qualityYield;

        const perModel = ["super", "ultra", "mega"].map(key => {
            const units = m.throughputUnitsPerDay * BUILD_RATIOS[key];
            const failedUnits = units * totalStress;

            const sales = units * fin[`${key}Sell`]; // Revenue from ALL units
            const cogs = units * fin[`${key}Cogs`];
            const labor = totalLabor * BUILD_RATIOS[key];
            const rework = failedUnits * fin[`${key}Rework`]; // Rework cost from FAILED units

            const profit = sales - cogs - labor - rework;

            return {
                label: key[0].toUpperCase() + key.slice(1),
                sales, cogs, labor, profit, rework, // Return rework
                margin: sales > 0 ? (profit / sales) * 100 : 0
            };
        });

        const totalProfit = d3.sum(perModel, d => d.profit);
        const totalRework = d3.sum(perModel, d => d.rework); // Get total rework
        const pad = Math.max(16 * uiScale, breakdownWidth * 0.10);

        // ---------- TOP (Legend) ----------
        const keyGroup = breakdownGroup.append("g");
        const legendBorder = keyGroup.append("rect")
            .attr("class", "breakdown-border")
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", breakdownWidth - pad)
            .attr("height", 1);

        const titleY = pad / 2 + 20 * uiScale;
        keyGroup.append("text")
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", titleY)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.subtitle)
            .attr("font-weight", "bold")
            .text("Profit Margin Indicators");

        const legendCard = keyGroup.append("g")
            .attr("transform", `translate(${pad},${titleY + 12 * uiScale})`);

        function addLegendItem(g, y, drawIcon, label) {
            const item = g.append("g").attr("transform", `translate(0,${y})`);
            drawIcon(item);
            item.append("text")
                .attr("x", 22 * uiScale)
                .attr("y", 10 * uiScale)
                .attr("font-size", sizes.body)
                .text(label);
            return item;
        }

        const rowHeight = 22 * uiScale;
        addLegendItem(
            legendCard, 0,
            (r) => r.append("circle").attr("class", "point-now").attr("r", 6 * uiScale).attr("cx", 6 * uiScale).attr("cy", 6 * uiScale),
            "Current profit/margin"
        );
        addLegendItem(
            legendCard, rowHeight,
            (r) => r.append("rect").attr("class", "lost-profit-area").attr("x", 1).attr("y", 0).attr("width", 12 * uiScale).attr("height", 12 * uiScale),
            "Unmet demand (lost profit)"
        );

        const legendBBox = keyGroup.node().getBBox();
        const legendOuterBottom = legendBBox.y + legendBBox.height + pad / 2 + 8 * uiScale;
        const baseTopH = Math.round(height * 0.10);
        const rightTopH = Math.max(baseTopH, Math.ceil(legendOuterBottom));
        legendBorder.attr("height", rightTopH - pad);

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
            .attr("y", pad / 2 + 20 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.subtitle)
            .attr("font-weight", "bold")
            .text("Cost & Profit Composition");

        // --- Use a 4-item color scheme ---
        const pieColors = {
            Profit: getComputedStyle(root).getPropertyValue('--primary').trim(),
            Rework: getComputedStyle(root).getPropertyValue('--failure-color').trim(),
            Labor: getComputedStyle(root).getPropertyValue('--secondary1').trim(),
            Material: getComputedStyle(root).getPropertyValue('--secondary2').trim()
        };

        const innerW = breakdownWidth - 2 * pad;
        const innerH = rightMidH - 2 * pad;

        const pie = d3.pie().value(d => d.value).sort(null);
        const ttPie = createTooltip('profit-pie-tooltip');

        // --- Add Rework to pie data objects ---
        const pies = [
            { title: "Overall", data: { Profit: totalProfit, Labor: totalLabor, Material: d3.sum(perModel, d => d.cogs), Rework: totalRework } },
            ...perModel.map(d => ({ title: d.label, data: { Profit: d.profit, Labor: d.labor, Material: d.cogs, Rework: d.rework } }))
        ];

        const cols = 2;
        const rowsP = Math.ceil(pies.length / cols);
        const cellW = innerW / cols;
        const cellH = innerH / rowsP;
        const rowPositions = [0.32, 0.68];
        const baseR = Math.min(cellW, cellH) * 0.28;

        pies.forEach((pd, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;

            const cx = pad + cellW * (col + 0.5);
            const cy = pad + innerH * rowPositions[row];

            const arc = d3.arc().innerRadius(0).outerRadius(baseR);
            const g = topHalf.append("g").attr("transform", `translate(${cx}, ${cy})`);

            // --- THIS IS THE CORE LOGIC FIX ---
            const isLoss = pd.data.Profit < 0;
            let dataForPie;

            if (isLoss) {
                // Unprofitable: Show COST breakdown
                dataForPie = {
                    Labor: pd.data.Labor,
                    Material: pd.data.Material,
                    Rework: pd.data.Rework
                };
            } else {
                // Profitable: Show REVENUE breakdown
                dataForPie = {
                    Profit: pd.data.Profit,
                    Labor: pd.data.Labor,
                    Material: pd.data.Material,
                    Rework: pd.data.Rework
                };
            }

            const chartData = Object.entries(dataForPie)
                .map(([k, v]) => ({ label: k, value: v }))
                .filter(d => d.value > 1e-6); // Filter out zero values

            const totalPart = d3.sum(chartData, r => r.value);

            g.selectAll("path")
                .data(pie(chartData))
                .join("path")
                .attr("class", "profit-pie-slice")
                .attr("d", arc)
                .attr("fill", d => pieColors[d.data.label])
                .on("mouseenter", () => ttPie.style("opacity", 1))
                .on("mouseleave", () => ttPie.style("opacity", 0))
                // --- Tooltip logic to explain the dynamic "Loss" slice ---
                .on("mousemove", (ev, d) => {

                    let tooltipHeader = `${pd.title}: ${d.data.label}`;
                    let amountValue = fmtMoney(d.data.value);
                    let shareLabel; // Will be set below

                    if (isLoss) {
                        // Unprofitable case
                        shareLabel = "Share of Costs";
                    } else {
                        // Profitable case
                        shareLabel = "Share of Revenue";
                    }

                    if (d.data.label === 'Rework') {
                        tooltipHeader = `${pd.title}: Rework`;
                    }

                    ttPie.html(
                        `<div class="tooltip-header">${tooltipHeader}</div>
<div class="tooltip-row"><span class="tooltip-key">Amount</span><span>${amountValue}</span></div>
<div class="tooltip-row"><span class="tooltip-key">${shareLabel}</span><span>${(totalPart > 0 ? (d.data.value / totalPart * 100) : 0).toFixed(1)}%</span></div>`
                    ).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px");
                });

            const outerArc = d3.arc().outerRadius(baseR + 1.5 * uiScale);
            
            g.append("path")
                .attr("class", "profit-pie-border")
                .classed("blinking-failure", isLoss)
                .attr("d", outerArc({
                    startAngle: 0,
                    endAngle: 2 * Math.PI
                }));

            g.append("text")
                .attr("y", -baseR - 8 * uiScale)
                .attr("text-anchor", "middle")
                .attr("font-size", sizes.body)
                .text(pd.title);
        });

        // --- LEGEND (2 columns, aligned) ---
        const legend2 = topHalf.append("g");

        // --- 4-item legend ---
        const legendItems = [
            { label: "Profit", color: pieColors.Profit },
            { label: "Rework", color: pieColors.Rework },
            { label: "Labor", color: pieColors.Labor },
            { label: "Material", color: pieColors.Material }
        ];

        const bottomPieCenterY = pad + innerH * rowPositions[1];
        const bottomPieBottom = bottomPieCenterY + baseR;
        const legendBaseY = bottomPieBottom + 12 * uiScale;

        const measurer = svg.append("text")
            .style("opacity", 0)
            .attr("font-size", sizes.body);

        function itemWidth(lbl) {
            measurer.text(lbl);
            return 12 * uiScale + 6 * uiScale + measurer.node().getBBox().width;
        }

        const col1Width = Math.max(itemWidth(legendItems[0].label), itemWidth(legendItems[2].label));
        const col2Width = Math.max(itemWidth(legendItems[1].label), itemWidth(legendItems[3].label));

        const colGap = 28 * uiScale;
        const totalLegendWidth = col1Width + colGap + col2Width;
        const startX = pad + (innerW - totalLegendWidth) / 2;

        const rowGapLegend = 22 * uiScale;

        // --- 4-item (2x2) layout ---
        [
            { ...legendItems[0], col: 0, row: 0 }, // Profit
            { ...legendItems[1], col: 1, row: 0 }, // Rework
            { ...legendItems[2], col: 0, row: 1 }, // Labor
            { ...legendItems[3], col: 1, row: 1 }, // Material
        ].forEach(item => {
            const xCol = item.col === 0 ? startX : startX + col1Width + colGap;
            const yRow = legendBaseY + item.row * rowGapLegend;

            const g = legend2.append("g").attr("transform", `translate(${xCol}, ${yRow})`);

            g.append("rect")
                .attr("width", 12 * uiScale)
                .attr("height", 12 * uiScale)
                .attr("y", 3 * uiScale)
                .attr("rx", 2)
                .attr("fill", item.color);

            g.append("text")
                .attr("x", 12 * uiScale + 6 * uiScale)
                .attr("y", 13 * uiScale)
                .attr("font-size", sizes.body)
                .text(item.label);
        });

        measurer.remove();
        // --- END LEGEND ---

        // ---------- BOTTOM (Bars) ----------
        const bottomHalf = breakdownGroup.append("g").attr("transform", `translate(0, ${rightTopH + rightMidH})`);
        bottomHalf.append("rect")
            .attr("class", "breakdown-border")
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", breakdownWidth - pad)
            .attr("height", height - (rightTopH + rightMidH) - pad);

        const barM = { top: 38 * uiScale, right: 22 * uiScale, bottom: 40 * uiScale, left: 20 * uiScale };
        bottomHalf.append("text")
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", pad / 2 + 22 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.subtitle)
            .attr("font-weight", "bold")
            .text("Profit by Model");

        const barShiftX = 16 * uiScale;

        const barH = (height - (rightTopH + rightMidH)) - 2 * pad - barM.top - barM.bottom;

        const minP = d3.min(perModel, d => d.profit);
        const maxP = d3.max(perModel, d => d.profit);
        const yBar = d3.scaleLinear()
            .domain([Math.min(0, minP), Math.max(0, maxP)])
            .nice()
            .range([barH, 0])
            .clamp(true);

        // measure y tick label width for k-format
        let maxLabelWidth = 0;
        const tempText = svg.append("text").style("opacity", 0).attr("font-size", sizes.axis);
        yBar.ticks(5).forEach(t => {
            maxLabelWidth = Math.max(maxLabelWidth, tempText.text(d3.format("~s")(t)).node().getBBox().width);
        });
        tempText.remove();

        // extra gap so y-axis label doesn't overlap
        const yAxisSpace = maxLabelWidth + 28 * uiScale;
        const barW = breakdownWidth - 2 * pad - barM.right - yAxisSpace - barShiftX;

        const gB = bottomHalf.append("g").attr("transform", `translate(${pad + barShiftX},${pad + barM.top})`);
        const xBand = d3.scaleBand()
            .domain(perModel.map(d => d.label))
            .range([yAxisSpace, yAxisSpace + barW])
            .padding(0.25);

        gB.append("g")
            .attr("transform", `translate(${yAxisSpace},0)`)
            .call(d3.axisLeft(yBar).ticks(5).tickFormat(d3.format("~s")))
            .selectAll("text")
            .attr("font-size", sizes.axis);

        gB.append("g")
            .attr("transform", `translate(0,${barH})`)
            .call(d3.axisBottom(xBand))
            .selectAll("text")
            .attr("font-size", sizes.axis);

        const zeroY = yBar(0);
        gB.append("line")
            .attr("class", "profit-bar-baseline")
            .attr("x1", yAxisSpace).attr("x2", yAxisSpace + barW)
            .attr("y1", zeroY).attr("y2", zeroY);

        const clipId = `clip-bars-${Math.random().toString(36).slice(2)}`;
        gB.append("defs").append("clipPath")
            .attr("id", clipId)
            .append("rect")
            .attr("x", yAxisSpace)
            .attr("y", 0)
            .attr("width", barW)
            .attr("height", barH);

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
            .attr("class", "profit-bar")
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

        // y-axis label (move it left more)
        gB.append("text")
            .attr("transform", "rotate(-90)")
            .attr("x", -barH / 2)
            .attr("y", yAxisSpace - 40 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.axis)
            .text("Gross Profit");

        // x-axis label
        gB.append("text")
            .attr("x", yAxisSpace + barW / 2)
            .attr("y", barH + barM.bottom + 4 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.axis)
            .text("Model");

        // ------------- LAST PASS: make sure every svg text has a font-size -------------
        svg.selectAll("text").each(function () {
            const t = d3.select(this);
            if (!t.attr("font-size")) {
                t.attr("font-size", sizes.body);
            }
        });
    }

    function resize() {
        draw();
    }

    return { draw, resize };
})();

// re-draw on window resize so scaling is visible
window.addEventListener("resize", () => {
    if (typeof ProfitTab !== "undefined" && ProfitTab.resize) {
        ProfitTab.resize();
    }
});