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

const majorCities = {
    "New York, NY": [-74.0060, 40.7128],
    "Los Angeles, CA": [-118.2437, 34.0522],
    "Chicago, IL": [-87.6298, 41.8781],
    "Houston, TX": [-95.3698, 29.7604],
    "Phoenix, AZ": [-112.0740, 33.4484],
    "Philadelphia, PA": [-75.1652, 39.9526],
    "San Antonio, TX": [-98.4936, 29.4241],
    "San Diego, CA": [-117.1611, 32.7157],
    "Dallas, TX": [-96.7970, 32.7767],
    "Columbus, OH": [-82.9988, 39.9612],
    "Charlotte, NC": [-80.8431, 35.2271],
    "Indianapolis, IN": [-86.1581, 39.7684],
    "Jacksonville, FL": [-81.6557, 30.3322],
    "San Francisco, CA": [-122.4194, 37.7749],
    "Seattle, WA": [-122.3321, 47.6062],
    "Denver, CO": [-104.9903, 39.7392],
    "Washington, D.C.": [-77.0369, 38.9072],
    "Boston, MA": [-71.0589, 42.3601],
    "Detroit, MI": [-83.0458, 42.3314],
    "Memphis, TN": [-90.0490, 35.1495],
    "Salt Lake City, UT": [-111.8910, 40.7608],
    "Las Vegas, NV": [-115.1398, 36.1699],
    "St. Louis, MO": [-90.1994, 38.6270],
    "Miami, FL": [-80.1918, 25.7617],
    "Atlanta, GA": [-84.3880, 33.7490]
};

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
    layout: { frameId: null, isRunning: false, isPaused: false, isManuallyPaused: false },
    schedule: { frameId: null, isRunning: false, isPaused: false, isManuallyPaused: false },
    speedo: { currentAngle: 0 }
};

