/**
* --------------------------------------------------------------------
* Global Constants and Data Mapping
* --------------------------------------------------------------------
*/
const MIN_TAKT_TIME = 2.5;
const BUILD_RATIOS = { super: 0.35, ultra: 0.45, mega: 0.20 };
const ASSEMBLY_LINE_LENGTH = 486;
let isRecalculating = false;
let autoAdjustEnabled = true;

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
    setupUIEventListeners();
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

/**
* Halts all running `requestAnimationFrame` loops for the layout and
* schedule simulations.
*/
function stopAllSimulations() {
    if (animationState.layout.frameId) {
        cancelAnimationFrame(animationState.layout.frameId);
        animationState.layout.frameId = null;
        animationState.layout.isRunning = false;
    }
    if (animationState.schedule.frameId) {
        cancelAnimationFrame(animationState.schedule.frameId);
        animationState.schedule.frameId = null;
        animationState.schedule.isRunning = false;
    }
}

/**
* Animates a numeric value in a DOM element from a start to an end value.
* @param {HTMLElement} element - The DOM element to update.
* @param {number} start - The starting number.
* @param {number} end - The ending number.
* @param {number} [duration=1000] - The animation duration in milliseconds.
* @param {Function} [formatter] - A function to format the number for display.
*/
function animateValue(element, start, end, duration = 1000, formatter = (val) => val.toFixed(1)) {
    if (!element) return;
    if (element._animationId) {
        cancelAnimationFrame(element._animationId);
    }
    const startTime = Date.now();
    const range = end - start;

    function updateValue() {
        const now = Date.now();
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 4);
        const current = start + (range * easeProgress);
        element.textContent = formatter(current);
        if (progress < 1) {
            element._animationId = requestAnimationFrame(updateValue);
        } else {
            element._animationId = null;
        }
    }
    updateValue();
}

/**
* Parses a numeric value from an element's text content, ignoring
* currency symbols and other non-numeric characters.
* @param {HTMLElement} element - The DOM element to parse.
* @returns {number} The parsed numeric value.
*/
function parseElementValue(element) {
    if (!element || !element.textContent) return 0;
    const text = element.textContent;
    if (text.includes('$')) {
        const cleanedText = text.replace(/[$,]/g, '');
        const match = cleanedText.match(/-?\d+\.?\d*/);
        return match ? parseFloat(match[0]) : 0;
    }
    const match = text.match(/-?\d+\.?\d*/);
    return match ? parseFloat(match[0]) : 0;
}

/**
* Enhances a number or range input to allow value changes via
* middle-mouse-button drag, mouse wheel scroll, and Ctrl+Click to reset.
* @param {HTMLInputElement} input - The input element to enhance.
* @param {number} [step=1] - The step value for dragging.
* @param {number} [sensitivity=0.1] - The drag sensitivity.
*/
function enableMiddleDragNumberInput(input, step = 1, sensitivity = 0.1) {
    let isDragging = false;
    let startY, startValue;
    const defaultValues = {
        'dailyDemand': 180,
        'opHours': 15.0,
        'numEmployees': 8,
        'laborCost': 25.0,
        'superSell': 1250,
        'superCogs': 450,
        'ultraSell': 1500,
        'ultraCogs': 550,
        'megaSell': 1800,
        'megaCogs': 650
    };
    const getConstraints = () => {
        const min = input.hasAttribute('min') ? parseFloat(input.min) : -Infinity;
        const max = input.hasAttribute('max') ? parseFloat(input.max) : Infinity;
        const stepValue = parseFloat(input.step) || 1;
        return { min, max, step: stepValue };
    };
    input.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            startY = e.clientY;
            startValue = parseFloat(input.value) || 0;
            const onMouseMove = (ev) => {
                if (!isDragging) return;
                const deltaY = startY - ev.clientY;
                const constraints = getConstraints();
                let newVal = startValue + deltaY * sensitivity * step;
                newVal = Math.max(constraints.min, Math.min(constraints.max, newVal));
                if (input.type === 'range' || constraints.step === 1) {
                    input.value = Math.round(newVal).toString();
                } else if (constraints.step < 1) {
                    const decimals = Math.max(0, -Math.floor(Math.log10(constraints.step)));
                    input.value = newVal.toFixed(decimals);
                } else {
                    input.value = newVal.toFixed(2);
                }
                input.dispatchEvent(new Event("input", { bubbles: true }));
            };
            const onMouseUp = () => {
                isDragging = false;
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            };
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        }
    });
    input.addEventListener("wheel", (e) => {
        if (document.activeElement === input) {
            e.preventDefault();
            const constraints = getConstraints();
            const direction = e.deltaY > 0 ? -1 : 1;
            let currentValue = parseFloat(input.value) || 0;
            let newVal = currentValue + (direction * constraints.step);
            newVal = Math.max(constraints.min, Math.min(constraints.max, newVal));
            if (input.type === 'range' || constraints.step === 1) {
                input.value = Math.round(newVal).toString();
            } else if (constraints.step < 1) {
                const decimals = Math.max(0, -Math.floor(Math.log10(constraints.step)));
                input.value = newVal.toFixed(decimals);
            } else {
                input.value = newVal.toFixed(2);
            }
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
}

/**
* Restores the active tab from session storage on page load.
*/
function restoreActiveTab() {
    let targetTab = sessionStorage.getItem("activeTab");
    if (!targetTab) {
        targetTab = "overview";
        sessionStorage.setItem("activeTab", targetTab);
    }
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    if (btn) btn.classList.add("active");
    visPanels.forEach(panel => {
        panel.style.display = panel.id === `${targetTab}-panel` ? "block" : "none";
    });
    renderActiveTab();
}

/**
* Main UI update function. It recalculates metrics and updates all
* output displays and visualizations.
*/
function updateUI() {
    employeeCountDisplay.textContent = numEmployeesInput.value;
    renderWorkstationSidebar(parseInt(numEmployeesInput.value));
    setupDragAndDrop();

    if (invalidPrecedenceNodes.size > 0) {
        demandStatusEl.textContent = "Fails to Meet Precedence";
        demandStatusEl.className = "status failure";
        wipEl.textContent = '---';
        throughputEl.textContent = '---';
        conveyorSpeedEl.textContent = '---';
        productSpacingEl.textContent = '---';
        grossProfitEl.textContent = '---';
        profitMarginEl.textContent = '---';
        avgEfficiencyEl.textContent = '---';
        totalIdleTimeEl.textContent = '---';
        balanceDelayEl.textContent = '---';
        idleTimeCvEl.textContent = '---';
    } else {
        const opInputs = {
            dailyDemand: parseInt(dailyDemandInput.value),
            opHours: parseFloat(opHoursInput.value),
            numEmployees: parseInt(numEmployeesInput.value)
        };
        const finInputs = {
            laborCost: parseFloat(laborCostInput.value),
            superSell: parseFloat(superSellInput.value),
            superCogs: parseFloat(superCogsInput.value),
            ultraSell: parseFloat(ultraSellInput.value),
            ultraCogs: parseFloat(ultraCogsInput.value),
            megaSell: parseFloat(megaSellInput.value),
            megaCogs: parseFloat(megaCogsInput.value),
        };
        const results = calculateMetrics(opInputs, finInputs);
        if (results) {
            animateValue(wipEl, parseElementValue(wipEl), results.wip, 800, val => val.toFixed(1));
            animateValue(throughputEl, parseElementValue(throughputEl), results.throughputUnitsPerHour, 800, val => `${val.toFixed(1)}/hr`);
            animateValue(conveyorSpeedEl, parseElementValue(conveyorSpeedEl), results.conveyorSpeed, 800, val => `${val.toFixed(2)} ft/min`);
            animateValue(productSpacingEl, parseElementValue(productSpacingEl), results.productSpacing, 800, val => `${val.toFixed(2)} ft`);
            animateValue(grossProfitEl, parseElementValue(grossProfitEl), results.dailyGrossProfit, 800, val => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }));
            animateValue(profitMarginEl, parseElementValue(profitMarginEl), results.grossProfitMargin, 800, val => `${val.toFixed(1)}%`);
            animateValue(avgEfficiencyEl, parseElementValue(avgEfficiencyEl), results.averageEfficiency, 800, val => `${val.toFixed(1)}%`);
            animateValue(totalIdleTimeEl, parseElementValue(totalIdleTimeEl), results.totalIdleTime / 60, 800, val => `${val.toFixed(2)} hrs`);
            animateValue(balanceDelayEl, parseElementValue(balanceDelayEl), results.balanceDelay, 800, val => `${val.toFixed(1)}%`);
            animateValue(idleTimeCvEl, parseElementValue(idleTimeCvEl), results.idleTimeCv, 800, val => `${val.toFixed(1)}%`);
            demandStatusEl.textContent = results.meetsDemand ? "Meets Demand" : "Fails to Meet Demand";
            demandStatusEl.className = results.meetsDemand ? "status success" : "status failure";
        }
    }

    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'layout' || activeTab === 'schedule' || activeTab === 'efficiency' || activeTab === 'profit') {
        stopAllSimulations();
        if (activeTab === 'layout') LayoutTab.draw();
        if (activeTab === 'schedule') ScheduleTab.draw();
        if (activeTab === 'efficiency') EfficiencyTab.draw();
        if (activeTab === 'profit') ProfitTab.draw();
    }
}

