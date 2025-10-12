/**
* --------------------------------------------------------------------
* Global Constants and Data Mapping
* --------------------------------------------------------------------
*/
const MIN_TAKT_TIME = 2.5;
const BUILD_RATIOS = { super: 0.35, ultra: 0.45, mega: 0.20 };
const ASSEMBLY_LINE_LENGTH = 486;
let isRecalculating = false;

const PRECEDENCE_DATA = [
    { id: 1, predecessors: [] }, { id: 2, predecessors: [1] }, { id: 3, predecessors: [1] }, { id: 4, predecessors: [1] },
    { id: 5, predecessors: [2, 3] }, { id: 6, predecessors: [1] }, { id: 7, predecessors: [6] }, { id: 8, predecessors: [1] },
    { id: 9, predecessors: [8] }, { id: 10, predecessors: [1] }, { id: 11, predecessors: [1] }, { id: 12, predecessors: [10, 11] },
    { id: 13, predecessors: [4, 5, 7, 9, 12] }, { id: 14, predecessors: [13] }, { id: 15, predecessors: [14] }, { id: 16, predecessors: [15] },
    { id: 17, predecessors: [16] }, { id: 18, predecessors: [14] }, { id: 19, predecessors: [18] }, { id: 20, predecessors: [19] },
    { id: 21, predecessors: [20] }, { id: 22, predecessors: [18] }, { id: 23, predecessors: [22] }, { id: 24, predecessors: [23] },
    { id: 25, predecessors: [19, 22] }, { id: 26, predecessors: [19, 22] }, { id: 27, predecessors: [25, 26] }, { id: 28, predecessors: [27] },
    { id: 29, predecessors: [15] }, { id: 30, predecessors: [17, 21, 24, 27, 29] }, { id: 31, predecessors: [30] },
];

const PERT_LABOR_FALLBACK = {
    1: 0.8, 2: 1.5, 3: 1.0, 4: 1.3, 5: 0.5, 6: 0.7, 7: 0.7, 8: 0.52, 9: 0.325, 10: 0.96, 11: 0.3, 12: 2.0,
    13: 2.5, 14: 1.5, 15: 2.2, 16: 1.2, 17: 0.5, 18: 0.8, 19: 1.1, 20: 0.325, 21: 0.325, 22: 1.3, 23: 0.14,
    24: 0.585, 25: 1.3, 26: 1.0, 27: 0.7, 28: 1.0, 29: 0.7, 30: 0.5, 31: 0.4
};

const WORKSTATION_CAPACITIES = [
    { ws: 3, maxDemand: 147 }, { ws: 4, maxDemand: 192 }, { ws: 5, maxDemand: 229 },
    { ws: 6, maxDemand: 284 }, { ws: 7, maxDemand: 312 }, { ws: 8, maxDemand: 350 },
    { ws: 9, maxDemand: 407 }, { ws: 10, maxDemand: 419 }, { ws: 11, maxDemand: 499 },
    { ws: 12, maxDemand: 501 }, { ws: 13, maxDemand: 552 }
];

const root = document.documentElement;
const PERT_PIE_STROKE = getComputedStyle(root).getPropertyValue('--white').trim();
const PERT_PIE_COLORS = {
    super: getComputedStyle(root).getPropertyValue('--super-color').trim(),
    ultra: getComputedStyle(root).getPropertyValue('--ultra-color').trim(),
    mega: getComputedStyle(root).getPropertyValue('--mega-color').trim(),
    idle: getComputedStyle(root).getPropertyValue('--idle-color').trim()
};

const originalConfigData = {};
const state = {
    taskData: new Map(),
    configData: {}
};

const { draw: drawPrecedenceChart, update: updatePrecedenceChart, flatten: flattenPrecedenceTree } = PrecedenceTab;

let sortableInstances = [];
let precedenceChartNodes = null;
let invalidPrecedenceNodes = new Set();
let profitMaximizationCache = { key: null, data: null };
let isProfitCalculating = false;
let animationState = {
    speedMultiplier: 1.0,
    layout: { frameId: null, isRunning: false, isPaused: false },
    schedule: { frameId: null, isRunning: false, isPaused: false },
    speedo: { currentAngle: 0 }
};

// --- NEW --- State variables for the comparison feature
let savedStateCache = null;
let isCompareMode = false;

/**
* --------------------------------------------------------------------
* DOM ELEMENTS
* --------------------------------------------------------------------
*/
const dailyDemandInput = document.getElementById('dailyDemand');
const opHoursInput = document.getElementById('opHours');
const numEmployeesInput = document.getElementById('numEmployees');
const employeeCountDisplay = document.getElementById('employeeCountDisplay');
const laborCostInput = document.getElementById('laborCost');
const superSellInput = document.getElementById('superSell');
const superCogsInput = document.getElementById('superCogs');
const ultraSellInput = document.getElementById('ultraSell');
const ultraCogsInput = document.getElementById('ultraCogs');
const megaSellInput = document.getElementById('megaSell');
const megaCogsInput = document.getElementById('megaCogs');
const wipEl = document.getElementById('wip');
const throughputEl = document.getElementById('throughput');
const conveyorSpeedEl = document.getElementById('conveyorSpeed');
const productSpacingEl = document.getElementById('productSpacing');
const grossProfitEl = document.getElementById('grossProfit');
const profitMarginEl = document.getElementById('profitMargin');
const demandStatusEl = document.getElementById('demandStatus');
const avgEfficiencyEl = document.getElementById('avgEfficiency');
const totalIdleTimeEl = document.getElementById('totalIdleTime');
const balanceDelayEl = document.getElementById('balanceDelay');
const idleTimeCvEl = document.getElementById('idleTimeCv');
const leftSidebar = document.getElementById('left-sidebar');
const rightSidebar = document.getElementById('right-sidebar');
const leftToggle = document.getElementById('left-toggle');
const rightToggle = document.getElementById('right-toggle');
const tabs = document.getElementById('tabs');
const visPanels = document.querySelectorAll('.vis-panel');
const workstationList = document.getElementById('workstation-list');
const precedenceMap = flattenPrecedenceTree();