/**
* Utility function to delay execution of a function until after a certain time
* has passed since the last time it was invoked.
* @param {Function} func - The function to debounce.
* @param {number} wait - The delay in milliseconds.
* @returns {Function} The debounced function.
*/
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const context = this;
        const later = function () {
            timeout = null;
            func.apply(context, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

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
* Injects custom CSS styles for the sidebars' and main panel's scrollbars.
*/
function injectCustomStyles() {
    const accentColor = getComputedStyle(root).getPropertyValue('--accent').trim();
    const primaryColor = getComputedStyle(root).getPropertyValue('--primary').trim();
    const style = document.createElement('style');
    style.textContent = `
/* Target sidebars and SVG area for Firefox */
#left-sidebar, #right-sidebar, #svg-container {
scrollbar-width: thin;
scrollbar-color: ${accentColor} transparent;
}
/* Target sidebars and SVG area for Webkit browsers (Chrome, Safari, etc.) */
#left-sidebar::-webkit-scrollbar, #right-sidebar::-webkit-scrollbar, #svg-container::-webkit-scrollbar {
width: 10px;
height: 10px;
}
#left-sidebar::-webkit-scrollbar-track, #right-sidebar::-webkit-scrollbar-track, #svg-container::-webkit-scrollbar-track {
background: transparent;
}
#left-sidebar::-webkit-scrollbar-thumb, #right-sidebar::-webkit-scrollbar-thumb, #svg-container::-webkit-scrollbar-thumb {
background-color: ${accentColor};
border-radius: 10px;
border: 2px solid transparent;
background-clip: content-box;
}
#left-sidebar::-webkit-scrollbar-thumb:hover, #right-sidebar::-webkit-scrollbar-thumb:hover, #svg-container::-webkit-scrollbar-thumb:hover {
background-color: ${primaryColor};
}
`;
    document.head.appendChild(style);
}

/**
* The main function to initialize the application.
*/
async function main() {
    injectCustomStyles();
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
    setWorkstationListHeight();
    document.querySelectorAll("input[type='number']").forEach(input => {
        enableMiddleDragNumberInput(input, 1, 1);
    });
    document.querySelectorAll("input[type='range']").forEach(input => {
        enableMiddleDragNumberInput(input, 1, 1);
    });
    try {
        wireRightSidebarTooltips();
    } catch (err) {
        console.error('Failed to attach right-sidebar tooltips:', err);
    }
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
* Parses a numeric value from an element's text content, ignoring
* currency symbols, units, and other non-numeric characters. Returns NaN if parsing fails.
* @param {HTMLElement} element - The DOM element to parse.
* @returns {number | NaN} The parsed numeric value or NaN.
*/
function parseElementValue(element) {
    // Check if element or textContent is null/undefined
    if (!element || typeof element.textContent !== 'string') {
        // console.warn("parseElementValue: Invalid element or textContent", element); // DEBUG
        return NaN;
    }
    const text = element.textContent.trim();
    // Handle specific non-numeric placeholders or empty strings
    if (text === '---' || text === '' || text === 'N/A' || text === 'No Return' || text === 'Net Loss') {
        // console.log(`parseElementValue: Handling placeholder "${text}" -> NaN`); // DEBUG
        return NaN;
    }

    let cleanedText;
    // Handle currency and potential parentheses for negatives first
    // Regex allows leading/trailing whitespace around symbols which trim() handles
    if (text.includes('$') || text.includes('(')) {
        cleanedText = text.replace(/[$,]/g, ''); // Remove $ and commas
        // Handle accounting negative format (123.45) -> -123.45
        if (cleanedText.startsWith('(') && cleanedText.endsWith(')')) {
            cleanedText = '-' + cleanedText.substring(1, cleanedText.length - 1);
        }
    } else {
        // Handle units typically found at the end of the string
        // Added 'Days'/'Day' and specific Efficiency tab units
        cleanedText = text.replace(/%|\/hr| ft\/min| ft| hrs$| h$| Days$| Day$/g, '').trim();
    }

    // After cleaning, check if it looks like a number (allows optional -, digits, optional decimal)
    // Allows scientific notation like 1.23e-4
    if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleanedText)) {
        // console.warn(`parseElementValue: Cleaned text "${cleanedText}" from "${text}" is not a valid number format.`); // DEBUG
        return NaN;
    }

    const parsed = parseFloat(cleanedText);

    // Final check if parseFloat resulted in a valid number (e.g., handles "Infinity")
    if (typeof parsed !== 'number' || !isFinite(parsed)) {
        // console.warn(`parseElementValue: parseFloat resulted in NaN/Infinity for "${cleanedText}" from "${text}".`); // DEBUG
        return NaN;
    }

    // console.log(`Parsing: "${text}" -> "${cleanedText}" -> ${parsed}`); // DEBUG
    return parsed;
}


/**
* Animates a numeric value in a DOM element from its previously stored value
* (or current parsed value if none stored) to an end value. Stores the end value
* for the next animation. Handles potential NaN inputs gracefully.
* @param {HTMLElement} element - The DOM element to update.
* @param {number} end - The target ending number. MUST be a valid, finite number.
* @param {number} [duration=1000] - The animation duration in milliseconds.
* @param {Function} [formatter] - A function to format the number for display.
*/
function animateValue(element, end, duration = 1000, formatter = (val) => val.toFixed(1)) {
    if (!element) {
        console.warn("animateValue called with null or undefined element.");
        return;
    }
    // --- Validate End Value ---
    // CRITICAL: Ensure 'end' is a valid, finite number before proceeding.
    // If not, log an error and potentially stop to avoid propagating NaN.
    if (typeof end !== 'number' || !isFinite(end)) {
        console.error(`animateValue received invalid 'end' value: ${end}. Cannot animate. Element:`, element, "Current text:", element.textContent);
        // Set a default state like '---' or 0 and store a valid fallback
        element.textContent = formatter(0); // Or perhaps '---'
        element._previousNumericValue = 0;
        return;
    }
    const validEnd = end; // Use the validated 'end' value

    // --- Determine Start Value ---
    let start;
    // 1. Try the stored value
    if (typeof element._previousNumericValue === 'number' && isFinite(element._previousNumericValue)) {
        start = element._previousNumericValue;
    } else {
        // 2. Try parsing the current text content
        start = parseElementValue(element);
        // 3. If parsing fails (returns NaN), fallback to the TARGET value (snap effect)
        if (typeof start !== 'number' || !isFinite(start)) {
            // console.warn(`Parsing failed for start value, snapping to end value ${validEnd}. Element:`, element, "Current text:", element.textContent); // DEBUG
            start = validEnd; // Use the target value directly
        }
    }

    // Store the VALID end value immediately. This ensures the *next* animation starts correctly.
    element._previousNumericValue = validEnd;

    // --- Animation Handling ---
    if (element._animationId) {
        cancelAnimationFrame(element._animationId);
        element._animationId = null;
    }

    // If duration is 0, start equals end, or if we snapped start to end, set final value immediately.
    if (duration <= 0 || Math.abs(validEnd - start) < 1e-6) {
        element.textContent = formatter(validEnd);
        // console.log(`Set immediate: ${formatter(validEnd)}`, element); // DEBUG
        return; // No animation needed
    }

    // --- Animation Logic ---
    const startTime = performance.now(); // Use performance.now() for higher precision
    const range = validEnd - start;
    // console.log(`Animating from ${start} to ${validEnd} over ${duration}ms`, element); // DEBUG

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = 1 - Math.pow(1 - progress, 4); // easeOutQuart
        const current = start + (range * easedProgress);

        element.textContent = formatter(current);

        if (progress < 1) {
            element._animationId = requestAnimationFrame(step);
        } else {
            // Animation finished: Ensure final value is exact and clear ID
            element.textContent = formatter(validEnd);
            element._animationId = null;
            // _previousNumericValue is already set
            // console.log(`Animation finished: ${formatter(validEnd)}`, element); // DEBUG
        }
    }
    element._animationId = requestAnimationFrame(step);
}

/**
 * Updates the right-sidebar Financial Metrics (NPV, IRR, Payback) using the
 * same animateValue helper and formatting used elsewhere. Accepts an object
 * with numeric values: { npv, irr, payback } where irr is decimal (e.g. 0.12)
 * and payback is in years (fractional).
 */