/**
* Renders the left sidebar, displaying workstations and their assigned
* elements for a given employee configuration.
* @param {number} numEmployees - The number of employees/workstations.
*/
function renderWorkstationSidebar(numEmployees) {
    workstationList.innerHTML = '';
    const config = state.configData[numEmployees];
    if (!config || Object.keys(config).length === 0) return;

    const sortedStationIds = Object.keys(config).sort((a, b) => parseInt(a) - parseInt(b));
    const numWorkstations = sortedStationIds.length;

    let maxElementTime = 0;
    sortedStationIds.forEach(stationId => {
        config[stationId].forEach(taskId => {
            const task = state.taskData.get(taskId);
            if (task && task.elementTime > maxElementTime) {
                maxElementTime = task.elementTime;
            }
        });
    });
    if (maxElementTime === 0) return;

    sortedStationIds.forEach((stationId, stationIndex) => {
        const elementsInStation = config[stationId];
        const elementColorScale = generateElementColorScale(stationIndex, numWorkstations, elementsInStation.length);
        const workstationDiv = document.createElement('div');
        workstationDiv.className = 'workstation';

        const title = document.createElement('div');
        title.className = 'workstation-title';
        title.textContent = `Workstation ${stationId}`;
        workstationDiv.appendChild(title);

        const elementsContainer = document.createElement('div');
        elementsContainer.className = 'workstation-elements';
        elementsInStation.forEach((taskId, elementIndex) => {
            const task = state.taskData.get(taskId);
            if (task) {
                const elementColor = elementColorScale(elementIndex);
                const elementRow = document.createElement('div');
                elementRow.className = 'element-row';
                elementRow.title = `Element ${taskId}: ${task.description}`;
                elementRow.dataset.taskId = taskId;

                const barWrapper = document.createElement('div');
                barWrapper.className = 'element-bar-wrapper';

                const elementTimeBar = document.createElement('div');
                elementTimeBar.className = 'element-time-bar';
                const elementBarWidth = (task.elementTime / maxElementTime) * 80;
                elementTimeBar.style.width = `${elementBarWidth}%`;
                elementTimeBar.style.backgroundColor = getComputedStyle(root).getPropertyValue('--accent').trim();
                elementTimeBar.style.border = `3px solid ${elementColor}`;

                const laborTimeBar = document.createElement('div');
                laborTimeBar.className = 'labor-time-bar';
                laborTimeBar.style.backgroundColor = elementColor;
                const laborBarRatio = task.elementTime > 0 ? (task.laborTime / task.elementTime) : 0;
                laborTimeBar.style.transform = `scaleX(${laborBarRatio})`;

                if (task.elementTime > 2 * task.laborTime) {
                    const timeText = document.createElement('span');
                    timeText.className = 'element-time-text';
                    timeText.textContent = taskId;
                    elementTimeBar.appendChild(timeText);
                } else {
                    const laborText = document.createElement('span');
                    laborText.className = 'labor-bar-text';
                    laborText.textContent = taskId;
                    elementTimeBar.appendChild(laborText);
                }

                elementTimeBar.appendChild(laborTimeBar);
                barWrapper.appendChild(elementTimeBar);
                elementRow.appendChild(barWrapper);
                elementsContainer.appendChild(elementRow);
            }
        });
        workstationDiv.appendChild(elementsContainer);
        workstationList.appendChild(workstationDiv);
    });

    const firstTitle = workstationList.querySelector('.workstation-title');
    const svgContainer = document.getElementById('svg-container');
    if (firstTitle && svgContainer) {
        const svgTop = svgContainer.getBoundingClientRect().top;
        const titleTop = firstTitle.getBoundingClientRect().top;
        const currentPadding = parseFloat(getComputedStyle(workstationList).paddingTop) || 0;
        const offset = svgTop - titleTop;
        const newPadding = Math.max(0, currentPadding + offset);
        workstationList.style.paddingTop = `${newPadding}px`;
    }
}

/**
* Sets up event listeners for the main financial and operational input controls.
*/
/**
 * UI - Set listeners for the variable inputs.
 */
function setupEventListeners() {
    const inputs = [
        dailyDemandInput, opHoursInput, numEmployeesInput, laborCostInput,
        superSellInput, superCogsInput, ultraSellInput, ultraCogsInput,
        megaSellInput, megaCogsInput
    ];
    attachCommitBehavior(inputs, (id, value) => {
        handleInputChange(id);
    });
}

