// Global Constants and Mapping
const MIN_TAKT_TIME = 2.5;
const BUILD_RATIOS = { super: 0.35, ultra: 0.45, mega: 0.20 };
const ASSEMBLY_LINE_LENGTH = 486;
let isRecalculating = false;

// Global Constants for Color Generation
const COLOR_CONSTANTS = {
    baseHue: 150,
    goldenAngle: 137.5,
    baseChroma: 65,
    baseLuminance: 60,
    luminanceVary: 15,
    hueVary: 10
};

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

const PERT_PIE_STROKE = '#ffffff';
const PERT_PIE_COLORS = {
    super: '#3498db',
    ultra: '#f1c40f',
    mega: '#e74c3c',
    idle: '#e5e7e9'
};

const originalConfigData = {};
const state = {
    taskData: new Map(),
    configData: {}
};

let sortableInstances = [];
let precedenceChartNodes = null;
let invalidPrecedenceNodes = new Set();
let profitMaximizationCache = { key: null, data: null };
let isProfitCalculating = false;
let animationState = {
    speedMultiplier: 1.0,
    layout: { frameId: null, isRunning: false },
    schedule: { frameId: null, isRunning: false }
};

// DOM Element References
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

// Main Initialization
async function main() {
    await loadData();
    setupEventListeners();
    setupUIEventListeners();
    setupVisibilityListener();
    initializeAndRunProfitCalculation(); // Handles cached or new calculation
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
 * Backend - generate a 'flattened' precedence tree.
 */
function flattenPrecedenceTree() {
    const elements = [
        { id: 1, predecessors: [] }, { id: 2, predecessors: [1] },
        { id: 3, predecessors: [1] }, { id: 4, predecessors: [1] },
        { id: 5, predecessors: [2, 3] }, { id: 6, predecessors: [1] },
        { id: 7, predecessors: [6] }, { id: 8, predecessors: [1] },
        { id: 9, predecessors: [8] }, { id: 10, predecessors: [1] },
        { id: 11, predecessors: [1] }, { id: 12, predecessors: [10, 11] },
        { id: 13, predecessors: [4, 5, 7, 9, 12] }, { id: 14, predecessors: [13] },
        { id: 15, predecessors: [14] }, { id: 16, predecessors: [15] },
        { id: 17, predecessors: [16] }, { id: 18, predecessors: [14] },
        { id: 19, predecessors: [18] }, { id: 20, predecessors: [19] },
        { id: 21, predecessors: [20] }, { id: 22, predecessors: [18] },
        { id: 23, predecessors: [22] }, { id: 24, predecessors: [23] },
        { id: 25, predecessors: [19, 22] }, { id: 26, predecessors: [19, 22] },
        { id: 27, predecessors: [25, 26] }, { id: 28, predecessors: [27] },
        { id: 29, predecessors: [15] }, { id: 30, predecessors: [17, 21, 24, 27, 29] },
        { id: 31, predecessors: [30] },
    ];
    const directPredecessors = new Map();
    elements.forEach(el => {
        directPredecessors.set(el.id, new Set(el.predecessors));
    });
    const fullPredecessorMap = new Map();
    const memo = new Map();
    function getAllPredecessors(taskId) {
        if (memo.has(taskId)) {
            return memo.get(taskId);
        }
        const preds = directPredecessors.get(taskId) || new Set();
        const allPreds = new Set(preds);
        preds.forEach(pId => {
            const grandPreds = getAllPredecessors(pId);
            grandPreds.forEach(gpId => allPreds.add(gpId));
        });
        memo.set(taskId, allPreds);
        return allPreds;
    }
    elements.forEach(el => {
        fullPredecessorMap.set(el.id, getAllPredecessors(el.id));
    });
    return fullPredecessorMap;
}

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
        if (isOperationalDriver) {
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
 * Backend - Calculating the balance of elements within workstations and their impact on bottlenecks.
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
 * Backend - Calculate the various variables whenever one changes.
 */
function calculateMetrics(op, fin) {
    const wsDetails = calculateWorkstationDetails(op.numEmployees);
    const fullTotalOpMinutes = op.opHours * 60;
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
 * Backend - Identify the best default employee count for a given TaktTime.
 */
function findBestEmployeeFit(requiredTaktTime, startingCount) {
    for (let i = startingCount; i <= 13; i++) {
        if (calculateWorkstationDetails(i).bottleneckTime <= requiredTaktTime) return i;
    }
    return 13;
}

/**
 * Backend - Round all increments of operational hours by 15 minutes.
 */
function roundUpToQuarter(value) { return Math.ceil(value / 0.25) * 0.25; }

/**
 * Backend - Update Workstation Sequences and trigger precedence validation.
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
        updatePrecedenceChartColors();
        updatePrecedenceChartLinks(invalidPrecedenceMap);
    }
    setTimeout(updateUI, 0);
}

/**
 * Backend - Determines if element order is valid based on precedence requirements.
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
* Backend - Generates a production sequence based on demand using MSSA Algorithm.
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
 * UI - Animate numeric values with smooth transitions
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
 * UI - Parse numeric value from element text content
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
 * UI - Enable Middle Drag for Variables 
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
    input.addEventListener("click", (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const inputId = input.id;
            const defaultValue = defaultValues[inputId];
            if (defaultValue !== undefined) {
                const constraints = getConstraints();
                const clampedDefault = Math.max(constraints.min, Math.min(constraints.max, defaultValue));
                if (input.type === 'range' || constraints.step === 1) {
                    input.value = Math.round(clampedDefault).toString();
                } else if (constraints.step < 1) {
                    const decimals = Math.max(0, -Math.floor(Math.log10(constraints.step)));
                    input.value = clampedDefault.toFixed(decimals);
                } else {
                    input.value = clampedDefault.toFixed(2);
                }
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.style.backgroundColor = '#90EE90';
                setTimeout(() => {
                    input.style.backgroundColor = '';
                }, 200);
            }
        }
    });
}

/**
 * UI - Used to Default to last tab when refreshed
 */
function restoreActiveTab() {
    const savedTab = sessionStorage.getItem("activeTab");
    const defaultTab = "overview";
    const targetTab = savedTab || defaultTab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    if (btn) btn.classList.add("active");
    visPanels.forEach(panel => {
        panel.style.display = panel.id === `${targetTab}-panel` ? "block" : "none";
    });
}

/**
 * UI - Rendering Active Tabs
 */
function renderActiveTab() {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    if (activeTab === 'overview') drawOverviewPanel();
    else if (activeTab === 'precedence') drawPrecedenceChart();
    else if (activeTab === 'schedule') drawScheduleVisualization();
    else if (activeTab === 'efficiency') drawEfficiencyPanel();
    else if (activeTab === 'layout') drawLayoutVisualization();
    else if (activeTab === 'profit') drawProfitPanel();
    else if (activeTab === 'investment') drawInvestmentPanel();
}

/**
 * UI - Update User Interface for changes in variables (excluding precedence visuals).
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
        if (activeTab === 'layout') drawLayoutVisualization();
        if (activeTab === 'schedule') drawScheduleVisualization();
        if (activeTab === 'efficiency') drawEfficiencyPanel();
        if (activeTab === 'profit') drawProfitPanel();
    }
}

/**
 * UI - Generate Color-Scheme for Workstation Configurations.
 */
function generateElementColorScale(workstationIndex, numWorkstations, numElements) {
    const { baseHue, goldenAngle, baseChroma, baseLuminance, luminanceVary, hueVary } = COLOR_CONSTANTS;
    const baseColor = d3.hcl((baseHue + workstationIndex * goldenAngle) % 360, baseChroma, baseLuminance);
    const startColor = baseColor.copy();
    startColor.h += hueVary;
    startColor.l += luminanceVary;
    const endColor = baseColor.copy();
    endColor.h -= hueVary;
    endColor.l -= luminanceVary;
    return d3.scaleLinear()
        .domain([0, numElements > 1 ? numElements - 1 : 1])
        .range([startColor.toString(), endColor.toString()])
        .interpolate(d3.interpolateHcl);
}

/**
 * UI - Creating the Left Sidebar for Workstation Configurations.
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
                elementTimeBar.style.backgroundColor = '#cccccc';
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
        requestAnimationFrame(() => {
            const svgTop = svgContainer.getBoundingClientRect().top;
            const titleTop = firstTitle.getBoundingClientRect().top;
            const currentPadding = parseFloat(getComputedStyle(workstationList).paddingTop) || 0;
            const offset = svgTop - titleTop;
            const newPadding = Math.max(0, currentPadding + offset);
            workstationList.style.paddingTop = `${newPadding}px`;
        });
    }
}

/**
 * UI - Set listeners for the variable inputs.
 */
function setupEventListeners() {
    const inputs = [
        dailyDemandInput, opHoursInput, numEmployeesInput, laborCostInput,
        superSellInput, superCogsInput, ultraSellInput, ultraCogsInput,
        megaSellInput, megaCogsInput
    ];
    inputs.forEach(input => input.addEventListener('input', (e) => handleInputChange(e.target.id)));
}

/**
 * UI - Set listeners for the various UI Events.
 */
function setupUIEventListeners() {
    leftToggle.addEventListener('click', () => {
        const redrawOnTransitionEnd = () => {
            updateUI();
            leftSidebar.removeEventListener('transitionend', redrawOnTransitionEnd);
        };
        leftSidebar.addEventListener('transitionend', redrawOnTransitionEnd);
        leftSidebar.classList.toggle('collapsed');
        const isCollapsed = leftSidebar.classList.contains('collapsed');
        leftToggle.innerHTML = isCollapsed ? '&raquo;' : '&laquo;';
    });
    rightToggle.addEventListener('click', () => {
        const redrawOnTransitionEnd = () => {
            updateUI();
            rightSidebar.removeEventListener('transitionend', redrawOnTransitionEnd);
        };
        rightSidebar.addEventListener('transitionend', redrawOnTransitionEnd);
        rightSidebar.classList.toggle('collapsed');
        const isCollapsed = rightSidebar.classList.contains('collapsed');
        rightToggle.innerHTML = isCollapsed ? '&laquo;' : '&raquo;';
    });
    tabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            const targetTab = e.target.dataset.tab;
            sessionStorage.setItem("activeTab", targetTab);
            tabs.querySelector('.active').classList.remove('active');
            e.target.classList.add('active');
            visPanels.forEach(panel => {
                panel.style.display = panel.id === `${targetTab}-panel` ? 'block' : 'none';
            });
            workstationList.scrollTop = 0;
            stopAllSimulations();
            if (targetTab === 'layout') {
                drawLayoutVisualization();
            } else if (targetTab === 'schedule') {
                drawScheduleVisualization();
            } else if (targetTab === 'efficiency') {
                drawEfficiencyPanel();
            } else if (targetTab === 'profit') {
                drawProfitPanel();
            } else if (targetTab === 'precedence') {
                drawPrecedenceChart();
                const invalidPrecedenceMap = validatePrecedence();
                invalidPrecedenceNodes = new Set(Array.from(invalidPrecedenceMap.keys()));
                updatePrecedenceChartColors();
                updatePrecedenceChartLinks(invalidPrecedenceMap);
            } else if (targetTab === 'investment') {
                drawInvestmentPanel();
            } else if (targetTab === 'overview') {
                drawOverviewPanel();
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
        stopAllSimulations();
    } else {
        renderActiveTab();
    }
}

/**
 * UI - Setup EventListeners.
 */
function setupVisibilityListener() {
    document.addEventListener('visibilitychange', handleVisibilityChange, false);
}

/**
 * UI - Enable Drag and Drop of Elements in Workstations
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
 * Overview - Gives a summary of the project, data sources, and visualization tabs
 */
function drawOverviewPanel() {
    const svg = d3.select("#overview-panel");
    svg.selectAll("*").remove();
    const fo = svg.append("foreignObject")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", "100%")
        .attr("height", "100%");
    const container = fo.append("xhtml:div")
        .attr("class", "overview-container");
    container.html(`
    <h2>Factory Flow to Fortune - Assembly Line Optimization</h2>
    <section class="overview-section overview-intro">
      <p class="overview-desc">An interactive visualization system for optimizing refrigerator assembly line operations. This tool helps analyze production efficiency, identify bottlenecks, and maximize profitability through data-driven assembly line configuration.</p>
    </section>
    <section class="overview-section">
      <h3>Project Objectives</h3>
      <p>Design and optimize assembly line configurations to achieve maximum efficiency and profitability:</p>
      <ul>
        <li><strong>Throughput Optimization</strong> – Maximize units produced per hour</li>
        <li><strong>Bottleneck Analysis</strong> – Identify and resolve production constraints</li>
        <li><strong>Labor Efficiency</strong> – Balance workstation assignments across employees</li>
        <li><strong>Cost Minimization</strong> – Reduce idle time and operational costs</li>
        <li><strong>Quality Assurance</strong> – Maintain proper assembly sequence precedence</li>
      </ul>
    </section>
    <section class="overview-section">
      <h3>Manufacturing Data</h3>
      <p>The system processes real assembly line data including:</p>
      <ul>
        <li><strong>Product Mix</strong> – Super (60%), Ultra (25%), Mega (15%) refrigerator models</li>
        <li><strong>Assembly Elements</strong> – 50+ individual manufacturing tasks with time requirements</li>
        <li><strong>Precedence Constraints</strong> – Required order dependencies between assembly steps</li>
        <li><strong>Workstation Capacity</strong> – Variable employee assignments (3-13 workers)</li>
        <li><strong>Financial Parameters</strong> – Labor costs, material costs, and profit margins</li>
      </ul>
    </section>
    <section class="overview-section">
      <h3>Key Performance Indicators</h3>
      <p>Real-time metrics calculated from your current configuration:</p>
      <ul>
        <li><strong>Production Rate</strong> – Current throughput and capacity utilization</li>
        <li><strong>Cycle Time</strong> – Time between completed units</li>
        <li><strong>Line Balance</strong> – Workstation efficiency distribution</li>
        <li><strong>Idle Time Analysis</strong> – Identify underutilized resources</li>
        <li><strong>Daily Gross Profit</strong> – Financial performance projections</li>
      </ul>
    </section>
    <section class="overview-section">
      <h3>Current System Status</h3>
      <p>Real-time display of your current configuration settings:</p>
      <ul>
        <li><strong>Active Configuration:</strong> ${document.getElementById('numEmployees')?.value || '8'} Workstations</li>
        <li><strong>Daily Demand:</strong> ${document.getElementById('dailyDemand')?.value || '180'} Units</li>
        <li><strong>Operating Hours:</strong> ${document.getElementById('opHours')?.value || '15'} Hours</li>
        <li><strong>Labor Rate:</strong> $${document.getElementById('laborCost')?.value || '25.00'}/hr</li>
        <li><strong>Production Target:</strong> Meeting demand requirements efficiently</li>
      </ul>
    </section>
    <section class="overview-section">
      <h3>Visualization Dashboard</h3>
      <p>Interactive tabs provide comprehensive analysis views:</p>
      <ul>
        <li><strong>Precedence Network</strong> – Visualize assembly step dependencies and constraints</li>
        <li><strong>Production Schedule</strong> – Real-time Gantt chart showing workstation timelines</li>
        <li><strong>Efficiency Analysis</strong> – Compare individual vs. line-wide performance metrics</li>
        <li><strong>Factory Layout</strong> – Animated U-shaped assembly line with product flow</li>
        <li><strong>Profit Optimization</strong> – Demand vs. profitability analysis and forecasting</li>
      </ul>
    </section>
    <section class="overview-section">
      <h3>Interactive Controls</h3>
      <p>Modify parameters to test different scenarios:</p>
      <ul>
        <li><strong>Demand Settings</strong> – Adjust daily production targets</li>
        <li><strong>Staffing Levels</strong> – Change number of assembly workers</li>
        <li><strong>Operating Hours</strong> – Modify shift length and scheduling</li>
        <li><strong>Task Assignment</strong> – Drag and drop elements between workstations</li>
        <li><strong>Cost Parameters</strong> – Update labor rates and material costs</li>
      </ul>
    </section>
    <section class="overview-section">
      <h3>Getting Started Guide</h3>
      <p>Follow these steps to optimize your assembly line:</p>
      <div class="step-list">
        <div class="step-item">
          <span class="step-number">1</span>
          <div class="step-content">
            <strong>Set Parameters</strong> – Adjust demand, staffing, and operational settings in the right sidebar
          </div>
        </div>
        <div class="step-item">
          <span class="step-number">2</span>
          <div class="step-content">
            <strong>Arrange Tasks</strong> – Drag assembly elements between workstations to balance the line
          </div>
        </div>
        <div class="step-item">
          <span class="step-number">3</span>
          <div class="step-content">
            <strong>Analyze Results</strong> – Monitor efficiency metrics and identify bottlenecks
          </div>
        </div>
        <div class="step-item">
          <span class="step-number">4</span>
          <div class="step-content">
            <strong>Explore Views</strong> – Switch between tabs to visualize different aspects of your line
          </div>
        </div>
      </div>
    </section>
    <section class="overview-section">
      <h3>Optimization Tips</h3>
      <p>Key strategies for achieving optimal assembly line performance:</p>
      <div class="tips-list">
        <div class="tip-item">
          <span class="tip-icon">💡</span>
          <div class="tip-content">
            <strong>Balance Workload</strong> – Aim for similar cycle times across all workstations to minimize idle time
          </div>
        </div>
        <div class="tip-item">
          <span class="tip-icon">⚡</span>
          <div class="tip-content">
            <strong>Respect Precedence</strong> – Ensure assembly steps follow the required order dependencies
          </div>
        </div>
        <div class="tip-item">
          <span class="tip-icon">📊</span>
          <div class="tip-content">
            <strong>Monitor Efficiency</strong> – Target 85%+ line efficiency for optimal performance
          </div>
        </div>
        <div class="tip-item">
          <span class="tip-icon">🎯</span>
          <div class="tip-content">
            <strong>Meet Demand</strong> – Ensure throughput meets or exceeds daily production targets
          </div>
        </div>
      </div>
    </section>
  `);
}

/**
 * Precedence - Sets node colors based on if elements are arranged before their predecessors.
 */
function updatePrecedenceChartColors() {
    if (!precedenceChartNodes) {
        return;
    }
    precedenceChartNodes.selectAll('circle')
        .each(function (d) {
            const circle = d3.select(this);
            const isError = invalidPrecedenceNodes.has(d.id);
            circle.interrupt("blink");
            if (isError) {
                function blink() {
                    circle.transition("blink")
                        .duration(700)
                        .attr("stroke", "#ff5c5cff")
                        .attr("stroke-width", 30)
                        .style("fill", "#e74c3c")
                        .transition("blink")
                        .duration(700)
                        .attr("stroke", "#e74c3c")
                        .attr("stroke-width", 10)
                        .style("fill", "#e74c3c")
                        .on("end", blink);
                }
                blink();
            } else {
                circle.transition()
                    .duration(500)
                    .attr("stroke", "#2c3e50")
                    .attr("stroke-width", 1.5)
                    .style("fill", "#ffffff");
            }
        });
}

/**
* Creates a custom D3 force that repels nodes from the container edges.
*/
function boundingForce(width, height) {
    let nodes;
    const margin = 10; // Padding from the edge
    const strength = 5; // How strongly to push back

    // This is the actual force function called on each 'tick' of the simulation
    function force() {
        for (const node of nodes) {
            // Only apply the force to nodes that are not fixed/pinned by dragging
            if (node.fx === null && node.fy === null) {
                const r = node.r || 50; // Use the node's radius for more accurate bounding
                const xBoundary = r + margin;
                const yBoundary = r + margin;

                // Nudge the node back if it crosses a boundary
                if (node.x < xBoundary) {
                    node.vx += strength;
                } else if (node.x > width - xBoundary) {
                    node.vx -= strength;
                }
                if (node.y < yBoundary) {
                    node.vy += strength;
                } else if (node.y > height - yBoundary) {
                    node.vy -= strength;
                }
            }
        }
    }

    // This 'initialize' function is called by D3 to give our force the array of nodes
    force.initialize = (_) => {
        nodes = _;
    };

    return force;
}

/**
* Precedence - Generates a Precedence DAG for Elements connected by precedence.
*/
function drawPrecedenceChart() {
    const nodes = PRECEDENCE_DATA.map(d => ({ id: d.id }));
    const links = [];
    PRECEDENCE_DATA.forEach(d => {
        d.predecessors.forEach(pId => {
            links.push({ source: pId, target: d.id });
        });
    });

    const svg = d3.select("#precedence-panel");
    svg.selectAll("*").remove();

    svg.append('defs').selectAll('marker')
        .data(['arrowhead', 'arrowhead-highlight'])
        .join('marker')
        .attr('id', d => d)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 10)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', d => d === 'arrowhead-highlight' ? '#e74c3c' : '#999');

    const width = document.getElementById('svg-container').clientWidth;
    const height = document.getElementById('svg-container').clientHeight;

    const mainGroup = svg.append("g");

    const link = mainGroup.append("g")
        .attr("stroke", "#999").attr("stroke-opacity", 0.8)
        .selectAll("line").data(links).join("line")
        .attr("stroke-width", 2.5)
        .attr("marker-end", "url(#arrowhead)");

    precedenceChartNodes = mainGroup.append("g").selectAll("g").data(nodes).join("g");

    // The previous fx/fy pinning of nodes has been removed to allow the graph to form a natural shape.

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(function (d) {
            if ((d.source.id === 13 && d.target.id === 14) || (d.source.id === 14 && d.target.id === 13)) {
                return 5;
            }
            return 40;
        }))
        .force("charge", d3.forceManyBody().strength(-500))
        .force("center", d3.forceCenter(width / 2, height / 2).strength(0.1))
        .force("collide", d3.forceCollide().radius(d => (d.r || 50) + 8).strength(1))
        .force("bound", boundingForce(width, height))
        .on("end", () => { // --- FIX START ---
            // When the simulation is done, calculate the bounds and zoom to fit.
            if (!nodes.length) return;

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            nodes.forEach(node => {
                const r = node.r || 12;
                if (node.x - r < minX) minX = node.x - r;
                if (node.x + r > maxX) maxX = node.x + r;
                if (node.y - r < minY) minY = node.y - r;
                if (node.y + r > maxY) maxY = node.y + r;
            });

            const graphWidth = maxX - minX;
            const graphHeight = maxY - minY;

            if (graphWidth <= 0 || graphHeight <= 0) return;

            const padding = 0.9;
            const scale = Math.min(width / graphWidth, height / graphHeight) * padding;
            const translateX = (width / 2) - scale * (minX + graphWidth / 2);
            const translateY = (height / 2) - scale * (minY + graphHeight / 2);

            const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);

            svg.transition().duration(250).call(zoom.transform, transform);
            // --- FIX END ---
        });

    precedenceChartNodes.append("circle")
        .attr("r", 12).attr("stroke", "#fff").attr("stroke-width", 1.5).attr("fill", "steelblue");

    precedenceChartNodes.append("text")
        .text(d => d.id).attr("text-anchor", "middle").attr("dy", "0.35em")
        .style("fill", "white").style("font-size", "10px").style("pointer-events", "none");

    function dragstarted(event) {
        event.sourceEvent.stopPropagation();
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

    precedenceChartNodes.call(d3.drag()
        .on("start", dragstarted).on("drag", dragged).on("end", dragended));

    simulation.on("tick", () => {
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
            d3.select(this)
                .attr("x1", d.source.x)
                .attr("y1", d.source.y)
                .attr("x2", x2)
                .attr("y2", y2);
        });
        precedenceChartNodes.attr("transform", d => `translate(${d.x}, ${d.y})`);
    });

    const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", zoomed);

    function zoomed(event) {
        mainGroup.attr("transform", event.transform);
    }

    svg.call(zoom);

    renderPrecedenceLegend();
}