/**
* --------------------------------------------------------------------
* Main Initialization
*
* These functions are the entry point for the application, handling
* initial data loading and setup calls.
* --------------------------------------------------------------------
*/

/**
* The main function to initialize the application.
*/
async function main() {
    await loadData();
    setupEventListeners();
    setupUIEventListeners(); // MODIFIED: This will now add the new controls
    setupVisibilityListener();
    runProfitCalculation();
    state.invalidPrecedenceMap = validatePrecedence();
    invalidPrecedenceNodes = new Set(Array.from(state.invalidPrecedenceMap.keys()));
    restoreActiveTab();
    updateUI();
    renderActiveTab();
    document.querySelectorAll("input[type='number']").forEach(input => {
        enableMiddleDragNumberInput(input, 1, 1);
    });
    document.querySelectorAll("input[type='range']").forEach(input => {
        enableMiddleDragNumberInput(input, 1, 1);
    });
}

/**
* Loads PERT and CONFIGS data from CSV files and populates the global state.
*/
async function loadData() {
    try {
        const [pertData, configsRaw] = await Promise.all([
            d3.csv("Data/PERT.csv"),
            d3.csv("Data/CONFIGS.csv")
        ]);
        pertData.forEach(d => {
            state.taskData.set(parseInt(d.Element), {
                laborTime: parseFloat(d.Labor_Time),
                elementTime: parseFloat(d.Element_Time),
                description: d["Description"] || d.Description,
                Super: parseFloat(d.Super),
                Ultra: parseFloat(d.Ultra),
                Mega: parseFloat(d.Mega)
            });
        });
        for (let i = 3; i <= 13; i++) {
            originalConfigData[i] = {};
        }
        configsRaw.forEach(row => {
            for (let i = 3; i <= 13; i++) {
                const workstation = row[`${i}_Workstation`];
                const element = parseInt(row[`${i}_Element`]);
                if (workstation && !isNaN(element)) {
                    if (!originalConfigData[i][workstation]) {
                        originalConfigData[i][workstation] = [];
                    }
                    originalConfigData[i][workstation].push(element);
                }
            }
        });
        state.configData = JSON.parse(JSON.stringify(originalConfigData));
        console.log("Local CSV data loaded successfully.");
    } catch (error) {
        console.error("Fatal Error: Could not load local data files.", error);
        demandStatusEl.innerHTML = "Error: Failed to load data.<br>Please use a local server.";
    }
}