// UPDATE: Improved input commit behavior to reduce accidental commits
// - Focus clears visual contents but keeps committed value until commit
// - Commit on Enter, Escape (revert), Blur (with special empty handling)
function attachCommitBehavior(inputs, onCommit) {
    const timers = new WeakMap();
    const autoFlag = new WeakMap();

    // Clear all auto-commit flags on global mouseup (end of middle-drag)
    const clearAllAutoFlags = () => {
        inputs.forEach(inp => autoFlag.set(inp, false));
    };
    document.addEventListener('mouseup', clearAllAutoFlags);

    inputs.forEach(input => {
        if (!input) return;

        // Ensure we have a committed baseline value stored
        if (!input.dataset.committedValue) input.dataset.committedValue = input.value ?? '';

        autoFlag.set(input, false);
        input.dataset.awaitingInput = 'false';

        // When user focuses the field: show an empty box with cursor but keep committed value stored
        input.addEventListener('focus', (e) => {
            input.dataset.preFocusValue = input.dataset.committedValue ?? '';
            // Only clear visual contents if there's something to hide; leave range inputs alone
            if (input.type !== 'range') {
                // If the user already started typing (awaitingInput), don't clear again
                if (input.dataset.awaitingInput !== 'true') {
                    input.dataset.awaitingInput = 'true';
                    // Clear displayed value but do not overwrite committedValue
                    input.value = '';
                    // Keep cursor visible; for some browsers move caret to start
                    try { input.setSelectionRange(0, 0); } catch (_) { }
                }
            }
        });

        // Middle-button drag enables auto-commit behavior (scrub)
        input.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                autoFlag.set(input, true);
            }
        });

        // Debounced auto-commit, but only if middle-scrub is active
        input.addEventListener('input', () => {
            const prevTimer = timers.get(input);
            if (prevTimer) clearTimeout(prevTimer);

            // Immediate commit for range inputs (sliders) so they update instantly
            if (input.type === 'range') {
                commitInput(input, onCommit);
                input.dataset.awaitingInput = 'false';
                return;
            }

            // If middle-scrub is required for auto-commit, ignore otherwise
            if (!autoFlag.get(input)) {
                // Mark that user did type something (so blur won't restore)
                input.dataset.awaitingInput = 'true';
                return;
            }

            const t = setTimeout(() => {
                const current = (input.value || '').trim();
                const committed = (input.dataset.committedValue || '').trim();
                if (current !== committed) {
                    commitInput(input, onCommit);
                }
            }, 200);
            timers.set(input, t);
        });

        // Also commit on change as a safe fallback (e.g., some browsers fire change reliably)
        input.addEventListener('change', () => {
            const prevTimer = timers.get(input);
            if (prevTimer) clearTimeout(prevTimer);
            commitInput(input, onCommit);
            input.dataset.awaitingInput = 'false';
        });

        // Commit on Enter, revert on Escape (always active)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const prevTimer = timers.get(input);
                if (prevTimer) clearTimeout(prevTimer);
                commitInput(input, onCommit);
                input.dataset.awaitingInput = 'false';
                input.blur();
            } else if (e.key === 'Escape') {
                const prevTimer = timers.get(input);
                if (prevTimer) clearTimeout(prevTimer);
                // Restore previous committed value visually and cancel awaiting state
                input.value = input.dataset.committedValue ?? '';
                input.dataset.awaitingInput = 'false';
                input.blur();
            }
        });

        // Commit on blur (always active) with special behavior:
        // - If user focused and did not enter a new value (still empty), restore previous committed value
        // - Otherwise attempt to commit (commitInput will validate / clamp / persist)
        input.addEventListener('blur', () => {
            const prevTimer = timers.get(input);
            if (prevTimer) clearTimeout(prevTimer);

            const awaiting = input.dataset.awaitingInput === 'true';
            const text = (input.value || '').trim();

            if (awaiting && text === '') {
                // User focused but didn't type a new value → restore previous committed value
                input.value = input.dataset.committedValue ?? '';
                input.dataset.awaitingInput = 'false';
                // No commit callback needed because value didn't change
            } else {
                // Either user typed something, or this wasn't an "empty-until-typed" session → attempt commit
                commitInput(input, onCommit);
                input.dataset.awaitingInput = 'false';
            }
        });
    });

    // Add Ctrl+Click to reset functionality
    const defaultValues = {
        'dailyDemand': 180,
        'opHours': 15.0,
        'numEmployees': 8,
        'laborCost': 25.0,
        'superSell': 1250,
        'superCogs': 450,
        'ultraSell': 1500,
        'ultraCogs': 550,
        'megaSell': 1800,
        'megaCogs': 650
    };

    inputs.forEach(input => {
        if (!input) return;
        input.addEventListener("click", (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const defaultValue = defaultValues[input.id];
                if (defaultValue !== undefined) {
                    const min = input.hasAttribute('min') ? parseFloat(input.min) : -Infinity;
                    const max = input.hasAttribute('max') ? parseFloat(input.max) : Infinity;
                    const step = parseFloat(input.step) || 1;

                    input.value = Math.max(min, Math.min(max, defaultValue));
                    commitInput(input, onCommit); // This will now work correctly

                    input.style.backgroundColor = getComputedStyle(root).getPropertyValue('--primary').trim();
                    setTimeout(() => { input.style.backgroundColor = ''; }, 200);
                }
            }
        });
    });
}

function commitInput(input, onCommit) {
    const raw = (input.value || '').trim();
    if (raw === '') {
        // Revert to last committed to avoid propagating invalid/empty state
        input.value = input.dataset.committedValue ?? '';
        return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        input.value = input.dataset.committedValue ?? '';
        return;
    }
    const clamped = clampByField(input.id, n);
    input.value = String(clamped);
    input.dataset.committedValue = input.value;
    if (typeof onCommit === 'function') onCommit(input.id, clamped);
}

function clampByField(id, n) {
    switch (id) {
        case 'opHours':
            return Math.min(Math.max(n, 0), 24);
        case 'dailyDemand':
            return Math.max(0, Math.floor(n));
        case 'numEmployees':
            return Math.max(1, Math.floor(n));
        case 'laborCost':
            return Math.max(0, n);
        case 'superSell':
        case 'superCogs':
        case 'ultraSell':
        case 'ultraCogs':
        case 'megaSell':
        case 'megaCogs':
            return Math.max(0, n);
        default:
            return n;
    }
}