/**
 * Precedence - Sets link styles based on the specific paths that violate precedence.
 */
function updatePrecedenceChartLinks() {
    if (!precedenceChartNodes) return;
    const allLinks = d3.select("#precedence-panel").selectAll('g > line');
    if (invalidPrecedenceNodes.size === 0) {
        allLinks
            .transition().duration(300)
            .attr('stroke', '#999')
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
    const directSuccessorsMap = new Map();
    PRECEDENCE_DATA.forEach(el => {
        if (!directSuccessorsMap.has(el.id)) directSuccessorsMap.set(el.id, new Set());
        el.predecessors.forEach(pId => {
            if (!directSuccessorsMap.has(pId)) directSuccessorsMap.set(pId, new Set());
            directSuccessorsMap.get(pId).add(el.id);
        });
    });
    const fullSuccessorMemo = new Map();
    function getAllSuccessors(taskId) {
        if (fullSuccessorMemo.has(taskId)) return fullSuccessorMemo.get(taskId);
        const successors = directSuccessorsMap.get(taskId) || new Set();
        const allSuccessors = new Set(successors);
        successors.forEach(sId => {
            getAllSuccessors(sId).forEach(gsId => allSuccessors.add(gsId));
        });
        fullSuccessorMemo.set(taskId, allSuccessors);
        return allSuccessors;
    }
    const violatingPathNodes = new Set();
    for (const violatingNodeId of invalidPrecedenceNodes) {
        const allPredecessors = precedenceMap.get(violatingNodeId) || new Set();
        for (const predecessorId of allPredecessors) {
            if (elementOrderMap.get(predecessorId) > elementOrderMap.get(violatingNodeId)) {
                violatingPathNodes.add(violatingNodeId);
                violatingPathNodes.add(predecessorId);
                const successorsOfLatePred = getAllSuccessors(predecessorId);
                for (const potentialPathNodeId of successorsOfLatePred) {
                    if (allPredecessors.has(potentialPathNodeId)) {
                        violatingPathNodes.add(potentialPathNodeId);
                    }
                }
            }
        }
    }
    allLinks
        .sort((a, b) => {
            const aIsHighlighted = violatingPathNodes.has(a.source.id) && violatingPathNodes.has(a.target.id);
            const bIsHighlighted = violatingPathNodes.has(b.source.id) && violatingPathNodes.has(b.target.id);
            if (aIsHighlighted && !bIsHighlighted) return 1;
            if (!aIsHighlighted && bIsHighlighted) return -1;
            return 0;
        })
        .each(function (d) {
            const isHighlighted = violatingPathNodes.has(d.source.id) && violatingPathNodes.has(d.target.id);
            d3.select(this)
                .transition().duration(300)
                .attr('stroke', isHighlighted ? '#e74c3c' : '#999')
                .attr('stroke-width', isHighlighted ? 5.5 : 2.5)
                .attr('marker-end', isHighlighted ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)');
        });
}

/**
 * Precedence - Generate Labor Times from tasks
 */
function getPertLaborTime(id) {
    try {
        const t = state?.taskData?.get?.(id)?.laborTime;
        if (Number.isFinite(t)) return t;
    } catch (_) { }
    return PERT_LABOR_FALLBACK[id];
}

/**
 * Precedence - Set Node Sizes based on Labor Time
 */
function sizePERTNodesOnce() {
    const panel = d3.select('#precedence-panel');
    const groups = panel.selectAll('g');
    if (groups.empty()) return;
    const times = [];
    groups.each(d => {
        if (!d || d.id == null) return;
        const lt = getPertLaborTime(+d.id);
        if (Number.isFinite(lt)) times.push(lt);
    });
    if (!times.length) return;
    const toRadius = d3.scaleLinear()
        .domain([d3.min(times), d3.max(times)])
        .range([14, 56])
        .nice();
    groups.each(function (d) {
        const id = d && d.id != null ? +d.id : NaN;
        const lt = getPertLaborTime(id);
        const r = toRadius(lt);
        const g = d3.select(this);
        g.select('circle').attr('r', r).attr('stroke-width', 2);
        g.select('text').style('font-size', Math.max(10, Math.min(18, r * 0.33)) + 'px');
    });
}

/**
 * Precedence - Pull in Row-Date
 */
function getPertRow(id) {
    const row = state?.taskData?.get?.(id);
    if (row) {
        return {
            elementTime: Number(row.elementTime) || 0,
            super: Number(row.Super) || 0,
            ultra: Number(row.Ultra) || 0,
            mega: Number(row.Mega) || 0
        };
    }
    return null;
}

/**
 * Precedence - Select Node Groups
 */
function selectPertNodeGroups() {
    if (precedenceChartNodes && typeof precedenceChartNodes.size === 'function' && precedenceChartNodes.size() > 0) {
        return precedenceChartNodes;
    }
    return d3.select('#precedence-panel').selectAll('g').filter(d => d && d.id != null);
}

/**
 * Precedence - Build Radius Scales for Node Groups
 */
function buildRadiusScaleForNodeGroups(groups) {
    if (!groups || groups.empty()) return null;
    const vals = [];
    groups.each(d => {
        const t = getPertLaborTime(+d.id);
        if (Number.isFinite(t)) vals.push(t);
    });
    if (!vals.length) return null;
    return d3.scaleLinear().domain([d3.min(vals), d3.max(vals)]).range([14, 56]).nice();
}
let pertTooltip = d3.select('body').select('.pert-tooltip');
if (pertTooltip.empty()) {
    pertTooltip = d3.select('body').append('div')
        .attr('class', 'pert-tooltip')
        .style('position', 'fixed').style('z-index', '99999').style('pointer-events', 'none')
        .style('padding', '8px 10px').style('border-radius', '8px')
        .style('background', 'rgba(0,0,0,0.85)').style('color', '#fff')
        .style('font', '12px/1.35 sans-serif').style('box-shadow', '0 4px 10px rgba(0,0,0,0.25)')
        .style('opacity', 0);
}

/**
 * Precedence - Set of Helper Functions
 */
function fmtPct(x) { return isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—'; }
function fmtNum(x, d = 2) { return isFinite(x) ? x.toFixed(d) : '—'; }
function swatch(color) {
    return `<span style="display:inline-block;width:10px;height:10px;background:${color};border:1px solid rgba(255,255,255,0.85);margin-right:6px;border-radius:2px;"></span>`;
}

/**
 * Precedence - Draw Nodes
 */
function drawPERTNodePiesOnce() {
    const groups = selectPertNodeGroups();
    const rScale = buildRadiusScaleForNodeGroups(groups);
    if (!rScale) return;
    const arc = d3.arc().innerRadius(0);
    const pie = d3.pie().sort(null).value(d => d.value);
    groups.each(function (d) {
        if (!d || d.id == null) return;
        const g = d3.select(this);
        const id = +d.id;
        const r = rScale(getPertLaborTime(id));
        d.r = r;
        g.select('circle')
            .attr('r', r).attr('fill', '#ffffff').attr('fill-opacity', 0.001)
            .attr('stroke', '#2c3e50').attr('stroke-width', 1.5).style('pointer-events', 'all');
        const row = getPertRow(id);
        if (!row) return;
        const { elementTime: ET, super: sup, mega: meg, ultra: ult } = row;
        const slices = [
            { key: 'super', value: ET * sup, color: PERT_PIE_COLORS.super, share: sup },
            { key: 'mega', value: ET * meg, color: PERT_PIE_COLORS.mega, share: meg },
            { key: 'ultra', value: ET * ult, color: PERT_PIE_COLORS.ultra, share: ult },
            { key: 'idle', value: Math.max(0, ET * (1 - (sup + meg + ult))), color: PERT_PIE_COLORS.idle, share: Math.max(0, 1 - (sup + meg + ult)) }
        ].filter(s => s.value > 1e-6);
        g.selectAll('path.__pert_pie').remove();
        const arcGen = arc.outerRadius(r);
        g.selectAll('path.__pert_pie').data(pie(slices)).join('path')
            .attr('class', '__pert_pie').attr('d', arcGen).style('pointer-events', 'none')
            .style('fill', a => a.data.color).style('stroke', PERT_PIE_STROKE).style('stroke-width', '0.9px');
        g.on('mouseenter', (event) => {
            pertTooltip.style('opacity', 1).html(
                `<div style="font-weight:700;margin-bottom:6px;">Element ${id}</div>
                 <div style="margin-bottom:4px;">Labor Time: <b>${fmtNum(getPertLaborTime(id))}</b></div>
                 <div>${swatch(PERT_PIE_COLORS.super)}Super: <b>${fmtPct(sup)}</b></div>
                 <div>${swatch(PERT_PIE_COLORS.ultra)}Ultra: <b>${fmtPct(ult)}</b></div>
                 <div>${swatch(PERT_PIE_COLORS.mega)}Mega: <b>${fmtPct(meg)}</b></div>`
            );
        }).on('mousemove', (event) => {
            pertTooltip.style('left', (event.clientX + 14) + 'px').style('top', (event.clientY + 14) + 'px');
        }).on('mouseleave', () => {
            pertTooltip.style('opacity', 0);
        });
    });
    addPERTLabelBackgrounds();
    restylePERTNodeLabelsStrong();
}

/**
 * Precedence - Add Labels
 */
function addPERTLabelBackgrounds() {
    const groups = selectPertNodeGroups();
    if (!groups) return;
    groups.each(function (d) {
        if (!d || d.id == null || !d.r) return;
        const g = d3.select(this);
        if (g.select('circle.__pert_label_bg').empty()) {
            g.insert('circle', 'text').attr('class', '__pert_label_bg').style('pointer-events', 'none');
        }
        g.select('circle.__pert_label_bg')
            .attr('r', Math.max(11, d.r * 0.48)).attr('fill', '#ffffff').attr('fill-opacity', 0.95)
            .attr('stroke', '#000').attr('stroke-opacity', 0.20).attr('stroke-width', 1);
    });
}

/**
 * Precedence - Set Label Settings
 */
function restylePERTNodeLabelsStrong() {
    const groups = selectPertNodeGroups();
    if (!groups) return;
    groups.each(function (d) {
        if (!d || d.id == null || !d.r) return;
        const fs = Math.max(15, Math.min(26, d.r * 0.42));
        d3.select(this).select('text').raise()
            .attr('text-anchor', 'middle').attr('dy', '0.35em')
            .style('font-family', 'sans-serif').style('font-weight', '800')
            .style('font-size', fs + 'px').style('fill', '#111').style('stroke', '#fff')
            .style('stroke-width', '4px').style('paint-order', 'stroke').style('pointer-events', 'none');
    });
}

/**
 * Precedence - Sets up listeners to automatically redraw the PERT chart when the tab is active.
 */
function setupPrecedenceTabObserver(callback) {
    const tabsEl = document.getElementById('tabs');
    const panelEl = document.getElementById('precedence-panel');
    if (tabsEl) {
        tabsEl.addEventListener('click', (e) => {
            const btn = e.target;
            if (btn.classList?.contains('tab-btn') && btn.dataset.tab === 'precedence') {
                requestAnimationFrame(() => setTimeout(callback, 50));
            }
        });
    }
    if (panelEl) {
        const obs = new MutationObserver(() => {
            clearTimeout(obs.__t);
            obs.__t = setTimeout(callback, 100);
        });
        obs.observe(panelEl, { childList: true, subtree: true });
    }
}
setupPrecedenceTabObserver(() => {
    sizePERTNodesOnce();
    drawPERTNodePiesOnce();
});

/**
 * Precedence - Create a Legend
 */
function renderPrecedenceLegend() {
    const svg = d3.select('#precedence-panel');
    svg.select('#precedence-legend').remove();
    const boxW = 180, boxH = 140;
    const g = svg.append('g')
        .attr('id', 'precedence-legend')
        .attr('transform', `translate(20, 20)`)
        .style('pointer-events', 'none');
    g.append('rect')
        .attr('width', boxW).attr('height', boxH)
        .attr('rx', 10).attr('fill', 'rgba(255,255,255,0.92)').attr('stroke', '#ccc');
    g.append('text')
        .text('Build Ratios').attr('x', 12).attr('y', 22)
        .style('font-weight', 700).style('font-size', '13px').attr('fill', '#333');
    const items = [
        { label: 'Super', color: PERT_PIE_COLORS.super },
        { label: 'Ultra', color: PERT_PIE_COLORS.ultra },
        { label: 'Mega', color: PERT_PIE_COLORS.mega },
        { label: 'Idle', color: PERT_PIE_COLORS.idle },
    ];
    const rowY0 = 35;
    items.forEach((it, i) => {
        const row = g.append('g').attr('transform', `translate(12, ${rowY0 + i * 22})`);
        row.append('rect').attr('width', 14).attr('height', 14)
            .attr('fill', it.color).attr('stroke', '#fff').attr('stroke-width', 1);
        row.append('text').text(it.label).attr('x', 20).attr('y', 12)
            .style('font-size', '12px').style('font-weight', 650).attr('fill', '#333');
    });
    const sizeG = g.append('g').attr('transform', `translate(12, ${rowY0 + items.length * 22 + 8})`);
    sizeG.append('text').text('Node size = Labor time').attr('x', 0).attr('y', 0)
        .style('font-size', '12px').style('font-weight', 600).attr('fill', '#333');
}

/**
 * Profit - Calculates optimal profit/margin by searching through opHours and numEmployees.
 * This runs in the background on load and when financial inputs change.
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
    const key = JSON.stringify(finInputs);
    if (profitMaximizationCache.key === key) {
        isProfitCalculating = false;
        return;
    }
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'profit') {
        drawProfitPanel();
    }
    return new Promise(resolve => {
        setTimeout(() => {
            const profitData = [];
            const marginData = [];
            const originalStateConfig = state.configData;
            try {
                state.configData = originalConfigData;
                for (let demand = 1; demand <= 576; demand++) {
                    let maxProfit = -Infinity;
                    let maxMargin = -Infinity;
                    for (let opHours = 1; opHours <= 24; opHours += 0.25) {
                        const taktTime = (opHours * 60) / demand;
                        for (let numEmployees = 3; numEmployees <= 13; numEmployees++) {
                            if (!originalConfigData[numEmployees] || Object.keys(originalConfigData[numEmployees]).length === 0) continue;
                            const bottleneckTime = calculateWorkstationDetails(numEmployees).bottleneckTime;
                            if (bottleneckTime <= taktTime) {
                                const metrics = calculateMetrics({ dailyDemand: demand, opHours, numEmployees }, finInputs);
                                if (metrics) {
                                    if (metrics.dailyGrossProfit > maxProfit) {
                                        maxProfit = metrics.dailyGrossProfit;
                                    }
                                    if (metrics.grossProfitMargin > maxMargin) {
                                        maxMargin = metrics.grossProfitMargin;
                                    }
                                }
                            }
                        }
                    }
                    profitData.push({ demand, value: isFinite(maxProfit) ? maxProfit : 0 });
                    marginData.push({ demand, value: isFinite(maxMargin) ? maxMargin : 0 });
                }
            } finally {
                state.configData = originalStateConfig;
            }
            const calculatedData = { profitData, marginData };
            profitMaximizationCache = { key, data: calculatedData };
            isProfitCalculating = false;
            if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') {
                drawProfitPanel();
            }
            resolve();
        }, 50);
    });
}

function drawProfitPanel() {
    const svg = d3.select("#profit-panel");
    const { clientWidth: width, clientHeight: height } = document.getElementById('svg-container');
    svg.selectAll("*").remove();

    // Add CSS for the tooltip if it doesn't exist
    if (!document.getElementById('profit-tooltip-style')) {
        const style = document.createElement('style');
        style.id = 'profit-tooltip-style';
        style.innerHTML = `
.profit-tooltip {
position: absolute; text-align: left; padding: 6px 8px;
font: 12px sans-serif; background: rgba(44, 62, 80, 0.9);
color: white; border-radius: 6px; pointer-events: none; line-height: 1.4;
}
.profit-tooltip strong { font-size: 13px; }
.lost-profit-area { fill: #c0392b; opacity: 0.3; }
.profit-breakdown-group .axis text { font-size: 10px; }
.profit-breakdown-group .axis-label { font-size: 12px; font-weight: 600; fill: #34495e; }
.profit-breakdown-group .pie-title { font-size: 14px; font-weight: bold; text-anchor: middle; }
.profit-breakdown-group .breakdown-border { fill: none; stroke: #34495e; stroke-width: 2; stroke-dasharray: 5,5; rx: 10; }
`;
        document.head.appendChild(style);
    }

    if (!profitMaximizationCache.data || isProfitCalculating) {
        svg.append("text")
            .attr("x", width / 2).attr("y", height / 2)
            .attr("text-anchor", "middle")
            .style("font-size", "16px").attr("fill", "#666")
            .text("Calculating optimal profit scenarios, please wait...");
        return;
    }

    const data = profitMaximizationCache.data;
    const margin = { top: 40, right: 20, bottom: 40, left: 80 };

    // --- Layout Partition ---
    const breakdownWidth = width * 0.3;
    const chartsWidth = width - breakdownWidth;
    const chartWidth = chartsWidth - margin.left - margin.right;
    const chartHeight = (height / 2) - margin.top - margin.bottom;

    const chartsGroup = svg.append("g").attr("class", "profit-charts-group");
    const breakdownGroup = svg.append("g").attr("class", "profit-breakdown-group").attr("transform", `translate(${chartsWidth}, 0)`);

    const xScale = d3.scaleLinear().domain([1, 576]).range([0, chartWidth]);

    // --- Current Configuration Calculation ---
    const currentOpInputs = {
        dailyDemand: parseInt(dailyDemandInput.value),
        opHours: parseFloat(opHoursInput.value),
        numEmployees: parseInt(numEmployeesInput.value)
    };
    const currentFinInputs = {
        laborCost: parseFloat(laborCostInput.value),
        superSell: parseFloat(superSellInput.value),
        superCogs: parseFloat(superCogsInput.value),
        ultraSell: parseFloat(ultraSellInput.value),
        ultraCogs: parseFloat(ultraCogsInput.value),
        megaSell: parseFloat(megaSellInput.value),
        megaCogs: parseFloat(megaCogsInput.value),
    };
    const currentMetrics = calculateMetrics(currentOpInputs, currentFinInputs);
    const requestedDemandX = xScale(currentOpInputs.dailyDemand);
    const actualThroughputX = xScale(currentMetrics.throughputUnitsPerDay);
    const bisectDemand = d3.bisector(d => d.demand).left;

    // --- Main Chart Drawing (Profit & Margin) ---
    const profitChart = chartsGroup.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);
    const yProfitScale = d3.scaleLinear().domain(d3.extent(data.profitData, d => d.value)).nice().range([chartHeight, 0]);
    // ... (rest of profit chart drawing)
    profitChart.append("g").attr("transform", `translate(0, ${chartHeight})`).call(d3.axisBottom(xScale));
    profitChart.append("g").call(d3.axisLeft(yProfitScale).tickFormat(d3.format("$,.0f")));
    profitChart.append("path").datum(data.profitData).attr("fill", "none").attr("stroke", "#27ae60").attr("stroke-width", 2).attr("d", d3.line().x(p => xScale(p.demand)).y(p => yProfitScale(p.value)));
    profitChart.append("text").attr("x", chartWidth / 2).attr("y", -15).attr("text-anchor", "middle").style("font-size", "14px").style("font-weight", "bold").text("Max Gross Profit by Demand");
    const iProfit = bisectDemand(data.profitData, currentOpInputs.dailyDemand, 1);
    const optimalProfitAtDemand = data.profitData[iProfit > 0 ? iProfit - 1 : 0]?.value || 0;
    const optimalProfitY = yProfitScale(optimalProfitAtDemand);
    profitChart.append("line").attr("x1", requestedDemandX).attr("x2", requestedDemandX).attr("y1", 0).attr("y2", chartHeight).attr("stroke", "#34495e").attr("stroke-width", 1).attr("stroke-dasharray", "3, 3");
    profitChart.append("line").attr("x1", requestedDemandX).attr("x2", requestedDemandX).attr("y1", chartHeight).attr("y2", optimalProfitY).attr("stroke", "#34495e").attr("stroke-width", 2.5);
    if (currentOpInputs.dailyDemand > currentMetrics.throughputUnitsPerDay) {
        const iActual = bisectDemand(data.profitData, currentMetrics.throughputUnitsPerDay, 1);
        const areaData = data.profitData.slice(iActual > 0 ? iActual - 1 : 0, iProfit);
        if (areaData.length > 0) {
            const lostProfitArea = d3.area().x(d => xScale(d.demand)).y0(chartHeight).y1(d => yProfitScale(d.value));
            profitChart.append("path").datum(areaData).attr("class", "lost-profit-area").attr("d", lostProfitArea);
            profitChart.append("line").attr("x1", actualThroughputX).attr("x2", actualThroughputX).attr("y1", 0).attr("y2", chartHeight).attr("stroke", "#c0392b").attr("stroke-width", 1).attr("stroke-dasharray", "2, 2");
        }
    }
    profitChart.append("circle").attr("cx", actualThroughputX).attr("cy", yProfitScale(currentMetrics.dailyGrossProfit)).attr("r", 5).attr("fill", "red").attr("stroke", "white").attr("stroke-width", 1.5);

    const marginChart = chartsGroup.append("g").attr("transform", `translate(${margin.left}, ${margin.top + height / 2})`);
    const yMarginScale = d3.scaleLinear().domain([d3.min(data.marginData, d => d.value) > 0 ? 0 : d3.min(data.marginData, d => d.value), d3.max(data.marginData, d => d.value)]).nice().range([chartHeight, 0]);
    marginChart.append("g").attr("transform", `translate(0, ${chartHeight})`).call(d3.axisBottom(xScale).tickFormat(d3.format("d")));
    marginChart.append("g").call(d3.axisLeft(yMarginScale).tickFormat(d => `${d.toFixed(1)}%`));
    marginChart.append("path").datum(data.marginData).attr("fill", "none").attr("stroke", "#2980b9").attr("stroke-width", 2).attr("d", d3.line().x(p => xScale(p.demand)).y(p => yMarginScale(p.value)));
    marginChart.append("text").attr("x", chartWidth / 2).attr("y", -15).attr("text-anchor", "middle").style("font-size", "14px").style("font-weight", "bold").text("Max Gross Profit Margin by Demand");
    marginChart.append("text").attr("x", chartWidth / 2).attr("y", chartHeight + margin.bottom - 5).attr("text-anchor", "middle").style("font-size", "12px").text("Daily Demand (Units)");
    const iMargin = bisectDemand(data.marginData, currentOpInputs.dailyDemand, 1);
    const optimalMarginAtDemand = data.marginData[iMargin > 0 ? iMargin - 1 : 0]?.value || 0;
    const optimalMarginY = yMarginScale(optimalMarginAtDemand);
    marginChart.append("line").attr("x1", requestedDemandX).attr("x2", requestedDemandX).attr("y1", 0).attr("y2", chartHeight).attr("stroke", "#34495e").attr("stroke-width", 1).attr("stroke-dasharray", "3, 3");
    marginChart.append("line").attr("x1", requestedDemandX).attr("x2", requestedDemandX).attr("y1", chartHeight).attr("y2", optimalMarginY).attr("stroke", "#34495e").attr("stroke-width", 2.5);
    if (currentOpInputs.dailyDemand > currentMetrics.throughputUnitsPerDay) {
        const iActual = bisectDemand(data.marginData, currentMetrics.throughputUnitsPerDay, 1);
        const areaData = data.marginData.slice(iActual > 0 ? iActual - 1 : 0, iMargin);
        if (areaData.length > 0) {
            const lostMarginArea = d3.area().x(d => xScale(d.demand)).y0(chartHeight).y1(d => yMarginScale(d.value));
            marginChart.append("path").datum(areaData).attr("class", "lost-profit-area").attr("d", lostMarginArea);
            marginChart.append("line").attr("x1", actualThroughputX).attr("x2", actualThroughputX).attr("y1", 0).attr("y2", chartHeight).attr("stroke", "#c0392b").attr("stroke-width", 1).attr("stroke-dasharray", "2, 2");
        }
    }
    marginChart.append("circle").attr("cx", actualThroughputX).attr("cy", yMarginScale(currentMetrics.grossProfitMargin)).attr("r", 5).attr("fill", "red").attr("stroke", "white").attr("stroke-width", 1.5);

    const tooltip = d3.select("body").selectAll(".profit-tooltip").data([null]).join("div").attr("class", "profit-tooltip").style("opacity", 0);
    const profitOverlay = chartsGroup.append("rect").attr("transform", `translate(${margin.left}, ${margin.top})`).attr("width", chartWidth).attr("height", chartHeight).style("fill", "none").style("pointer-events", "all");
    const marginOverlay = chartsGroup.append("rect").attr("transform", `translate(${margin.left}, ${margin.top + height / 2})`).attr("width", chartWidth).attr("height", chartHeight).style("fill", "none").style("pointer-events", "all");
    profitOverlay.on("mouseover", () => tooltip.style("opacity", 1)).on("mouseout", () => tooltip.style("opacity", 0)).on("mousemove", profitMousemove);
    marginOverlay.on("mouseover", () => tooltip.style("opacity", 1)).on("mouseout", () => tooltip.style("opacity", 0)).on("mousemove", marginMousemove);
    function profitMousemove(event) { const x0 = xScale.invert(d3.pointer(event)[0]); const i = bisectDemand(data.profitData, x0, 1); if (i <= 0 || i >= data.profitData.length) return; const d0 = data.profitData[i - 1]; const d1 = data.profitData[i]; const d = (x0 - d0.demand > d1.demand - x0) ? d1 : d0; tooltip.html(`<strong>Demand: ${d.demand}</strong><br/>Optimal Profit: ${d3.format("$,.0f")(d.value)}<br/>Configuration: ${d.config.emp} W, ${d.config.hrs} hrs`).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"); }
    function marginMousemove(event) { const x0 = xScale.invert(d3.pointer(event)[0]); const i = bisectDemand(data.marginData, x0, 1); if (i <= 0 || i >= data.marginData.length) return; const d0 = data.marginData[i - 1]; const d1 = data.marginData[i]; const d = (x0 - d0.demand > d1.demand - x0) ? d1 : d0; tooltip.html(`<strong>Demand: ${d.demand}</strong><br/>Optimal Margin: ${d.value.toFixed(1)}%<br/>Configuration: ${d.config.emp} W, ${d.config.hrs} hrs`).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"); }

    // --- Per-Model Breakdown Panel ---
    const totalUnits = currentMetrics.throughputUnitsPerDay;
    const totalLabor = currentOpInputs.numEmployees * currentOpInputs.opHours * currentFinInputs.laborCost;
    const perModelData = [];
    const models = [{ key: 'super', sell: 'superSell', cogs: 'superCogs' }, { key: 'ultra', sell: 'ultraSell', cogs: 'ultraCogs' }, { key: 'mega', sell: 'megaSell', cogs: 'megaCogs' }];
    models.forEach(model => {
        const units = totalUnits * BUILD_RATIOS[model.key];
        const sales = units * currentFinInputs[model.sell];
        const cogs = units * currentFinInputs[model.cogs];
        const labor = totalLabor * BUILD_RATIOS[model.key];
        perModelData.push({ label: model.key.charAt(0).toUpperCase() + model.key.slice(1), value: sales - cogs - labor, sales, cogs, labor });
    });
    const totalSales = perModelData.reduce((sum, d) => sum + d.sales, 0);
    const totalCogs = perModelData.reduce((sum, d) => sum + d.cogs, 0);
    const totalProfit = perModelData.reduce((sum, d) => sum + d.value, 0);

    const topHalf = breakdownGroup.append("g");
    const bottomHalf = breakdownGroup.append("g").attr("transform", `translate(0, ${height / 2})`);
    const panelPadding = breakdownWidth * 0.1; // Increase padding to shrink content

    // --- Bottom Half: Bar Chart ---
    const barMargin = { top: 30, right: 25, bottom: 40, left: 60 };
    const barContentHeight = (height / 2) - (panelPadding * 2);
    const barContentWidth = breakdownWidth - (panelPadding * 2);
    const barHeight = barContentHeight - barMargin.top - barMargin.bottom;
    const barWidth = barContentWidth - barMargin.left - barMargin.right;

    bottomHalf.append("rect").attr("class", "breakdown-border")
        .attr("x", panelPadding / 2).attr("y", panelPadding / 2)
        .attr("width", breakdownWidth - panelPadding)
        .attr("height", height / 2 - panelPadding);
    const barChartGroup = bottomHalf.append("g").attr("transform", `translate(${barMargin.left + 30 + panelPadding / 2}, ${barMargin.top + 10 + panelPadding / 2})`);

    const xBar = d3.scaleBand().domain(perModelData.map(d => d.label)).range([0, barWidth]).padding(0.2);
    const yBar = d3.scaleLinear().domain([0, d3.max(perModelData, d => d.value)]).nice().range([barHeight, 0]);
    barChartGroup.append("g").call(d3.axisLeft(yBar).ticks(5).tickFormat(d3.format("$,.0f")));
    barChartGroup.append("g").attr("transform", `translate(0, ${barHeight})`).call(d3.axisBottom(xBar));
    barChartGroup.append("text").attr("class", "axis-label").attr("text-anchor", "middle").attr("x", barWidth / 2).attr("y", barHeight + barMargin.bottom - 5).text("Model");
    barChartGroup.append("text").attr("class", "axis-label").attr("transform", "rotate(-90)").attr("text-anchor", "middle").attr("y", -barMargin.left + 15).attr("x", -barHeight / 2).text("Gross Profit ($)");
    const bars = barChartGroup.selectAll("rect").data(perModelData).join("rect")
        .attr("x", d => xBar(d.label)).attr("y", d => yBar(Math.max(0, d.value))).attr("width", xBar.bandwidth()).attr("height", d => barHeight - yBar(Math.max(0, d.value)))
        .attr("fill", d => PERT_PIE_COLORS[d.label.toLowerCase()]);
    bars.on("mouseover", () => tooltip.style("opacity", 1)).on("mouseout", () => tooltip.style("opacity", 0))
        .on("mousemove", (event, d) => tooltip.html(`<strong>${d.label} Profit</strong><br/>${d3.format("$,.0f")(d.value)}`).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"));

    // --- Top Half: Pie Charts ---
    const pieColors = { Profit: '#2ecc71', Labor: '#f39c12', COGS: '#e74c3c' };
    const pieChartData = [
        { title: 'Overall', data: { Profit: totalProfit, Labor: totalLabor, COGS: totalCogs } },
        { title: 'Super', data: { Profit: perModelData[0].value, Labor: perModelData[0].labor, COGS: perModelData[0].cogs } },
        { title: 'Ultra', data: { Profit: perModelData[1].value, Labor: perModelData[1].labor, COGS: perModelData[1].cogs } },
        { title: 'Mega', data: { Profit: perModelData[2].value, Labor: perModelData[2].labor, COGS: perModelData[2].cogs } }
    ];
    const pieGrid = topHalf.append("g");
    pieGrid.append("rect").attr("class", "breakdown-border").attr("x", panelPadding / 2).attr("y", panelPadding / 2).attr("width", breakdownWidth - panelPadding).attr("height", height / 2 - panelPadding);

    const topHalfHeight = height / 2;
    const pieContentWidth = breakdownWidth - (panelPadding * 2);
    const pieContentHeight = topHalfHeight - (panelPadding * 2);

    const pieRadius = Math.min(pieContentWidth / 4, pieContentHeight / 4) * 0.8;
    const gridPositions = [
        { x: panelPadding + (pieContentWidth * 0.25), y: panelPadding + (pieContentHeight * 0.3) },
        { x: panelPadding + (pieContentWidth * 0.75), y: panelPadding + (pieContentHeight * 0.3) },
        { x: panelPadding + (pieContentWidth * 0.25), y: panelPadding + (pieContentHeight * 0.75) },
        { x: panelPadding + (pieContentWidth * 0.75), y: panelPadding + (pieContentHeight * 0.75) }
    ];

    const pie = d3.pie().value(d => d.value).sort(null);
    const arc = d3.arc().innerRadius(0).outerRadius(pieRadius);
    pieChartData.forEach((chartData, i) => {
        const pieGroup = pieGrid.append("g").attr("transform", `translate(${gridPositions[i].x}, ${gridPositions[i].y - 15})`);
        const dataForPie = Object.entries(chartData.data).map(([key, value]) => ({ label: key, value: Math.max(0, value) }));
        const totalValue = dataForPie.reduce((sum, d) => sum + d.value, 0);
        pieGroup.selectAll("path").data(pie(dataForPie)).join("path")
            .attr("d", arc)
            .attr("fill", d => pieColors[d.data.label])
            .on("mouseover", () => tooltip.style("opacity", 1)).on("mouseout", () => tooltip.style("opacity", 0))
            .on("mousemove", (event, d) => {
                const percent = totalValue > 0 ? (d.data.value / totalValue * 100).toFixed(1) : 0;
                tooltip.html(`<strong>${chartData.title}: ${d.data.label}</strong><br/>
${d3.format("$,.0f")(d.data.value)} (${percent}%)`)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            });
        pieGroup.append("text").attr("class", "pie-title").attr("y", -pieRadius - 8).text(chartData.title);
    });

    const legendGroup = topHalf.append("g").attr("transform", `translate(${panelPadding}, ${topHalfHeight - panelPadding - 15})`);
    const legendData = Object.entries(pieColors).map(([label, color]) => ({ label, color }));
    const legendItemWidth = (breakdownWidth - 2 * panelPadding) / legendData.length;
    const legendItems = legendGroup.selectAll(".legend-item").data(legendData).join("g")
        .attr("class", "legend-item")
        .attr("transform", (d, i) => `translate(${i * legendItemWidth}, 0)`);
    legendItems.append("rect").attr("width", 13).attr("height", 13).attr("fill", d => d.color);
    legendItems.append("text").attr("x", 18).attr("y", 11).style("font-size", "12px").style("font-weight", "600").text(d => d.label);
}

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
    return 'profitDataCache-' + JSON.stringify(finInputs);
}

function initializeAndRunProfitCalculation() {
    const cacheKey = getFinancialInputsKey();
    try {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
            console.log("Loading profit data from session cache.");
            profitMaximizationCache = { key: cacheKey, data: JSON.parse(cachedData) };
            if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') {
                drawProfitPanel();
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
    const key = getFinancialInputsKey();

    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'profit') {
        drawProfitPanel();
    }

    return new Promise(resolve => {
        setTimeout(() => {
            const profitData = [];
            const marginData = [];
            const originalStateConfig = state.configData;
            try {
                state.configData = originalConfigData;
                for (let demand = 1; demand <= 576; demand++) {
                    let maxProfit = -Infinity, maxMargin = -Infinity;
                    let maxProfitConfig = { emp: 0, hrs: 0 }, maxMarginConfig = { emp: 0, hrs: 0 };

                    for (let opHours = 1; opHours <= 24; opHours += 0.25) {
                        const taktTime = (opHours * 60) / demand;
                        for (let numEmployees = 3; numEmployees <= 13; numEmployees++) {
                            if (!originalConfigData[numEmployees] || Object.keys(originalConfigData[numEmployees]).length === 0) continue;

                            const bottleneckTime = calculateWorkstationDetails(numEmployees).bottleneckTime;
                            if (bottleneckTime > 0 && bottleneckTime <= taktTime) {
                                const metrics = calculateMetrics({ dailyDemand: demand, opHours, numEmployees }, finInputs);
                                if (metrics) {
                                    if (metrics.dailyGrossProfit > maxProfit) {
                                        maxProfit = metrics.dailyGrossProfit;
                                        maxProfitConfig = { emp: numEmployees, hrs: opHours };
                                    }
                                    if (metrics.grossProfitMargin > maxMargin) {
                                        maxMargin = metrics.grossProfitMargin;
                                        maxMarginConfig = { emp: numEmployees, hrs: opHours };
                                    }
                                }
                            }
                        }
                    }
                    profitData.push({ demand, value: isFinite(maxProfit) ? maxProfit : 0, config: maxProfitConfig });
                    marginData.push({ demand, value: isFinite(maxMargin) ? maxMargin : 0, config: maxMarginConfig });
                }
            } finally {
                state.configData = originalStateConfig;
            }

            const calculatedData = { profitData, marginData };
            profitMaximizationCache = { key, data: calculatedData };

            try {
                sessionStorage.setItem(key, JSON.stringify(calculatedData));
                console.log("Profit data saved to session cache.");
            } catch (e) {
                console.error("Could not save profit data to session storage.", e);
            }

            isProfitCalculating = false;
            if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') {
                drawProfitPanel();
            }
            resolve();
        }, 50);
    });
}

/**
 * Layout - Determines if a given element works on a given model.
 */
function doesElementBuildModel(elementId, modelId) {
    const task = state.taskData.get(elementId);
    if (!task) return false;
    const modelMap = { 1: 'Super', 2: 'Ultra', 3: 'Mega' };
    const modelFieldName = modelMap[modelId];
    return task[modelFieldName] > 0;
}

/**
 * Halts all running animations.
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
* Layout - Initialize the Simulation for a given configuration.
*/
function startSimulation(config) {
    stopAllSimulations();
    let {
        svg, g, masterPathNode, productionQueue, totalDurationMs, launchDelayMs,
        binConfig, opHours, scale, elementMap
    } = config;
    if (!masterPathNode || totalDurationMs <= 0 || launchDelayMs <= 0) {
        console.warn("Animation aborted due to invalid parameters.");
        return;
    }
    animationState.layout.isRunning = true;
    const modelColors = { 1: '#3498db', 2: '#f1c40f', 3: '#e74c3c' };
    const modelBorders = { 1: '#f39c12', 2: '#8e44ad', 3: '#1abc9c' };
    animationState.layout = {
        svg, g, masterPathNode, productionQueue, totalDurationMs, launchDelayMs,
        binConfig, opHours, scale, elementMap,
        isRunning: true,
        lastFrameTime: performance.now(),
        totalSimTimeMs: 0,
        nextLaunchTime: 0,
        productsOnLine: [],
        queueIndex: 0,
        finishedGoodsCount: 0,
        pathLength: masterPathNode.getTotalLength()
    };

    function animationLoop(currentTime) {
        if (!animationState.layout.isRunning) return;
        const speedMultiplier = animationState.speedMultiplier;
        const realDeltaMs = currentTime - animationState.layout.lastFrameTime;
        animationState.layout.lastFrameTime = currentTime;
        const simDeltaMs = realDeltaMs * speedMultiplier;
        animationState.layout.totalSimTimeMs += simDeltaMs;
        const elapsedSimTimeMsForClock = animationState.layout.totalSimTimeMs * 60;
        const simSeconds = elapsedSimTimeMsForClock / 1000;
        const simMinutes = simSeconds / 60;
        const simHours = simMinutes / 60;
        const minuteAngle = (simMinutes % 60) / 60 * 360;
        const hourAngle = ((simHours % 12) / 12 * 360);
        d3.select("#sim-clock-minute-hand").attr("transform", `rotate(${minuteAngle})`);
        d3.select("#sim-clock-hour-hand").attr("transform", `rotate(${hourAngle})`);
        if (animationState.layout.totalSimTimeMs >= animationState.layout.nextLaunchTime && animationState.layout.queueIndex < animationState.layout.productionQueue.length) {
            const modelId = animationState.layout.productionQueue[animationState.layout.queueIndex];
            animationState.layout.productsOnLine.push({
                modelId: modelId,
                launchTime: animationState.layout.totalSimTimeMs,
                element: createProductShape(g, modelId, modelColors, modelBorders)
            });
            animationState.layout.queueIndex++;
            animationState.layout.nextLaunchTime += animationState.layout.launchDelayMs;
        }
        for (let i = animationState.layout.productsOnLine.length - 1; i >= 0; i--) {
            const product = animationState.layout.productsOnLine[i];
            const elapsedTime = animationState.layout.totalSimTimeMs - product.launchTime;
            const progress = elapsedTime / animationState.layout.totalDurationMs;
            if (progress >= 1) {
                placeInBin(product.element, animationState.layout.finishedGoodsCount, animationState.layout.binConfig, animationState.layout.svg);
                animationState.layout.finishedGoodsCount++;
                animationState.layout.productsOnLine.splice(i, 1);
            } else {
                const distance = animationState.layout.pathLength * progress;
                const pos = animationState.layout.masterPathNode.getPointAtLength(distance);
                const nextPos = animationState.layout.masterPathNode.getPointAtLength(distance + 1);
                const angle = Math.atan2(nextPos.y - pos.y, nextPos.x - pos.x) * 180 / Math.PI;
                product.element.attr('transform', `translate(${pos.x},${pos.y}) rotate(${angle})`);
                const currentSegment = elementMap.find(e => distance >= e.startDist && distance < e.endDist);
                const builds = currentSegment ? doesElementBuildModel(currentSegment.elementId, product.modelId) : false;
                product.element.attr('fill', builds ? modelColors[product.modelId] : '#cccccc');
            }
        }
        if (animationState.layout.productsOnLine.length > 0 || animationState.layout.queueIndex < animationState.layout.productionQueue.length) {
            animationState.layout.frameId = requestAnimationFrame(animationLoop);
        } else {
            animationState.layout.isRunning = false;
        }
    }
    animationState.layout.frameId = requestAnimationFrame(animationLoop);
}

/**
* Layout - Creates 'Product' shapes for animated flow.
*/
function createProductShape(container, modelId, modelColors, modelBorders) {
    const modelShapes = { 1: 'square', 2: 'triangle', 3: 'circle' };
    const shapeType = modelShapes[modelId];
    const shapeSize = 1.6;
    let shape;
    if (shapeType === 'circle') {
        shape = container.append("circle").attr("r", shapeSize / 2);
    } else if (shapeType === 'square') {
        shape = container.append("rect").attr("x", -shapeSize / 2).attr("y", -shapeSize / 2).attr("width", shapeSize).attr("height", shapeSize);
    } else if (shapeType === 'triangle') {
        const h = shapeSize * (Math.sqrt(3) / 2);
        shape = container.append("polygon").attr("points", `0,${-h / 1.5} ${shapeSize / 1.5},${h / 2} ${-shapeSize / 1.5},${h / 2}`);
    }
    if (shape) {
        shape.attr("fill", modelColors[modelId])
            .attr("stroke", modelBorders[modelId])
            .attr("stroke-width", 0.25)
            .style("filter", "url(#smooth-shadow)");
    }
    return shape;
}

/**
* Layout - Moves 'Built' Product into the Finished Goods Bin.
*/
function placeInBin(element, count, binConfig, svg) {
    const { binPixelX, binPixelY_bottom, itemsPerRow, productPixelSize, padding } = binConfig;
    const row = Math.floor(count / itemsPerRow);
    const col = count % itemsPerRow;

    // Re-parent the DOM node to move it from the scaled group to the main SVG.
    if (svg && svg.node() && element && element.node()) {
        svg.node().appendChild(element.node());
    }

    // Immediately remove the old transform to prevent the "flicker" jump.
    element.attr('transform', null);

    // Calculate the total size of one "cell" (product + padding).
    const totalCellSize = productPixelSize + padding;

    // Position the element in the center of its calculated grid cell.
    const newX = binPixelX + (col * totalCellSize) + (productPixelSize / 2);
    const newY = binPixelY_bottom - (row * totalCellSize) - (productPixelSize / 2);
    const newScale = productPixelSize / 1.8;

    element.transition().duration(300)
        .attr('transform', `translate(${newX}, ${newY}) rotate(0) scale(${newScale})`);
}

/**
* Layout - Renders the U-shaped assembly line layout and initializes the animation.
*/
function drawLayoutVisualization() {
    stopAllSimulations();
    const numEmployees = parseInt(numEmployeesInput.value);
    const svg = d3.select("#layout-panel");
    svg.selectAll("*").remove();
    const config = state.configData[numEmployees];
    if (!config || Object.keys(config).length === 0) {
        svg.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").attr("fill", "black")
            .text("No configuration data for this number of workstations.");
        return;
    }
    let isLayoutValid = true;
    for (const stationId in config) {
        const elements = config[stationId];
        if (!elements || elements.length === 0) continue;
        const totalElementTime = elements.reduce((sum, elId) => sum + (state.taskData.get(elId)?.elementTime || 0), 0);
        const stationLengthFt = totalElementTime * 15;
        if (stationLengthFt > 0 && stationLengthFt < 13) {
            isLayoutValid = false;
            break;
        }
    }
    if (!isLayoutValid) {
        demandStatusEl.textContent = "Invalid Spacing";
        demandStatusEl.className = "status failure";
        svg.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").attr("fill", "red")
            .text("Error: A workstation's length is less than 13 feet.");
        return;
    }
    const opInputs = { dailyDemand: parseInt(dailyDemandInput.value), opHours: parseFloat(opHoursInput.value), numEmployees: parseInt(numEmployeesInput.value) };
    const finInputs = { laborCost: parseFloat(laborCostInput.value) };
    const results = calculateMetrics(opInputs, finInputs);

    const { clientWidth: containerWidth, clientHeight: containerHeight } = document.getElementById('svg-container');
    const leftPanelWidth = containerWidth * 0.8;
    const rightPanelWidth = containerWidth * 0.2;
    const rightPanelX = leftPanelWidth;
    const uiPadding = containerWidth * 0.01;

    const isEven = numEmployees % 2 === 0;
    const numLeft = isEven ? numEmployees / 2 : Math.floor(numEmployees / 2);
    const middleWsId = isEven ? null : numLeft + 1;
    let connectionPoint;
    const allPaths = [], allPoints = [];
    let workstationBorders = [];
    for (let i = 1; i <= numEmployees; i++) {
        const wsId = i;
        const elements = config[wsId];
        if (!elements || elements.length === 0) continue;
        const totalElementTime = elements.reduce((sum, elId) => sum + (state.taskData.get(elId)?.elementTime || 0), 0);
        const totalLengthFt = totalElementTime * 15;
        let p;
        if (wsId === middleWsId) {
            const startPt = { x: 0, y: numLeft * 10 }, endPt = { x: 10, y: numLeft * 10 };
            const horizontal_segment_ft = 10;
            const vertical_leg_ft = Math.max(0, (totalLengthFt - horizontal_segment_ft) / 2);
            p = [startPt, { x: startPt.x, y: startPt.y + vertical_leg_ft }, { x: endPt.x, y: endPt.y + vertical_leg_ft }, endPt];
        } else {
            let startPt, endPt, out_dx, out_dy;
            if (wsId <= numLeft) {
                startPt = { x: 0, y: (wsId - 1) * 10 }; endPt = { x: 0, y: wsId * 10 }; out_dx = -1; out_dy = 0;
            } else {
                const mirroredIndex = (isEven ? numLeft : numLeft + 1) - (wsId - numLeft - 1);
                startPt = { x: 10, y: mirroredIndex * 10 }; endPt = { x: 10, y: (mirroredIndex - 1) * 10 }; out_dx = 1; out_dy = 0;
            }
            if (isEven && (wsId === numLeft || wsId === numLeft + 1)) {
                const leg_to_center = 5, leg_from_main = 2, mouth_ft = 6;
                const extension_ft = Math.max(0, (totalLengthFt - leg_to_center - mouth_ft - leg_from_main) / 2);
                if (wsId === numLeft) {
                    p = [startPt, { x: startPt.x, y: startPt.y + leg_from_main }, { x: startPt.x - extension_ft, y: startPt.y + leg_from_main }, { x: startPt.x - extension_ft, y: startPt.y + leg_from_main + mouth_ft }, { x: startPt.x, y: startPt.y + leg_from_main + mouth_ft }, { x: startPt.x + leg_to_center, y: startPt.y + leg_from_main + mouth_ft }];
                    connectionPoint = p[p.length - 1];
                } else {
                    startPt = connectionPoint; endPt = { x: 10, y: (numLeft - 1) * 10 };
                    p = [startPt, { x: startPt.x + leg_to_center, y: startPt.y }, { x: startPt.x + leg_to_center + extension_ft, y: startPt.y }, { x: startPt.x + leg_to_center + extension_ft, y: startPt.y - mouth_ft }, { x: startPt.x + leg_to_center, y: startPt.y - mouth_ft }, endPt];
                }
            } else {
                const leg1_ft = 2, leg2_ft = 2, mouth_ft = 6;
                const extension_ft = Math.max(0, (totalLengthFt - leg1_ft - leg2_ft - mouth_ft) / 2);
                const dx = Math.sign(endPt.x - startPt.x), dy = Math.sign(endPt.y - startPt.y);
                p = [startPt, { x: startPt.x + dx * leg1_ft, y: startPt.y + dy * leg1_ft }, { x: startPt.x + dx * leg1_ft + out_dx * extension_ft, y: startPt.y + dy * leg1_ft + out_dy * extension_ft }, { x: startPt.x + dx * (leg1_ft + mouth_ft) + out_dx * extension_ft, y: startPt.y + dy * (leg1_ft + mouth_ft) + out_dy * extension_ft }, { x: endPt.x - dx * leg2_ft, y: endPt.y - dy * leg2_ft }, endPt];
            }
        }
        allPoints.push(...p);
        if (p && p.length > 1) {
            let borderPathString = "M " + p[0].x + " " + p[0].y;
            for (let j = 1; j < p.length; j++) { borderPathString += " L " + p[j].x + " " + p[j].y; }
            workstationBorders.push({ wsID: i, path: borderPathString });
        }
        const elementColorScale = generateElementColorScale(i - 1, numEmployees, elements.length);
        let currentPathPosFt = 0;
        elements.forEach((elId, index) => {
            const task = state.taskData.get(elId);
            let lineCap = 'round';
            if (index === 0 || index === elements.length - 1) { lineCap = 'butt'; }
            allPaths.push({
                wsId: i, elId: elId, path: generateSubPath(p, currentPathPosFt, (task?.elementTime || 0) * 15),
                color: elementColorScale(index), lineCap: lineCap
            });
            currentPathPosFt += (task?.elementTime || 0) * 15;
        });
    }
    if (allPoints.length === 0) return;
    const minX_ft = d3.min(allPoints, d => d.x), maxX_ft = d3.max(allPoints, d => d.x);
    const minY_ft = d3.min(allPoints, d => d.y), maxY_ft = d3.max(allPoints, d => d.y);
    if ((maxX_ft - minX_ft) <= 0 || (maxY_ft - minY_ft) <= 0) return;

    const lineBBox = { width: maxX_ft - minX_ft, height: maxY_ft - minY_ft };
    const availableLineWidth = leftPanelWidth - (uiPadding * 2);
    const availableLineHeight = containerHeight - (uiPadding * 2);
    const scale = Math.min(availableLineWidth / lineBBox.width, availableLineHeight / lineBBox.height);
    const scaledLineWidth = lineBBox.width * scale;
    const leftPadding = (leftPanelWidth - scaledLineWidth) / 2;
    const translateX = (leftPadding - (minX_ft * scale));
    const translateY = uiPadding - (minY_ft * scale);
    const g = svg.append("g").attr("transform", `translate(${translateX}, ${translateY}) scale(${scale})`).attr("fill", "none");

    const clockY = containerHeight * 0.075;
    const clockX = rightPanelX + (rightPanelWidth / 2);
    const clockRadius = Math.min(rightPanelWidth * 0.4, containerHeight * 0.15 * 0.4);

    const speedoY = containerHeight * 0.225;
    const speedoX = clockX;
    const speedoRadius = Math.min(rightPanelWidth * 0.4, containerHeight * 0.15 * 0.4);

    // --- BIN CONFIGURATION & CALCULATION (FIXED) ---
    const binPadding = 15;
    const binTopY = containerHeight * 0.30;
    const binHeight = containerHeight * 0.70 - (binPadding * 2);
    let binContentWidth = rightPanelWidth - (binPadding * 2);
    let binContentHeight = binHeight;
    if (binContentWidth <= 0 || binContentHeight <= 0) { // Safety check
        binContentWidth = 1;
        binContentHeight = 1;
    }
    const capacity = 600;
    const aspectRatio = binContentWidth / binContentHeight;
    let numRows = Math.round(Math.sqrt(capacity / aspectRatio));
    if (numRows < 1) numRows = 1;
    let numCols = Math.ceil(capacity / numRows);
    if (numCols < 1) numCols = 1;
    const itemSizeWithPadding = Math.min(binContentWidth / numCols, binContentHeight / numRows);
    const itemPadding = itemSizeWithPadding * 0.1;
    const finalItemSize = itemSizeWithPadding - itemPadding;

    const binConfig = {
        productPixelSize: finalItemSize,
        itemsPerRow: numCols,
        padding: itemPadding,
        binPixelX: rightPanelX + binPadding,
        binPixelY_bottom: containerHeight - binPadding,
    };
    // --- END BIN FIX ---

    const clockGroup = svg.append("g").attr("transform", `translate(${clockX}, ${clockY})`);
    clockGroup.append("circle").attr("r", clockRadius).attr("fill", "#ecf0f1").attr("stroke", "#333").attr("stroke-width", 2);
    for (let i = 0; i < 12; i++) { const angle = (i / 12) * 2 * Math.PI; const tickLength = i % 3 === 0 ? 8 : 4; clockGroup.append("line").attr("x1", Math.sin(angle) * (clockRadius - tickLength)).attr("y1", -Math.cos(angle) * (clockRadius - tickLength)).attr("x2", Math.sin(angle) * clockRadius).attr("y2", -Math.cos(angle) * clockRadius).attr("stroke", "#333").attr("stroke-width", i % 3 === 0 ? 2 : 1); }
    clockGroup.append("line").attr("id", "sim-clock-hour-hand").attr("y2", -clockRadius * 0.5).attr("stroke", "#e74c3c").attr("stroke-width", 4).attr("stroke-linecap", "round");
    clockGroup.append("line").attr("id", "sim-clock-minute-hand").attr("y2", -clockRadius * 0.8).attr("stroke", "#e74c3c").attr("stroke-width", 2).attr("stroke-linecap", "round");
    clockGroup.append("circle").attr("r", 4).attr("fill", "#34495e");

    const sliderTopPadding = uiPadding;
    const sliderHeight = containerHeight * 0.15 - sliderTopPadding;
    const sliderGroup = svg.append("g").attr("transform", `translate(${clockX + clockRadius + 25}, ${sliderTopPadding})`);
    const speedScale = d3.scaleLinear().domain([8.0, 0.1]).range([0, sliderHeight]).clamp(true);
    sliderGroup.append("line").attr("y1", 0).attr("y2", sliderHeight).attr("stroke", "#aaa").attr("stroke-width", 4).attr("stroke-linecap", "round");
    sliderGroup.append("circle").attr("id", "d3-layout-slider-handle").attr("class", "handle").attr("r", 8).attr("fill", "#3498db").attr("stroke", "#fff").attr("stroke-width", 2).attr("cy", speedScale(animationState.speedMultiplier));
    const interactionArea = sliderGroup.append("rect").attr("y", 0).attr("height", sliderHeight).attr("x", -10).attr("width", 20).style("fill", "transparent").style("cursor", "grab");
    interactionArea.call(d3.drag().on("drag", function (event) { const [, my] = d3.pointer(event, this.parentNode); const newValue = speedScale.invert(my); animationState.speedMultiplier = newValue; d3.select("#d3-layout-slider-handle").attr("cy", speedScale(newValue)); }));
    interactionArea.on("wheel", function (event) { event.preventDefault(); const newValue = Math.max(0.1, Math.min(8.0, animationState.speedMultiplier + (event.deltaY > 0 ? -0.1 : 0.1))); animationState.speedMultiplier = newValue; d3.select("#d3-layout-slider-handle").transition().duration(50).attr("cy", speedScale(newValue)); });

    const speedoGroup = svg.append("g").attr("transform", `translate(${speedoX}, ${speedoY})`);
    const speedoDomain = [0, 15];
    const degreeScale = d3.scaleLinear().domain(speedoDomain).range([-90, 90]);
    const radianScale = d3.scaleLinear().domain(speedoDomain).range([-Math.PI / 2, Math.PI / 2]);
    const arcGenerator = d3.arc().innerRadius(speedoRadius * 0.7).outerRadius(speedoRadius).cornerRadius(3);
    const arcs = [{ start: 0, end: 4, color: "#3498db" }, { start: 4, end: 10, color: "#2ecc71" }, { start: 10, end: 15, color: "#e74c3c" }];
    speedoGroup.selectAll("path.color-arc").data(arcs).join("path").attr("fill", d => d.color).attr("d", d => arcGenerator({ startAngle: radianScale(d.start), endAngle: radianScale(d.end) }));
    const ticks = degreeScale.ticks(6);
    speedoGroup.selectAll("text.tick-label").data(ticks).join("text").attr("x", d => Math.sin(radianScale(d)) * (speedoRadius + 12)).attr("y", d => -Math.cos(radianScale(d)) * (speedoRadius + 12)).attr("text-anchor", "middle").attr("dominant-baseline", "central").style("font-size", "10px").style("font-weight", "700").text(d => d);
    speedoGroup.append("line").attr("id", "speedo-needle").attr("y1", 10).attr("y2", -speedoRadius * 0.9).attr("stroke", "#34495e").attr("stroke-width", 3).attr("stroke-linecap", "round").attr("transform", `rotate(${degreeScale(Math.min(speedoDomain[1], results.conveyorSpeed || 0))})`);
    speedoGroup.append("circle").attr("r", 6).attr("fill", "#34495e").attr("stroke", "white").attr("stroke-width", 2);
    speedoGroup.append("text").text(`${(results.conveyorSpeed || 0).toFixed(1)}`).attr("y", speedoRadius * 0.45).attr("text-anchor", "middle").style("font-size", "18px").style("font-weight", "bold");
    speedoGroup.append("text").text("ft/min").attr("y", speedoRadius * 0.75).attr("text-anchor", "middle").style("font-size", "10px");

    svg.append("rect").attr("x", rightPanelX + binPadding / 2).attr("y", binTopY).attr("width", rightPanelWidth - binPadding).attr("height", containerHeight * 0.7 - uiPadding).attr("fill", "#E5E7E9").attr("stroke", "#666").attr("stroke-width", 1);
    svg.append("text").text("Finished Goods").attr("x", rightPanelX + rightPanelWidth / 2).attr("y", binTopY + 20).attr("text-anchor", "middle").style("font-size", "14px").style("font-weight", "bold");

    const legendGroup = svg.append("g").attr("transform", `translate(${uiPadding}, ${containerHeight - 130})`);
    legendGroup.append("rect").attr("width", 160).attr("height", 120).attr("fill", "rgba(255,255,255,0.8)").attr("rx", 5).attr("stroke", "#ccc");
    legendGroup.append("text").text("Built Models").attr("x", 10).attr("y", 20).style("font-weight", "bold").attr("fill", "black");
    const legendModels = [{ id: 1, name: "Super" }, { id: 2, name: "Ultra" }, { id: 3, name: "Mega" }];
    const modelColors = { 1: '#3498db', 2: '#f1c40f', 3: '#e74c3c' };
    const modelBorders = { 1: '#f39c12', 2: '#8e44ad', 3: '#1abc9c' };
    legendModels.forEach((model, i) => { const item = legendGroup.append("g").attr("transform", `translate(20, ${40 + i * 22})`); createProductShape(item, model.id, modelColors, modelBorders).attr("transform", "scale(8)"); item.append("text").text(model.name).style('font-weight', 650).attr("x", 20).attr("y", 4).attr("fill", "black"); });
    legendGroup.append("text").text("Grid: 10ft x 10ft").attr("x", 10).attr("y", 110).style("font-style", "italic").attr("fill", "black");
    const gridGroup = g.append("g");
    const gridBounds = { x1: (0 - translateX) / scale, y1: (0 - translateY) / scale, x2: (containerWidth - translateX) / scale, y2: (containerHeight - translateY) / scale };
    for (let x = Math.floor(gridBounds.x1 / 10) * 10; x <= gridBounds.x2; x += 10) { gridGroup.append("line").attr("x1", x).attr("y1", gridBounds.y1).attr("x2", x).attr("y2", gridBounds.y2); }
    for (let y = Math.floor(gridBounds.y1 / 10) * 10; y <= gridBounds.y2; y += 10) { gridGroup.append("line").attr("x1", gridBounds.x1).attr("y1", y).attr("x2", gridBounds.x2).attr("y2", y); }
    gridGroup.selectAll("line").attr("stroke", "rgba(0,0,0,0.1)").attr("stroke-width", 0.2);
    const buttPaths = allPaths.filter(p => p.lineCap === 'butt');
    const roundPaths = allPaths.filter(p => p.lineCap === 'round');
    const drawElementPaths = (selection) => { selection.append("path").attr("d", d => d.path).attr("stroke", "#333333").attr("stroke-width", 1.5).attr("stroke-linecap", d => d.lineCap); selection.append("path").attr("d", d => d.path).attr("stroke", d => d.color).attr("stroke-width", 1).attr("stroke-linecap", d => d.lineCap).append("title").text(d => `Element ${d.elId}\nWorkstation ${d.wsId}`); };
    g.selectAll("g.element-group-butt").data(buttPaths, d => `${d.wsId}-${d.elId}`).join("g").attr("class", "element-group-butt").call(drawElementPaths);
    g.selectAll("g.element-group-round").data(roundPaths, d => `${d.wsId}-${d.elId}`).join("g").attr("class", "element-group-round").call(drawElementPaths);
    g.selectAll("path.workstation-border").data(workstationBorders, d => d.wsId).join("path").attr("class", "workstation-border").attr("d", d => d.path).attr("fill", "none").attr("stroke", "#34495e").attr("stroke-width", 0.3).attr("stroke-linecap", "butt").attr("opacity", 0.6);
    const totalDurationMin = (ASSEMBLY_LINE_LENGTH / results.conveyorSpeed);
    const launchDelayMin = (results.productSpacing / results.conveyorSpeed);
    if (isFinite(totalDurationMin) && totalDurationMin > 0 && isFinite(launchDelayMin) && launchDelayMin > 0) {
        let masterPathString = "";
        allPaths.forEach((pathData, i) => { masterPathString += i === 0 ? pathData.path : pathData.path.replace('M', ' '); });
        const masterPathNode = g.append("path").attr("d", masterPathString).node();
        let cumulativeDist = 0;
        const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const elementMap = allPaths.map(p => { tempPath.setAttribute('d', p.path); const len = tempPath.getTotalLength(); const segment = { elementId: p.elId, startDist: cumulativeDist, endDist: cumulativeDist + len }; cumulativeDist += len; return segment; });
        startSimulation({
            svg, g, masterPathNode, elementMap,
            opHours: opInputs.opHours,
            productionQueue: generateProductionQueue(opInputs.dailyDemand),
            totalDurationMs: totalDurationMin * 1000,
            launchDelayMs: launchDelayMin * 1000,
            binConfig, scale
        });
    }
}

/**
* Layout - Helper function to generate a sub-path along a larger path defined by points.
*/
function generateSubPath(points, startFt, lengthFt) {
    let pathString = "M ";
    let traveledFt = 0;
    let started = false;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const segLenFt = Math.sqrt(Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2));
        if (!started && traveledFt + segLenFt >= startFt) {
            const ratio = segLenFt > 0 ? (startFt - traveledFt) / segLenFt : 0;
            const startX = prev.x + ratio * (curr.x - prev.x);
            const startY = prev.y + ratio * (curr.y - prev.y);
            pathString += `${startX} ${startY}`;
            started = true;
        }
        if (started) {
            if (traveledFt + segLenFt <= startFt + lengthFt) {
                pathString += ` L ${curr.x} ${curr.y}`;
            } else {
                const ratio = segLenFt > 0 ? (startFt + lengthFt - traveledFt) / segLenFt : 0;
                const endX = prev.x + ratio * (curr.x - prev.x);
                const endY = prev.y + ratio * (curr.y - prev.y);
                pathString += ` L ${endX} ${endY}`;
                return pathString;
            }
        }
        traveledFt += segLenFt;
    }
    return pathString;
}

