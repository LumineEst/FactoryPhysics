/**
* --------------------------------------------------------------------
* Precedence Chart Tab (IIFE)
* --------------------------------------------------------------------
* Handles the interactive PERT/precedence chart with zoom/pan.
*/
const PrecedenceTab = (function () {
    // --- MODULE-LEVEL STATE ---
    let precedenceChartNodes = null;
    let pertTooltip = null;

    // --- HELPER FUNCTIONS ---
    function flatten() {
        const directPredecessors = new Map();
        PRECEDENCE_DATA.forEach(el => {
            directPredecessors.set(el.id, new Set(el.predecessors));
        });
        const fullPredecessorMap = new Map();
        const memo = new Map();
        function getAllPredecessors(taskId) {
            if (memo.has(taskId)) return memo.get(taskId);
            const preds = directPredecessors.get(taskId) || new Set();
            const allPreds = new Set(preds);
            preds.forEach(pId => {
                const grandPreds = getAllPredecessors(pId);
                grandPreds.forEach(gpId => allPreds.add(gpId));
            });
            memo.set(taskId, allPreds);
            return allPreds;
        }
        PRECEDENCE_DATA.forEach(el => {
            fullPredecessorMap.set(el.id, getAllPredecessors(el.id));
        });
        return fullPredecessorMap;
    }

    function updatePrecedenceChartColors() {
        if (!precedenceChartNodes) return;
        precedenceChartNodes.selectAll('circle')
            .each(function (d) {
                const circle = d3.select(this);
                const isError = invalidPrecedenceNodes.has(d.id);
                circle.interrupt("blink");
                if (isError) {
                    function blink() {
                        circle.transition("blink").duration(700)
                            .attr("stroke", getComputedStyle(root).getPropertyValue('--failure-color').trim())
                            .attr("stroke-width", 30)
                            .style("fill", getComputedStyle(root).getPropertyValue('--failure-color').trim())
                            .transition("blink").duration(700)
                            .attr("stroke", getComputedStyle(root).getPropertyValue('--failure-color').trim())
                            .attr("stroke-width", 10)
                            .style("fill", getComputedStyle(root).getPropertyValue('--failure-color').trim())
                            .on("end", blink);
                    }
                    blink();
                } else {
                    circle.transition().duration(500)
                        .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
                        .attr("stroke-width", 1.5)
                        .style("fill", getComputedStyle(root).getPropertyValue('--white').trim());
                }
            });
    }

    function updatePrecedenceChartLinks() {
        if (!precedenceChartNodes) return;
        const allLinks = d3.select("#precedence-panel").selectAll('g > line');

        if (invalidPrecedenceNodes.size === 0) {
            allLinks.transition().duration(300)
                .attr('stroke', getComputedStyle(root).getPropertyValue('--accent').trim())
                .attr('stroke-width', 2.5)
                .attr('marker-end', 'url(#arrowhead)');
            return;
        }

        const elementOrderMap = new Map();
        let orderIndex = 0;
        document.querySelectorAll('.element-row').forEach(row => {
            const taskId = parseInt(row.dataset.taskId);
            elementOrderMap.set(taskId, orderIndex++);
        });

        const violatingPathNodes = new Set();
        for (const violatingNodeId of invalidPrecedenceNodes) {
            const allPredecessors = precedenceMap.get(violatingNodeId) || new Set();
            for (const predecessorId of allPredecessors) {
                if (elementOrderMap.get(predecessorId) > elementOrderMap.get(violatingNodeId)) {
                    violatingPathNodes.add(violatingNodeId);
                    violatingPathNodes.add(predecessorId);
                }
            }
        }

        allLinks.each(function (d) {
            const isHighlighted = violatingPathNodes.has(d.source.id) && violatingPathNodes.has(d.target.id);
            d3.select(this)
                .transition().duration(300)
                .attr('stroke', isHighlighted ? getComputedStyle(root).getPropertyValue('--failure-color').trim() : getComputedStyle(root).getPropertyValue('--accent').trim())
                .attr('stroke-width', isHighlighted ? 5.5 : 2.5)
                .attr('marker-end', isHighlighted ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)');
        });
    }

    // --- PUBLIC FUNCTIONS ---
    function update() {
        if (!precedenceChartNodes) return;
        updatePrecedenceChartColors();
        updatePrecedenceChartLinks();
    }

    /**
     * Draw the interactive precedence network graph.
     */
    function draw() {
        // Data
        const nodes = PRECEDENCE_DATA.map(d => ({ id: d.id }));
        const links = [];
        PRECEDENCE_DATA.forEach(d => {
            d.predecessors.forEach(pId => links.push({ source: pId, target: d.id }));
        });

        // Base SVG
        const svg = d3.select("#precedence-panel");
        svg.selectAll("*").remove();

        // Size + viewBox for consistent zooming/panning
        const width = document.getElementById('svg-container').clientWidth;
        const height = document.getElementById('svg-container').clientHeight;
        svg.attr("viewBox", `0 0 ${width} ${height}`);

        // Markers
        svg.append('defs').selectAll('marker')
            .data(['arrowhead', 'arrowhead-highlight'])
            .join('marker')
            .attr('id', d => d)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 10)
            .attr('orient', 'auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', d => d === 'arrowhead-highlight'
                ? getComputedStyle(root).getPropertyValue('--failure-color').trim()
                : getComputedStyle(root).getPropertyValue('--accent').trim());

        // --- IMPORTANT: zoom catcher (behind everything) ---
        const zoomPane = svg.append("rect")
            .attr("class", "zoom-pane")
            .attr("x", 0).attr("y", 0)
            .attr("width", width).attr("height", height)
            .style("fill", "none")
            .style("pointer-events", "all"); // ensures zoom events are captured

        // Main group (transformed by zoom)
        const mainGroup = svg.append("g");

        // Tooltip
        pertTooltip = createTooltip('pert-tooltip').style("position", "fixed");

        // Force layout
        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(40))
            .force("charge", d3.forceManyBody().strength(-500))
            .force("center", d3.forceCenter(width / 2, height / 2).strength(0.1))
            .force("collide", d3.forceCollide().radius(d => (d.r || 50) + 8).strength(1));

        const link = mainGroup.append("g").selectAll("line").data(links).join("line")
            .attr("class", "precedence-link")
            .attr("marker-end", "url(#arrowhead)");

        precedenceChartNodes = mainGroup.append("g").selectAll("g").data(nodes).join("g");

        // --- CLAMP HELPERS ---
        const CLAMP_PAD = 12;
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        function clampToViewport(d) {
            const r = (d.r || 12);
            const minX = CLAMP_PAD + r;
            const maxX = width - CLAMP_PAD - r;
            const minY = CLAMP_PAD + r;
            const maxY = height - CLAMP_PAD - r;
            d.x = clamp(d.x, minX, maxX);
            d.y = clamp(d.y, minY, maxY);
            if (d.fx != null) d.fx = clamp(d.fx, minX, maxX);
            if (d.fy != null) d.fy = clamp(d.fy, minY, maxY);
        }

        // TICK (clamp every tick so sim can't push nodes out)
        simulation.on("tick", () => {
            nodes.forEach(clampToViewport);

            link.each(function (d) {
                const targetRadius = (d.target.r || 12) + 3;
                const dx = d.target.x - d.source.x;
                const dy = d.target.y - d.source.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                let x2 = d.target.x, y2 = d.target.y;
                if (distance > 0) {
                    const ratio = (distance - targetRadius) / distance;
                    x2 = d.source.x + dx * ratio;
                    y2 = d.source.y + dy * ratio;
                }
                d3.select(this)
                    .attr("x1", d.source.x).attr("y1", d.source.y)
                    .attr("x2", x2).attr("y2", y2);
            });
            precedenceChartNodes.attr("transform", d => `translate(${d.x}, ${d.y})`);
        });

        // -------- LEGEND (same look, just moved to bottom-right corner) --------
        function renderPrecedenceLegend() {
            // Layout constants
            const legendPadding = 12;
            const swatch = { w: 14, h: 14 };
            const colGap = 14;   // space between the two columns
            const rowGap = 10;   // space between the two rows
            const labelOffsetX = 8; // text offset from swatch
            const topGap = 20;   // space below title to the first row
            const bottomGap = 2;

            // Compute legend width and height
            const colWidth = swatch.w + labelOffsetX + 56;
            const legendWidth = legendPadding * 2 + colWidth * 2;
            const legendHeight = legendPadding * 2 + topGap + (swatch.h + rowGap) * 2 + bottomGap + 14;

            // Move legend to bottom-right corner with small margin
            const legendX = width - legendWidth - 20;
            const legendY = height - legendHeight - 20;

            const g = svg.append('g')
                .attr('id', 'precedence-legend')
                .attr('transform', `translate(${legendX}, ${legendY})`)
                .style('pointer-events', 'none');

            // Card
            g.append('rect')
                .attr('width', legendWidth)
                .attr('height', legendHeight)
                .attr('rx', 10)
                .attr('fill', getComputedStyle(root).getPropertyValue('--white').trim())
                .attr('stroke', getComputedStyle(root).getPropertyValue('--accent').trim());

            const centerX = legendWidth / 2;

            // Title (centered)
            g.append('text')
                .text('Build Ratios')
                .attr('x', centerX)
                .attr('y', 18)
                .attr('text-anchor', 'middle')
                .style('font-weight', 700)
                .style('font-size', '13px')
                .attr('fill', getComputedStyle(root).getPropertyValue('--accent').trim());

            // Grid data
            const itemsGrid = [
                [
                    { label: 'Super', color: PERT_PIE_COLORS.super },
                    { label: 'Ultra', color: PERT_PIE_COLORS.ultra },
                ],
                [
                    { label: 'Mega',  color: PERT_PIE_COLORS.mega  },
                    { label: 'Idle',  color: PERT_PIE_COLORS.idle  },
                ],
            ];

            const gridOriginX = legendPadding;
            const gridOriginY = legendPadding + topGap;

            // Render grid
            itemsGrid.forEach((rowItems, rowIndex) => {
                rowItems.forEach((item, colIndex) => {
                    const gx = gridOriginX + colIndex * (colWidth + colGap);
                    const gy = gridOriginY + rowIndex * (swatch.h + rowGap);

                    const row = g.append('g').attr('transform', `translate(${gx}, ${gy})`);
                    row.append('rect')
                        .attr('width', swatch.w).attr('height', swatch.h)
                        .attr('fill', item.color)
                        .attr('stroke', getComputedStyle(root).getPropertyValue('--white').trim())
                        .attr('stroke-width', 1);

                    row.append('text')
                        .text(item.label)
                        .attr('x', swatch.w + labelOffsetX)
                        .attr('y', swatch.h - 2)
                        .style('font-size', '12px')
                        .style('font-weight', 650)
                        .attr('fill', getComputedStyle(root).getPropertyValue('--accent').trim());
                });
            });

            // Caption (centered)
            g.append('text')
                .text('Node size = Labor time')
                .attr('x', centerX)
                .attr('y', legendHeight - legendPadding)
                .attr('text-anchor', 'middle')
                .style('font-size', '12px')
                .style('font-weight', 600)
                .attr('fill', getComputedStyle(root).getPropertyValue('--accent').trim());
        }

        

        // Label helpers
        function addPERTLabelBackgrounds() {
            if (!precedenceChartNodes) return;
            precedenceChartNodes.each(function (d) {
                if (!d || d.id == null || !d.r) return;
                const g = d3.select(this);
                g.insert('circle', 'text').attr('class', '__pert_label_bg')
                    .style('pointer-events', 'none')
                    .attr('r', Math.max(11, d.r * 0.48))
                    .attr('fill', getComputedStyle(root).getPropertyValue('--white').trim())
                    .attr('fill-opacity', 0.95)
                    .attr('stroke', getComputedStyle(root).getPropertyValue('--accent').trim())
                    .attr('stroke-opacity', 0.20)
                    .attr('stroke-width', 1);
            });
        }
        function restylePERTNodeLabelsStrong() {
            if (!precedenceChartNodes) return;
            precedenceChartNodes.each(function (d) {
                if (!d || d.id == null || !d.r) return;
                const fs = Math.max(15, Math.min(26, d.r * 0.42));
                d3.select(this).select('text').raise()
                    .attr('text-anchor', 'middle').attr('dy', '0.35em')
                    .style('font-family', 'sans-serif').style('font-weight', '800')
                    .style('font-size', fs + 'px')
                    .style('fill', getComputedStyle(root).getPropertyValue('--accent').trim())
                    .style('stroke', getComputedStyle(root).getPropertyValue('--white').trim())
                    .style('stroke-width', '4px')
                    .style('paint-order', 'stroke')
                    .style('pointer-events', 'none');
            });
        }

        // PERT pies
        function getPertLaborTime(id) {
            const t = state?.taskData?.get?.(id)?.laborTime;
            return Number.isFinite(t) ? t : (PERT_LABOR_FALLBACK[id] || 0);
        }
        function drawPERTNodePiesOnce() {
            if (!precedenceChartNodes || precedenceChartNodes.empty()) return;
            const times = nodes.map(d => getPertLaborTime(+d.id));
            if (!times.length) return;
            const rScale = d3.scaleLinear().domain(d3.extent(times)).range([14, 56]).nice();
            const arc = d3.arc().innerRadius(0);
            const pie = d3.pie().sort(null).value(d => d.value);

            precedenceChartNodes.each(function (d) {
                const g = d3.select(this);
                const id = +d.id;
                const r = rScale(getPertLaborTime(id));
                d.r = r;

                g.select('circle').remove();
                g.append('circle')
                    .attr('r', r)
                    .attr('fill', 'transparent')
                    .style('pointer-events', 'all');

                const row = state.taskData.get(id);
                if (!row) return;
                const { elementTime: ET, Super: sup, Mega: meg, Ultra: ult } = row;

                const slices = [
                    { key: 'super', value: ET * sup, color: PERT_PIE_COLORS.super },
                    { key: 'mega', value: ET * meg, color: PERT_PIE_COLORS.mega },
                    { key: 'ultra', value: ET * ult, color: PERT_PIE_COLORS.ultra },
                    { key: 'idle', value: Math.max(0, ET * (1 - (sup + meg + ult))), color: PERT_PIE_COLORS.idle }
                ].filter(s => s.value > 1e-6);

                const arcGen = arc.outerRadius(r);
                g.selectAll('path.__pert_pie')
                    .data(pie(slices))
                    .join('path')
                    .attr('class', '__pert_pie')
                    .attr('d', arcGen)
                    .style('fill', a => a.data.color)
                    .style('stroke', PERT_PIE_STROKE)
                    .style('stroke-width', '0.9px');

                g.selectAll('text').data([d]).join('text').text(d => d.id);

                g.on('mouseenter', (event) => {
                    pertTooltip.style('opacity', 1).html(
                        `<div class="tooltip-header">Element ${id}</div>
                         <div class="tooltip-row"><span>Labor Time:</span> <b>${getPertLaborTime(id).toFixed(2)}</b></div>
                         <div class="tooltip-row">Super: <b>${(sup * 100).toFixed(0)}%</b></div>
                         <div class="tooltip-row">Ultra: <b>${(ult * 100).toFixed(0)}%</b></div>
                         <div class="tooltip-row">Mega: <b>${(meg * 100).toFixed(0)}%</b></div>`
                    );
                }).on('mousemove', (event) => {
                    pertTooltip.style('left', (event.clientX + 14) + 'px')
                               .style('top', (event.clientY + 14) + 'px');
                }).on('mouseleave', () => {
                    pertTooltip.style('opacity', 0);
                });
            });

            addPERTLabelBackgrounds();
            restylePERTNodeLabelsStrong();
        }

        // --- ZOOM / PAN ---
        const zoom = d3.zoom()
            .scaleExtent([0.1, 8])
            .on("zoom", (event) => {
                mainGroup.attr("transform", event.transform);
            });

        // Attach zoom to the svg and its zoomPane
        svg.call(zoom);
        zoomPane.call(zoom); // ensure the catcher gets events

        // Default: start zoomed out and centered
        const DEFAULT_ZOOM = 0.95; // < 1 = zoom out
        const tx = (width - width * DEFAULT_ZOOM) / 2;
        const ty = (height - height * DEFAULT_ZOOM) / 2;
        const initialTransform = d3.zoomIdentity.translate(tx, ty).scale(DEFAULT_ZOOM);
        svg.call(zoom.transform, initialTransform);

        // --- DRAG (kept inside viewport, zoom-aware) ---
        function dragstarted(event, d) {
            if (event.sourceEvent && event.sourceEvent.stopPropagation) {
                event.sourceEvent.stopPropagation();
            }
            if (!event.active) simulation.alphaTarget(0.3).restart();
            const t = d3.zoomTransform(svg.node());
            const [lx, ly] = t.invert([event.x, event.y]);
            d.fx = lx;
            d.fy = ly;
        }
        function dragged(event, d) {
            const t = d3.zoomTransform(svg.node());
            const [lx, ly] = t.invert([event.x, event.y]);

            const r = (d.r || 12);
            const minX = CLAMP_PAD + r;
            const maxX = width - CLAMP_PAD - r;
            const minY = CLAMP_PAD + r;
            const maxY = height - CLAMP_PAD - r;

            d.fx = Math.max(minX, Math.min(maxX, lx));
            d.fy = Math.max(minY, Math.min(maxY, ly));
        }
        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = d.x;
            d.fy = d.y;
        }

        precedenceChartNodes.call(
            d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended)
        );

        // --- FINAL RENDERING ---
        renderPrecedenceLegend();
        drawPERTNodePiesOnce();
        updatePrecedenceChartColors();
        updatePrecedenceChartLinks();
    }

    return { draw, update, flatten };
})();