/**
* Sets up event listeners for general UI elements like sidebars and tabs.
*/
function setupUIEventListeners() {
    // --- Create the Auto-Adjust Toggle Switch ---
    const switchContainer = document.createElement('div');
    switchContainer.style.display = 'flex';
    switchContainer.style.alignItems = 'center';

    const switchText = document.createElement('span');
    switchText.textContent = 'Auto Adjust';
    switchText.style.marginRight = '8px';
    switchText.style.fontSize = '0.9em';

    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';

    const switchInput = document.createElement('input');
    switchInput.type = 'checkbox';
    switchInput.id = 'autoAdjustToggle';
    switchInput.checked = autoAdjustEnabled;

    const sliderSpan = document.createElement('span');
    sliderSpan.className = 'slider';

    switchLabel.append(switchInput, sliderSpan);
    switchContainer.append(switchText, switchLabel);

    switchInput.addEventListener('change', () => {
        autoAdjustEnabled = switchInput.checked;
    });

    // --- Position the Switch Next to the "Operational Inputs" Title ---
    // Note: This robustly finds the title above the 'dailyDemand' input.
    const demandInputContainer = dailyDemandInput.closest('.input-group, .form-group, div');
    if (demandInputContainer) {
        const operationalTitle = demandInputContainer.previousElementSibling;
        if (operationalTitle && (operationalTitle.tagName === 'H3' || operationalTitle.tagName === 'H4')) {
            const titleWrapper = document.createElement('div');
            titleWrapper.style.display = 'flex';
            titleWrapper.style.justifyContent = 'space-between';
            titleWrapper.style.alignItems = 'center';
            // Maintain original spacing by moving the title's margin to the wrapper
            titleWrapper.style.marginBottom = getComputedStyle(operationalTitle).marginBottom;
            operationalTitle.style.marginBottom = '0';

            // Replace the original title with the new wrapper
            operationalTitle.parentNode.insertBefore(titleWrapper, operationalTitle);

            // Move the title and the new switch group into the wrapper
            titleWrapper.appendChild(operationalTitle);
            titleWrapper.appendChild(switchContainer);
        } else {
            // Fallback if the title can't be found: place it at the top.
            rightSidebar.insertBefore(switchContainer, rightSidebar.firstChild);
        }
    }


    leftToggle.addEventListener('click', () => {
        const redrawOnTransitionEnd = () => {
            updateUI();
            document.getElementById('left-sidebar').removeEventListener('transitionend', redrawOnTransitionEnd);
        };
        document.getElementById('left-sidebar').addEventListener('transitionend', redrawOnTransitionEnd);
        document.getElementById('left-sidebar').classList.toggle('collapsed');
        const isCollapsed = document.getElementById('left-sidebar').classList.contains('collapsed');
        leftToggle.innerHTML = isCollapsed ? '&raquo;' : '&laquo;';
    });
    rightToggle.addEventListener('click', () => {
        const redrawOnTransitionEnd = () => {
            updateUI();
            document.getElementById('right-sidebar').removeEventListener('transitionend', redrawOnTransitionEnd);
        };
        document.getElementById('right-sidebar').addEventListener('transitionend', redrawOnTransitionEnd);
        document.getElementById('right-sidebar').classList.toggle('collapsed');
        const isCollapsed = document.getElementById('right-sidebar').classList.contains('collapsed');
        rightToggle.innerHTML = isCollapsed ? '&laquo;' : '&raquo;';
    });
    tabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            const targetTab = e.target.dataset.tab;
            const currentActive = tabs.querySelector('.active');
            if (currentActive && currentActive.dataset.tab === targetTab) {
                return;
            }
            sessionStorage.setItem("activeTab", targetTab);
            if (currentActive) currentActive.classList.remove('active');
            e.target.classList.add('active');
            visPanels.forEach(panel => {
                panel.style.display = panel.id === `${targetTab}-panel` ? 'block' : 'none';
            });
            workstationList.scrollTop = 0;
            stopAllSimulations();
            if (targetTab === 'precedence') {
                drawPrecedenceChart();
            } else {
                renderActiveTab();
            }
        }
    });
    workstationList.addEventListener('scroll', () => {
        const scrollTop = workstationList.scrollTop;
        const schedulePanel = document.getElementById('schedule-panel');
        const contentGroup = schedulePanel.querySelector('.schedule-content-group');
        if (contentGroup) {
            contentGroup.setAttribute('transform', `translate(0, ${-scrollTop})`);
        }
    });
}

/**
 * UI - Controls tab shift visibility
 */
function handleVisibilityChange() {
    if (document.hidden) {
        // Pause animations without resetting state
        if (animationState && animationState.schedule && animationState.schedule.isRunning) {
            animationState.schedule.isPaused = true;
        }
        if (animationState && animationState.layout && animationState.layout.isRunning) {
            animationState.layout.isPaused = true;
        }
    } else {
        // Resume animations; reset lastFrameTime to avoid jumps
        if (animationState && animationState.schedule && animationState.schedule.isPaused) {
            animationState.schedule.isPaused = false;
            animationState.schedule.lastFrameTime = performance.now();
        }
        if (animationState && animationState.layout && animationState.layout.isPaused) {
            animationState.layout.isPaused = false;
            animationState.layout.lastFrameTime = performance.now();
        }
    }
}

/**
* Sets up the event listener for browser tab visibility changes.
*/
function setupVisibilityListener() {
    document.addEventListener('visibilitychange', handleVisibilityChange, false);
}

/**
* Initializes Sortable.js for drag-and-drop functionality on workstations.
*/
function setupDragAndDrop() {
    sortableInstances.forEach(instance => instance.destroy());
    sortableInstances = [];
    const workstationElements = document.querySelectorAll('.workstation-elements');
    workstationElements.forEach(el => {
        const instance = new Sortable(el, {
            group: 'shared',
            animation: 150,
            onEnd: function (evt) {
                updateWorkstationOrder();
            }
        });
        sortableInstances.push(instance);
    });
}

/**
* Creates a new D3 tooltip element or returns an existing one.
* @param {string} className - The class name for the tooltip.
* @returns {d3.Selection} The D3 selection for the tooltip div.
*/
function createTooltip(className) {
    let tooltip = d3.select("body > .d3-tooltip");
    if (tooltip.empty()) {
        tooltip = d3.select("body").append("div")
            .attr("class", `d3-tooltip ${className || ''}`)
            .style("opacity", 0).style("position", "absolute");
    }
    return tooltip;
}

/**
* Creates a standardized SVG control button.
* @param {d3.Selection} parent - The parent G element to append the button to.
* @param {object} options - Configuration for the button.
* @returns {d3.Selection} The created button group selection.
*/
function createControlButton(parent, options) {
    const { className, text, transform = [0, 0] } = options;
    const btn = parent.append("g")
        .attr("class", className)
        .attr("transform", `translate(${transform[0]}, ${transform[1]})`)
        .style("cursor", "pointer");
    btn.append("rect")
        .attr("width", 28)
        .attr("height", 18)
        .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
        .attr("rx", 3);
    btn.append("text")
        .attr("x", 14)
        .attr("y", 13.5)
        .attr("text-anchor", "middle")
        .attr("fill", getComputedStyle(root).getPropertyValue('--secondary1').trim())
        .style("font-size", "14px")
        .text(text);
    return btn;
}