/**
 * Schedule - Gathers data for the Gantt chart based on a more accurate physical simulation.
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
 * Schedule - Renders the scrolling Gantt chart animation, aligned with the left sidebar.
 */
function drawScheduleVisualization() {
    const svg = d3.select("#schedule-panel");
    svg.selectAll("*").remove();
    const simulationResult = runGanttSimulation();
    const { clientWidth: containerWidth, clientHeight: containerHeight } = document.getElementById('svg-container');
    if (!simulationResult || simulationResult.tasks.length === 0) {
        svg.append("text").attr("x", containerWidth / 2).attr("y", containerHeight / 2).attr("text-anchor", "middle").attr("fill", "#666")
            .text("No data to display. Check configuration or inputs.");
        return;
    }
    const { tasks } = simulationResult;
    const opHours = parseFloat(opHoursInput.value);
    const margin = { top: 40, right: 20, bottom: 20, left: 20 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;
    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const clockX = margin.left + 10;
    const clockY = 30;
    const clockGroup = svg.append("g").attr("transform", `translate(${clockX}, ${clockY})`);
    clockGroup.append("rect").attr("x", -10).attr("y", -15).attr("width", 100).attr("height", 20).attr("fill", "rgba(0,0,0,0.5)").attr("rx", 5);
    const clockDisplay = clockGroup.append("text").attr("id", "sim-clock-display").attr("fill", "white").style("font-size", "18px").style("font-family", "monospace").text("00:00");
    const sliderWidth = Math.min(150, containerWidth * 0.15);
    const sliderXStart = 0;
    const sliderXEnd = sliderWidth;
    const minVal = 0.1;
    const maxVal = 8.0;
    const sliderGroup = svg.append("g")
        .attr("transform", `translate(${clockX + 100}, ${clockY - 5})`);
    const speedScale = d3.scaleLinear()
        .domain([minVal, maxVal])
        .range([sliderXStart, sliderXEnd])
        .clamp(true);
    sliderGroup.append("line")
        .attr("class", "track")
        .attr("x1", sliderXStart)
        .attr("x2", sliderXEnd)
        .attr("stroke", "#aaa")
        .attr("stroke-width", 4)
        .attr("stroke-linecap", "round");
    sliderGroup.append("circle")
        .attr("id", "d3-schedule-slider-handle")
        .attr("class", "handle")
        .attr("r", 8)
        .attr("fill", "#3498db")
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .attr("cx", speedScale(animationState.speedMultiplier));
    const interactionArea = sliderGroup.append("rect")
        .attr("x", sliderXStart - 10)
        .attr("width", sliderWidth + 20)
        .attr("y", -10)
        .attr("height", 20)
        .style("fill", "transparent")
        .style("cursor", "grab");
    interactionArea.call(d3.drag().on("drag", function (event) {
        const [mx] = d3.pointer(event, this.parentNode);
        const newValue = speedScale.invert(mx);
        animationState.speedMultiplier = newValue;
        d3.select(this.parentNode).select(".handle").attr("cx", speedScale(newValue));
    }));
    interactionArea.on("wheel", function (event) {
        event.preventDefault();
        const scrollStep = 0.1;
        const currentValue = animationState.speedMultiplier;
        const change = event.deltaY > 0 ? -scrollStep : scrollStep;
        let newValue = currentValue + change;
        newValue = Math.max(minVal, Math.min(maxVal, newValue));
        animationState.speedMultiplier = newValue;
        d3.select(this.parentNode).select(".handle")
            .transition().duration(50)
            .attr("cx", speedScale(newValue));
    });
    const contentGroup = chart.append("g").attr("class", "schedule-content-group");
    const yOffset = document.getElementById('svg-container').getBoundingClientRect().top + margin.top;
    const elementGeometry = new Map();
    document.querySelectorAll('.element-row').forEach(elRow => {
        const taskId = parseInt(elRow.dataset.taskId);
        const rect = elRow.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const barHeight = rect.height * 0.8;
        const barY = (centerY - barHeight / 2) - yOffset;
        elementGeometry.set(taskId, { y: barY, height: barHeight });
    });
    document.querySelectorAll('.workstation-title').forEach(title => {
        const rect = title.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const lineY = centerY - yOffset;
        contentGroup.append("line")
            .attr("x1", -margin.left).attr("x2", width + margin.right)
            .attr("y1", lineY).attr("y2", lineY)
            .attr("stroke", "#34495e").attr("stroke-width", 3).attr("stroke-opacity", 0.75);
    });
    const VIEW_WINDOW_MINS = 10;
    const xScale = d3.scaleLinear().range([0, width]);
    const modelColors = d3.scaleOrdinal().domain([1, 2, 3]).range(['#3498db', '#f1c40f', '#e74c3c']);
    const timeMarker = chart.append("line").attr("x1", 0).attr("x2", 0).attr("y1", -margin.top).attr("y2", height + margin.bottom).attr("stroke", "red").attr("stroke-width", 2);
    timeMarker.append("title").text("Current Simulation Time");
    contentGroup.append("g").attr("class", "task-bars")
        .selectAll(".bar").data(tasks).enter().append("rect")
        .attr("class", "bar")
        .attr("y", d => elementGeometry.get(d.taskId)?.y || -100)
        .attr("height", d => elementGeometry.get(d.taskId)?.height || 0)
        .attr("fill", d => modelColors(d.modelId))
        .attr("stroke", "#333").attr("stroke-width", 0.5);
    const maxTime = tasks.length > 0 ? d3.max(tasks, d => d.endTime) : (opHours * 60);
    const totalSimDurationMinutes = maxTime;
    animationState.schedule = {
        isRunning: true,
        lastFrameTime: performance.now(),
        totalSimTimeMins: 0,
        frameId: null
    };
    function animationLoop(currentTime) {
        if (!animationState.schedule.isRunning) return;
        const speedMultiplier = animationState.speedMultiplier;
        const realDeltaMs = currentTime - animationState.schedule.lastFrameTime;
        animationState.schedule.lastFrameTime = currentTime;
        const simDeltaMs = realDeltaMs * 60 * speedMultiplier;
        animationState.schedule.totalSimTimeMins += simDeltaMs / 60000;
        const elapsedSimTimeMinutes = animationState.schedule.totalSimTimeMins;
        if (elapsedSimTimeMinutes > totalSimDurationMinutes) {
            animationState.schedule.isRunning = false;
            const finalHours = String(Math.floor(totalSimDurationMinutes / 60)).padStart(2, '0');
            const finalMinutes = String(Math.floor(totalSimDurationMinutes % 60)).padStart(2, '0');
            clockDisplay.text(`${finalHours}:${finalMinutes}`);
            return;
        }
        const h = String(Math.floor(elapsedSimTimeMinutes / 60)).padStart(2, '0');
        const m = String(Math.floor(elapsedSimTimeMinutes % 60)).padStart(2, '0');
        clockDisplay.text(`${h}:${m}`);
        const viewStartTime = elapsedSimTimeMinutes;
        xScale.domain([viewStartTime, viewStartTime + VIEW_WINDOW_MINS]);
        contentGroup.selectAll(".bar")
            .attr("x", d => xScale(d.startTime))
            .attr("width", d => Math.max(0, xScale(d.endTime) - xScale(d.startTime)));
        animationState.schedule.frameId = requestAnimationFrame(animationLoop);
    }
    workstationList.dispatchEvent(new Event('scroll'));
    animationState.schedule.frameId = requestAnimationFrame(animationLoop);
}

/**
 * Efficiency - Draws the per-workstation and line-level efficiency charts.
 */
function drawEfficiencyPanel() {
    let tooltip = d3.select("body").select(".eff-tooltip");
    if (tooltip.empty()) {
        tooltip = d3.select("body").append("div")
            .attr("class", "eff-tooltip")
            .style("position", "absolute")
            .style("pointer-events", "none")
            .style("background", "rgba(44, 62, 80, 0.9)")
            .style("color", "white")
            .style("padding", "8px 12px")
            .style("border-radius", "6px")
            .style("font-size", "12px")
            .style("opacity", 0)
            .style("transition", "opacity 0.2s");
    }
    const svg = d3.select("#efficiency-panel");
    const { clientWidth: panelWidth, clientHeight: panelHeight } = document.getElementById('svg-container');
    const opInputs = {
        dailyDemand: +dailyDemandInput.value,
        opHours: +opHoursInput.value,
        numEmployees: +numEmployeesInput.value
    };
    const finInputs = { laborCost: +laborCostInput.value };
    const results = calculateMetrics(opInputs, finInputs);
    if (!results || !results.workstations || results.workstations.length === 0) {
        svg.selectAll("*").remove();
        svg.append("text")
            .attr("x", panelWidth / 2)
            .attr("y", panelHeight / 2)
            .attr("text-anchor", "middle")
            .text("No data available for efficiency analysis.");
        return;
    }
    const root = svg.selectAll("g#eff-root")
        .data([null])
        .join(enter => enter.append("g").attr("id", "eff-root"));
    root.selectAll("g.ws").interrupt();
    const defs = root.selectAll("defs").data([null]).join("defs");
    const boxGradient = defs.selectAll("#box-gradient").data([null])
        .join("linearGradient")
        .attr("id", "box-gradient")
        .attr("x1", "0%").attr("y1", "0%")
        .attr("x2", "0%").attr("y2", "100%");
    boxGradient.selectAll("stop").data([
        { offset: "0%", color: "#8e44ad" },
        { offset: "100%", color: "#d032e3" }
    ]).join("stop")
        .attr("offset", d => d.offset)
        .attr("stop-color", d => d.color);
    function getLayoutConfig(n) {
        switch (n) {
            case 1: case 2: return [n];
            case 3: return [4, 5, 4];
            case 4: return [4, 5, 4];
            case 5: return [4, 5, 4];
            case 6: return [4, 5, 4];
            case 7: return [4, 5, 4];
            case 8: return [4, 5, 4];
            case 9: return [4, 5, 4];
            case 10: return [4, 5, 4];
            case 11: return [4, 5, 4];
            case 12: return [4, 5, 4];
            case 13: return [4, 5, 4];
            default:
                const rows = []; let temp_n = n;
                while (temp_n > 0) { rows.push(Math.min(temp_n, 4)); temp_n -= 4; }
                return rows;
        }
    }
    const padding = 20;
    const availableWidth = panelWidth - (2 * padding);
    const availableHeight = panelHeight - (2 * padding);
    const numWorkstations = results.workstations.length;
    const layoutConfig = getLayoutConfig(numWorkstations);
    const numLayoutRows = layoutConfig.length;
    const summaryRowWeight = 1.1;
    const totalRowWeights = numLayoutRows + summaryRowWeight;
    const singleRowUnitHeight = availableHeight / totalRowWeights;
    const summaryRowHeight = singleRowUnitHeight * summaryRowWeight;
    const workstationRowHeight = singleRowUnitHeight;
    const pieRadius = Math.min(availableWidth / 17.5, workstationRowHeight / 3);
    const clockRadius = pieRadius * 0.5;
    const positionMap = [];
    let stationIndex = 0;
    layoutConfig.forEach((colsInRow, rowIndex) => {
        for (let colIndex = 0; colIndex < colsInRow; colIndex++) {
            if (stationIndex < numWorkstations) {
                positionMap[stationIndex] = { row: rowIndex, col: colIndex, totalCols: colsInRow };
                stationIndex++;
            }
        }
    });
    const layoutTransform = (i) => {
        const pos = positionMap[i];
        if (!pos) return `translate(-100, -100)`;
        const y = padding + summaryRowHeight + (pos.row * workstationRowHeight) + (workstationRowHeight / 2);
        const itemWidth = availableWidth / pos.totalCols;
        const x = (1.1 * padding) + (pos.col * itemWidth) + (itemWidth / 2);
        return `translate(${x},${y})`;
    };
    const wsSel = root.selectAll("g.ws")
        .data(results.workstations, d => d.id);
    const wsEnter = wsSel.enter()
        .append("g")
        .attr("class", "ws")
        .attr("transform", (d, i) => layoutTransform(i));
    const centerDistance = (pieRadius + clockRadius) * 1.1;
    const pieOffsetX = -centerDistance / 2;
    const clockOffsetX = centerDistance / 2;
    wsEnter.append("g").attr("class", "pie").attr("transform", `translate(${pieOffsetX}, 0)`);
    wsEnter.append("g").attr("class", "clock").attr("transform", `translate(${clockOffsetX}, 0)`);
    wsEnter.append("text")
        .attr("class", "ws-heading")
        .attr("x", 0)
        .attr("text-anchor", "middle")
        .style("font-weight", "normal")
        .attr("fill", "black");
    const wsMerge = wsEnter.merge(wsSel);
    wsMerge.style("opacity", 1);
    wsMerge.transition().duration(750)
        .attr("transform", (d, i) => layoutTransform(i));
    wsMerge.select("g.pie")
        .attr("transform", `translate(${pieOffsetX}, 0)`);
    wsMerge.select("g.clock")
        .attr("transform", `translate(${clockOffsetX}, 0)`);
    wsMerge.select("text.ws-heading")
        .attr("y", -Math.max(pieRadius + workstationRowHeight * 0.05, workstationRowHeight * 0.35))
        .style("font-size", `${Math.max(Math.min(workstationRowHeight * 0.08, availableWidth / 4 * 0.06), 12)}px`)
        .text(d => `Workstation ${d.id}`);
    wsSel.exit().transition().duration(750).style("opacity", 0).remove();
    const arc = d3.arc().innerRadius(0).outerRadius(pieRadius);
    wsMerge.each(function (ws) {
        const totalOpMinutes = opInputs.opHours * 60;
        const productiveMinutes = ws.cycleTime * results.throughputUnitsPerDay;
        const productiveRatio = totalOpMinutes > 0 ? Math.min(1, productiveMinutes / totalOpMinutes) : 0;
        const productivePercentage = productiveRatio * 100;
        const pieGroup = d3.select(this).select("g.pie");
        const pieData = d3.pie().value(d => d.value).sort(null)([
            { label: "Productive", value: productiveRatio },
            { label: "Idle", value: 1 - productiveRatio }
        ]);
        const slices = pieGroup.selectAll("path.slice")
            .data(pieData, d => d.data.label);
        const slicesEnter = slices.enter()
            .append("path")
            .attr("class", "slice")
            .attr("fill", d => d.data.label === "Productive" ? "#329de3" : "#e37832")
            .attr("stroke", "#07283f")
            .attr("stroke-width", 1.5)
            .each(function (d) { this._current = { startAngle: 0, endAngle: 0 }; });
        slicesEnter.merge(slices)
            .transition().duration(750)
            .attrTween("d", function (d) {
                const i = d3.interpolate(this._current, d);
                this._current = i(1);
                return t => arc(i(t));
            });
        slices.exit().remove();
        const pieTextBg = pieGroup.selectAll("circle.pie-text-bg")
            .data([ws.efficiency]);
        pieTextBg.enter()
            .append("circle")
            .attr("class", "pie-text-bg")
            .attr("fill", "white")
            .attr("stroke", "#07283f")
            .attr("stroke-width", 1.5)
            .merge(pieTextBg)
            .attr("r", pieRadius * 0.33);
        const pieText = pieGroup.selectAll("text.pie-text").data([productivePercentage]);
        pieText.enter().append("text").attr("class", "pie-text")
            .attr("text-anchor", "middle")
            .attr("dy", "0.35em")
            .style("font-weight", "bold")
            .attr("fill", "#2c3e50")
            .merge(pieText)
            .style("font-size", `${Math.max(Math.min(pieRadius * 0.2, workstationRowHeight * 0.06), 8)}px`)
            .text(d => `${d.toFixed(1)}%`);
    });
    wsMerge.each(function (ws) {
        const totalOpMinutes = opInputs.opHours * 60;
        const productiveMinutes = ws.cycleTime * results.throughputUnitsPerDay;
        const idleMinutes = Math.max(0, totalOpMinutes - productiveMinutes);
        const idleHours = idleMinutes / 60;
        const clockGroup = d3.select(this).select("g.clock");
        clockGroup.selectAll("circle.face").data([null])
            .join("circle").attr("class", "face")
            .attr("r", clockRadius)
            .attr("fill", "#ecf0f1")
            .attr("stroke", "#333")
            .attr("stroke-width", Math.max(clockRadius * 0.04, 1));
        const clockMarks = clockGroup.selectAll("line.tick")
            .data(d3.range(0, 360, 30));
        const tickOuterRadius = clockRadius * 0.9;
        const tickInnerRadius = clockRadius * 0.75;
        clockMarks.enter().append("line").attr("class", "tick")
            .merge(clockMarks)
            .attr("x1", 0).attr("y1", -tickInnerRadius)
            .attr("x2", 0).attr("y2", -tickOuterRadius)
            .attr("stroke", "#333")
            .attr("stroke-width", (d) => d % 90 === 0 ? 1.5 : 1)
            .attr("transform", d => `rotate(${d})`);
        clockGroup.selectAll("circle.center").data([null])
            .join("circle").attr("class", "center")
            .attr("r", Math.max(clockRadius * 0.06, 2))
            .attr("fill", "#333");
        const angle = (idleHours % 12) / 12 * 360;
        const wsHand = clockGroup.selectAll("line.hand").data([angle]);
        wsHand.enter().append("line").attr("class", "hand")
            .attr("y2", -clockRadius * 0.8)
            .attr("stroke", "#e67e22").attr("stroke-width", Math.max(clockRadius * 0.08, 2))
            .attr("stroke-linecap", "round")
            .each(function (d) { this._current = d; })
            .merge(wsHand)
            .transition().duration(750)
            .attrTween("transform", function (d) {
                const i = d3.interpolate(this._current, d);
                this._current = i(1);
                return t => `rotate(${i(t)})`;
            });
        const idleText = clockGroup.selectAll("text.idle-text").data([idleHours]);
        idleText.enter().append("text").attr("class", "idle-text")
            .attr("text-anchor", "middle")
            .style("font-weight", "bold")
            .attr("fill", "black")
            .merge(idleText)
            .attr("y", clockRadius + clockRadius * 0.4)
            .style("font-size", `${Math.max(Math.min(clockRadius * 0.4, workstationRowHeight * 0.06), 10)}px`)
            .text(d => `${d.toFixed(1)}h idle`);
    });

    const summaryWidth = availableWidth;
    const summaryHeight = summaryRowHeight - (2 * padding);
    const summaryX = panelWidth / 2;
    const summaryY = padding + summaryRowHeight / 2;
    const summary = root.selectAll("g#eff-summary").data([null])
        .join(enter => {
            const summaryGroup = enter.append("g").attr("id", "eff-summary");
            summaryGroup.append("rect").attr("class", "summary-border")
                .attr("fill", "none")
                .attr("stroke", "#34495e")
                .attr("stroke-width", 2)
                .attr("stroke-dasharray", "5,5")
                .attr("rx", 10);
            return summaryGroup;
        })
        .attr("transform", `translate(${summaryX}, ${summaryY})`);
    summary.select("rect.summary-border")
        .attr("x", -summaryWidth / 2)
        .attr("y", -summaryHeight / 2)
        .attr("width", summaryWidth)
        .attr("height", summaryHeight);
    const metricsGroup = summary.selectAll("g.key-metrics").data([null])
        .join("g")
        .attr("class", "key-metrics")
        .attr("transform", `translate(${-summaryWidth / 2 + 25}, ${-summaryHeight / 2 + 30})`);
    const colWidth = summaryWidth / 3;
    const titleAreaHeight = 35;
    const chartAreaHeight = summaryHeight - titleAreaHeight;
    const chartAreaWidth = colWidth * 0.8;
    const labelFontSize = Math.min(summaryHeight * 0.14, 14);
    const chartContainerY = -summaryHeight / 2 + titleAreaHeight + chartAreaHeight / 2;
    const summaryPieGroup = summary.selectAll("g.pie-group").data([null])
        .join("g").attr("class", "pie-group")
        .attr("transform", `translate(0, ${chartContainerY})`);
    const summaryProductiveRatio = results.averageEfficiency / 100;
    const linePieData = d3.pie().value(d => d.value).sort(null)([
        { label: "Productive", value: summaryProductiveRatio },
        { label: "Idle", value: 1 - summaryProductiveRatio }
    ]);
    const summaryPieRadius = Math.min(chartAreaWidth / 2, chartAreaHeight / 2) * 0.9;
    const arcLine = d3.arc().innerRadius(0).outerRadius(summaryPieRadius);
    const sumSlices = summaryPieGroup.selectAll("path.sum-slice").data(linePieData);
    sumSlices.enter().append("path").attr("class", "sum-slice")
        .attr("fill", d => d.data.label === "Productive" ? "#329de3" : "#e37832")
        .attr("stroke", "#07283f")
        .attr("stroke-width", 1.5)
        .each(function (d) { this._current = { startAngle: 0, endAngle: 0 }; })
        .merge(sumSlices)
        .transition().duration(750)
        .attrTween("d", function (d) {
            const i = d3.interpolate(this._current, d);
            this._current = i(1);
            return t => arcLine(i(t));
        });
    const summaryPieTextBg = summaryPieGroup.selectAll("circle.summary-pie-text-bg")
        .data([results.averageEfficiency]);
    summaryPieTextBg.enter()
        .append("circle")
        .attr("class", "summary-pie-text-bg")
        .attr("fill", "white")
        .attr("stroke", "#07283f")
        .attr("stroke-width", 1.5)
        .merge(summaryPieTextBg)
        .attr("r", summaryPieRadius * 0.4);
    summaryPieGroup.selectAll("text.summary-pie-text").data([results.averageEfficiency])
        .join("text").attr("class", "summary-pie-text")
        .attr("text-anchor", "middle").attr("dy", "0.35em")
        .style("font-weight", "bold")
        .style("font-size", `${Math.max(Math.min(summaryPieRadius * 0.25, 12), 8)}px`)
        .text(d => `${d.toFixed(1)}%`);
    summary.selectAll("text.pie-label").data(["Overall Efficiency"])
        .join("text").attr("class", "pie-label")
        .attr("text-anchor", "middle")
        .attr("y", -summaryHeight / 2 + titleAreaHeight - 10)
        .style("font-size", `${labelFontSize}px`)
        .style("font-weight", "bold")
        .text(d => d);
    const bottleneckCycleTime = d3.max(results.workstations, d => d.cycleTime) || 0;
    const idleTimesPerCycle = results.workstations.map(ws => bottleneckCycleTime - ws.cycleTime);
    const boxPlotGroup = summary.selectAll("g.box-plot-group").data([null])
        .join("g").attr("class", "box-plot-group")
        .attr("transform", `translate(${-colWidth}, ${chartContainerY})`);
    const q1 = d3.quantile(idleTimesPerCycle, 0.25) || 0;
    const median = d3.quantile(idleTimesPerCycle, 0.5) || 0;
    const q3 = d3.quantile(idleTimesPerCycle, 0.75) || 0;
    const min = d3.min(idleTimesPerCycle) || 0;
    const max = d3.max(idleTimesPerCycle) || 0;
    const xBox = d3.scaleLinear()
        .domain([0, max * 1.1 || 1])
        .range([-chartAreaWidth / 2, chartAreaWidth / 2]);
    const boxHeight = chartAreaHeight * 0.4;
    const axisPadding = 20;
    const axisYPosition = (boxHeight / 2) + axisPadding;
    const titleTopMargin = 18;
    const xAxisGroup = boxPlotGroup.selectAll("g.x-axis").data([null])
        .join("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0, ${axisYPosition})`);
    const tickValues = xBox.ticks(4).filter(d => d > 0);
    xAxisGroup.transition().duration(750)
        .call(d3.axisBottom(xBox)
            .tickValues(tickValues)
            .tickFormat(d => `${d.toFixed(1)}m`)
            .tickSizeOuter(0)
        );
    xAxisGroup.selectAll("text")
        .style("font-size", "12px")
        .style("font-weight", "700");
    summary.selectAll("text.box-label").data([results])
        .join("text").attr("class", "box-label")
        .attr("text-anchor", "middle")
        .attr("transform", `translate(${-colWidth}, 0)`)
        .attr("y", -summaryHeight / 2 + titleTopMargin)
        .style("font-size", `${labelFontSize}px`)
        .style("font-weight", "bold")
        .html(d => `Total Idle Time: <tspan fill="#e74c3c">${(d.totalIdleTime / 60).toFixed(1)}h</tspan> | Idle Time CV: <tspan fill="#e74c3c">${d.idleTimeCv.toFixed(1)}%</tspan>`);
    summary.selectAll("text.box-plot-title").data(["Balance Loss per Cycle"])
        .join("text")
        .attr("class", "box-plot-title")
        .attr("text-anchor", "middle")
        .attr("transform", `translate(${-colWidth}, 0)`)
        .attr("y", -summaryHeight / 2 + titleTopMargin + 35)
        .style("font-size", `${labelFontSize}px`)
        .style("font-weight", "bold")
        .text(d => d);
    boxPlotGroup.selectAll("line.center-line").data([null])
        .join("line").attr("class", "center-line")
        .attr("y1", 0).attr("y2", 0)
        .attr("stroke", "#34495e").attr("stroke-width", 3)
        .transition().duration(750)
        .attr("x1", xBox(min)).attr("x2", xBox(max));
    boxPlotGroup.selectAll("line.whisker").data([{ val: min, key: 'min' }, { val: max, key: 'max' }], d => d.key)
        .join("line").attr("class", "whisker")
        .attr("y1", -boxHeight / 2)
        .attr("y2", d => d.key === 'min' ? axisYPosition : boxHeight / 2)
        .attr("stroke", "#34495e").attr("stroke-width", 3)
        .attr("stroke-linecap", "round")
        .transition().duration(750)
        .attr("x1", d => xBox(d.val)).attr("x2", d => xBox(d.val));
    boxPlotGroup.selectAll("rect.box").data([null])
        .join("rect").attr("class", "box")
        .attr("y", -boxHeight / 2).attr("height", boxHeight)
        .attr("stroke", "#34495e").attr("stroke-width", 4)
        .style("fill", "url(#box-gradient)")
        .transition().duration(750)
        .attr("x", xBox(q1)).attr("width", xBox(q3) - xBox(q1));
    boxPlotGroup.selectAll("line.median-line").data([median])
        .join("line").attr("class", "median-line")
        .attr("y1", -boxHeight / 2).attr("y2", boxHeight / 2)
        .attr("stroke", "#07283f").attr("stroke-width", 5)
        .attr("stroke-linecap", "round")
        .transition().duration(750)
        .attr("x1", d => xBox(d)).attr("x2", d => xBox(d));
    const tooltipContent = `
        <div style="font-weight:bold; margin-bottom: 5px; text-align:center; border-bottom: 1px solid #fff; padding-bottom: 4px;">Idle Time per Cycle</div>
        <strong>Min:</strong> ${min.toFixed(2)} min<br>
        <strong>Q1:</strong> ${q1.toFixed(2)} min<br>
        <strong>Median:</strong> ${median.toFixed(2)} min<br>
        <strong>Q3:</strong> ${q3.toFixed(2)} min<br>
        <strong>Max:</strong> ${max.toFixed(2)} min
    `;
    boxPlotGroup.selectAll("rect.tooltip-receiver").data([null])
        .join("rect")
        .attr("class", "tooltip-receiver")
        .attr("x", -chartAreaWidth / 2)
        .attr("y", -chartAreaHeight / 2)
        .attr("width", chartAreaWidth)
        .attr("height", chartAreaHeight)
        .style("fill", "transparent")
        .on("mouseover", () => tooltip.style("opacity", 1))
        .on("mousemove", (event) => {
            tooltip.html(tooltipContent)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", () => tooltip.style("opacity", 0));
    const barChartMargin = { top: 10, right: 5, bottom: 35, left: 40 };
    const barChartInnerWidth = chartAreaWidth - barChartMargin.left - barChartMargin.right;
    const barChartInnerHeight = chartAreaHeight - barChartMargin.top - barChartMargin.bottom;
    const barChartGroup = summary.selectAll("g.bar-chart-group").data([null])
        .join("g").attr("class", "bar-chart-group")
        .attr("transform", `translate(${colWidth - chartAreaWidth / 2 + barChartMargin.left}, ${chartContainerY - chartAreaHeight / 2 + barChartMargin.top})`);
    const xBar = d3.scaleBand()
        .domain(results.workstations.map(d => d.id))
        .range([0, barChartInnerWidth])
        .padding(0.2);
    const yBar = d3.scaleLinear()
        .domain([0, d3.max(results.workstations, d => d.dailyIdleTime) * 1.1 || 1])
        .range([barChartInnerHeight, 0]);
    barChartGroup.selectAll(".x-axis").data([null]).join("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0, ${barChartInnerHeight})`)
        .call(d3.axisBottom(xBar).tickSizeOuter(0))
        .selectAll("text")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .attr("transform", "rotate(-45)")
        .attr("text-anchor", "end")
        .attr("dx", "-0.8em")
        .attr("dy", "0.15em");
    barChartGroup.selectAll(".y-axis").data([null]).join("g")
        .attr("class", "y-axis")
        .call(d3.axisLeft(yBar).ticks(4).tickFormat(d => `${(d / 60).toFixed(1)}h`).tickSizeOuter(0))
        .selectAll("text")
        .style("font-size", "12px")
        .style("font-weight", "600");
    barChartGroup.selectAll("rect.bar")
        .data(results.workstations, d => d.id)
        .join(
            enter => enter.append("rect")
                .attr("class", "bar")
                .attr("x", d => xBar(d.id))
                .attr("width", xBar.bandwidth())
                .attr("y", yBar(0))
                .attr("height", 0)
                .style("fill", "url(#box-gradient)")
                .attr("stroke", "#34495e")
                .attr("stroke-width", 1.8)
                .call(enter => enter.transition().duration(750)
                    .attr("y", d => yBar(d.dailyIdleTime))
                    .attr("height", d => barChartInnerHeight - yBar(d.dailyIdleTime))
                ),
            update => update
                .call(update => update.transition().duration(750)
                    .attr("x", d => xBar(d.id))
                    .attr("width", xBar.bandwidth())
                    .attr("y", d => yBar(d.dailyIdleTime))
                    .attr("height", d => barChartInnerHeight - yBar(d.dailyIdleTime))
                ),
            exit => exit
                .call(exit => exit.transition().duration(750)
                    .attr("y", yBar(0))
                    .attr("height", 0)
                    .remove()
                )
        );
    const minDailyIdleTime = d3.min(results.workstations, d => d.dailyIdleTime);
    summary.selectAll("text.bar-label").data([results])
        .join("text").attr("class", "bar-label")
        .attr("text-anchor", "middle")
        .attr("transform", `translate(${colWidth}, 0)`)
        .attr("y", -summaryHeight / 2 + titleAreaHeight - 10)
        .style("font-size", `${labelFontSize}px`)
        .style("font-weight", "bold")
        .html(d => `Workstation Balance Loss: <tspan fill="#e74c3c">${d.balanceDelay.toFixed(1)}%</tspan>`);
}

// Self-contained module for the Investment Analysis Tab.
// Encapsulated in an IIFE to prevent global scope pollution.
const drawInvestmentPanel = (function () {
    // State management for investment inputs
    const investmentState = {
        analysisPeriod: 5,
        marr: 12.0,
        taxRate: 25.0,
        workingDays: 250,
        p90Demand: 38250,
        p50Demand: 45000,
        p10Demand: 51750,
        mfgOverhead: 550000,
        sgaExpenses: 350000,
        costPerFootStraight: 225,
        costPerBend: 450,
        installationCost: 10000,
        salvageValue: 10000,
        macrsClass: '5-year',
        runExpansionCase: false
    };

    // --- MODULE-LEVEL VARIABLES ---
    const MACRS_RATES = {
        '5-year': [0.2000, 0.3200, 0.1920, 0.1152, 0.1152, 0.0576],
        '7-year': [0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446]
    };
    let isListenerAttached = false;
    let analysisDebounceTimer;

    // --- UTILITY & CALCULATION FUNCTIONS ---

    function formatNumberWithCommas(num) {
        if (num === null || num === undefined) return '';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    function parseFormattedNumber(str) {
        if (typeof str !== 'string') return str;
        return parseFloat(str.replace(/,/g, '')) || 0;
    }

    function updateDemandScenariosFromDemand() {
        const targetDailyDemand = parseFloat(dailyDemandInput.value) || 180;
        const p50 = Math.round(targetDailyDemand * investmentState.workingDays);
        const stdDevPercent = 0.15;
        const p90 = Math.round(p50 * (1 - stdDevPercent));
        const p10 = Math.round(p50 * (1 + stdDevPercent));
        investmentState.p90Demand = p90;
        investmentState.p50Demand = p50;
        investmentState.p10Demand = p10;
        const p90Input = document.getElementById('inv-p90Demand');
        const p50Input = document.getElementById('inv-p50Demand');
        const p10Input = document.getElementById('inv-p10Demand');
        if (p90Input) p90Input.value = formatNumberWithCommas(p90);
        if (p50Input) p50Input.value = formatNumberWithCommas(p50);
        if (p10Input) p10Input.value = formatNumberWithCommas(p10);
    }

    function formatMetric(value, format) {
        if (isNaN(value) || !isFinite(value)) return 'N/A';
        switch (format) {
            case 'currency':
                return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
            case 'percent':
                return `${(value * 100).toFixed(1)}%`;
            case 'decimal':
                return value.toFixed(1);
            case 'integer':
                return value.toLocaleString('en-US');
            default:
                return value;
        }
    }

    function calculateConveyorCost(numWorkstations) {
        const isEven = numWorkstations % 2 === 0;
        const numBends = (4 * numWorkstations) - (isEven ? 2 : 0);
        const costStraights = investmentState.costPerFootStraight * ASSEMBLY_LINE_LENGTH;
        const costBends = investmentState.costPerBend * numBends;
        return costStraights + costBends; // Note: Installation cost is separate now
    }

    function updateCalculatedCosts() {
        const totalFixed = investmentState.mfgOverhead + investmentState.sgaExpenses;
        d3.select("#inv-totalFixedCost").text(formatMetric(totalFixed, 'currency') + " / year");
    }

    function calculateNPV(cashFlows, rate) {
        let npv = cashFlows[0] || 0;
        for (let t = 1; t < cashFlows.length; t++) {
            npv += cashFlows[t] / Math.pow(1 + rate, t);
        }
        return npv;
    }

    function calculateIRR(cashFlows, maxIter = 100, tolerance = 1e-7) {
        if (!cashFlows || cashFlows.length === 0 || cashFlows[0] >= 0) {
            return NaN;
        }
        let highRate = 1.0;
        let lowRate = -0.99;
        let npvHigh = calculateNPV(cashFlows, highRate);
        let npvLow = calculateNPV(cashFlows, lowRate);
        let attempts = 0;
        const maxAttempts = 50;
        while (npvHigh * npvLow > 0 && attempts < maxAttempts) {
            if (npvHigh > 0 && npvLow > 0) {
                highRate *= 2;
                npvHigh = calculateNPV(cashFlows, highRate);
            } else if (npvHigh < 0 && npvLow < 0) {
                highRate *= 2;
                npvHigh = calculateNPV(cashFlows, highRate);
            }
            attempts++;
        }
        if (npvHigh * npvLow > 0) {
            return NaN;
        }
        for (let i = 0; i < maxIter; i++) {
            const midRate = (lowRate + highRate) / 2;
            const npvMid = calculateNPV(cashFlows, midRate);
            if (Math.abs(npvMid) < tolerance) {
                return midRate;
            }
            if (npvLow * npvMid < 0) {
                highRate = midRate;
                npvHigh = npvMid;
            } else {
                lowRate = midRate;
                npvLow = npvMid;
            }
        }
        return (lowRate + highRate) / 2;
    }

    function calculatePaybackPeriod(cashFlows) {
        if (!cashFlows || cashFlows.length < 2) return Infinity;
        const initialInvestment = Math.abs(cashFlows[0]);
        if (initialInvestment === 0) return 0;
        let cumulativeCashFlow = 0;
        for (let t = 1; t < cashFlows.length; t++) {
            const lastCumulative = cumulativeCashFlow;
            cumulativeCashFlow += cashFlows[t];
            if (cumulativeCashFlow >= initialInvestment) {
                const currentYearCashFlow = cashFlows[t];
                if (currentYearCashFlow <= 0) {
                    if (lastCumulative >= initialInvestment) return t - 1;
                    continue;
                }
                const amountNeeded = initialInvestment - lastCumulative;
                return (t - 1) + (amountNeeded / currentYearCashFlow);
            }
        }
        return Infinity;
    }

    // --- CORE LOGIC FUNCTIONS ---
    function calculateFinancialScenario(annualUnitDemand) {
        const { analysisPeriod, marr, taxRate, workingDays, macrsClass, runExpansionCase, salvageValue, installationCost } = investmentState;
        const avgPrice = (superSellInput.value * BUILD_RATIOS.super) + (ultraSellInput.value * BUILD_RATIOS.ultra) + (megaSellInput.value * BUILD_RATIOS.mega);
        const dailyUnitDemand = workingDays > 0 ? Math.ceil(annualUnitDemand / workingDays) : 0;
        let unitsToProduce = 0, configForReport = {}, initialInvestment = 0, equipmentCostForDepreciation = 0;
        const currentEmployees = parseInt(numEmployeesInput.value);
        const baseOpHours = parseFloat(opHoursInput.value);

        if (!runExpansionCase) {
            const metrics = calculateMetrics({ dailyDemand: 9999, opHours: baseOpHours, numEmployees: currentEmployees }, {});
            const maxAnnualCapacity = metrics.throughputUnitsPerDay * workingDays;
            unitsToProduce = Math.min(annualUnitDemand, maxAnnualCapacity);
            const lostSales = annualUnitDemand - unitsToProduce;
            configForReport = { name: `${currentEmployees} Workers, ${baseOpHours} hrs/day`, lostSales: lostSales > 0 ? `(${formatMetric(lostSales, 'integer')} lost sales)` : '', empCount: currentEmployees, opHours: baseOpHours };
            equipmentCostForDepreciation = calculateConveyorCost(currentEmployees) + installationCost;
            initialInvestment = -equipmentCostForDepreciation;
        } else {
            let optimalConfig = { meetsDemand: false, empCount: 0, opHours: 0 };
            let minCompositeCost = Infinity;
            for (let emp = 3; emp <= 13; emp++) {
                for (let hrs = 1; hrs <= 24; hrs += 0.25) {
                    const metrics = calculateMetrics({ dailyDemand: dailyUnitDemand, opHours: hrs, numEmployees: emp }, {});
                    if (metrics.meetsDemand) {
                        const compositeCost = (hrs * 1000) + emp;
                        if (compositeCost < minCompositeCost) {
                            minCompositeCost = compositeCost;
                            optimalConfig = { name: `${emp} Workers, ${hrs.toFixed(2)} hrs/day`, meetsDemand: true, empCount: emp, opHours: hrs };
                        }
                    }
                }
            }
            unitsToProduce = annualUnitDemand;
            let finalEmpCount = currentEmployees;
            if (optimalConfig.meetsDemand) {
                configForReport = { ...optimalConfig, lostSales: '' };
                finalEmpCount = optimalConfig.empCount;
            } else {
                configForReport = { name: `>13 Workers Required`, lostSales: '', empCount: 13, opHours: 24 };
                finalEmpCount = 13;
            }
            const oldLineCost = calculateConveyorCost(currentEmployees);
            const newLineCost = calculateConveyorCost(finalEmpCount);
            let adjustment = 0;
            if (newLineCost < oldLineCost) {
                const ratio = (oldLineCost - newLineCost) / oldLineCost;
                adjustment = -(salvageValue * ratio); // Credit based on salvage value ratio
                equipmentCostForDepreciation = 0; // No new asset to depreciate
            } else {
                adjustment = newLineCost - oldLineCost;
                equipmentCostForDepreciation = adjustment + installationCost; // Depreciate new cost + installation
            }
            initialInvestment = -(installationCost + adjustment);
        }
        const cashFlows = [initialInvestment];
        const scenarioOpHours = configForReport.opHours;
        let scaledMfgOverhead = investmentState.mfgOverhead;
        let scaledSgaExpenses = investmentState.sgaExpenses;
        if (scenarioOpHours > baseOpHours) {
            const scalingFactor = scenarioOpHours / baseOpHours;
            scaledMfgOverhead *= scalingFactor;
            scaledSgaExpenses *= scalingFactor;
        }
        const macrsSchedule = MACRS_RATES[macrsClass] || [];
        for (let t = 1; t <= analysisPeriod; t++) {
            const revenue = unitsToProduce * avgPrice;
            const avgMaterialCost = (superCogsInput.value * BUILD_RATIOS.super) + (ultraCogsInput.value * BUILD_RATIOS.ultra) + (megaCogsInput.value * BUILD_RATIOS.mega);
            const totalMaterialCost = unitsToProduce * avgMaterialCost;
            const laborCost = configForReport.empCount * configForReport.opHours * parseFloat(laborCostInput.value) * workingDays;
            const cogs = totalMaterialCost + laborCost + scaledMfgOverhead;
            const grossProfit = revenue - cogs;
            const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0;
            const ebit = grossProfit - scaledSgaExpenses - taxDepreciation;
            const taxes = ebit > 0 ? ebit * (taxRate / 100) : 0;
            const nopat = ebit - taxes;
            const fcf = nopat + taxDepreciation;
            cashFlows.push(fcf);
        }
        if (equipmentCostForDepreciation > 0 && analysisPeriod > 0) {
            const afterTaxSalvage = salvageValue * (1 - (taxRate / 100));
            cashFlows[analysisPeriod] += afterTaxSalvage;
        }
        const npv = calculateNPV(cashFlows, marr / 100);
        const irr = calculateIRR(cashFlows);
        const payback = calculatePaybackPeriod(cashFlows);
        return { dailyUnitDemand, annualUnitDemand, requiredConfig: configForReport, metrics: { npv, irr, payback, initialInvestment }, cashFlows };
    }

    function runFullAnalysis() {
        const resultsDisplay = d3.select("#inv-results-display");
        const resultsPlaceholder = d3.select("#inv-results-placeholder");
        resultsPlaceholder.html("<p>Running financial calculations...</p>").style("display", "block");
        resultsDisplay.style("display", "none");
        setTimeout(() => {
            try {
                const scenarios = {
                    'P90 (Conservative)': investmentState.p90Demand,
                    'P50 (Most Likely)': investmentState.p50Demand,
                    'P10 (Optimistic)': investmentState.p10Demand
                };
                const results = {};
                for (const [name, demandUnits] of Object.entries(scenarios)) {
                    results[name] = calculateFinancialScenario(demandUnits);
                }
                resultsPlaceholder.style("display", "none");
                resultsDisplay.style("display", "block");
                renderInvestmentResults(results);
            } catch (error) {
                console.error("Error during investment analysis:", error);
                resultsPlaceholder.html(`<p class="error">An error occurred: ${error.message}</p>`);
            }
        }, 50);
    }

    // --- D3 RENDERING FUNCTIONS ---
    function renderFunnel(results, containerSelector) {
        const container = d3.select(containerSelector);
        container.html("");
        const chartNode = container.node();
        if (!chartNode) return;
        const scenarios = [
            { label: "Optimistic (P10)", value: results['P10 (Optimistic)'].annualUnitDemand, color: '#c0392b' },
            { label: "Most Likely (P50)", value: results['P50 (Most Likely)'].annualUnitDemand, color: '#2980b9' },
            { label: "Conservative (P90)", value: results['P90 (Conservative)'].annualUnitDemand, color: '#27ae60' }
        ];
        const margin = { top: 10, right: 20, bottom: 10, left: 20 };
        const width = chartNode.getBoundingClientRect().width - margin.left - margin.right;
        const height = chartNode.getBoundingClientRect().height - margin.top - margin.bottom;
        const svg = container.append("svg").attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`);
        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const maxValue = scenarios[0].value;
        const sectionHeight = height / scenarios.length;
        scenarios.forEach((d, i) => {
            const topWidth = (d.value / maxValue) * width;
            const bottomWidth = (i < scenarios.length - 1) ? (scenarios[i + 1].value / maxValue) * width : topWidth * 0.95;
            const x0 = (width - topWidth) / 2;
            const x1 = (width - bottomWidth) / 2;
            const y0 = i * sectionHeight;
            const y1 = (i + 1) * sectionHeight - 2;
            g.append("path")
                .attr("d", `M ${x0},${y0} L ${x0 + topWidth},${y0} L ${x1 + bottomWidth},${y1} L ${x1},${y1} Z`)
                .attr("fill", d.color).attr("fill-opacity", 0.7).attr("stroke", "#333").attr("stroke-width", 1);
            const textY = y0 + sectionHeight / 2;
            const textBlock = g.append("text").attr("x", width / 2).attr("y", textY).attr("text-anchor", "middle");
            textBlock.append("tspan").attr("class", "funnel-label").text(d.label);
            textBlock.append("tspan").attr("class", "funnel-value").attr("x", width / 2).attr("dy", "1.2em").text(formatNumberWithCommas(d.value) + " u/yr");
        });
    }

    function renderInvestmentResults(results) {
        const resultsNode = d3.select('.inv-results-column').node();
        if (!resultsNode) return;
        const totalHeight = resultsNode.clientHeight * 0.95;
        const topThirdHeight = Math.floor(totalHeight / 3);
        const bottomTwoThirdsHeight = totalHeight - topThirdHeight;

        const scorecardHeight = 95;
        const funnelHeight = topThirdHeight - scorecardHeight;

        d3.select(".inv-scorecard-container").style('height', `${scorecardHeight > 0 ? scorecardHeight : 0}px`);
        d3.select(".inv-funnel-container").style('height', `${funnelHeight > 0 ? funnelHeight : 0}px`);
        d3.select(".inv-chart-container").style('height', `${bottomTwoThirdsHeight > 0 ? bottomTwoThirdsHeight : 0}px`);
        // --- FIX END ---

        const p50Result = results['P50 (Most Likely)'];
        const scorecardContainer = d3.select(".inv-scorecard-container");
        scorecardContainer.html("");
        const isZeroInvestment = p50Result.metrics.initialInvestment >= 0;
        const displayIRR = isZeroInvestment ? "N/A" : formatMetric(p50Result.metrics.irr, 'percent');
        const displayPayback = isZeroInvestment ? "Immediate" : formatMetric(p50Result.metrics.payback, 'decimal');
        scorecardContainer.selectAll(".inv-scorecard")
            .data([{ label: 'Net Present Value (NPV)', value: formatMetric(p50Result.metrics.npv, 'currency') }, { label: 'Internal Rate of Return (IRR)', value: displayIRR }, { label: 'Payback Period (Years)', value: displayPayback }])
            .join("div").attr("class", "inv-scorecard").html(d => `<div class="inv-scorecard-label">${d.label}</div><div class="inv-scorecard-value">${d.value}</div>`);

        renderFunnel(results, ".inv-funnel-container");

        const chartContainer = d3.select(".inv-chart-container");
        chartContainer.html("");
        d3.select(".inv-tooltip").remove();
        const chartNode = chartContainer.node();
        if (!chartNode) return;
        const margin = { top: 20, right: 30, bottom: 70, left: 80 }, width = chartNode.getBoundingClientRect().width - margin.left - margin.right, height = chartNode.getBoundingClientRect().height - margin.top - margin.bottom;
        const chartSvg = chartContainer.append("svg").attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`);
        const chartG = chartSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const cumulativeData = Object.entries(results).map(([name, data]) => {
            let cumulative = 0;
            const values = data.cashFlows.map((cf, i) => {
                cumulative += cf;
                return { year: i, value: cumulative };
            });
            return { name, values };
        });
        const x = d3.scaleLinear().domain([0, investmentState.analysisPeriod]).range([0, width]);
        const y = d3.scaleLinear().domain([d3.min(cumulativeData, d => d3.min(d.values, v => v.value)), d3.max(cumulativeData, d => d3.max(d.values, v => v.value))]).nice().range([height, 0]);
        chartG.append("g").attr("class", "inv-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(investmentState.analysisPeriod).tickFormat(d3.format("d")));
        chartG.append("g").attr("class", "inv-axis").call(d3.axisLeft(y).tickFormat(d3.format("$,.2s")));
        const p10Data = cumulativeData.find(d => d.name.includes('P10')).values;
        const p50Data = cumulativeData.find(d => d.name.includes('P50')).values;
        const p90Data = cumulativeData.find(d => d.name.includes('P90')).values;
        const areaP10_P50 = d3.area().x(d => x(d.year)).y0(d => y(p50Data[d.year].value)).y1(d => y(p10Data[d.year].value));
        const areaP50_P90 = d3.area().x(d => x(d.year)).y0(d => y(p90Data[d.year].value)).y1(d => y(p50Data[d.year].value));
        chartG.append("path").datum(p10Data).attr("fill", "#c0392b").attr("class", "inv-area").attr("d", areaP10_P50);
        chartG.append("path").datum(p50Data).attr("fill", "#27ae60").attr("class", "inv-area").attr("d", areaP50_P90);
        chartG.append("line").attr("class", "inv-break-even").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0));
        const line = d3.line().x(d => x(d.year)).y(d => y(d.value));
        const color = d3.scaleOrdinal().domain(['P10 (Optimistic)', 'P50 (Most Likely)', 'P90 (Conservative)']).range(['#c0392b', '#2980b9', '#27ae60']);
        chartG.selectAll(".inv-line").data(cumulativeData).join("path")
            .attr("class", "inv-line").attr("d", d => line(d.values))
            .style("stroke", d => color(d.name))
            .style("stroke-width", d => d.name.includes('P50') ? '4px' : '2.5px');
        chartSvg.append("text").attr("class", "inv-axis-label").attr("text-anchor", "middle").attr("x", margin.left + width / 2).attr("y", height + margin.top + margin.bottom - 30).text("Analysis Period (Years)");
        chartSvg.append("text").attr("class", "inv-axis-label").attr("transform", "rotate(-90)").attr("text-anchor", "middle").attr("y", margin.left / 4).attr("x", -(margin.top + height / 2)).text("Cumulative Free Cash Flow");
        const tooltip = d3.select("body").append("div").attr("class", "inv-tooltip").style("opacity", 0);
        chartG.selectAll(".inv-hitbox").data(cumulativeData).join("path")
            .attr("class", "inv-hitbox").attr("d", d => line(d.values))
            .on("mouseover", (event, d) => {
                tooltip.transition().duration(200).style("opacity", 1);
                const scenarioResult = results[d.name];
                tooltip.html(`<h4>${d.name}</h4>
<p><strong>NPV:</strong> ${formatMetric(scenarioResult.metrics.npv, 'currency')}</p>
<p><strong>IRR:</strong> ${scenarioResult.metrics.initialInvestment >= 0 ? "N/A" : formatMetric(scenarioResult.metrics.irr, 'percent')}</p>
<p><strong>Payback:</strong> ${scenarioResult.metrics.initialInvestment >= 0 ? "Immediate" : formatMetric(scenarioResult.metrics.payback, 'decimal') + ' Yrs'}</p><hr>
<p><strong>Config:</strong> ${scenarioResult.requiredConfig.name}</p>
<p><strong>Annual Demand:</strong> ${formatMetric(scenarioResult.annualUnitDemand, 'integer')} u</p>`);
            })
            .on("mousemove", (event) => tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"))
            .on("mouseout", () => tooltip.transition().duration(500).style("opacity", 0));
    }

    function draw() {
        if (!isListenerAttached) {
            const relevantInputs = [dailyDemandInput, opHoursInput, laborCostInput, superSellInput, superCogsInput, ultraSellInput, ultraCogsInput, megaSellInput, megaCogsInput];
            relevantInputs.forEach(input => {
                input.addEventListener('input', () => {
                    if (input.id === 'dailyDemand') {
                        updateDemandScenariosFromDemand();
                    }
                    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
                    if (activeTab === 'investment') {
                        clearTimeout(analysisDebounceTimer);
                        analysisDebounceTimer = setTimeout(runFullAnalysis, 500);
                    }
                });
            });
            isListenerAttached = true;
        }
        updateDemandScenariosFromDemand();
        const svg = d3.select("#investment-panel");
        svg.selectAll("*").remove();
        const fo = svg.append("foreignObject").attr("x", 0).attr("y", 0).attr("width", "100%").attr("height", "100%");
        const container = fo.append("xhtml:div").attr("class", "inv-container");
        const inputColumn = container.append("div").attr("class", "inv-input-column");
        inputColumn.append("h3").attr("class", "inv-column-title").text("Economic Parameters");
        const inputArea = inputColumn.append("div").attr("class", "inv-inputs");
        inputArea.html(`
<div class="inv-input-group">
<div class="inv-group-header">Project & Fixed Costs</div>
<label>Analysis Period (Yrs): <input type="number" id="inv-analysisPeriod" step="1" min="1" max="30" value="${investmentState.analysisPeriod}"></label>
<label>MARR / Discount Rate (%): <input type="number" id="inv-marr" step="0.1" min="0" max="100" value="${investmentState.marr}"></label>
<label>Corporate Tax Rate (%): <input type="number" id="inv-taxRate" step="0.1" min="0" max="100" value="${investmentState.taxRate}"></label>
<label>Working Days per Year: <input type="number" id="inv-workingDays" step="1" min="1" max="365" value="${investmentState.workingDays}"></label>
<label>Mfg. Overhead ($/yr): <input type="text" data-type="currency" id="inv-mfgOverhead" value="${formatNumberWithCommas(investmentState.mfgOverhead)}"></label>
<label>SG&A Expenses ($/yr): <input type="text" data-type="currency" id="inv-sgaExpenses" value="${formatNumberWithCommas(investmentState.sgaExpenses)}"></label>
</div>
<div class="inv-input-group">
<div class="inv-group-header">Capital Investment</div>
<label>Cost / ft of Straights ($): <input type="text" data-type="currency" id="inv-costPerFootStraight" value="${formatNumberWithCommas(investmentState.costPerFootStraight)}"></label>
<label>Cost / Conveyor Bend ($): <input type="text" data-type="currency" id="inv-costPerBend" value="${formatNumberWithCommas(investmentState.costPerBend)}"></label>
<label>Installation Cost ($): <input type="text" data-type="currency" id="inv-installationCost" value="${formatNumberWithCommas(investmentState.installationCost)}"></label>
<label>Salvage Value ($): <input type="text" data-type="currency" id="inv-salvageValue" value="${formatNumberWithCommas(investmentState.salvageValue)}"></label>
<label>MACRS Class:<select id="inv-macrsClass"><option value="5-year" ${investmentState.macrsClass === '5-year' ? 'selected' : ''}>5-Year Property</option><option value="7-year" ${investmentState.macrsClass === '7-year' ? 'selected' : ''}>7-Year Property</option></select></label>
</div>
<div class="inv-input-group">
<div class="inv-group-header">Probabilistic Demand Scenarios (Annual Units)</div>
<label>P90 (Conservative): <input type="text" data-type="currency" id="inv-p90Demand" value="${formatNumberWithCommas(investmentState.p90Demand)}"></label>
<label>P50 (Most Likely): <input type="text" data-type="currency" id="inv-p50Demand" value="${formatNumberWithCommas(investmentState.p50Demand)}"></label>
<label>P10 (Optimistic): <input type="text" data-type="currency" id="inv-p10Demand" value="${formatNumberWithCommas(investmentState.p10Demand)}"></label>
</div>
`);
        const controlsArea = inputColumn.append("div").attr("class", "inv-analysis-controls");
        controlsArea.html(`
<div class="inv-scenario-toggle">
<span>Base Case</span>
<label class="inv-switch">
<input type="checkbox" id="inv-runExpansionCase" ${investmentState.runExpansionCase ? 'checked' : ''}>
<span class="inv-slider inv-round"></span>
</label>
<span>Expansion Case</span>
</div>
`);
        const resultsColumn = container.append("div").attr("class", "inv-results-column");
        resultsColumn.html(`
<div id="inv-results-placeholder">
<h3>Economic Analysis Dashboard</h3>
<p>Configure your parameters on the left. Results will update automatically.</p>
</div>
<div id="inv-results-display" style="display: none;">
<div class="inv-scorecard-container"></div>
<div class="inv-funnel-container"></div>
<div class="inv-chart-container"></div>
</div>
`);
        container.selectAll("input, select").on("change", (event) => {
            const target = event.target;
            const key = target.id.replace('inv-', '');
            if (target.type === 'checkbox') {
                investmentState[key] = target.checked;
            } else {
                const value = (target.dataset.type === 'currency') ? parseFormattedNumber(target.value) : (target.type === 'number' ? parseFloat(target.value) : target.value);
                investmentState[key] = value || 0;
                if (target.dataset.type === 'currency') {
                    target.value = formatNumberWithCommas(value);
                }
            }
            updateCalculatedCosts();
            clearTimeout(analysisDebounceTimer);
            analysisDebounceTimer = setTimeout(runFullAnalysis, 500);
        });
        updateCalculatedCosts();
        runFullAnalysis();
    }

    const styleId = 'investment-styles';
    if (!document.getElementById(styleId)) {
        const styleSheet = document.createElement("style");
        styleSheet.id = styleId;
        styleSheet.innerText = `
#investment-panel .inv-container { display: flex; height: 100%; font-family: sans-serif; background: #f4f7f6; }
#investment-panel .inv-input-column { flex: 0 0 320px; padding: 15px; background: #ffffff; border-right: 1px solid #ddd; overflow-y: auto; display: flex; flex-direction: column; }
#investment-panel .inv-results-column { flex-grow: 1; padding: 15px; overflow-y: auto; display: flex; flex-direction: column; }
#investment-panel .inv-column-title { text-align: center; font-size: 18px; color: #2c3e50; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #3498db; }
#investment-panel .inv-inputs { flex-grow: 1; display: flex; flex-direction: column; gap: 15px; }
#investment-panel .inv-input-group { border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; background: #fcfcfc; }
#investment-panel .inv-group-header { font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 14px; color: #333; }
#investment-panel .inv-input-column label { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 8px; font-size: 13px; color: #555; }
#investment-panel .inv-input-column input, #investment-panel .inv-input-column select { box-sizing: border-box; padding: 6px; font-size: 13px; border: 1px solid #ccc; border-radius: 4px; text-align: right; }
#investment-panel .inv-input-column input { width: 30%; }
#investment-panel .inv-input-column select { width: 55%; }
#investment-panel .inv-analysis-controls { margin-top: auto; padding-top: 15px; border-top: 1px solid #eee; display: flex; justify-content: center; align-items: center; background: #ffffff; }
#investment-panel .inv-scenario-toggle { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 10px; font-size: 12px; }
#investment-panel .inv-switch { position: relative; display: inline-block; width: 60px; height: 34px; }
#investment-panel .inv-switch input { opacity: 0; width: 0; height: 0; }
#investment-panel .inv-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; }
#investment-panel .inv-slider:before { position: absolute; content: ""; height: 26px; width: 26px; left: 4px; bottom: 4px; background-color: white; transition: .4s; }
#investment-panel input:checked + .inv-slider { background-color: #2196F3; }
#investment-panel input:checked + .inv-slider:before { transform: translateX(26px); }
#investment-panel .inv-slider.inv-round { border-radius: 34px; }
#investment-panel .inv-slider.inv-round:before { border-radius: 50%; }
#investment-panel #inv-results-display { display: flex; flex-direction: column; height: 100%; }
#investment-panel #inv-results-placeholder { text-align: center; padding: 50px 20px; color: #666; }
#investment-panel .inv-scorecard-container { flex-shrink: 0; display: flex; justify-content: space-around; gap: 5px; margin-bottom: 1px; }
#investment-panel .inv-scorecard { flex: 1; text-align: center; padding: 15px; background: #ecf0f1; border-radius: 8px; border-bottom: 3px solid #bdc3c7; }
#investment-panel .inv-scorecard-label { font-size: 13px; color: #34495e; margin-bottom: 5px; }
#investment-panel .inv-scorecard-value { font-size: 26px; font-weight: bold; color: #2c3e50; }
#investment-panel .inv-funnel-container { flex-shrink: 0; }
#investment-panel .inv-funnel-container text { fill: white; font-weight: bold; pointer-events: none; }
#investment-panel .inv-funnel-container .funnel-label { font-size: 14px; }
#investment-panel .inv-funnel-container .funnel-value { font-size: 12px; font-weight: normal; }
#investment-panel .inv-chart-container { flex-grow: 1; position: relative; }
#investment-panel .inv-axis text, #investment-panel .inv-axis .tick text { font-weight: 700; }
#investment-panel .inv-axis-label { font-size: 14px; font-weight: 700; fill: #34495e; }
#investment-panel .inv-area { fill-opacity: 0.2; }
#investment-panel .inv-break-even { stroke: #e74c3c; stroke-width: 2px; stroke-dasharray: 6, 4; }
#investment-panel .inv-line { fill: none; }
#investment-panel .inv-hitbox { stroke-width: 20px; fill: none; stroke: transparent; cursor: pointer; }
.inv-tooltip { position: absolute; text-align: left; padding: 8px; font: 12px sans-serif; background: rgba(44, 62, 80, 0.9); color: white; border: 0px; border-radius: 8px; pointer-events: none; }
.inv-tooltip h4 { margin: 0 0 5px 0; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.5); padding-bottom: 4px;}
.inv-tooltip p { margin: 3px 0; }
.inv-tooltip hr { border: none; border-top: 1px solid rgba(255,255,255,0.3); margin: 5px 0;}
`;
        document.head.appendChild(styleSheet);
    }
    return draw;
})();

// Run the application
main();