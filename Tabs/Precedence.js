/**
* --------------------------------------------------------------------
* Precedence Chart Tab (IIFE)
* --------------------------------------------------------------------
* This file encapsulates all logic for the Precedence Chart tab within an
* Immediately Invoked Function Expression (IIFE). This creates a private
* scope for its state variables (like the chart nodes) and helper functions,
* preventing conflicts with the global script.
*
* It returns an object with public methods (`draw`, `update`, `flatten`) that
* the main script can use to interact with the chart.
*
* @returns {object} An object containing the public functions for this module.
*/
const PrecedenceTab = (function () {
    // --- MODULE-LEVEL STATE ---
    /**
     * @property {d3.Selection|null} precedenceChartNodes - A D3 selection that holds
     * the group elements for each node in the graph. This is stored in the module's
     * scope so it can be accessed by both the `draw` and `update` functions without
     * needing to re-query the DOM.
     */
    let precedenceChartNodes = null;
    /**
     * @property {d3.Selection|null} pertTooltip - A D3 selection for the tooltip element
     * used specifically for the PERT pie charts on the nodes. It is created once and
     * reused to improve performance.
     */
    let pertTooltip = null;
    // --- HELPER FUNCTIONS ---
    /**
     * Flattens the precedence tree to create a map where each task ID maps to a
     * Set of all its direct and indirect predecessors. This is crucial for efficient
     * validation of the element sequence.
     * @returns {Map<number, Set<number>>} The full precedence map.
     */
    function flatten() {
        // Create a map of direct predecessors from the source data.
        const directPredecessors = new Map();
        PRECEDENCE_DATA.forEach(el => {
            directPredecessors.set(el.id, new Set(el.predecessors));
        });
        const fullPredecessorMap = new Map();
        const memo = new Map(); // Use memoization to avoid re-calculating for the same task.
        function getAllPredecessors(taskId) {
            if (memo.has(taskId)) {
                return memo.get(taskId);
            }
            const preds = directPredecessors.get(taskId) || new Set();
            const allPreds = new Set(preds);
            // Recursively find predecessors of predecessors.
            preds.forEach(pId => {
                const grandPreds = getAllPredecessors(pId);
                grandPreds.forEach(gpId => allPreds.add(gpId));
            });
            memo.set(taskId, allPreds);
            return allPreds;
        }
        // Populate the full map for every element.
        PRECEDENCE_DATA.forEach(el => {
            fullPredecessorMap.set(el.id, getAllPredecessors(el.id));
        });
        return fullPredecessorMap;
    }
    /**
     * Updates the fill and stroke of nodes in the precedence chart to indicate errors.
     * Nodes that violate precedence rules are made to blink with a failure color.
     */
    function updatePrecedenceChartColors() {
        if (!precedenceChartNodes) return;
        precedenceChartNodes.selectAll('circle')
            .each(function (d) {
                const circle = d3.select(this);
                // The global `invalidPrecedenceNodes` set is checked here.
                const isError = invalidPrecedenceNodes.has(d.id);
                // Stop any ongoing blinking animations before starting a new one.
                circle.interrupt("blink");
                if (isError) {
                    // Create a recursive blinking animation for error nodes.
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
                    // Transition valid nodes back to their default appearance.
                    circle.transition().duration(500)
                        .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
                        .attr("stroke-width", 1.5)
                        .style("fill", getComputedStyle(root).getPropertyValue('--white').trim());
                }
            });
    }
    /**
     * Highlights the specific links in the precedence chart that are part of an invalid sequence.
     * It traces the paths between violating nodes and their out-of-order predecessors.
     */
    function updatePrecedenceChartLinks() {
        if (!precedenceChartNodes) return;
        const allLinks = d3.select("#precedence-panel").selectAll('g > line');
        // If there are no errors, reset all links to their default style.
        if (invalidPrecedenceNodes.size === 0) {
            allLinks.transition().duration(300)
                .attr('stroke', getComputedStyle(root).getPropertyValue('--accent').trim())
                .attr('stroke-width', 2.5)
                .attr('marker-end', 'url(#arrowhead)');
            return;
        }
        // Create a map of the current linear order of elements from the DOM.
        const elementOrderMap = new Map();
        let orderIndex = 0;
        document.querySelectorAll('.element-row').forEach(row => {
            const taskId = parseInt(row.dataset.taskId);
            elementOrderMap.set(taskId, orderIndex++);
        });
        const violatingPathNodes = new Set();
        // For each node that has an error...
        for (const violatingNodeId of invalidPrecedenceNodes) {
            // ...find all of its required predecessors.
            const allPredecessors = precedenceMap.get(violatingNodeId) || new Set();
            for (const predecessorId of allPredecessors) {
                // If a predecessor appears *after* the node in the current sequence, it's a violation.
                if (elementOrderMap.get(predecessorId) > elementOrderMap.get(violatingNodeId)) {
                    // Mark both the node and its misplaced predecessor for highlighting.
                    violatingPathNodes.add(violatingNodeId);
                    violatingPathNodes.add(predecessorId);
                }
            }
        }
        // Apply styles to the links based on whether they connect two violating nodes.
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
    /**
     * Public method to trigger an update of the chart's colors and links.
     * This is called from the main script when the workstation order changes.
     */
    function update() {
        if (!precedenceChartNodes) return; // Do nothing if the chart hasn't been drawn yet.
        updatePrecedenceChartColors();
        updatePrecedenceChartLinks();
    }
    /**
     * @tab Precedence
     * Draws the interactive precedence network graph. This is the main public
     * function for rendering the entire tab.
     */
    function draw() {
        // --- INITIAL SETUP ---
        // Prepare node and link data structures for D3's force simulation.
        const nodes = PRECEDENCE_DATA.map(d => ({ id: d.id }));
        const links = [];
        PRECEDENCE_DATA.forEach(d => {
            d.predecessors.forEach(pId => {
                links.push({ source: pId, target: d.id });
            });
        });
        // Select the SVG container and clear any previous contents.
        const svg = d3.select("#precedence-panel");
        svg.selectAll("*").remove();
        // Define SVG markers for the arrowheads on the links.
        svg.append('defs').selectAll('marker')
            .data(['arrowhead', 'arrowhead-highlight']) // Normal and error-state arrowheads.
            .join('marker')
            .attr('id', d => d)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 10) // Offset from the end of the line.
            .attr('orient', 'auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5') // The shape of the arrowhead.
            .attr('fill', d => d === 'arrowhead-highlight' ? getComputedStyle(root).getPropertyValue('--failure-color').trim() : getComputedStyle(root).getPropertyValue('--accent').trim());
        // Get container dimensions for the simulation.
        const width = document.getElementById('svg-container').clientWidth;
        const height = document.getElementById('svg-container').clientHeight;
        const mainGroup = svg.append("g"); // Main group for zooming and panning.
        // Initialize the tooltip.
        pertTooltip = createTooltip('pert-tooltip').style("position", "fixed");
        // --- D3 FORCE SIMULATION ---
        // Create the simulation with several forces to arrange the nodes.
        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(40)) // Keeps linked nodes a certain distance apart.
            .force("charge", d3.forceManyBody().strength(-500)) // Makes nodes repel each other.
            .force("center", d3.forceCenter(width / 2, height / 2).strength(0.1)) // Gently pulls all nodes toward the center.
            .force("collide", d3.forceCollide().radius(d => (d.r || 50) + 8).strength(1)); // Prevents nodes from overlapping.
        // Create the SVG elements for links and nodes.
        const link = mainGroup.append("g").selectAll("line").data(links).join("line")
            .attr("class", "precedence-link")
            .attr("marker-end", "url(#arrowhead)");
        // Store the node selection in the module-level variable for later access.
        precedenceChartNodes = mainGroup.append("g").selectAll("g").data(nodes).join("g");
        // The "tick" event is fired repeatedly by the simulation. On each tick, update element positions.
        simulation.on("tick", () => {
            // Adjust link endpoints so they point to the edge of the circle, not the center.
            link.each(function (d) {
                const targetRadius = (d.target.r || 12) + 3;
                const dx = d.target.x - d.source.x;
                const dy = d.target.y - d.source.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                let x2 = d.target.x;
                let y2 = d.target.y;
                if (distance > 0) {
                    const ratio = (distance - targetRadius) / distance;
                    x2 = d.source.x + dx * ratio;
                    y2 = d.source.y + dy * ratio;
                }
                d3.select(this).attr("x1", d.source.x).attr("y1", d.source.y).attr("x2", x2).attr("y2", y2);
            });
            // Update the position of the node groups.
            precedenceChartNodes.attr("transform", d => `translate(${d.x}, ${d.y})`);
        });
        // --- [FIX] RENDER LEGEND (This function was missing) ---
        function renderPrecedenceLegend() {
            const g = svg.append('g')
                .attr('id', 'precedence-legend')
                .attr('transform', `translate(20, 20)`)
                .style('pointer-events', 'none');
            g.append('rect')
                .attr('width', 180).attr('height', 140)
                .attr('rx', 10).attr('fill', getComputedStyle(root).getPropertyValue('--white').trim()).attr('stroke', getComputedStyle(root).getPropertyValue('--accent').trim());
            g.append('text')
                .text('Build Ratios').attr('x', 12).attr('y', 22)
                .style('font-weight', 700).style('font-size', '13px').attr('fill', getComputedStyle(root).getPropertyValue('--accent').trim());
            const items = [
                { label: 'Super', color: PERT_PIE_COLORS.super },
                { label: 'Ultra', color: PERT_PIE_COLORS.ultra },
                { label: 'Mega', color: PERT_PIE_COLORS.mega },
                { label: 'Idle', color: PERT_PIE_COLORS.idle },
            ];
            items.forEach((it, i) => {
                const row = g.append('g').attr('transform', `translate(12, ${35 + i * 22})`);
                row.append('rect').attr('width', 14).attr('height', 14)
                    .attr('fill', it.color).attr('stroke', getComputedStyle(root).getPropertyValue('--white').trim()).attr('stroke-width', 1);
                row.append('text').text(it.label).attr('x', 20).attr('y', 12)
                    .style('font-size', '12px').style('font-weight', 650).attr('fill', getComputedStyle(root).getPropertyValue('--accent').trim());
            });
            const sizeG = g.append('g').attr('transform', `translate(12, ${35 + items.length * 22 + 8})`);
            sizeG.append('text').text('Node size = Labor time').attr('x', 0).attr('y', 0)
                .style('font-size', '12px').style('font-weight', 600).attr('fill', getComputedStyle(root).getPropertyValue('--accent').trim());
        }
        // --- [FIX] NODE STYLING FUNCTIONS (These functions were missing) ---
        function addPERTLabelBackgrounds() {
            if (!precedenceChartNodes) return;
            precedenceChartNodes.each(function (d) {
                if (!d || d.id == null || !d.r) return;
                const g = d3.select(this);
                g.insert('circle', 'text').attr('class', '__pert_label_bg')
                    .style('pointer-events', 'none')
                    .attr('r', Math.max(11, d.r * 0.48)).attr('fill', getComputedStyle(root).getPropertyValue('--white').trim()).attr('fill-opacity', 0.95)
                    .attr('stroke', getComputedStyle(root).getPropertyValue('--accent').trim()).attr('stroke-opacity', 0.20).attr('stroke-width', 1);
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
                    .style('font-size', fs + 'px').style('fill', getComputedStyle(root).getPropertyValue('--accent').trim()).style('stroke', getComputedStyle(root).getPropertyValue('--white').trim())
                    .style('stroke-width', '4px').style('paint-order', 'stroke').style('pointer-events', 'none');
            });
        }
        // --- PERT NODE VISUALIZATION ---
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
                    .attr('r', r).attr('fill', 'transparent').style('pointer-events', 'all');
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
                g.selectAll('path.__pert_pie').data(pie(slices)).join('path')
                    .attr('class', '__pert_pie').attr('d', arcGen)
                    .style('fill', a => a.data.color).style('stroke', PERT_PIE_STROKE).style('stroke-width', '0.9px');
                g.selectAll('text').data([d]).join('text').text(d => d.id); // Add basic text first
                g.on('mouseenter', (event) => {
                    pertTooltip.style('opacity', 1).html(
                        `<div class="tooltip-header">Element ${id}</div>
                         <div class="tooltip-row"><span>Labor Time:</span> <b>${getPertLaborTime(id).toFixed(2)}</b></div>
                         <div class="tooltip-row">Super: <b>${(sup * 100).toFixed(0)}%</b></div>
                         <div class="tooltip-row">Ultra: <b>${(ult * 100).toFixed(0)}%</b></div>
                         <div class="tooltip-row">Mega: <b>${(meg * 100).toFixed(0)}%</b></div>`
                    );
                }).on('mousemove', (event) => {
                    pertTooltip.style('left', (event.clientX + 14) + 'px').style('top', (event.clientY + 14) + 'px');
                }).on('mouseleave', () => {
                    pertTooltip.style('opacity', 0);
                });
            });
            // --- [FIX] Call the restored styling functions ---
            addPERTLabelBackgrounds();
            restylePERTNodeLabelsStrong();
        }
        // --- USER INTERACTION (Drag & Zoom) ---
        function dragstarted(event) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }
        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }
        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }
        precedenceChartNodes.call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended));
        const zoom = d3.zoom().scaleExtent([0.1, 8]).on("zoom", (event) => {
            mainGroup.attr("transform", event.transform);
        });
        svg.call(zoom);
        // --- FINAL RENDERING STEPS ---
        renderPrecedenceLegend();
        drawPERTNodePiesOnce();
        updatePrecedenceChartColors();
        updatePrecedenceChartLinks();
    }

    // Expose public functions to the main script.
    return {
        draw: draw,
        update: update,
        flatten: flatten
    };
})();