/**
* Generates a D3 color scale for elements within a single workstation.
* @param {number} workstationIndex - The index of the workstation.
* @param {number} numWorkstations - The total number of workstations.
* @param {number} numElements - The number of elements in this workstation.
* @returns {d3.ScaleLinear<string, string>} The D3 color scale.
*/
function generateElementColorScale(workstationIndex, numWorkstations, numElements) {
    const schemeColors = [
        getComputedStyle(root).getPropertyValue('--primary').trim(),
        getComputedStyle(root).getPropertyValue('--secondary1').trim(),
        getComputedStyle(root).getPropertyValue('--secondary2').trim(),
    ];
    const baseColor = d3.hcl(schemeColors[workstationIndex % schemeColors.length]);
    const startColor = baseColor.copy();
    startColor.l += 15;
    const endColor = baseColor.copy();
    endColor.l -= 15;
    return d3.scaleLinear()
        .domain([0, numElements > 1 ? numElements - 1 : 1])
        .range([startColor.toString(), endColor.toString()])
        .interpolate(d3.interpolateHcl);
}

/**
* --------------------------------------------------------------------
* Backend Logic & Calculations
*
* These functions handle core data processing, simulations, and
* business logic without directly manipulating the DOM.
* --------------------------------------------------------------------
*/

/**
* Handles changes from any of the main input controls, triggering
* recalculations and UI updates.
* @param {string} driverId - The ID of the input element that changed.
*/
function handleInputChange(driverId) {
    if (isRecalculating) return;
    isRecalculating = true;

    const isFinancialDriver = ['laborCost', 'superSell', 'superCogs', 'ultraSell', 'ultraCogs', 'megaSell', 'megaCogs'].includes(driverId);
    if (isFinancialDriver) {
        calculateOptimalProfitData();
    }

    try {
        let dailyDemand = parseInt(dailyDemandInput.value) || 1;
        let opHours = parseFloat(opHoursInput.value) || 1;
        let numEmployees = parseInt(numEmployeesInput.value);
        const isOperationalDriver = ['dailyDemand', 'opHours', 'numEmployees'].includes(driverId);

        if (isOperationalDriver) {
            workstationList.scrollTop = 0;
        }

        if (driverId === 'numEmployees') {
            state.configData[numEmployees] = JSON.parse(JSON.stringify(originalConfigData[numEmployees]));
        }

        if (isOperationalDriver && autoAdjustEnabled) {
            let currentBottleneck = calculateWorkstationDetails(numEmployees).bottleneckTime;
            if (currentBottleneck === 0) {
                console.error(`No valid workstation data for ${numEmployees} employees. Aborting.`);
                isRecalculating = false;
                return;
            }
            let taktTime = (opHours * 60) / dailyDemand;
            if (taktTime < currentBottleneck) {
                if (driverId === 'numEmployees') {
                    let requiredHours = (currentBottleneck * dailyDemand) / 60;
                    opHours = requiredHours <= 24 ? roundUpToQuarter(requiredHours) : 24;
                    if (requiredHours > 24) {
                        dailyDemand = Math.floor((24 * 60) / currentBottleneck);
                    }
                } else {
                    numEmployees = findBestEmployeeFit(taktTime, numEmployees);
                }
            }
            taktTime = (opHours * 60) / dailyDemand;
            if (taktTime < MIN_TAKT_TIME) {
                if (driverId === 'dailyDemand') {
                    opHours = roundUpToQuarter((MIN_TAKT_TIME * dailyDemand) / 60);
                    if (opHours > 24) opHours = 24;
                } else {
                    dailyDemand = Math.floor((opHours * 60) / MIN_TAKT_TIME);
                }
            }
        }

        dailyDemandInput.value = Math.round(dailyDemand);
        opHoursInput.value = opHours.toFixed(2);
        numEmployeesInput.value = numEmployees;

        updateUI();
    } catch (error) {
        console.error("Error during input handling:", error);
    } finally {
        isRecalculating = false;
    }
}

/**
* Calculates the cycle time for each workstation and identifies the
* line's bottleneck and fastest station times.
* @param {number} numEmployees - The number of employees/workstations in the config.
* @returns {{workstations: Array<object>, bottleneckTime: number, fastestTime: number}}
*/
function calculateWorkstationDetails(numEmployees) {
    const config = state.configData[numEmployees];
    if (!config || Object.keys(config).length === 0) return { workstations: [], bottleneckTime: 0, fastestTime: Infinity };

    let workstations = [],
        bottleneckTime = 0,
        fastestTime = Infinity;

    for (const stationId in config) {
        let totalLaborTime = 0;
        let totalElementTime = 0;

        config[stationId].forEach(taskId => {
            const task = state.taskData.get(taskId);
            if (task) {
                totalLaborTime += task.laborTime;
                totalElementTime += task.elementTime;
            }
        });

        const stationLength = totalElementTime * 15;
        workstations.push({ id: stationId, cycleTime: totalLaborTime, stationLength: stationLength });

        if (totalLaborTime > bottleneckTime) bottleneckTime = totalLaborTime;
        if (totalLaborTime < fastestTime && totalLaborTime > 0) fastestTime = totalLaborTime;
    }

    return { workstations, bottleneckTime, fastestTime };
}