/**
* --------------------------------------------------------------------
* UI & DOM Manipulation
*
* These functions directly interact with the DOM to update the user
* interface, render components, and set up event listeners.
* --------------------------------------------------------------------
*/
function stopAllSimulations() { if (animationState.layout.frameId) { cancelAnimationFrame(animationState.layout.frameId); animationState.layout.frameId = null; animationState.layout.isRunning = !1 } if (animationState.schedule.frameId) { cancelAnimationFrame(animationState.schedule.frameId); animationState.schedule.frameId = null; animationState.schedule.isRunning = !1 } }
function animateValue(e, t, a, i = 1e3, n = o => o.toFixed(1)) { if (!e) return; if (e._animationId) { cancelAnimationFrame(e._animationId) } const o = Date.now(), s = a - t; function l() { const r = Date.now(), d = r - o, c = Math.min(d / i, 1), p = 1 - Math.pow(1 - c, 4), u = t + s * p; e.textContent = n(u); if (c < 1) { e._animationId = requestAnimationFrame(l) } else { e._animationId = null } } l() }
function parseElementValue(e) { if (!e || !e.textContent) return 0; const t = e.textContent; if (t.includes("$")) { const a = t.replace(/[$,]/g, ""), i = a.match(/-?\d+\.?\d*/); return i ? parseFloat(i[0]) : 0 } const n = t.match(/-?\d+\.?\d*/); return n ? parseFloat(n[0]) : 0 }
function enableMiddleDragNumberInput(e, t = 1, a = .1) { let i = !1, n, o; const s = () => { const r = e.hasAttribute("min") ? parseFloat(e.min) : -1 / 0, d = e.hasAttribute("max") ? parseFloat(e.max) : 1 / 0, c = parseFloat(e.step) || 1; return { min: r, max: d, step: c } }; e.addEventListener("mousedown", r => { if (r.button === 1) { r.preventDefault(); r.stopPropagation(); i = !0; n = r.clientY; o = parseFloat(e.value) || 0; const d = c => { if (!i) return; const p = n - c.clientY, u = s(); let m = o + p * a * t; m = Math.max(u.min, Math.min(u.max, m)); if (e.type === "range" || u.step === 1) { e.value = Math.round(m).toString() } else if (u.step < 1) { const g = Math.max(0, -Math.floor(Math.log10(u.step))); e.value = m.toFixed(g) } else { e.value = m.toFixed(2) } e.dispatchEvent(new Event("input", { bubbles: !0 })) }, p = () => { i = !1; document.removeEventListener("mousemove", d); document.removeEventListener("mouseup", p) }; document.addEventListener("mousemove", d); document.addEventListener("mouseup", p) } }); e.addEventListener("wheel", r => { if (document.activeElement === e) { r.preventDefault(); const d = s(), c = r.deltaY > 0 ? -1 : 1; let p = parseFloat(e.value) || 0, u = p + c * d.step; u = Math.max(d.min, Math.min(d.max, u)); if (e.type === "range" || d.step === 1) { e.value = Math.round(u).toString() } else if (d.step < 1) { const m = Math.max(0, -Math.floor(Math.log10(d.step))); e.value = u.toFixed(m) } else { e.value = u.toFixed(2) } e.dispatchEvent(new Event("input", { bubbles: !0 })) } }) }
function restoreActiveTab() { let e = sessionStorage.getItem("activeTab"); if (!e) { e = "overview"; sessionStorage.setItem("activeTab", e) } document.querySelectorAll(".tab-btn").forEach(t => t.classList.remove("active")); const t = document.querySelector(`.tab-btn[data-tab="${e}"]`); if (t) t.classList.add("active"); visPanels.forEach(a => { a.style.display = a.id === `${e}-panel` ? "block" : "none" }) }
function updateUI() { employeeCountDisplay.textContent = numEmployeesInput.value; renderWorkstationSidebar(parseInt(numEmployeesInput.value)); setupDragAndDrop(); invalidPrecedenceNodes = validatePrecedence(); if (invalidPrecedenceNodes.size > 0) { demandStatusEl.textContent = "Fails to Meet Precedence"; demandStatusEl.className = "status failure"; wipEl.textContent = "---"; throughputEl.textContent = "---"; conveyorSpeedEl.textContent = "---"; productSpacingEl.textContent = "---"; grossProfitEl.textContent = "---"; profitMarginEl.textContent = "---"; avgEfficiencyEl.textContent = "---"; totalIdleTimeEl.textContent = "---"; balanceDelayEl.textContent = "---"; idleTimeCvEl.textContent = "---" } else { const e = { dailyDemand: parseInt(dailyDemandInput.value), opHours: parseFloat(opHoursInput.value), numEmployees: parseInt(numEmployeesInput.value) }, t = { laborCost: parseFloat(laborCostInput.value), superSell: parseFloat(superSellInput.value), superCogs: parseFloat(superCogsInput.value), ultraSell: parseFloat(ultraSellInput.value), ultraCogs: parseFloat(ultraCogsInput.value), megaSell: parseFloat(megaSellInput.value), megaCogs: parseFloat(megaCogsInput.value) }, a = calculateMetrics(e, t); if (a) { animateValue(wipEl, parseElementValue(wipEl), a.wip, 800, i => i.toFixed(1)); animateValue(throughputEl, parseElementValue(throughputEl), a.throughputUnitsPerHour, 800, i => `${i.toFixed(1)}/hr`); animateValue(conveyorSpeedEl, parseElementValue(conveyorSpeedEl), a.conveyorSpeed, 800, i => `${i.toFixed(2)} ft/min`); animateValue(productSpacingEl, parseElementValue(productSpacingEl), a.productSpacing, 800, i => `${i.toFixed(2)} ft`); animateValue(grossProfitEl, parseElementValue(grossProfitEl), a.dailyGrossProfit, 800, i => i.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 })); animateValue(profitMarginEl, parseElementValue(profitMarginEl), a.grossProfitMargin, 800, i => `${i.toFixed(1)}%`); animateValue(avgEfficiencyEl, parseElementValue(avgEfficiencyEl), a.averageEfficiency, 800, i => `${i.toFixed(1)}%`); animateValue(totalIdleTimeEl, parseElementValue(totalIdleTimeEl), a.totalIdleTime / 60, 800, i => `${i.toFixed(2)} hrs`); animateValue(balanceDelayEl, parseElementValue(balanceDelayEl), a.balanceDelay, 800, i => `${i.toFixed(1)}%`); animateValue(idleTimeCvEl, parseElementValue(idleTimeCvEl), a.idleTimeCv, 800, i => `${i.toFixed(1)}%`); demandStatusEl.textContent = a.meetsDemand ? "Meets Demand" : "Fails to Meet Demand"; demandStatusEl.className = a.meetsDemand ? "status success" : "status failure" } } stopAllSimulations(); renderActiveTab() }
function renderWorkstationSidebar(e) { workstationList.innerHTML = ""; const t = state.configData[e]; if (!t || Object.keys(t).length === 0) return; const a = Object.keys(t).sort((l, r) => parseInt(l) - parseInt(r)), i = a.length; let n = 0; a.forEach(l => { t[l].forEach(r => { const d = state.taskData.get(r); if (d && d.elementTime > n) { n = d.elementTime } }) }); if (n === 0) return; a.forEach((l, r) => { const d = t[l], c = generateElementColorScale(r, i, d.length), p = document.createElement("div"); p.className = "workstation"; const u = document.createElement("div"); u.className = "workstation-title"; u.textContent = `Workstation ${l}`; p.appendChild(u); const m = document.createElement("div"); m.className = "workstation-elements"; d.forEach((g, h) => { const f = state.taskData.get(g); if (f) { const v = c(h), b = document.createElement("div"); b.className = "element-row"; b.title = `Element ${g}: ${f.description}`; b.dataset.taskId = g; const S = document.createElement("div"); S.className = "element-bar-wrapper"; const w = document.createElement("div"); w.className = "element-time-bar"; const T = (f.elementTime / n) * 80; w.style.width = `${T}%`; w.style.backgroundColor = getComputedStyle(root).getPropertyValue("--accent").trim(); w.style.border = `3px solid ${v}`; const C = document.createElement("div"); C.className = "labor-time-bar"; C.style.backgroundColor = v; const A = f.elementTime > 0 ? f.laborTime / f.elementTime : 0; C.style.transform = `scaleX(${A})`; if (f.elementTime > 2 * f.laborTime) { const k = document.createElement("span"); k.className = "element-time-text"; k.textContent = g; w.appendChild(k) } else { const E = document.createElement("span"); E.className = "labor-bar-text"; E.textContent = g; w.appendChild(E) } w.appendChild(C); S.appendChild(w); b.appendChild(S); m.appendChild(b) } }); p.appendChild(m); workstationList.appendChild(p) }); const o = workstationList.querySelector(".workstation-title"), s = document.getElementById("svg-container"); if (o && s) { const l = s.getBoundingClientRect().top, r = o.getBoundingClientRect().top, d = parseFloat(getComputedStyle(workstationList).paddingTop) || 0, c = l - r, p = Math.max(0, d + c); workstationList.style.paddingTop = `${p}px` } }
function setupEventListeners() { const e = [dailyDemandInput, opHoursInput, numEmployeesInput, laborCostInput, superSellInput, superCogsInput, ultraSellInput, ultraCogsInput, megaSellInput, megaCogsInput]; attachCommitBehavior(e, (t, a) => { handleInputChange(t) }) }
function attachCommitBehavior(e, t) { const a = new WeakMap, i = new WeakMap; const n = () => e.forEach(l => i.set(l, !1)); document.addEventListener("mouseup", n); e.forEach(o => { if (!o) return; if (!o.dataset.committedValue) o.dataset.committedValue = o.value ?? ""; i.set(o, !1); o.dataset.awaitingInput = "false"; o.addEventListener("focus", s => { o.dataset.preFocusValue = o.dataset.committedValue ?? ""; if (o.type !== "range") { if (o.dataset.awaitingInput !== "true") { o.dataset.awaitingInput = "true"; o.value = ""; try { o.setSelectionRange(0, 0) } catch (l) { } } } }); o.addEventListener("mousedown", s => { if (s.button === 1) { i.set(o, !0) } }); o.addEventListener("input", () => { const s = a.get(o); if (s) clearTimeout(s); if (o.type === "range") { commitInput(o, t); o.dataset.awaitingInput = "false"; return } if (!i.get(o)) { o.dataset.awaitingInput = "true"; return } const l = setTimeout(() => { const r = (o.value || "").trim(), d = (o.dataset.committedValue || "").trim(); if (r !== d) { commitInput(o, t) } }, 200); a.set(o, l) }); o.addEventListener("change", () => { const s = a.get(o); if (s) clearTimeout(s); commitInput(o, t); o.dataset.awaitingInput = "false" }); o.addEventListener("keydown", s => { if (s.key === "Enter") { const l = a.get(o); if (l) clearTimeout(l); commitInput(o, t); o.dataset.awaitingInput = "false"; o.blur() } else if (s.key === "Escape") { const r = a.get(o); if (r) clearTimeout(r); o.value = o.dataset.committedValue ?? ""; o.dataset.awaitingInput = "false"; o.blur() } }); o.addEventListener("blur", () => { const s = a.get(o); if (s) clearTimeout(s); const l = o.dataset.awaitingInput === "true", r = (o.value || "").trim(); if (l && r === "") { o.value = o.dataset.committedValue ?? ""; o.dataset.awaitingInput = "false" } else { commitInput(o, t); o.dataset.awaitingInput = "false" } }) }); const c = { dailyDemand: 180, opHours: 15, numEmployees: 8, laborCost: 25, superSell: 1250, superCogs: 450, ultraSell: 1500, ultraCogs: 550, megaSell: 1800, megaCogs: 650 }; e.forEach(p => { if (!p) return; p.addEventListener("click", u => { if (u.ctrlKey) { u.preventDefault(); const m = c[p.id]; if (m !== void 0) { const g = p.hasAttribute("min") ? parseFloat(p.min) : -1 / 0, h = p.hasAttribute("max") ? parseFloat(p.max) : 1 / 0, f = parseFloat(p.step) || 1; p.value = Math.max(g, Math.min(h, m)); commitInput(p, t); p.style.backgroundColor = getComputedStyle(root).getPropertyValue("--primary").trim(); setTimeout(() => { p.style.backgroundColor = "" }, 200) } } }) }) }
function commitInput(e, t) { const a = (e.value || "").trim(); if (a === "") { e.value = e.dataset.committedValue ?? ""; return } const i = Number(a); if (!Number.isFinite(i)) { e.value = e.dataset.committedValue ?? ""; return } const n = clampByField(e.id, i); e.value = String(n); e.dataset.committedValue = e.value; if (typeof t === "function") t(e.id, n) }
function clampByField(e, t) { switch (e) { case "opHours": return Math.min(Math.max(t, 0), 24); case "dailyDemand": return Math.max(0, Math.floor(t)); case "numEmployees": return Math.max(1, Math.floor(t)); case "laborCost": case "superSell": case "superCogs": case "ultraSell": case "ultraCogs": case "megaSell": case "megaCogs": return Math.max(0, t); default: return t } }
function setupUIEventListeners() { leftToggle.addEventListener("click", () => { const e = () => { updateUI(); document.getElementById("left-sidebar").removeEventListener("transitionend", e) }; document.getElementById("left-sidebar").addEventListener("transitionend", e); document.getElementById("left-sidebar").classList.toggle("collapsed"); const t = document.getElementById("left-sidebar").classList.contains("collapsed"); leftToggle.innerHTML = t ? "&raquo;" : "&laquo;" }); rightToggle.addEventListener("click", () => { const e = () => { updateUI(); document.getElementById("right-sidebar").removeEventListener("transitionend", e) }; document.getElementById("right-sidebar").addEventListener("transitionend", e); document.getElementById("right-sidebar").classList.toggle("collapsed"); const t = document.getElementById("right-sidebar").classList.contains("collapsed"); rightToggle.innerHTML = t ? "&laquo;" : "&raquo;" }); tabs.addEventListener("click", e => { if (e.target.classList.contains("tab-btn")) { const t = e.target.dataset.tab, a = tabs.querySelector(".active"); if (a && a.dataset.tab === t) { return } sessionStorage.setItem("activeTab", t); if (a) a.classList.remove("active"); e.target.classList.add("active"); visPanels.forEach(i => { i.style.display = i.id === `${t}-panel` ? "block" : "none" }); workstationList.scrollTop = 0; stopAllSimulations(); if (isCompareMode) { const n = document.getElementById("compareSwitch"); if (n) { n.checked = !1; handleCompareToggle({ target: n }) } } else { renderActiveTab() } } }); workstationList.addEventListener("scroll", () => { const e = workstationList.scrollTop, t = document.getElementById("schedule-panel"), a = t.querySelector(".schedule-content-group"); if (a) { a.setAttribute("transform", `translate(0, ${-e})`) } }); const controlsContainer = document.createElement("div"); controlsContainer.className = "right-toolbar-controls"; controlsContainer.innerHTML = `<button id="saveStateBtn" class="button">Save State</button><label class="switch" title="Compare current state with saved state"><input type="checkbox" id="compareSwitch"><span class="slider" data-on="Compare" data-off="Compare"></span></label>`; rightSidebar.appendChild(controlsContainer); document.getElementById("saveStateBtn").addEventListener("click", saveCurrentState); document.getElementById("compareSwitch").addEventListener("change", handleCompareToggle); const style = document.createElement("style"); style.textContent = `.right-toolbar-controls{display:flex;justify-content:space-around;align-items:center;padding:10px;border-top:1px solid var(--border-color);margin-top:auto;gap:10px;}.right-toolbar-controls .button{flex-grow:1;}.comparison-wrapper{display:flex;width:100%;height:100%;}.comparison-container{flex:1;position:relative;overflow:hidden;border:1px solid var(--border-color);}.comparison-container > svg{width:100%;height:100%;}`; document.head.appendChild(style) }
function handleVisibilityChange() { if (document.hidden) { if (animationState && animationState.schedule && animationState.schedule.isRunning) { animationState.schedule.isPaused = !0 } if (animationState && animationState.layout && animationState.layout.isRunning) { animationState.layout.isPaused = !0 } } else { if (animationState && animationState.schedule && animationState.schedule.isPaused) { animationState.schedule.isPaused = !1; animationState.schedule.lastFrameTime = performance.now() } if (animationState && animationState.layout && animationState.layout.isPaused) { animationState.layout.isPaused = !1; animationState.layout.lastFrameTime = performance.now() } } }
function setupVisibilityListener() { document.addEventListener("visibilitychange", handleVisibilityChange, !1) }
function setupDragAndDrop() { sortableInstances.forEach(e => e.destroy()); sortableInstances = []; const e = document.querySelectorAll(".workstation-elements"); e.forEach(t => { const a = new Sortable(t, { group: "shared", animation: 150, onEnd: function (i) { updateWorkstationOrder() } }); sortableInstances.push(a) }) }
function createTooltip(e) { let t = d3.select("body > .d3-tooltip"); if (t.empty()) { t = d3.select("body").append("div").attr("class", `d3-tooltip ${e || ""}`).style("opacity", 0).style("position", "absolute") } return t }
function createControlButton(e, t) { const { className: a, text: i, transform: n = [0, 0] } = t, o = e.append("g").attr("class", a).attr("transform", `translate(${n[0]}, ${n[1]})`).style("cursor", "pointer"); o.append("rect").attr("width", 28).attr("height", 18).attr("fill", getComputedStyle(root).getPropertyValue("--accent").trim()).attr("rx", 3); o.append("text").attr("x", 14).attr("y", 13.5).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue("--secondary1").trim()).style("font-size", "14px").text(i); return o }
function generateElementColorScale(e, t, a) { const i = [getComputedStyle(root).getPropertyValue("--primary").trim(), getComputedStyle(root).getPropertyValue("--secondary1").trim(), getComputedStyle(root).getPropertyValue("--secondary2").trim()], n = d3.hcl(i[e % i.length]), o = n.copy(); o.l += 15; const s = n.copy(); s.l -= 15; return d3.scaleLinear().domain([0, a > 1 ? a - 1 : 1]).range([o.toString(), s.toString()]).interpolate(d3.interpolateHcl) }
function handleInputChange(driverId) { if (isRecalculating) return; isRecalculating = !0; const isFinancialDriver = ['laborCost', 'superSell', 'superCogs', 'ultraSell', 'ultraCogs', 'megaSell', 'megaCogs'].includes(driverId); if (isFinancialDriver) { calculateOptimalProfitData() } try { let e = parseInt(dailyDemandInput.value) || 1, t = parseFloat(opHoursInput.value) || 1, a = parseInt(numEmployeesInput.value); const i = ['dailyDemand', 'opHours', 'numEmployees'].includes(driverId); if (i) { workstationList.scrollTop = 0 } if (driverId === 'numEmployees') { state.configData[a] = JSON.parse(JSON.stringify(originalConfigData[a])) } if (i) { let n = calculateWorkstationDetails(a).bottleneckTime; if (n === 0) { console.error(`No valid workstation data for ${a} employees. Aborting.`); isRecalculating = !1; return } let o = (t * 60) / e; if (o < n) { if (driverId === 'numEmployees') { let s = (n * e) / 60; t = s <= 24 ? roundUpToQuarter(s) : 24; if (s > 24) { e = Math.floor(24 * 60 / n) } } else { a = findBestEmployeeFit(o, a) } } o = t * 60 / e; if (o < MIN_TAKT_TIME) { if (driverId === 'dailyDemand') { t = roundUpToQuarter(MIN_TAKT_TIME * e / 60); if (t > 24) t = 24 } else { e = Math.floor(t * 60 / MIN_TAKT_TIME) } } } dailyDemandInput.value = Math.round(e); opHoursInput.value = t.toFixed(2); numEmployeesInput.value = a; updateUI() } catch (l) { console.error("Error during input handling:", l) } finally { isRecalculating = !1 } }
function calculateWorkstationDetails(e) { const t = state.configData[e]; if (!t || Object.keys(t).length === 0) return { workstations: [], bottleneckTime: 0, fastestTime: 1 / 0 }; let a = [], i = 0, n = 1 / 0; for (const o in t) { let s = 0, l = 0; t[o].forEach(r => { const d = state.taskData.get(r); if (d) { s += d.laborTime; l += d.elementTime } }); const c = l * 15; a.push({ id: o, cycleTime: s, stationLength: c }); if (s > i) i = s; if (s < n && s > 0) n = s } return { workstations: a, bottleneckTime: i, fastestTime: n } }
function calculateMetrics(e, t) { const a = calculateWorkstationDetails(e.numEmployees), i = Math.floor(e.opHours * 4) * 15, n = a.bottleneckTime, o = a.fastestTime === 1 / 0 ? 0 : a.fastestTime * 15; if (o <= 0 || n <= 0) { return { wip: 0, throughputUnitsPerHour: 0, conveyorSpeed: 0, productSpacing: 0, dailyGrossProfit: -(e.numEmployees * e.opHours * (t.laborCost || 0)), grossProfitMargin: 0, meetsDemand: !1, effectiveCycleTime: 1 / 0, workstations: a.workstations, averageEfficiency: 0, totalIdleTime: i * e.numEmployees, balanceDelay: 100, idleTimeCv: 0, throughputUnitsPerDay: 0 } } let s; const l = e.dailyDemand > 1 ? e.dailyDemand - 1 : 0, r = ASSEMBLY_LINE_LENGTH / o; if (e.dailyDemand <= 1) { s = 1 / 0 } else { const u = l + r; s = i / u } const d = n <= s, c = d ? s : n, p = o / (isFinite(c) ? c : n), m = ASSEMBLY_LINE_LENGTH / o * c; let g; if (i < m) { g = 0 } else if (e.dailyDemand <= 1) { g = 1 } else { const h = i - m; g = Math.floor(h / c) + 1 } const f = ASSEMBLY_LINE_LENGTH / o; let v; if (e.dailyDemand <= 0) { v = 0 } else if (e.dailyDemand === 1) { v = m } else { v = c * l + m } const b = (v > 0 ? e.dailyDemand / v : 0) * 60; let S = 0; a.workstations.forEach(y => { S += y.cycleTime; y.efficiency = n > 0 ? y.cycleTime / n * 100 : 0; const D = n - y.cycleTime; y.dailyIdleTime = D * g }); const w = e.numEmployees * i, T = e.numEmployees * e.opHours * (t.laborCost || 0), C = g * S, A = Math.max(0, w - C), k = w > 0 ? C / w * 100 : 0; const E = a.workstations.map(y => y.efficiency), P = E.length > 0 ? E.reduce((y, D) => y + D, 0) / E.length : 0, L = 100 - P; const V = a.workstations.map(y => n - y.cycleTime), I = V.length > 0 ? V.reduce((y, D) => y + D, 0) / V.length : 0, x = Math.sqrt(V.map(y => Math.pow(y - I, 2)).reduce((y, D) => y + D, 0) / (V.length || 1)), N = I > 0 ? x / I * 100 : 0; const _ = g * (BUILD_RATIOS.super * (t.superSell || 0) + BUILD_RATIOS.ultra * (t.ultraSell || 0) + BUILD_RATIOS.mega * (t.megaSell || 0)), R = g * (BUILD_RATIOS.super * (t.superCogs || 0) + BUILD_RATIOS.ultra * (t.ultraCogs || 0) + BUILD_RATIOS.mega * (t.megaCogs || 0)), M = _ - R - T, O = M > 0 ? M / _ * 100 : 0; return { wip: f, throughputUnitsPerHour: b, conveyorSpeed: p, productSpacing: o, dailyGrossProfit: M, grossProfitMargin: O, meetsDemand: d, effectiveCycleTime: c, workstations: a.workstations, averageEfficiency: k, totalIdleTime: A, balanceDelay: L, idleTimeCv: N, throughputUnitsPerDay: g } }
function findBestEmployeeFit(e, t) { for (let a = t; a <= 13; a++) { if (calculateWorkstationDetails(a).bottleneckTime <= e) return a } return 13 }
function updateWorkstationOrder() { const e = parseInt(numEmployeesInput.value), t = {}; document.querySelectorAll(".workstation").forEach(a => { const i = a.querySelector(".workstation-title").textContent, n = i.match(/\d+/); if (n) { const o = n[0], s = []; a.querySelectorAll(".element-row").forEach(l => { s.push(parseInt(l.dataset.taskId)) }); t[o] = s } }); state.configData[e] = t; const a = validatePrecedence(); invalidPrecedenceNodes = new Set(Array.from(a.keys())); if (document.querySelector('.tab-btn[data-tab="precedence"].active')) { updatePrecedenceChart() } setTimeout(updateUI, 0) }
function validatePrecedence() { const e = new Set, t = document.querySelectorAll(".element-row"), a = new Set; t.forEach(i => { const n = parseInt(i.dataset.taskId), o = precedenceMap.get(n) || new Set; let s = !0; for (const l of o) { if (!e.has(l)) { s = !1; break } } if (!s) { i.classList.add("precedence-error"); a.add(n) } else { i.classList.remove("precedence-error") } e.add(n) }); return a }
function generateProductionQueue(e) { const t = [], a = Object.values(BUILD_RATIOS); let i = []; let n = 0; for (let l = 0; l < a.length - 1; l++) { const r = Math.round(a[l] * e); i.push(r); n += r } i.push(e - n); let o = e; const s = i.map(l => l > 0 ? o / l : 1 / 0); let l = s.map(r => r / 2); for (let r = 0; r < e; r++) { let d = -1, c = 1 / 0; for (let p = 0; p < l.length; p++) { if (i[p] > 0 && l[p] < c) { c = l[p]; d = p } } if (d === -1) { break } t.push(d + 1); l[d] += s[d]; i[d]-- } return t }
function getFinancialInputsKey() { const e = { laborCost: parseFloat(laborCostInput.value), superSell: parseFloat(superSellInput.value), superCogs: parseFloat(superCogsInput.value), ultraSell: parseFloat(ultraSellInput.value), ultraCogs: parseFloat(ultraCogsInput.value), megaSell: parseFloat(megaSellInput.value), megaCogs: parseFloat(megaCogsInput.value) }; return 'profitDataCache-v1-' + JSON.stringify(e) }
function runProfitCalculation() { const e = getFinancialInputsKey(); try { const t = sessionStorage.getItem(e); if (t) { console.log("Loading profit data from session cache."); profitMaximizationCache = { key: e, data: JSON.parse(t) }; if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') { ProfitTab.draw() } } else { console.log("No valid cache found. Calculating optimal profit data for the first time."); calculateOptimalProfitData() } } catch (a) { console.error("Could not access session storage. Recalculating profit data.", a); calculateOptimalProfitData() } }
function findOptimalConfigForDemand(e, t, a) { let i = -1 / 0, n = { emp: 0, hrs: 0 }, o = -1 / 0, s = { emp: 0, hrs: 0 }; for (let l = 3; l <= 13; l++) { if (e > (a.get(l) || 0)) { continue } if (!originalConfigData[l] || Object.keys(originalConfigData[l]).length === 0) continue; const { bottleneckTime: r, fastestTime: d } = calculateWorkstationDetails(l); if (r <= 0 || !isFinite(d) || d <= 0) continue; const c = (e > 1 ? (e - 1) * r : 0) + ASSEMBLY_LINE_LENGTH / (d * 15) * r, p = c / 60; if (p > 24) continue; const u = roundUpToQuarter(p); for (let m = u; m <= 24; m += .25) { const g = calculateMetrics({ dailyDemand: e, opHours: m, numEmployees: l }, t); if (g && g.throughputUnitsPerDay >= e) { if (g.dailyGrossProfit > i) { i = g.dailyGrossProfit; n = { emp: l, hrs: m } } if (g.grossProfitMargin > o) { o = g.grossProfitMargin; s = { emp: l, hrs: m } } break } } } const h = { demand: e, value: isFinite(i) ? i : 0, config: n }, f = { demand: e, value: isFinite(o) ? o : 0, config: s }; return { profitResult: h, marginResult: f } }
async function calculateOptimalProfitData() { if (isProfitCalculating) return; isProfitCalculating = !0; const e = { laborCost: parseFloat(laborCostInput.value), superSell: parseFloat(superSellInput.value), superCogs: parseFloat(superCogsInput.value), ultraSell: parseFloat(ultraSellInput.value), ultraCogs: parseFloat(ultraCogsInput.value), megaSell: parseFloat(megaSellInput.value), megaCogs: parseFloat(megaCogsInput.value) }; const t = getFinancialInputsKey() + "-demand50plus"; if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') { ProfitTab.draw() } setTimeout(() => { const a = [], i = []; const n = JSON.parse(JSON.stringify(state.configData)); try { state.configData = originalConfigData; const o = new Map(WORKSTATION_CAPACITIES.map(s => [s.ws, s.maxDemand])); for (let s = 50; s <= 552; s++) { const { profitResult: l, marginResult: r } = findOptimalConfigForDemand(s, e, o); a.push(l); i.push(r) } const c = { profitData: a, marginData: i }; profitMaximizationCache = { key: t, data: c }; try { sessionStorage.setItem(t, JSON.stringify(c)) } catch (p) { console.error("Could not save profit data to session storage.", p) } } finally { state.configData = n; isProfitCalculating = !1; if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') { ProfitTab.draw() } } }, 200) }
function doesElementBuildModel(e, t) { const a = state.taskData.get(e); if (!a) return !1; const i = { 1: 'Super', 2: 'Ultra', 3: 'Mega' }, n = i[t]; return a[n] > 0 }
function runGanttSimulation() { const e = parseInt(numEmployeesInput.value), t = parseInt(dailyDemandInput.value), a = parseFloat(opHoursInput.value), i = state.configData[e]; if (!i || Object.keys(i).length === 0 || invalidPrecedenceNodes.size > 0) { return { tasks: [] } } const n = generateProductionQueue(t), o = calculateMetrics({ dailyDemand: t, opHours: a, numEmployees: e }, {}), s = o.effectiveCycleTime, l = o.conveyorSpeed; if (l <= 0 || !isFinite(l)) { return { tasks: [] } } let r = []; let d = n.map((p, u) => { let m = u * s; if (u === 0 && isNaN(m)) { m = 0 } return { modelId: p, arrivalTime: m, uniqueId: `${p}-${u}` } }); const c = Object.keys(i).sort((p, u) => parseInt(p) - parseInt(u)), h = c.reduce((p, u) => { const m = i[u] || []; const g = m.reduce((f, v) => f + (state.taskData.get(v)?.elementTime || 0), 0); return p + g }, 0), f = ASSEMBLY_LINE_LENGTH / l; for (const v of c) { const b = i[v] || []; if (b.length === 0) continue; let S = 0; let w = []; const T = b.reduce((I, x) => I + (state.taskData.get(x)?.elementTime || 0), 0); let C = 0; if (h > 0) { C = T / h * f } d.sort((I, x) => I.arrivalTime - x.arrivalTime); for (const A of d) { if (!isFinite(A.arrivalTime)) continue; const k = Math.max(A.arrivalTime, S); let E = k; for (const P of b) { if (doesElementBuildModel(P, A.modelId)) { const L = state.taskData.get(P); if (L) { const V = E, I = V + L.elementTime; r.push({ workstationId: `WS ${v}`, modelId: A.modelId, taskId: P, startTime: V, endTime: I, uniqueId: A.uniqueId }); E = I } } } const x = E; S = x; const N = A.arrivalTime + C, _ = Math.max(x, N); w.push({ ...A, arrivalTime: _ }) } d = w } return { tasks: r } }
function roundUpToQuarter(e) { return Math.ceil(e / .25) * .25 }