function updateFinancialSidebar({ npv, irr, payback } = {}) {
    try {
        const npvEl = document.getElementById('npvMetric');
        const irrEl = document.getElementById('irrMetric');
        const paybackEl = document.getElementById('paybackMetric');

        const npvVal = isFinite(npv) ? npv : 0;
        const irrIsValid = !isNaN(irr) && isFinite(irr);
        const irrPercent = irrIsValid ? (irr * 100) : NaN;
        const paybackIsFinite = isFinite(payback);
        const paybackDays = paybackIsFinite ? Math.ceil(payback * 365.2425) : NaN;

        const getStartNumber = (el) => {
            if (!el) return 0;
            if (typeof parseElementValue === 'function') return parseElementValue(el) || 0;
            const txt = (el.textContent || '').replace(/[$,]|\s|Days|Day|%/gi, '');
            return parseFloat(txt) || 0;
        };

        const startNpv = getStartNumber(npvEl);
        const startIrr = getStartNumber(irrEl);
        const startPayback = getStartNumber(paybackEl);

        const hasAnimator = (typeof animateValue === 'function');

        if (npvEl) {
            if (hasAnimator && isFinite(npvVal) && startNpv !== npvVal) {
                animateValue(npvEl, startNpv, npvVal, 800, val => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
            } else {
                npvEl.textContent = npvVal.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
            }
        }

        if (irrEl) {
            if (irrIsValid) {
                if (hasAnimator && startIrr !== irrPercent) {
                    animateValue(irrEl, startIrr, irrPercent, 800, val => `${val.toFixed(1)}%`);
                } else {
                    irrEl.textContent = `${(irr * 100).toFixed(1)}%`;
                }
            } else {
                irrEl.textContent = 'No Return';
            }
        }

        if (paybackEl) {
            if (paybackIsFinite) {
                if (hasAnimator && startPayback !== paybackDays) {
                    animateValue(paybackEl, startPayback, paybackDays, 800, val => `${Math.round(val)} Days`);
                } else {
                    paybackEl.textContent = `${paybackDays} Days`;
                }
            } else {
                paybackEl.textContent = 'Net Loss';
            }
        }
    } catch (err) {
        console.error('updateFinancialSidebar failed:', err);
    }
}

if (typeof window !== 'undefined') window.updateFinancialSidebar = updateFinancialSidebar;

/**
* Enhances a number or range input to allow value changes via
* middle-mouse-button drag, mouse wheel scroll, and Ctrl+Click to reset.
* @param {HTMLInputElement} input - The input element to enhance.
* @param {number} [step=1] - The step value for dragging.
* @param {number} [sensitivity=0.1] - The drag sensitivity.
*/
function enableMiddleDragNumberInput(input, step = 1, sensitivity = 0.1) {
    let isDragging = false;
    let startY = 0;
    let startValue = 0;

    const getConstraints = () => {
        const min = input.hasAttribute('min') ? parseFloat(input.min) : -Infinity;
        const max = input.hasAttribute('max') ? parseFloat(input.max) : Infinity;
        const stepValue = input.id === 'opHours' ? 0.25 : (parseFloat(input.step) || 1);
        return { min, max, step: stepValue };
    };

    const countDecimals = (n) => {
        if (!isFinite(n)) return 0;
        const s = String(n);
        if (s.indexOf('e-') > -1) {
            const match = s.match(/e-(\d+)$/);
            return match ? parseInt(match[1], 10) : 0;
        }
        const parts = s.split('.');
        return parts[1] ? parts[1].length : 0;
    };

    const formatValue = (val, stepVal) => {
        if (!isFinite(val)) return '';
        const decimals = Math.max(0, countDecimals(stepVal));
        return Number(val).toFixed(decimals);
    };

    const parseDisplayedNumber = (v) => {
        if (v === null || v === undefined) return 0;
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        let s = String(v).trim();
        if (s === '') return 0;
        s = s.replace(/\(([^)]+)\)/, '-$1');
        s = s.replace(/[^0-9eE+\-\.]/g, '');
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : 0;
    };

    input.addEventListener("pointerdown", (e) => {
        if (e.pointerType === 'mouse' && e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            startY = e.clientY;
            startValue = parseDisplayedNumber(input.value || input.dataset.committedValue || 0);
            try { console.debug && console.debug('pointerdown startValue=', startValue, 'id=', input.id); } catch (err) { }

            const onPointerMove = (ev) => {
                if (!isDragging) return;
                const deltaY = startY - ev.clientY;
                const constraints = getConstraints();
                const deltaSteps = Math.round(deltaY * sensitivity);
                let newVal = startValue + (deltaSteps * constraints.step);
                newVal = Math.max(constraints.min, Math.min(constraints.max, newVal));
                try {
                    try { console.debug && console.debug('pointermove deltaSteps=', deltaSteps, 'newValRaw=', newVal); } catch (err) { }
                    if (input && input.dataset && input.dataset.type === 'currency') {
                        const decimals = Math.max(0, countDecimals(constraints.step));
                        input.value = Number(newVal).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
                    } else {
                        input.value = formatValue(newVal, constraints.step);
                    }
                    try { console.debug && console.debug('pointermove applied value=', input.value, 'id=', input.id); } catch (err) { }
                } catch (e) {
                    input.value = formatValue(newVal, constraints.step);
                }
                input.dispatchEvent(new Event("input", { bubbles: true }));
            };

            const onPointerUp = () => {
                isDragging = false;
                document.removeEventListener("pointermove", onPointerMove);
                document.removeEventListener("pointerup", onPointerUp);
            };

            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", onPointerUp);
        }
    });

    input.addEventListener("wheel", (e) => {
        if (document.activeElement === input) {
            e.preventDefault();
            const constraints = getConstraints();
            const direction = e.deltaY > 0 ? -1 : 1;
            let currentValue = parseDisplayedNumber(input.value || input.dataset.committedValue || 0);
            try { console.debug && console.debug('wheel currentValue=', currentValue, 'id=', input.id, 'deltaY=', e.deltaY); } catch (err) { }
            let newVal = currentValue + (direction * constraints.step);
            newVal = Math.max(constraints.min, Math.min(constraints.max, newVal));
            try {
                if (input && input.dataset && input.dataset.type === 'currency') {
                    const decimals = Math.max(0, countDecimals(constraints.step));
                    input.value = Number(newVal).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
                } else {
                    input.value = formatValue(newVal, constraints.step);
                }
                try { console.debug && console.debug('wheel applied value=', input.value, 'id=', input.id); } catch (err) { }
            } catch (err) {
                input.value = formatValue(newVal, constraints.step);
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
* output displays and visualizations. Now correctly redraws the active tab.
*/
function updateUI(options = {}) {
    // --- Update Top-Level Displays ---
    employeeCountDisplay.textContent = numEmployeesInput.value;

    // --- Render Sidebar & Drag-Drop ---
    // These need to run on most updates as data/structure might change
    renderWorkstationSidebar(parseInt(numEmployeesInput.value));
    setupDragAndDrop(); // Re-initialize sortable after sidebar redraw

    // --- Precedence Validation ---
    // Skip only if explicitly told (e.g., during drag/drop update)
    if (!options.skipPrecedence) {
        invalidPrecedenceNodes = validatePrecedence();
    }

    // --- Calculate Metrics & Update Right Sidebar ---
    // This part runs regardless of the active tab
    if (invalidPrecedenceNodes.size > 0) {
        // Display precedence error state
        demandStatusEl.textContent = "Fails to Meet Precedence";
        demandStatusEl.className = "status failure";
        // Clear or show placeholder values for metrics
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
        // Clear financial sidebar if precedence fails
        if (typeof updateFinancialSidebar === 'function') {
            updateFinancialSidebar({ npv: NaN, irr: NaN, payback: NaN });
        }

    } else {
        // Calculate metrics if precedence is valid
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
            // Animate metric updates
            animateValue(wipEl, results.wip, 800, val => val.toFixed(1));
            animateValue(throughputEl, results.throughputUnitsPerHour, 800, val => `${val.toFixed(1)}/hr`);
            animateValue(conveyorSpeedEl, results.conveyorSpeed, 800, val => `${val.toFixed(2)} ft/min`);
            animateValue(productSpacingEl, results.productSpacing, 800, val => `${val.toFixed(2)} ft`);
            animateValue(grossProfitEl, results.dailyGrossProfit, 800, val => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }));
            animateValue(profitMarginEl, results.grossProfitMargin, 800, val => `${val.toFixed(1)}%`);
            animateValue(avgEfficiencyEl, results.averageEfficiency, 800, val => `${val.toFixed(1)}%`);
            animateValue(totalIdleTimeEl, results.totalIdleTime / 60, 800, val => `${val.toFixed(2)} hrs`);
            animateValue(balanceDelayEl, results.balanceDelay, 800, val => `${val.toFixed(1)}%`);
            animateValue(idleTimeCvEl, results.idleTimeCv, 800, val => `${val.toFixed(1)}%`);

            // Update demand status text and class
            const idleHoursTotal = (results.totalIdleTime || 0) / 60;
            const idleHoursPerEmployee = (opInputs.numEmployees > 0) ? idleHoursTotal / opInputs.numEmployees : idleHoursTotal;

            if (results.meetsDemand && idleHoursPerEmployee > 12) {
                demandStatusEl.textContent = "Too Much Idle Time";
                demandStatusEl.className = "status failure";
            } else {
                demandStatusEl.textContent = results.meetsDemand ? "Meets Demand" : "Fails to Meet Demand";
                demandStatusEl.className = results.meetsDemand ? "status success" : "status failure";
            }
        } else {
            // Handle case where calculateMetrics returns null/undefined
            console.error("calculateMetrics returned invalid results.");
            // Show error state for metrics
            // ... (similar to precedence error state) ...
        }
    }

    // --- Update the ACTIVE Visualization ---
    // This section now correctly triggers redraw/update for the current tab
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;

    try {
        stopAllSimulations(); // Stop simulations before redrawing

        // Use a switch statement for clarity and safety
        switch (activeTab) {
            case 'overview':
                // Overview might need updating if its content depends on inputs
                if (typeof drawOverviewPanel === 'function') {
                    drawOverviewPanel();
                }
                break;
            case 'precedence':
                // PrecedenceTab has a specific 'update' method for efficiency
                if (!options.skipPrecedence && typeof PrecedenceTab !== 'undefined' && PrecedenceTab.update) {
                    PrecedenceTab.update(invalidPrecedenceNodes);
                } else if (!options.skipPrecedence) {
                    console.warn("PrecedenceTab.update not found or skipped.");
                    // Optionally call drawPrecedenceChart() as a fallback if update isn't available
                    // if (typeof drawPrecedenceChart === 'function') drawPrecedenceChart();
                }
                break;
            case 'layout':
                if (typeof LayoutTab !== 'undefined' && LayoutTab.draw) {
                    LayoutTab.draw();
                } else {
                    console.warn("LayoutTab.draw not found.");
                }
                break;
            case 'schedule':
                if (typeof ScheduleTab !== 'undefined' && ScheduleTab.draw) {
                    ScheduleTab.draw();
                } else {
                    console.warn("ScheduleTab.draw not found.");
                }
                break;
            case 'efficiency':
                if (typeof EfficiencyTab !== 'undefined' && EfficiencyTab.draw) {
                    // Call draw for efficiency as it recalculates and redraws everything
                    EfficiencyTab.draw();
                } else {
                    console.warn("EfficiencyTab.draw not found.");
                }
                break;
            case 'profit':
                // Profit tab might need a redraw if financial inputs changed
                // calculateOptimalProfitData is already called if needed in handleInputChange
                if (typeof ProfitTab !== 'undefined' && ProfitTab.draw) {
                    ProfitTab.draw();
                } else {
                    console.warn("ProfitTab.draw not found.");
                }
                break;
            case 'investment':
                // Investment panel likely needs redraw if inputs change
                if (typeof drawInvestmentPanel === 'function') {
                    drawInvestmentPanel();
                }
                break;
            case 'location':
                if (typeof LocationTab !== 'undefined' && LocationTab.draw) {
                    LocationTab.draw();
                } else {
                    console.warn("LocationTab.draw not found.");
                }
                break;
            default:
                // No specific update action needed for unknown or unhandled tabs
                console.log(`No specific update action defined for active tab: ${activeTab}`);
                break;
        }
    } catch (err) {
        console.error(`Error updating active tab (${activeTab}):`, err);
    }

    // --- Final Adjustments ---
    setWorkstationListHeight(); // Adjust height after potential redraw
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

    const accentColor = getComputedStyle(root).getPropertyValue('--accent').trim();

    const tooltip = createTooltip('workstation-tooltip');
    tooltip.style('pointer-events', 'none').style('z-index', 9999);

    sortedStationIds.forEach((stationId, stationIndex) => {
        const elementsInStation = config[stationId];
        const elementColorScale = generateElementColorScale(stationIndex, numWorkstations, elementsInStation.length);
        const workstationDiv = document.createElement('div');
        workstationDiv.className = 'workstation';

        const title = document.createElement('div');
        title.className = 'workstation-title';
        const stationTotalElementTime = elementsInStation.reduce((s, tId) => s + (state.taskData.get(tId)?.elementTime || 0), 0);
        const stationLengthFt = stationTotalElementTime * 15;
        title.textContent = `Workstation ${stationId} — ${stationLengthFt.toFixed(1)} ft`;
        workstationDiv.appendChild(title);

        const elementsContainer = document.createElement('div');
        elementsContainer.className = 'workstation-elements';
        elementsInStation.forEach((taskId, elementIndex) => {
            const task = state.taskData.get(taskId);
            if (task) {
                const elementColor = elementColorScale(elementIndex);
                const elementRow = document.createElement('div');
                elementRow.className = 'element-row';
                elementRow.dataset.taskId = taskId;

                const barWrapper = document.createElement('div');
                barWrapper.className = 'element-bar-wrapper';

                const elementTimeBar = document.createElement('div');
                elementTimeBar.className = 'element-time-bar';
                const elementBarWidth = (task.elementTime / maxElementTime) * 80;
                elementTimeBar.style.width = `${elementBarWidth}%`;
                elementTimeBar.style.backgroundColor = accentColor;
                elementTimeBar.style.border = `2px solid ${accentColor}`;
                elementTimeBar.style.borderRadius = '4px';

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
                elementRow.dataset.workstationId = stationId;
                elementRow.dataset.workstationLengthFt = stationLengthFt.toFixed(1);
                elementsContainer.appendChild(elementRow);
            }
        });
        workstationDiv.appendChild(elementsContainer);
        workstationList.appendChild(workstationDiv);
    });

    if (!workstationList._hasTooltipDelegation) {
        let activeRow = null;

        const buildTooltipHtmlForTask = (task, opts = {}) => {
            if (!task) return '';
            const desc = task.description ? `<div class="tt-desc">${task.description}</div>` : '';
            const et = isFinite(task.elementTime) ? task.elementTime.toFixed(2) : '—';
            const lt = isFinite(task.laborTime) ? task.laborTime.toFixed(2) : '—';
            const elLenFt = isFinite(task.elementTime) ? (task.elementTime * 15).toFixed(1) : null;
            const elLenRow = elLenFt != null ? `<div class="tooltip-row"><span class="tooltip-key">Element Length</span><span>${elLenFt} ft</span></div>` : '';
            const wsId = opts.wsId || task._workstationId || '';
            const wsLen = opts.wsLen != null ? opts.wsLen : (task._workstationLengthFt != null ? task._workstationLengthFt : null);
            const wsRow = wsLen != null ? `<div class="tooltip-row"><span class="tooltip-key">Workstation Length</span><span>${wsLen} ft</span></div>` : '';
            const wsIdRow = wsId ? `<div class="tooltip-row"><span class="tooltip-key">Workstation</span><span>${wsId}</span></div>` : '';
            return `<div class="tt-title">Element ${task._id || ''}</div>${desc}${wsIdRow}${wsRow}${elLenRow}<div class="tt-stats">Element: ${et} min &nbsp;|&nbsp; Labor: ${lt} min</div>`;
        };

        workstationList.addEventListener('pointerover', (e) => {
            const row = e.target.closest?.('.element-row');
            if (!row || !workstationList.contains(row)) return;
            activeRow = row;
            const taskId = parseInt(row.dataset.taskId);
            const task = state.taskData.get(taskId);
            if (!task) return;
            task._id = taskId;
            task._workstationId = row.dataset.workstationId || '';
            task._workstationLengthFt = row.dataset.workstationLengthFt != null ? row.dataset.workstationLengthFt : null;
            tooltip.html(buildTooltipHtmlForTask(task, { wsId: task._workstationId, wsLen: task._workstationLengthFt }))
                .style('opacity', 1)
                .style('left', `${e.pageX + 12}px`)
                .style('top', `${e.pageY + 12}px`);
        });

        workstationList.addEventListener('pointermove', (e) => {
            if (!activeRow) return;
            const rowUnderPointer = e.target.closest?.('.element-row');
            if (rowUnderPointer !== activeRow) return;
            tooltip.style('left', `${e.pageX + 12}px`)
                .style('top', `${e.pageY + 12}px`);
        });

        workstationList.addEventListener('pointerout', (e) => {
            const fromRow = e.target.closest?.('.element-row');
            const toEl = e.relatedTarget;
            if (fromRow && (!toEl || !fromRow.contains(toEl))) {
                activeRow = null;
                tooltip.style('opacity', 0);
            }
        });

        workstationList._hasTooltipDelegation = true;
    }

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

function attachCommitBehavior(inputs, onCommit) {
    const timers = new WeakMap();
    const autoFlag = new WeakMap();

    const clearAllAutoFlags = () => {
        inputs.forEach(inp => autoFlag.set(inp, false));
    };
    document.addEventListener('mouseup', clearAllAutoFlags);

    let lastPointerEnterTime = 0;
    const lastPointerDown = new WeakMap();

    inputs.forEach(input => {
        if (!input) return;

        if (!input.dataset.committedValue) input.dataset.committedValue = input.value ?? '';

        autoFlag.set(input, false);
        input.dataset.awaitingInput = 'false';

        input.addEventListener('pointerenter', () => {
            lastPointerEnterTime = Date.now();
            input._hovering = true;
        });
        input.addEventListener('pointerleave', () => {
            input._hovering = false;
        });

        input.addEventListener('pointerdown', (ev) => {
            const rect = input.getBoundingClientRect();
            const inSpinnerArea = (ev.clientX >= rect.right - 32);
            lastPointerDown.set(input, { time: Date.now(), inSpinnerArea });
            if (ev.button === 1) {
                autoFlag.set(input, true);
            }
        });

        input.addEventListener('focus', (focusEv) => {
            input.dataset.preFocusValue = input.dataset.committedValue ?? '';

            if (input.type === 'range') return;

            const now = Date.now();
            const pd = lastPointerDown.get(input);
            const pointerDownRecent = pd && (now - pd.time < 300);
            const clickedOnSpinner = pointerDownRecent && pd.inSpinnerArea;

            const shouldClearForTyping = !clickedOnSpinner;

            if (shouldClearForTyping) {
                input.dataset.awaitingInput = 'true';
                input.value = '';
                try {
                    if (typeof input.select === 'function') input.select();
                    else input.setSelectionRange(0, 0);
                } catch (_) { }
            } else {
                if (input.dataset.awaitingInput !== 'true') {
                    input.dataset.awaitingInput = 'true';
                    input.value = input.dataset.committedValue ?? input.value ?? '';
                    try {
                        if (typeof input.select === 'function') input.select();
                        else input.setSelectionRange(0, input.value.length);
                    } catch (_) { }
                }
            }
        });

        input.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                autoFlag.set(input, true);
            }
        });

        input.addEventListener('input', () => {
            const prevTimer = timers.get(input);
            if (prevTimer) clearTimeout(prevTimer);

            if (input.type === 'range') {
                commitInput(input, onCommit);
                input.dataset.awaitingInput = 'false';
                return;
            }

            if (!autoFlag.get(input)) {
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

        input.addEventListener('change', () => {
            const prevTimer = timers.get(input);
            if (prevTimer) clearTimeout(prevTimer);
            commitInput(input, onCommit);
            input.dataset.awaitingInput = 'false';
        });

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
                input.value = input.dataset.committedValue ?? '';
                input.dataset.awaitingInput = 'false';
                input.blur();
            }
        });

        input.addEventListener('blur', () => {
            const prevTimer = timers.get(input);
            if (prevTimer) clearTimeout(prevTimer);

            const awaiting = input.dataset.awaitingInput === 'true';
            const text = (input.value || '').trim();

            if (awaiting && text === '') {
                input.value = input.dataset.committedValue ?? '';
                input.dataset.awaitingInput = 'false';
            } else {
                commitInput(input, onCommit);
                input.dataset.awaitingInput = 'false';
            }
        });
    });

    const defaultValues = {
        'dailyDemand': 180,
        'opHours': 15.0,
        'numEmployees': 8,
        'laborCost': 25.0,
        'superSell': 400,
        'superCogs': 375,
        'ultraSell': 650,
        'ultraCogs': 590,
        'megaSell': 1000,
        'megaCogs': 960
    };
    Object.assign(defaultValues, {
        'inv-analysisPeriod': 5,
        'inv-marr': 12.0,
        'inv-taxRate': 25.0,
        'inv-mfgOverhead': 250000,
        'inv-sgaExpenses': 350000,
        'inv-freightExpense': 300000,
        'inv-costPerFootStraight': 225,
        'inv-costPerBend': 450,
        'inv-installationCost': 10000,
        'inv-salvageValue': 10000,
        'inv-std': 6804,
        'inv-cv': 15.0,
        'inv-ciLevel': 95,
        'inv-p90Demand': 58696,
        'inv-p10Demand': 32024
    });

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
                    commitInput(input, onCommit);

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
        input.value = input.dataset.committedValue ?? '';
        return;
    }
    let cleaned = raw.replace(/\(([^)]+)\)/, '-$1');
    cleaned = cleaned.replace(/[^0-9eE+\-\.]/g, '');
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) {
        input.value = input.dataset.committedValue ?? '';
        return;
    }
    const clamped = clampByField(input.id, n);

    try {
        if (input && input.dataset && input.dataset.type === 'currency') {
            const stepVal = input.id === 'opHours' ? 0.25 : (parseFloat(input.step) || 1);
            const decimals = Math.max(0, (function (s) {
                if (!isFinite(s)) return 0;
                const str = String(s);
                if (str.indexOf('e-') > -1) { const m = str.match(/e-(\d+)$/); return m ? parseInt(m[1], 10) : 0; }
                const parts = str.split('.'); return parts[1] ? parts[1].length : 0;
            })(stepVal));
            input.value = Number(clamped).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        } else {
            input.value = String(clamped);
        }
    } catch (err) {
        input.value = String(clamped);
    }

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
    const demandInputContainer = dailyDemandInput.closest('.input-group, .form-group, div');
    if (demandInputContainer) {
        const operationalTitle = demandInputContainer.previousElementSibling;
        if (operationalTitle && (operationalTitle.tagName === 'H3' || operationalTitle.tagName === 'H4')) {
            const titleWrapper = document.createElement('div');
            titleWrapper.style.display = 'flex';
            titleWrapper.style.justifyContent = 'space-between';
            titleWrapper.style.alignItems = 'center';
            titleWrapper.style.marginBottom = getComputedStyle(operationalTitle).marginBottom;
            operationalTitle.style.marginBottom = '0';

            operationalTitle.parentNode.insertBefore(titleWrapper, operationalTitle);

            titleWrapper.appendChild(operationalTitle);
            titleWrapper.appendChild(switchContainer);
        } else {
            rightSidebar.insertBefore(switchContainer, rightSidebar.firstChild);
        }
    }

    /**
    * Central handler for resizing visualizations.
    * Calls the .resize() method on the active tab's module, if it exists.
    * For tabs with foreignObjects, it dispatches a custom 'appResize' event.
    * Falls back to renderActiveTab() for modules without a .resize() method.
    */
    function handleResize() {
        const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
        if (!activeTab) return;

        try {
            if (activeTab === 'overview' || activeTab === 'investment') {
                const panelEl = document.getElementById(`${activeTab}-panel`);
                if (panelEl) {
                    const fo = panelEl.querySelector('foreignObject');
                    if (fo) {
                        fo.setAttribute('width', '100%');
                        fo.setAttribute('height', '100%');
                    }
                    // Dispatch a custom event for FO content to listen to
                    window.dispatchEvent(new Event('appResize'));
                }
            }
            // Handle SVG-native tabs (call .resize() if it exists)
            else if (activeTab === 'precedence' && typeof PrecedenceTab !== 'undefined' && PrecedenceTab.resize) {
                PrecedenceTab.resize();
            }
            else if (activeTab === 'layout' && typeof LayoutTab !== 'undefined' && LayoutTab.resize) {
                LayoutTab.resize();
            }
            else if (activeTab === 'schedule' && typeof ScheduleTab !== 'undefined' && ScheduleTab.resize) {
                ScheduleTab.resize();
            }
            else if (activeTab === 'efficiency' && typeof EfficiencyTab !== 'undefined' && EfficiencyTab.resize) {
                EfficiencyTab.resize();
            }
            else if (activeTab === 'profit' && typeof ProfitTab !== 'undefined' && ProfitTab.resize) {
                ProfitTab.resize();
            }
            else if (activeTab === 'location' && typeof LocationTab !== 'undefined' && LocationTab.resize) {
                LocationTab.resize();
            }
            // Fallback for any tab that doesn't have a .resize() method
            else {
                renderActiveTab();
            }
        } catch (err) {
            console.error(`Error during resize for tab ${activeTab}:`, err);
        }

        setWorkstationListHeight();
    }

    /**
     * Smoothly resizes the active visualization during the sidebar's
     * 300ms CSS transition animation.
     */
    function smoothResize() {
        const duration = 300; // Match CSS transition duration
        let start = null;

        function step(timestamp) {
            if (!start) start = timestamp;
            const progress = timestamp - start;

            // Call the main resize logic on each frame of the animation
            handleResize();

            if (progress < duration) {
                requestAnimationFrame(step);
            } else {
                // Final ensure layout is correct at the end of animation
                handleResize();
            }
        }
        requestAnimationFrame(step);
    }

    leftToggle.addEventListener('click', () => {
        const leftSidebarEl = document.getElementById('left-sidebar');
        leftSidebarEl.classList.toggle('collapsed');
        const isCollapsed = leftSidebarEl.classList.contains('collapsed');
        leftToggle.innerHTML = isCollapsed ? '&raquo;' : '&laquo;';
        smoothResize();
    });

    rightToggle.addEventListener('click', () => {
        const rightSidebarEl = document.getElementById('right-sidebar');
        rightSidebarEl.classList.toggle('collapsed');
        const isCollapsed = rightSidebarEl.classList.contains('collapsed');
        rightToggle.innerHTML = isCollapsed ? '&laquo;' : '&raquo;';
        smoothResize();
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
                setWorkstationListHeight();
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

    // --- Add Global Window Resize Listener ---
    window.addEventListener('resize', debounce(handleResize, 150));
}

/**
* UI - Controls tab shift visibility
*/
function handleVisibilityChange() {
    if (document.hidden) {
        if (animationState && animationState.schedule && animationState.schedule.isRunning && !animationState.schedule.isManuallyPaused) {
            animationState.schedule.isPaused = true;
        }
        if (animationState && animationState.layout && animationState.layout.isRunning && !animationState.layout.isManuallyPaused) {
            animationState.layout.isPaused = true;
        }
    } else {
        if (animationState && animationState.schedule && animationState.schedule.isPaused && !animationState.schedule.isManuallyPaused) {
            animationState.schedule.isPaused = false;
            animationState.schedule.lastFrameTime = performance.now();
        }
        if (animationState && animationState.layout && animationState.layout.isPaused && !animationState.layout.isManuallyPaused) {
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
    // Use a specific class selector to avoid conflicts between different tooltips.
    const selector = `body > .d3-tooltip.${className}`;
    let tooltip = d3.select(selector);

    if (tooltip.empty()) {
        tooltip = d3.select("body").append("div")
            .attr("class", `d3-tooltip ${className || ''}`)
            .style("opacity", 0).style("position", "absolute");
    }
    return tooltip;
}

function wireRightSidebarTooltips() {
    const tooltips = {
        'dailyDemand': 'Number of units which can be sold, or which producing more than needed is a liability. Production should match your demand.',
        'opHours': 'Number of hours the assembly line is running per day.',
        'numEmployees': 'Total number of employees working. Corresponds to the number of workstations.',
        'laborCost': 'Hourly labor cost per employee.',
        'sellPriceHeading': 'Selling price per unit (used to compute total revenue).',
        'materialCostHeading': 'Material / COGS per unit (used to compute cost of goods sold).',
        'wip': 'Work in Progress. Number of incomplete products currently being worked on.',
        'throughput': 'Number of models built within a given time-period, usually an hour.',
        'conveyorSpeed': 'Conveyor belt speed in feet per minute.',
        'productSpacing': 'Distance between consecutive products on the line, in feet.',
        'avgEfficiency': 'Average percentage of time in which the assembly line/workstation are working on a model.',
        'totalIdleTime': 'Total amount of time workstations are idle / not working, in hours.',
        'balanceDelay': 'Percentage of time in which the individual(s) in a workstation/line are idle / not working.',
        'idleTimeCv': 'Coefficient of variation of idle times across stations (%).',
        'grossProfit': 'Value of goods sold minus COGS. Represents the value a given product provides for the company, to sustain operations.',
        'profitMargin': 'Percentage of profit compared to total goods sold. Can be either net or gross.',
        'npvMetric': 'Used to determine the profitability of an investment by comparing the present value of future cash inflows to the initial investment.',
        'irrMetric': 'Represents the annual rate of return an investment is expected to yield. Is the discount rate that makes the NPV of all cash flows from the investment equal to zero.',
        'paybackMetric': 'Length of time it takes for an investment to generate enough cash flow to recover its initial cost.'
    };

    const tooltip = createTooltip('right-sidebar-tooltip');
    const sidebar = document.getElementById('right-sidebar');
    if (!sidebar) return;
    const containerElement = sidebar;

    const finGrid = containerElement.querySelector('.fin-grid');
    const finSpans = finGrid ? Array.from(finGrid.querySelectorAll('span')) : [];

    const findLabelSpanForStrong = (strongId) => {
        const strongEl = containerElement.querySelector(`#${strongId}`);
        if (!strongEl) return null;
        const prev = strongEl.previousElementSibling;
        if (prev && prev.tagName && prev.tagName.toLowerCase() === 'span') return prev;
        return null;
    };

    for (const [id, text] of Object.entries(tooltips)) {
        let target = null;

        target = containerElement.querySelector(`label[for="${id}"]`);

        if (!target) {
            if (id === 'sellPriceHeading' && finSpans.length >= 2) target = finSpans[1];
            if (id === 'materialCostHeading' && finSpans.length >= 3) target = finSpans[2];
        }

        if (!target) {
            target = findLabelSpanForStrong(id);
        }

        if (target) {
            target.addEventListener('mouseover', function (event) {
                tooltip.transition().duration(200).style('opacity', 1);
                tooltip.html(`<div class="tooltip-row">${text}</div>`)
                    .style('left', (event.pageX + 15) + 'px')
                    .style('top', (event.pageY - 28) + 'px');
            });
            target.addEventListener('mousemove', function (event) {
                tooltip.style('left', (event.pageX + 15) + 'px').style('top', (event.pageY - 28) + 'px');
            });
            target.addEventListener('mouseout', function () {
                tooltip.transition().duration(500).style('opacity', 0);
            });
        }
    }
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
    invalidPrecedenceNodes = validatePrecedence();

    if (document.querySelector('.tab-btn[data-tab="precedence"].active')) {
        PrecedenceTab.update(invalidPrecedenceNodes);
    }

    setTimeout(() => updateUI({ skipPrecedence: true }), 0);
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
        ProfitTab.draw();
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
* Sets the maxHeight of the workstation list based on the current tab's container height and header height.
*/
function setWorkstationListHeight() {
    const header = document.querySelector('.main-header');
    const headerHeight = header.offsetHeight;
    const svgContainer = document.getElementById('svg-container');
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    let containerHeight = svgContainer.clientHeight;
    let marginTop = 0;
    if (activeTab === 'schedule' && typeof ScheduleTab !== 'undefined' && ScheduleTab.containerHeight) {
        containerHeight = ScheduleTab.containerHeight;
        marginTop = ScheduleTab.margin?.top || 0;
    }
    workstationList.style.maxHeight = `${(containerHeight * 0.93) - marginTop + headerHeight}px`;
}

/**
* @tab General
* Renders the content for the currently active visualization tab.
*/
function renderActiveTab() {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'overview') drawOverviewPanel();
    else if (activeTab === 'precedence') drawPrecedenceChart();
    else if (activeTab === 'schedule') ScheduleTab.draw();
    else if (activeTab === 'efficiency') EfficiencyTab.draw();
    else if (activeTab === 'layout') LayoutTab.draw();
    else if (activeTab === 'profit') ProfitTab.draw();
    else if (activeTab === 'investment') drawInvestmentPanel();
    else if (activeTab === 'location') LocationTab.draw();
    setWorkstationListHeight();
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

document.addEventListener('DOMContentLoaded', main());