/**
* Calculates all key performance indicators (KPIs) for the assembly line
* based on the current operational and financial inputs.
* @param {object} op - Operational inputs { dailyDemand, opHours, numEmployees }.
* @param {object} fin - Financial inputs { laborCost, ...sell/cogs prices }.
* @returns {object} An object containing all calculated metrics.
*/
function calculateMetrics(op, fin) {
    const wsDetails = calculateWorkstationDetails(op.numEmployees);
    const fullTotalOpMinutes = Math.floor(op.opHours * 4) * 15;
    const bottleneckCycleTime = wsDetails.bottleneckTime;
    const productSpacing = wsDetails.fastestTime === Infinity ? 0 : wsDetails.fastestTime * 15;

    if (productSpacing <= 0 || bottleneckCycleTime <= 0) {
        return {
            wip: 0, throughputUnitsPerHour: 0, conveyorSpeed: 0, productSpacing: 0, dailyGrossProfit: -(op.numEmployees * op.opHours * (fin.laborCost || 0)),
            grossProfitMargin: 0, meetsDemand: false, effectiveCycleTime: Infinity, workstations: wsDetails.workstations,
            averageEfficiency: 0, totalIdleTime: fullTotalOpMinutes * op.numEmployees, balanceDelay: 100, idleTimeCv: 0, throughputUnitsPerDay: 0
        };
    }

    let requiredTaktTime;
    const demandIntervals = op.dailyDemand > 1 ? op.dailyDemand - 1 : 0;
    const throughputTimeAsIntervals = ASSEMBLY_LINE_LENGTH / productSpacing;
    if (op.dailyDemand <= 1) {
        requiredTaktTime = Infinity;
    } else {
        const totalIntervals = demandIntervals + throughputTimeAsIntervals;
        requiredTaktTime = fullTotalOpMinutes / totalIntervals;
    }
    const meetsDemand = bottleneckCycleTime <= requiredTaktTime;
    const effectiveCycleTime = meetsDemand ? requiredTaktTime : bottleneckCycleTime;
    const cycleTimeToUseForSpeedCalc = isFinite(effectiveCycleTime) ? effectiveCycleTime : bottleneckCycleTime;
    const conveyorSpeed = productSpacing / cycleTimeToUseForSpeedCalc;
    const actualThroughputTime = (ASSEMBLY_LINE_LENGTH / productSpacing) * effectiveCycleTime;

    let throughputUnitsPerDay;
    if (fullTotalOpMinutes < actualThroughputTime) {
        throughputUnitsPerDay = 0;
    } else if (op.dailyDemand <= 1) {
        throughputUnitsPerDay = 1;
    } else {
        const launchWindowMinutes = fullTotalOpMinutes - actualThroughputTime;
        throughputUnitsPerDay = Math.floor(launchWindowMinutes / effectiveCycleTime) + 1;
    }

    const wip = ASSEMBLY_LINE_LENGTH / productSpacing;
    let actualProductionMinutes;
    if (op.dailyDemand <= 0) {
        actualProductionMinutes = 0;
    } else if (op.dailyDemand === 1) {
        actualProductionMinutes = actualThroughputTime;
    } else {
        actualProductionMinutes = effectiveCycleTime * (demandIntervals) + actualThroughputTime;
    }

    const throughputUnitsPerHour = actualProductionMinutes > 0 ? (op.dailyDemand / actualProductionMinutes) * 60 : 0;
    let totalWorkstationCycleTime = 0;
    wsDetails.workstations.forEach(ws => {
        totalWorkstationCycleTime += ws.cycleTime;
        ws.efficiency = bottleneckCycleTime > 0 ? (ws.cycleTime / bottleneckCycleTime) * 100 : 0;
        const idleTimePerCycle = bottleneckCycleTime - ws.cycleTime;
        ws.dailyIdleTime = idleTimePerCycle * throughputUnitsPerDay;
    });

    const totalAvailableTime = op.numEmployees * fullTotalOpMinutes;
    const totalDailyLaborCost = op.numEmployees * op.opHours * (fin.laborCost || 0);
    const totalProductiveTime = throughputUnitsPerDay * totalWorkstationCycleTime;
    const totalIdleTime = Math.max(0, totalAvailableTime - totalProductiveTime);
    const averageEfficiency = totalAvailableTime > 0 ? (totalProductiveTime / totalAvailableTime) * 100 : 0;

    const efficiencies = wsDetails.workstations.map(ws => ws.efficiency);
    const balanceActive = efficiencies.length > 0 ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length : 0;
    const balanceDelay = 100 - balanceActive;

    const idleTimesPerCycle = wsDetails.workstations.map(ws => bottleneckCycleTime - ws.cycleTime);
    const idleMean = idleTimesPerCycle.length > 0 ? idleTimesPerCycle.reduce((a, b) => a + b, 0) / idleTimesPerCycle.length : 0;
    const stdDev = Math.sqrt(idleTimesPerCycle.map(x => Math.pow(x - idleMean, 2)).reduce((a, b) => a + b, 0) / (idleTimesPerCycle.length || 1));
    const idleTimeCv = idleMean > 0 ? (stdDev / idleMean) * 100 : 0;

    const totalRevenue = throughputUnitsPerDay * ((BUILD_RATIOS.super * (fin.superSell || 0)) + (BUILD_RATIOS.ultra * (fin.ultraSell || 0)) + (BUILD_RATIOS.mega * (fin.megaSell || 0)));
    const totalCogs = throughputUnitsPerDay * ((BUILD_RATIOS.super * (fin.superCogs || 0)) + (BUILD_RATIOS.ultra * (fin.ultraCogs || 0)) + (BUILD_RATIOS.mega * (fin.megaCogs || 0)));
    const dailyGrossProfit = totalRevenue - totalCogs - totalDailyLaborCost;
    const grossProfitMargin = totalRevenue > 0 ? (dailyGrossProfit / totalRevenue) * 100 : 0;

    return {
        wip, throughputUnitsPerHour, conveyorSpeed, productSpacing, dailyGrossProfit,
        grossProfitMargin, meetsDemand, effectiveCycleTime, workstations: wsDetails.workstations,
        averageEfficiency, totalIdleTime, balanceDelay, idleTimeCv, throughputUnitsPerDay
    };
}

/**
* Finds the minimum number of employees required to meet a given takt time,
* starting the search from a given employee count.
* @param {number} requiredTaktTime - The target cycle time to meet.
* @param {number} startingCount - The number of employees to start searching from.
* @returns {number} The optimal number of employees.
*/
function findBestEmployeeFit(requiredTaktTime, startingCount) {
    for (let i = startingCount; i <= 13; i++) {
        if (calculateWorkstationDetails(i).bottleneckTime <= requiredTaktTime) return i;
    }
    return 13;
}

/**
* Updates the workstation configuration in the global state based on the
* current DOM structure after a drag-and-drop operation.
*/
function updateWorkstationOrder() {
    const numEmployees = parseInt(numEmployeesInput.value);
    const newConfig = {};

    document.querySelectorAll('.workstation').forEach(workstationDiv => {
        const title = workstationDiv.querySelector('.workstation-title').textContent;
        const stationMatch = title.match(/\d+/);
        if (stationMatch) {
            const stationId = stationMatch[0];
            const elements = [];
            workstationDiv.querySelectorAll('.element-row').forEach(elRow => {
                elements.push(parseInt(elRow.dataset.taskId));
            });
            newConfig[stationId] = elements;
        }
    });

    state.configData[numEmployees] = newConfig;
    const invalidPrecedenceMap = validatePrecedence();
    invalidPrecedenceNodes = new Set(Array.from(invalidPrecedenceMap.keys()));

    if (document.querySelector('.tab-btn[data-tab="precedence"].active')) {
        updatePrecedenceChart();
    }
    setTimeout(updateUI, 0);
}

/**
* Validates the current element order against the precedence map,
* adding error classes to invalid elements in the DOM.
* @returns {Set<number>} A set of task IDs that violate precedence rules.
*/
function validatePrecedence() {
    const seenTasks = new Set();
    const allElementRows = document.querySelectorAll('.element-row');
    const invalidNodes = new Set();

    allElementRows.forEach(row => {
        const taskId = parseInt(row.dataset.taskId);
        const predecessors = precedenceMap.get(taskId) || new Set();
        let isTaskValid = true;

        for (const pId of predecessors) {
            if (!seenTasks.has(pId)) {
                isTaskValid = false;
                break;
            }
        }

        if (!isTaskValid) {
            row.classList.add('precedence-error');
            invalidNodes.add(taskId);
        } else {
            row.classList.remove('precedence-error');
        }
        seenTasks.add(taskId);
    });

    return invalidNodes;
}