/**
* --------------------------------------------------------------------
* State Comparison Functionality (NEW)
* --------------------------------------------------------------------
*/
function saveCurrentState() {
    savedStateCache = {
        inputs: { dailyDemand: dailyDemandInput.value, opHours: opHoursInput.value, numEmployees: numEmployeesInput.value, laborCost: laborCostInput.value, superSell: superSellInput.value, superCogs: superCogsInput.value, ultraSell: ultraSellInput.value, ultraCogs: ultraCogsInput.value, megaSell: megaSellInput.value, megaCogs: megaCogsInput.value },
        configData: JSON.parse(JSON.stringify(state.configData)),
    };
    const saveBtn = document.getElementById('saveStateBtn');
    if (saveBtn) { saveBtn.textContent = 'State Saved!'; saveBtn.style.backgroundColor = 'var(--accent)'; setTimeout(() => { saveBtn.textContent = 'Save State'; saveBtn.style.backgroundColor = ''; }, 1500); }
}

function handleCompareToggle(event) {
    isCompareMode = event.target.checked;
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if ((activeTab === 'overview' || activeTab === 'precedence') && isCompareMode) {
        event.target.checked = false;
        isCompareMode = false;
        return;
    }
    if (isCompareMode && !savedStateCache) {
        saveCurrentState();
    }
    renderActiveTab();
}