/**
* Generates a mixed-model production sequence based on daily demand
* using the Model-Mix Sequencing Algorithm (MSSA).
* @param {number} dailyDemand - The total number of units to produce.
* @returns {Array<number>} An array representing the production queue (1=Super, 2=Ultra, 3=Mega).
*/
function generateProductionQueue(dailyDemand) {
    const productionQueue = [];
    const modelRatios = Object.values(BUILD_RATIOS);
    let modelDemand = [];
    let sumOfDemands = 0;

    for (let i = 0; i < modelRatios.length - 1; i++) {
        const demand = Math.round(modelRatios[i] * dailyDemand);
        modelDemand.push(demand);
        sumOfDemands += demand;
    }
    modelDemand.push(dailyDemand - sumOfDemands);

    let totalDemand = dailyDemand;
    const wModel = modelDemand.map(d => (d > 0 ? totalDemand / d : Infinity));
    let aModel = wModel.map(w => w / 2);

    for (let j = 0; j < dailyDemand; j++) {
        let minIndex = -1;
        let minValue = Infinity;

        for (let k = 0; k < aModel.length; k++) {
            if (modelDemand[k] > 0 && aModel[k] < minValue) {
                minValue = aModel[k];
                minIndex = k;
            }
        }

        if (minIndex === -1) {
            break;
        }
        productionQueue.push(minIndex + 1);
        aModel[minIndex] += wModel[minIndex];
        modelDemand[minIndex]--;
    }
    return productionQueue;
}

/**
* Generates a unique key based on the current financial inputs
* for caching profit calculation results.
* @returns {string} The cache key.
*/
function getFinancialInputsKey() {
    const finInputs = {
        laborCost: parseFloat(laborCostInput.value),
        superSell: parseFloat(superSellInput.value),
        superCogs: parseFloat(superCogsInput.value),
        ultraSell: parseFloat(ultraSellInput.value),
        ultraCogs: parseFloat(ultraCogsInput.value),
        megaSell: parseFloat(megaSellInput.value),
        megaCogs: parseFloat(megaCogsInput.value),
    };
    return 'profitDataCache-v1-' + JSON.stringify(finInputs);
}

/**
* Checks for cached profit data in session storage. If found, loads it.
* Otherwise, triggers a new calculation.
*/
function runProfitCalculation() {
    const cacheKey = getFinancialInputsKey();
    try {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
            console.log("Loading profit data from session cache.");
            profitMaximizationCache = { key: cacheKey, data: JSON.parse(cachedData) };
            if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') {
                ProfitTab.draw();
            }
        } else {
            console.log("No valid cache found. Calculating optimal profit data for the first time.");
            calculateOptimalProfitData();
        }
    } catch (e) {
        console.error("Could not access session storage. Recalculating profit data.", e);
        calculateOptimalProfitData();
    }
}

/**
* Finds the most profitable and highest margin configuration for a single demand value.
* @param {number} demand - The daily demand to analyze.
* @param {object} finInputs - The financial inputs object.
* @param {Map<number, number>} maxDemandMap - A pre-calculated map of max demands per workstation.
* @returns {{profitResult: object, marginResult: object}} An object containing the results.
*/
function findOptimalConfigForDemand(demand, finInputs, maxDemandMap) {
    let maxProfit = -Infinity;
    let maxProfitConfig = { emp: 0, hrs: 0 };
    let maxMargin = -Infinity;
    let maxMarginConfig = { emp: 0, hrs: 0 };

    for (let numEmployees = 3; numEmployees <= 13; numEmployees++) {
        if (demand > (maxDemandMap.get(numEmployees) || 0)) {
            continue;
        }

        if (!originalConfigData[numEmployees] || Object.keys(originalConfigData[numEmployees]).length === 0) continue;

        const { bottleneckTime, fastestTime } = calculateWorkstationDetails(numEmployees);
        if (bottleneckTime <= 0 || !isFinite(fastestTime) || fastestTime <= 0) continue;

        const productSpacing = fastestTime * 15;
        const throughputTime = (ASSEMBLY_LINE_LENGTH / productSpacing) * bottleneckTime;
        const totalRequiredMinutes = (demand > 1 ? (demand - 1) * bottleneckTime : 0) + throughputTime;
        const minRequiredHours = totalRequiredMinutes / 60;

        if (minRequiredHours > 24) continue;

        const startHours = roundUpToQuarter(minRequiredHours);
        for (let opHours = startHours; opHours <= 24; opHours += 0.25) {
            const metrics = calculateMetrics({ dailyDemand: demand, opHours, numEmployees }, finInputs);

            if (metrics && metrics.throughputUnitsPerDay >= demand) {
                if (metrics.dailyGrossProfit > maxProfit) {
                    maxProfit = metrics.dailyGrossProfit;
                    maxProfitConfig = { emp: numEmployees, hrs: opHours };
                }
                if (metrics.grossProfitMargin > maxMargin) {
                    maxMargin = metrics.grossProfitMargin;
                    maxMarginConfig = { emp: numEmployees, hrs: opHours };
                }
                break;
            }
        }
    }

    const profitResult = { demand, value: isFinite(maxProfit) ? maxProfit : 0, config: maxProfitConfig };
    const marginResult = { demand, value: isFinite(maxMargin) ? maxMargin : 0, config: maxMarginConfig };

    return { profitResult, marginResult };
}

/**
 * Calculates the optimal profit for every demand level from 50 to 552 for the Profit Tab.
 */
async function calculateOptimalProfitData() {
    if (isProfitCalculating) return;
    isProfitCalculating = true;

    const finInputs = {
        laborCost: parseFloat(laborCostInput.value),
        superSell: parseFloat(superSellInput.value),
        superCogs: parseFloat(superCogsInput.value),
        ultraSell: parseFloat(ultraSellInput.value),
        ultraCogs: parseFloat(ultraCogsInput.value),
        megaSell: parseFloat(megaSellInput.value),
        megaCogs: parseFloat(megaCogsInput.value),
    };

    const key = getFinancialInputsKey() + '-demand50plus';
    if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') {
        ProfitTab.draw(); // Show loading state
    }

    setTimeout(() => {
        const profitData = [];
        const marginData = [];
        const originalStateConfig = JSON.parse(JSON.stringify(state.configData));

        try {
            state.configData = originalConfigData;
            const maxDemandMap = new Map(WORKSTATION_CAPACITIES.map(c => [c.ws, c.maxDemand]));

            for (let demand = 50; demand <= 552; demand++) {
                const { profitResult, marginResult } = findOptimalConfigForDemand(demand, finInputs, maxDemandMap);
                profitData.push(profitResult);
                marginData.push(marginResult);
            }

            const calculatedData = { profitData, marginData };
            profitMaximizationCache = { key, data: calculatedData };
            try {
                sessionStorage.setItem(key, JSON.stringify(calculatedData));
            } catch (e) {
                console.error("Could not save profit data to session storage.", e);
            }
        } finally {
            state.configData = originalStateConfig;
            isProfitCalculating = false;
            if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') {
                ProfitTab.draw();
            }
        }
    }, 200);
}

/**
* Checks if a specific assembly element is used in the construction
* of a given refrigerator model.
* @param {number} elementId - The ID of the assembly element.
* @param {number} modelId - The ID of the model (1=Super, 2=Ultra, 3=Mega).
* @returns {boolean} True if the element is used for the model.
*/
function doesElementBuildModel(elementId, modelId) {
    const task = state.taskData.get(elementId);
    if (!task) return false;
    const modelMap = { 1: 'Super', 2: 'Ultra', 3: 'Mega' };
    const modelFieldName = modelMap[modelId];
    return task[modelFieldName] > 0;
}

/**
* Runs a detailed simulation of the production day to generate task data
* for the Gantt chart visualization.
* @returns {{tasks: Array<object>}} An object containing the list of simulated tasks.
*/
function runGanttSimulation() {
    const numEmployees = parseInt(numEmployeesInput.value);
    const dailyDemand = parseInt(dailyDemandInput.value);
    const opHours = parseFloat(opHoursInput.value);
    const config = state.configData[numEmployees];

    if (!config || Object.keys(config).length === 0 || invalidPrecedenceNodes.size > 0) {
        return { tasks: [] };
    }

    const productionQueue = generateProductionQueue(dailyDemand);
    const metrics = calculateMetrics({ dailyDemand, opHours, numEmployees }, {});
    const launchInterval = metrics.effectiveCycleTime;
    const conveyorSpeed = metrics.conveyorSpeed;

    if (conveyorSpeed <= 0 || !isFinite(conveyorSpeed)) {
        return { tasks: [] };
    }

    let allFinishedTasks = [];
    let arrivalsForNextStation = productionQueue.map((modelId, index) => {
        let arrivalTime = index * launchInterval;
        if (index === 0 && isNaN(arrivalTime)) {
            arrivalTime = 0;
        }
        return {
            modelId: modelId,
            arrivalTime: arrivalTime,
            uniqueId: `${modelId}-${index}`
        };
    });

    const sortedWorkstationIds = Object.keys(config).sort((a, b) => parseInt(a) - parseInt(b));
    const totalElementTimeOfLine = sortedWorkstationIds.reduce((lineSum, stationId) => {
        const elements = config[stationId] || [];
        const stationTime = elements.reduce((stationSum, elId) => stationSum + (state.taskData.get(elId)?.elementTime || 0), 0);
        return lineSum + stationTime;
    }, 0);
    const totalPhysicalThroughputTime = ASSEMBLY_LINE_LENGTH / conveyorSpeed;

    for (const stationId of sortedWorkstationIds) {
        const elements = config[stationId] || [];
        if (elements.length === 0) continue;
        let workerFreeTime = 0;
        let processedModels = [];
        const totalElementTimeInStation = elements.reduce((sum, elId) => sum + (state.taskData.get(elId)?.elementTime || 0), 0);
        let travelTimeMinutes = 0;
        if (totalElementTimeOfLine > 0) {
            travelTimeMinutes = (totalElementTimeInStation / totalElementTimeOfLine) * totalPhysicalThroughputTime;
        }

        arrivalsForNextStation.sort((a, b) => a.arrivalTime - b.arrivalTime);

        for (const model of arrivalsForNextStation) {
            if (!isFinite(model.arrivalTime)) continue;
            const startProcessingTime = Math.max(model.arrivalTime, workerFreeTime);
            let currentTaskTime = startProcessingTime;

            for (const elementId of elements) {
                if (doesElementBuildModel(elementId, model.modelId)) {
                    const task = state.taskData.get(elementId);
                    if (task) {
                        const taskStartTime = currentTaskTime;
                        const taskEndTime = taskStartTime + task.elementTime;
                        allFinishedTasks.push({
                            workstationId: `WS ${stationId}`,
                            modelId: model.modelId,
                            taskId: elementId,
                            startTime: taskStartTime,
                            endTime: taskEndTime,
                            uniqueId: model.uniqueId
                        });
                        currentTaskTime = taskEndTime;
                    }
                }
            }
            const endProcessingTime = currentTaskTime;
            workerFreeTime = endProcessingTime;

            const endTravelTime = model.arrivalTime + travelTimeMinutes;
            const exitTime = Math.max(endProcessingTime, endTravelTime);

            processedModels.push({ ...model, arrivalTime: exitTime });
        }
        arrivalsForNextStation = processedModels;
    }

    return { tasks: allFinishedTasks };
}

/**
* Rounds a number up to the nearest quarter (0.25).
* @param {number} value - The number to round.
* @returns {number} The rounded number.
*/
function roundUpToQuarter(value) {
    return Math.ceil(value / 0.25) * 0.25;
}

/**
* --------------------------------------------------------------------
* Visualization Panels (Tabs)
*
* These functions are responsible for rendering the primary content
* for each of the main application tabs.
* --------------------------------------------------------------------
*/

/**
* @tab General
* Renders the content for the currently active visualization tab.
*/
function renderActiveTab() {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    if (activeTab === 'overview') drawOverviewPanel();
    else if (activeTab === 'precedence') drawPrecedenceChart();
    else if (activeTab === 'schedule') ScheduleTab.draw();
    else if (activeTab === 'efficiency') EfficiencyTab.draw();
    else if (activeTab === 'layout') LayoutTab.draw();
    else if (activeTab === 'profit') ProfitTab.draw();
    else if (activeTab === 'investment') drawInvestmentPanel();
}

/**
* @tab Overview
* Fetches and renders the content for the Overview panel.
*/
async function drawOverviewPanel() {
    const svg = d3.select("#overview-panel");
    svg.selectAll("*").remove();
    const fo = svg.append("foreignObject")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", "100%")
        .attr("height", "100%");
    const container = fo.append("xhtml:div")
        .attr("class", "overview-container");

    try {
        const response = await fetch('Pages/overview.html');
        if (!response.ok) {
            throw new Error(`Failed to load HTML: ${response.statusText}`);
        }
        let html = await response.text();

        const replacements = {
            'overview-num-employees': document.getElementById('numEmployees')?.value || '8',
            'overview-daily-demand': document.getElementById('dailyDemand')?.value || '180',
            'overview-op-hours': document.getElementById('opHours')?.value || '15',
            'overview-labor-cost': parseFloat(document.getElementById('laborCost')?.value || '25.00').toFixed(2)
        };

        for (const [id, value] of Object.entries(replacements)) {
            const regex = new RegExp(`(<span id="${id}">)(.*?)(<\\/span>)`);
            html = html.replace(regex, `$1${value}$3`);
        }

        container.html(html);
    } catch (error) {
        console.error("Could not render Overview panel:", error);
        container.html(`<p style="padding: 2rem; text-align: center;">Error: Could not load overview content.</p>`);
    }
}

// Run the application
main();