/**
* --------------------------------------------------------------------
* Visualization Panels (Tabs) - MODIFIED FOR COMPARISON
* --------------------------------------------------------------------
*/
function renderActiveTab() {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (!activeTab) return;

    const panel = document.getElementById(`${activeTab}-panel`);
    const panelParent = panel.parentElement;

    const drawFunctionMap = {
        'overview': drawOverviewPanel, 'precedence': drawPrecedenceChart,
        'schedule': ScheduleTab.draw, 'efficiency': EfficiencyTab.draw,
        'layout': LayoutTab.draw, 'profit': ProfitTab.draw,
        'investment': drawInvestmentPanel
    };
    const drawFunction = drawFunctionMap[activeTab];
    if (!drawFunction) return;

    // Always clean up a previous comparison view to ensure a fresh start
    const existingWrapper = panelParent.querySelector('.comparison-wrapper');
    if (existingWrapper) {
        const liveContainer = existingWrapper.querySelector('.live-view');
        if (liveContainer?.firstChild) {
            panelParent.appendChild(liveContainer.firstChild); // Restore original panel
        }
        existingWrapper.remove();
    }

    const isCompareDisabled = activeTab === 'overview' || activeTab === 'precedence';

    if (isCompareMode && !isCompareDisabled) {
        // Store the live state before changing anything
        const liveStateCache = {
            inputs: { dailyDemand: dailyDemandInput.value, opHours: opHoursInput.value, numEmployees: numEmployeesInput.value, laborCost: laborCostInput.value, superSell: superSellInput.value, superCogs: superCogsInput.value, ultraSell: ultraSellInput.value, ultraCogs: ultraCogsInput.value, megaSell: megaSellInput.value, megaCogs: megaCogsInput.value },
            configData: JSON.parse(JSON.stringify(state.configData))
        };

        // Temporarily apply the saved state and draw
        state.configData = savedStateCache.configData;
        for (const key in savedStateCache.inputs) { document.getElementById(key).value = savedStateCache.inputs[key]; }
        drawFunction();
        const savedSvgClone = panel.cloneNode(true);
        savedSvgClone.id = '';

        // Restore the live state and draw
        state.configData = liveStateCache.configData;
        for (const key in liveStateCache.inputs) { document.getElementById(key).value = liveStateCache.inputs[key]; }
        drawFunction();

        // Build the side-by-side container and place the SVGs
        const wrapper = document.createElement('div');
        wrapper.className = 'comparison-wrapper';
        wrapper.innerHTML = `<div class="comparison-container saved-view"></div><div class="comparison-container live-view"></div>`;
        wrapper.querySelector('.saved-view').appendChild(savedSvgClone);
        wrapper.querySelector('.live-view').appendChild(panel);
        panelParent.appendChild(wrapper);
        wrapper.style.flexDirection = (panelParent.offsetWidth > panelParent.offsetHeight) ? 'row' : 'column';
    } else {
        // Normal render
        drawFunction();
    }
}

async function drawOverviewPanel() {
    const panel = d3.select("#overview-panel");
    panel.html('');
    const fo = panel.append("foreignObject").attr("width", "100%").attr("height", "100%");
    const container = fo.append("xhtml:div").attr("class", "overview-container");
    try {
        const response = await fetch('Pages/overview.html');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        let html = await response.text();
        const replacements = { 'overview-num-employees': numEmployeesInput.value, 'overview-daily-demand': dailyDemandInput.value, 'overview-op-hours': opHoursInput.value, 'overview-labor-cost': parseFloat(laborCostInput.value).toFixed(2) };
        for (const [id, value] of Object.entries(replacements)) { html = html.replace(new RegExp(`(<span id="${id}">)(.*?)(<\\/span>)`), `$1${value}$3`); }
        container.html(html);
    } catch (error) {
        console.error("Could not render Overview panel:", error);
        container.html(`<p style="padding: 2rem; text-align: center;">Error: Could not load overview content.</p>`);
    }
}

// --- Start the application ---
main();
