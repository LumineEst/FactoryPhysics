// Global Constants and Mapping
const MIN_TAKT_TIME = 2.5;
const BUILD_RATIOS = { super: 0.35, ultra: 0.45, mega: 0.20 };
const ASSEMBLY_LINE_LENGTH = 486; // in feet
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

const state = {
    taskData: new Map(),
    configData: {}
};

const originalConfigData = {};
let sortableInstances = [];
let precedenceChartNodes = null;
let invalidPrecedenceNodes = new Set();
let profitMaximizationCache = { key: null, data: null };
let isProfitCalculating = false;

let animationState = {
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
    restoreActiveTab();
    updateUI();
    renderActiveTab();
    document.querySelectorAll("input[type='number']").forEach(input => {
        enableMiddleDragNumberInput(input, 1, 1);
    });
    document.querySelectorAll("input[type='range']").forEach(input => {
        enableMiddleDragNumberInput(input, 1, 1);
    });

    calculateOptimalProfitData(); // Pre-calculate profit data on initial load
}

// Data Loading from local files
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
            state.configData[i] = {};
            originalConfigData[i] = {};
        }
        configsRaw.forEach(row => {
            for (let i = 3; i <= 13; i++) {
                const wsKey = `${i}_Workstation`,
                    elKey = `${i}_Element`;
                const workstation = row[wsKey],
                    element = parseInt(row[elKey]);
                if (workstation && !isNaN(element)) {
                    if (!state.configData[i][workstation]) state.configData[i][workstation] = [];
                    state.configData[i][workstation].push(element);
                    if (!originalConfigData[i][workstation]) originalConfigData[i][workstation] = [];
                    originalConfigData[i][workstation].push(element);
                }
            }
        });
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

/**
 * Backend - Input Change Helper.
 */
function handleInputChange(driverId) {
    if (isRecalculating) return;
    isRecalculating = true;

    const isFinancialDriver = ['laborCost', 'superSell', 'superCogs', 'ultraSell', 'ultraCogs', 'megaSell', 'megaCogs'].includes(driverId);
    if (isFinancialDriver && !isProfitCalculating) {
        calculateOptimalProfitData();
    }

    try {
        let dailyDemand = parseInt(dailyDemandInput.value) || 1;
        let opHours = parseFloat(opHoursInput.value) || 1;
        let numEmployees = parseInt(numEmployeesInput.value);
        if (driverId === 'numEmployees') {
            workstationList.scrollTop = 0;
            state.configData[numEmployees] = JSON.parse(JSON.stringify(originalConfigData[numEmployees]));
        }
        const isOperationalDriver = ['dailyDemand', 'opHours', 'numEmployees'].includes(driverId);
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
    const netProductionTimeMinutes = op.opHours * 60;
    const taktTime = netProductionTimeMinutes / op.dailyDemand;
    const wsDetails = calculateWorkstationDetails(op.numEmployees);
    const bottleneckCycleTime = wsDetails.bottleneckTime;
    const meetsDemand = bottleneckCycleTime <= taktTime && bottleneckCycleTime > 0;
    const effectiveCycleTime = meetsDemand ? taktTime : bottleneckCycleTime;
    const productSpacing = wsDetails.fastestTime === Infinity ? 0 : wsDetails.fastestTime * 15;
    const throughputPerMinute = effectiveCycleTime > 0 ? 1 / effectiveCycleTime : 0;
    const conveyorSpeed = throughputPerMinute * productSpacing;
    const throughputUnitsPerDay = throughputPerMinute * netProductionTimeMinutes;
    const wip = productSpacing > 0 ? ASSEMBLY_LINE_LENGTH / productSpacing : 0;

    let totalWorkstationCycleTime = 0;
    wsDetails.workstations.forEach(ws => {
        totalWorkstationCycleTime += ws.cycleTime;
        // Calculate per-workstation metrics needed for efficiency panel
        const idleTimePerCycle = bottleneckCycleTime - ws.cycleTime;
        ws.dailyIdleTime = idleTimePerCycle * throughputUnitsPerDay;
        ws.efficiency = bottleneckCycleTime > 0 ? (ws.cycleTime / bottleneckCycleTime) * 100 : 0;
    });

    const totalAvailableTime = op.numEmployees * netProductionTimeMinutes;
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

    const throughputUnitsPerHour = op.opHours > 0 ? throughputUnitsPerDay / op.opHours : 0;
    const totalDailyLaborCost = op.numEmployees * op.opHours * (fin.laborCost || 0);
    const totalRevenue = throughputUnitsPerDay * ((BUILD_RATIOS.super * (fin.superSell || 0)) + (BUILD_RATIOS.ultra * (fin.ultraSell || 0)) + (BUILD_RATIOS.mega * (fin.megaSell || 0)));
    const totalCogs = throughputUnitsPerDay * ((BUILD_RATIOS.super * (fin.superCogs || 0)) + (BUILD_RATIOS.ultra * (fin.ultraCogs || 0)) + (BUILD_RATIOS.mega * (fin.megaCogs || 0)));
    const dailyGrossProfit = totalRevenue - totalCogs - totalDailyLaborCost;
    const grossProfitMargin = totalRevenue > 0 ? (dailyGrossProfit / totalRevenue) * 100 : 0;
    return {
        wip, throughputUnitsPerHour, conveyorSpeed, productSpacing, dailyGrossProfit,
        grossProfitMargin, meetsDemand, effectiveCycleTime, workstations: wsDetails.workstations,
        averageEfficiency, totalIdleTime, balanceDelay, idleTimeCv
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
 * Backend - Update Workstation Sequences based on takt-time thresholds
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

    // To avoid rounding errors, calculate the first n-1 demands and derive the last one.
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
 * UI - Update User Interface for changes in Element Order or Variables.
 */
function updateUI() {
    employeeCountDisplay.textContent = numEmployeesInput.value;
    renderWorkstationSidebar(parseInt(numEmployeesInput.value));
    setupDragAndDrop();
    invalidPrecedenceNodes = validatePrecedence();
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

    stopAllSimulations();

    if (activeTab && (activeTab === 'layout' || activeTab === 'schedule')) {
        const clockToReset = document.querySelector(`#${activeTab}-panel #sim-clock-display`);
        if (clockToReset) clockToReset.textContent = "00:00";
    }

    if (activeTab === 'layout') {
        drawLayoutVisualization();
    } else if (activeTab === 'schedule') {
        drawScheduleVisualization();
    }

    if (activeTab === 'efficiency') {
        drawEfficiencyPanel();
    }
    if (activeTab === 'precedence') {
        updatePrecedenceChartColors();
    }
}

/**
 * UI - Generate Color-Scheme for Workstation Configurations.
 */
function generateElementColorScale(workstationIndex, numWorkstations, numElements) {
    const { baseHue, goldenAngle, baseChroma, baseLuminance, luminanceVary, hueVary } = COLOR_CONSTANTS;

    // Calculate the unique base color for the workstation using the golden angle for distinct hues.
    const baseColor = d3.hcl((baseHue + workstationIndex * goldenAngle) % 360, baseChroma, baseLuminance);

    // Create the start and end points of the gradient for this workstation's elements.
    const startColor = baseColor.copy();
    startColor.h += hueVary;
    startColor.l += luminanceVary;

    const endColor = baseColor.copy();
    endColor.h -= hueVary;
    endColor.l -= luminanceVary;

    // Return a D3 scale that maps an element's index (0 to n-1) to a color in the gradient.
    return d3.scaleLinear()
        .domain([0, numElements > 1 ? numElements - 1 : 1])
        .range([startColor.toString(), endColor.toString()])
        .interpolate(d3.interpolateHcl);
}

/**
 * UI - Creating the Left Sidebar for Workstation Configurations.
 */
function renderWorkstationSidebar(numEmployees) {
    while (workstationList.children.length > 1) {
        workstationList.lastChild.remove();
    }

    const config = state.configData[numEmployees];
    if (!config || Object.keys(config).length === 0) return;

    // Sort station IDs to ensure a consistent processing order for coloring.
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
        // Generate the unique color scale for this workstation.
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
                // Set the element bar's fill to grey and its border to the generated color.
                elementTimeBar.style.backgroundColor = '#cccccc';
                elementTimeBar.style.border = `3px solid ${elementColor}`;

                const laborTimeBar = document.createElement('div');
                laborTimeBar.className = 'labor-time-bar';
                // Set the labor bar's fill to the generated color.
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
        leftSidebar.classList.toggle('collapsed');
        const isCollapsed = leftSidebar.classList.contains('collapsed');
        leftToggle.innerHTML = isCollapsed ? '&raquo;' : '&laquo;';
    });
    rightToggle.addEventListener('click', () => {
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

            stopAllSimulations();

            if (targetTab === 'overview') {
                drawOverviewPanel();
            } else if (targetTab === 'precedence') {
                drawPrecedenceChart();
            } else if (targetTab === 'schedule') {
                drawScheduleVisualization();
            } else if (targetTab === 'efficiency') {
                drawEfficiencyPanel();
            } else if (targetTab === 'layout') {
                drawLayoutVisualization();
            } else if (targetTab === 'profit') {
                drawProfitPanel();
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
 * Precedence - Sets node colors based on if elements are arranged before their predecessors.
 */
function updatePrecedenceChartColors() {
    if (!precedenceChartNodes) {
        return;
    }
    precedenceChartNodes.selectAll('circle')
        .transition()
        .duration(300)
        .style('fill', d => {
            return invalidPrecedenceNodes.has(d.id) ? '#e74c3c' : 'steelblue';
        });
}

/**
 * Overview - Gives a summary of the project, data sources, and visualization tabs
 */
function drawOverviewPanel() {
    const svg = d3.select("#overview-panel");
    svg.selectAll("*").remove(); // clear any previous content

    // Use foreignObject so we can put HTML inside the SVG container
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
 * Precedence - Generates a Precedence DAG for Elements connected by precedence.
 */
function drawPrecedenceChart() {
    const rawData = [
        { id: 1, predecessors: [] }, { id: 2, predecessors: [1] }, { id: 3, predecessors: [1] }, { id: 4, predecessors: [1] },
        { id: 5, predecessors: [2, 3] }, { id: 6, predecessors: [1] }, { id: 7, predecessors: [6] }, { id: 8, predecessors: [1] },
        { id: 9, predecessors: [8] }, { id: 10, predecessors: [1] }, { id: 11, predecessors: [1] }, { id: 12, predecessors: [10, 11] },
        { id: 13, predecessors: [4, 5, 7, 9, 12] }, { id: 14, predecessors: [13] }, { id: 15, predecessors: [14] }, { id: 16, predecessors: [15] },
        { id: 17, predecessors: [16] }, { id: 18, predecessors: [14] }, { id: 19, predecessors: [18] }, { id: 20, predecessors: [19] },
        { id: 21, predecessors: [20] }, { id: 22, predecessors: [18] }, { id: 23, predecessors: [22] }, { id: 24, predecessors: [23] },
        { id: 25, predecessors: [19, 22] }, { id: 26, predecessors: [19, 22] }, { id: 27, predecessors: [25, 26] }, { id: 28, predecessors: [27] },
        { id: 29, predecessors: [15] }, { id: 30, predecessors: [17, 21, 24, 27, 29] }, { id: 31, predecessors: [30] },
    ];
    const nodes = rawData.map(d => ({ id: d.id }));
    const links = [];
    rawData.forEach(d => {
        d.predecessors.forEach(pId => {
            links.push({ source: pId, target: d.id });
        });
    });

    const svg = d3.select("#precedence-panel");
    svg.selectAll("*").remove();

    const width = document.getElementById('svg-container').clientWidth;
    const height = document.getElementById('svg-container').clientHeight;
    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(60))
        .force("charge", d3.forceManyBody().strength(-200))
        .force("center", d3.forceCenter(width / 2, height / 2));

    const link = svg.append("g")
        .attr("stroke", "#999").attr("stroke-opacity", 0.6)
        .selectAll("line").data(links).join("line").attr("stroke-width", 2);

    precedenceChartNodes = svg.append("g").selectAll("g").data(nodes).join("g");

    precedenceChartNodes.append("circle")
        .attr("r", 12).attr("stroke", "#fff").attr("stroke-width", 1.5).attr("fill", "steelblue");

    precedenceChartNodes.append("text")
        .text(d => d.id).attr("text-anchor", "middle").attr("dy", "0.35em")
        .style("fill", "white").style("font-size", "10px").style("pointer-events", "none");

    precedenceChartNodes.call(d3.drag()
        .on("start", dragstarted).on("drag", dragged).on("end", dragended));

    simulation.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        precedenceChartNodes.attr("transform", d => `translate(${d.x}, ${d.y})`);
    });

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

    renderPrecedenceLegend();
}

/* =======================
    PERT node sizing
    ======================= */

const PERT_LABOR_FALLBACK = {
    1: 0.8, 2: 1.5, 3: 1.0, 4: 1.3, 5: 0.5, 6: 0.7, 7: 0.7, 8: 0.52, 9: 0.325, 10: 0.96, 11: 0.3, 12: 2.0,
    13: 2.5, 14: 1.5, 15: 2.2, 16: 1.2, 17: 0.5, 18: 0.8, 19: 1.1, 20: 0.325, 21: 0.325, 22: 1.3, 23: 0.14,
    24: 0.585, 25: 1.3, 26: 1.0, 27: 0.7, 28: 1.0, 29: 0.7, 30: 0.5, 31: 0.4
};

function getPertLaborTime(id) {
    try {
        const t = state?.taskData?.get?.(id)?.laborTime;
        if (Number.isFinite(t)) return t;
    } catch (_) { }
    return PERT_LABOR_FALLBACK[id];
}

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

function enableAutoPERTSizing() {
    const tabsEl = document.getElementById('tabs');
    if (tabsEl) {
        tabsEl.addEventListener('click', (e) => {
            const btn = e.target;
            if (btn.classList?.contains('tab-btn') && btn.dataset.tab === 'precedence') {
                requestAnimationFrame(() => setTimeout(sizePERTNodesOnce, 50));
            }
        });
    }

    const panelEl = document.getElementById('precedence-panel');
    if (panelEl) {
        const obs = new MutationObserver(() => {
            clearTimeout(obs.__t);
            obs.__t = setTimeout(sizePERTNodesOnce, 100);
        });
        obs.observe(panelEl, { childList: true, subtree: true });
    }
}

enableAutoPERTSizing();

/* ==========================
    PERT node pies
    ========================== */

const PERT_PIE_COLORS = {
    super: '#3498db',
    ultra: '#f1c40f',
    mega: '#e74c3c',
    idle: '#e5e7e9'
};

const PERT_PIE_STROKE = '#ffffff';

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

function selectPertNodeGroups() {
    if (precedenceChartNodes && typeof precedenceChartNodes.size === 'function' && precedenceChartNodes.size() > 0) {
        return precedenceChartNodes;
    }
    return d3.select('#precedence-panel').selectAll('g').filter(d => d && d.id != null);
}

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

function fmtPct(x) { return isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—'; }
function fmtNum(x, d = 2) { return isFinite(x) ? x.toFixed(d) : '—'; }
function swatch(color) {
    return `<span style="display:inline-block;width:10px;height:10px;background:${color};border:1px solid rgba(255,255,255,0.85);margin-right:6px;border-radius:2px;"></span>`;
}

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

function enableAutoPERTPies() {
    const tabsEl = document.getElementById('tabs');
    if (tabsEl) {
        tabsEl.addEventListener('click', (e) => {
            const btn = e.target;
            if (btn.classList?.contains('tab-btn') && btn.dataset.tab === 'precedence') {
                requestAnimationFrame(() => setTimeout(() => {
                    sizePERTNodesOnce();
                    drawPERTNodePiesOnce();
                }, 50));
            }
        });
    }

    const panelEl = document.getElementById('precedence-panel');
    if (panelEl) {
        const obs = new MutationObserver(() => {
            clearTimeout(obs.__t);
            obs.__t = setTimeout(() => {
                sizePERTNodesOnce();
                drawPERTNodePiesOnce();
            }, 100);
        });
        obs.observe(panelEl, { childList: true, subtree: true });
    }
}

enableAutoPERTPies();

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
        .text('Precedence Legend').attr('x', 12).attr('y', 22)
        .style('font-weight', 700).style('font-size', '13px').attr('fill', '#333');

    const items = [
        { label: 'Super', color: PERT_PIE_COLORS.super },
        { label: 'Ultra', color: PERT_PIE_COLORS.ultra },
        { label: 'Mega', color: PERT_PIE_COLORS.mega },
        { label: 'Idle', color: PERT_PIE_COLORS.idle },
    ];

    const rowY0 = 46;
    items.forEach((it, i) => {
        const row = g.append('g').attr('transform', `translate(12, ${rowY0 + i * 22})`);
        row.append('rect').attr('width', 14).attr('height', 14)
            .attr('fill', it.color).attr('stroke', '#fff').attr('stroke-width', 1);
        row.append('text').text(it.label).attr('x', 20).attr('y', 12)
            .style('font-size', '12px').attr('fill', '#333');
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

    // If cache is valid for current financial inputs, do nothing.
    if (profitMaximizationCache.key === key) {
        isProfitCalculating = false;
        return;
    }

    // If the profit tab is active, show a loading message.
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'profit') {
        drawProfitPanel(); // This will show the loading state
    }

    return new Promise(resolve => {
        setTimeout(() => {
            const profitData = [];
            const marginData = [];
            const originalStateConfig = state.configData;

            try {
                state.configData = originalConfigData; // Use default configs for calculation

                for (let demand = 1; demand <= 576; demand++) {
                    let maxProfit = -Infinity;
                    let maxMargin = -Infinity;

                    // Brute-force search for the optimal combination of hours and employees
                    for (let opHours = 1; opHours <= 24; opHours += 0.25) {
                        const taktTime = (opHours * 60) / demand;
                        for (let numEmployees = 3; numEmployees <= 13; numEmployees++) {
                            if (!originalConfigData[numEmployees] || Object.keys(originalConfigData[numEmployees]).length === 0) continue;

                            const bottleneckTime = calculateWorkstationDetails(numEmployees).bottleneckTime;

                            // Only calculate profit if this configuration is feasible (meets Takt Time)
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
                state.configData = originalStateConfig; // Restore user's config
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


/**
 * Profit - Draws the Gross Profit and Gross Profit Margin charts from cached data.
 */
function drawProfitPanel() {
    const svg = d3.select("#profit-panel");
    const { clientWidth: width, clientHeight: height } = document.getElementById('svg-container');
    svg.selectAll("*").remove();

    if (!profitMaximizationCache.data || isProfitCalculating) {
        svg.append("text")
            .attr("x", width / 2).attr("y", height / 2)
            .attr("text-anchor", "middle")
            .style("font-size", "16px").attr("fill", "#666")
            .text("Calculating optimal profit scenarios, please wait...");
        return;
    }

    const data = profitMaximizationCache.data;

    const margin = { top: 40, right: 60, bottom: 40, left: 80 };
    const chartHeight = (height / 2) - margin.top - margin.bottom;
    const chartWidth = width - margin.left - margin.right;
    const xScale = d3.scaleLinear().domain([1, 576]).range([0, chartWidth]);

    const profitChart = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);
    const yProfitScale = d3.scaleLinear().domain(d3.extent(data.profitData, d => d.value)).nice().range([chartHeight, 0]);
    const profitLine = d3.line().x(d => xScale(d.demand)).y(d => yProfitScale(d.value));

    profitChart.append("g").attr("transform", `translate(0, ${chartHeight})`).call(d3.axisBottom(xScale));
    profitChart.append("g").call(d3.axisLeft(yProfitScale).tickFormat(d3.format("$,.0f")));
    profitChart.append("path").datum(data.profitData).attr("fill", "none").attr("stroke", "#27ae60").attr("stroke-width", 2).attr("d", profitLine);
    profitChart.append("text").attr("x", chartWidth / 2).attr("y", -15).attr("text-anchor", "middle").style("font-size", "14px").style("font-weight", "bold").text("Max Gross Profit by Demand");

    const marginChart = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top + height / 2})`);
    const yMarginScale = d3.scaleLinear().domain([d3.min(data.marginData, d => d.value) > 0 ? 0 : d3.min(data.marginData, d => d.value), d3.max(data.marginData, d => d.value)]).nice().range([chartHeight, 0]);
    const marginLine = d3.line().x(d => xScale(d.demand)).y(d => yMarginScale(d.value));

    marginChart.append("g").attr("transform", `translate(0, ${chartHeight})`).call(d3.axisBottom(xScale).tickFormat(d3.format("d")));
    marginChart.append("g").call(d3.axisLeft(yMarginScale).tickFormat(d => `${d.toFixed(0)}%`));
    marginChart.append("path").datum(data.marginData).attr("fill", "none").attr("stroke", "#2980b9").attr("stroke-width", 2).attr("d", marginLine);
    marginChart.append("text").attr("x", chartWidth / 2).attr("y", -15).attr("text-anchor", "middle").style("font-size", "14px").style("font-weight", "bold").text("Max Gross Profit Margin by Demand");
    marginChart.append("text").attr("x", chartWidth / 2).attr("y", chartHeight + margin.bottom - 5).attr("text-anchor", "middle").style("font-size", "12px").text("Daily Demand (Units)");

    const focus = svg.append("g").style("display", "none");
    focus.append("line").attr("class", "focus-line").attr("y1", margin.top).attr("y2", height - margin.bottom).attr("stroke", "#e74c3c").attr("stroke-dasharray", "3,3");
    const profitCircle = focus.append("circle").attr("r", 4).attr("fill", "#27ae60").attr("stroke", "white");
    const marginCircle = focus.append("circle").attr("r", 4).attr("fill", "#2980b9").attr("stroke", "white");
    const tooltip = focus.append("g");
    tooltip.append("rect").attr("width", 150).attr("height", 60).attr("rx", 4).attr("fill", "rgba(0,0,0,0.7)");
    const tooltipText1 = tooltip.append("text").attr("x", 10).attr("y", 20).attr("fill", "white").style("font-size", "12px");
    const tooltipText2 = tooltip.append("text").attr("x", 10).attr("y", 35).attr("fill", "white").style("font-size", "12px");
    const tooltipText3 = tooltip.append("text").attr("x", 10).attr("y", 50).attr("fill", "white").style("font-size", "12px");

    svg.append("rect").attr("width", width).attr("height", height).style("fill", "none").style("pointer-events", "all")
        .on("mouseover", () => focus.style("display", null))
        .on("mouseout", () => focus.style("display", "none"))
        .on("mousemove", mousemove);

    const bisectDemand = d3.bisector(d => d.demand).left;
    function mousemove(event) {
        const x0 = xScale.invert(d3.pointer(event)[0] - margin.left);
        const i = bisectDemand(data.profitData, x0, 1);
        if (i <= 0 || i >= data.profitData.length) return;
        const d0 = data.profitData[i - 1];
        const d1 = data.profitData[i];
        const d = (x0 - d0.demand > d1.demand - x0) ? d1 : d0;
        const m = data.marginData[d.demand - 1];

        const focusX = xScale(d.demand) + margin.left;
        const profitY = yProfitScale(d.value) + margin.top;
        const marginY = yMarginScale(m.value) + margin.top + height / 2;

        focus.select(".focus-line").attr("transform", `translate(${focusX}, 0)`);
        profitCircle.attr("transform", `translate(${focusX}, ${profitY})`);
        marginCircle.attr("transform", `translate(${focusX}, ${marginY})`);

        let tooltipX = focusX + 15;
        if (tooltipX + 150 > width) tooltipX = focusX - 165;
        tooltip.attr("transform", `translate(${tooltipX}, ${margin.top + 20})`);

        tooltipText1.text(`Demand: ${d.demand}`);
        tooltipText2.text(`Profit: ${d3.format("$,.0f")(d.value)}`);
        tooltipText3.text(`Margin: ${m.value.toFixed(1)}%`);
    }
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
        animationState.layout = { frameId: null, isRunning: false };
    }
    if (animationState.schedule.frameId) {
        cancelAnimationFrame(animationState.schedule.frameId);
        animationState.schedule = { frameId: null, isRunning: false };
    }
}

/**
* Layout - Initialize the Simulation for a given configuration.
*/
function startSimulation(config) {
    stopAllSimulations();

    let {
        svg, g, masterPathNode, productionQueue, totalDurationMs, launchDelayMs,
        binConfig, opHours, clockDisplay, scale, elementMap
    } = config;

    if (!masterPathNode || totalDurationMs <= 0 || launchDelayMs <= 0) {
        console.warn("Animation aborted due to invalid parameters.");
        return;
    }

    animationState.layout.isRunning = true;
    const realWorkdayDurationMs = (opHours * 60 * 60 * 1000) / 60;
    const modelColors = { 1: '#3498db', 2: '#f1c40f', 3: '#e74c3c' };
    const modelBorders = { 1: '#f39c12', 2: '#8e44ad', 3: '#1abc9c' };

    animationState.layout = {
        ...config,
        isRunning: true,
        startTime: performance.now(),
        nextLaunchTime: performance.now(),
        productsOnLine: [],
        queueIndex: 0,
        finishedGoodsCount: 0,
        pathLength: masterPathNode.getTotalLength()
    };

    function animationLoop(currentTime) {
        if (!animationState.layout.isRunning) return;

        const elapsedRealTimeMs = currentTime - animationState.layout.startTime;
        const elapsedSimTimeMs = elapsedRealTimeMs * 60;
        const simSeconds = elapsedSimTimeMs / 1000;
        const totalSimHours = Math.floor(simSeconds / 3600);
        const totalSimMinutes = Math.floor((simSeconds % 3600) / 60);
        clockDisplay.text(`${String(totalSimHours).padStart(2, '0')}:${String(totalSimMinutes).padStart(2, '0')}`);

        if (elapsedRealTimeMs < realWorkdayDurationMs && currentTime >= animationState.layout.nextLaunchTime && animationState.layout.queueIndex < animationState.layout.productionQueue.length) {
            const modelId = animationState.layout.productionQueue[animationState.layout.queueIndex];
            animationState.layout.productsOnLine.push({
                modelId: modelId,
                launchTime: currentTime,
                element: createProductShape(g, modelId, modelColors, modelBorders)
            });
            animationState.layout.queueIndex++;
            animationState.layout.nextLaunchTime += animationState.layout.launchDelayMs;
        }

        for (let i = animationState.layout.productsOnLine.length - 1; i >= 0; i--) {
            const product = animationState.layout.productsOnLine[i];
            const elapsedTime = currentTime - product.launchTime;
            const progress = elapsedTime / animationState.layout.totalDurationMs;

            if (progress >= 1) {
                placeInBin(product.element, animationState.layout.finishedGoodsCount, animationState.layout.binConfig, svg, scale);
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

        if (animationState.layout.productsOnLine.length > 0 || (animationState.layout.queueIndex < animationState.layout.productionQueue.length && elapsedRealTimeMs < realWorkdayDurationMs)) {
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
    const shapeSize = 1.3;
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
            .attr("stroke-width", 0.1);
    }
    return shape;
}

/**
* Layout - Moves 'Built' Product into the Finished Goods Bin.
*/
function placeInBin(element, count, binConfig, svg, scale) {
    const { binPixelX, binPixelY_bottom, itemsPerRow, productPixelSize, padding } = binConfig;
    const row = Math.floor(count / itemsPerRow);
    const col = count % itemsPerRow;

    svg.node().appendChild(element.node());

    // Calculate new position in pixels
    const newX = binPixelX + (padding / 2) + (col * productPixelSize) + (productPixelSize / 2);
    const newY = binPixelY_bottom - (padding / 2) - (row * productPixelSize) - (productPixelSize / 2);
    const newScale = productPixelSize / 1.3;

    element.attr('transform', `translate(${newX}, ${newY}) rotate(0) scale(${newScale})`);
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


    // Check for invalid workstation spacing
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


    // Generate workstation geometry
    const isEven = numEmployees % 2 === 0;
    const numLeft = isEven ? numEmployees / 2 : Math.floor(numEmployees / 2);
    const middleWsId = isEven ? null : numLeft + 1;
    let connectionPoint;

    const allPaths = [], allPoints = [];
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

        // Generate the unique color scale for this workstation's elements.
        const elementColorScale = generateElementColorScale(i - 1, numEmployees, elements.length);

        let currentPathPosFt = 0;
        elements.forEach((elId, index) => {
            const task = state.taskData.get(elId);

            // Determine line cap based on element's position in the workstation.
            let lineCap = 'round';
            if (index === 0 || index === elements.length - 1) {
                lineCap = 'butt';
            }

            allPaths.push({
                wsId: i,
                elId: elId,
                path: generateSubPath(p, currentPathPosFt, (task?.elementTime || 0) * 15),
                color: elementColorScale(index), // Use the new color scale
                lineCap: lineCap // Store the determined line cap.
            });
            currentPathPosFt += (task?.elementTime || 0) * 15;
        });
    }


    // Calculate Bounding Box and Scaling for Assembly Line
    if (allPoints.length === 0) return;
    const minX_ft = d3.min(allPoints, d => d.x);
    const maxX_ft = d3.max(allPoints, d => d.x);
    const minY_ft = d3.min(allPoints, d => d.y);
    const maxY_ft = d3.max(allPoints, d => d.y);
    if ((maxX_ft - minX_ft) <= 0 || (maxY_ft - minY_ft) <= 0) return;


    const lineBBox = { width: maxX_ft - minX_ft, height: maxY_ft - minY_ft };
    const uiPadding = 20;
    const rightPanelWidth = 180;


    const availableWidth = containerWidth - rightPanelWidth - uiPadding;
    const availableHeight = containerHeight - (uiPadding * 2);
    const scale = Math.min(availableWidth / lineBBox.width, availableHeight / lineBBox.height);


    const scaledLineWidth = lineBBox.width * scale;
    const leftPadding = ((containerWidth - rightPanelWidth) - scaledLineWidth) / 2;
    const translateX = leftPadding - (minX_ft * scale);
    const translateY = uiPadding - (minY_ft * scale);
    const g = svg.append("g").attr("transform", `translate(${translateX}, ${translateY}) scale(${scale})`).attr("fill", "none");


    // Draw UI Overlay (Dashboard, Bin, Legend) in Pixel Space
    const clockGroup = svg.append("g").attr("transform", `translate(${uiPadding}, ${uiPadding + 10})`);
    clockGroup.append("rect").attr("x", -10).attr("y", -22).attr("width", 100).attr("height", 30).attr("fill", "rgba(0,0,0,0.5)").attr("rx", 5);
    const clockDisplay = clockGroup.append("text").attr("id", "sim-clock-display").attr("fill", "white").style("font-size", "18px").style("font-family", "monospace").text("00:00");

    // Enhanced Speedometer
    const speedoX = containerWidth - (rightPanelWidth / 2) - uiPadding;
    const speedoY = 80;
    const speedoGroup = svg.append("g").attr("transform", `translate(${speedoX + 28}, ${speedoY})`);
    const speedoRadius = 60;
    const speedoDomain = [0, 15]; // The full range of the speedometer
    const colorThresholds = { slow: 4, medium: 10 }; // Thresholds for color changes

    // Scale for needle rotation in degrees
    const degreeScale = d3.scaleLinear().domain(speedoDomain).range([-90, 90]);
    // Scale for drawing arcs in radians
    const radianScale = d3.scaleLinear().domain(speedoDomain).range([-Math.PI / 2, Math.PI / 2]);

    const arcGenerator = d3.arc()
        .innerRadius(speedoRadius * 0.7)
        .outerRadius(speedoRadius)
        .cornerRadius(3);

    // Define the colored arc segments using HCL for better control over luminance (darkness)
    const arcs = [
        { start: speedoDomain[0], end: colorThresholds.slow, color: d3.hcl(200, 70, 70).toString() },    // Light Blue 🔵
        { start: colorThresholds.slow, end: colorThresholds.medium, color: d3.hcl(145, 70, 60).toString() }, // Darker Green 🟢
        { start: colorThresholds.medium, end: speedoDomain[1], color: d3.hcl(25, 80, 50).toString() }      // Darkest Orange-Red 🔴
    ];

    // Draw the colored arcs
    speedoGroup.selectAll("path.color-arc")
        .data(arcs)
        .join("path")
        .attr("class", "color-arc")
        .attr("fill", d => d.color)
        .attr("d", d => arcGenerator({
            startAngle: radianScale(d.start),
            endAngle: radianScale(d.end)
        }));

    // Add tick labels with improved readability
    const ticks = degreeScale.ticks(6);
    speedoGroup.selectAll("text.tick-label")
        .data(ticks)
        .join("text")
        .attr("class", "tick-label")
        .attr("x", d => Math.sin(radianScale(d)) * (speedoRadius + 15))
        .attr("y", d => -Math.cos(radianScale(d)) * (speedoRadius + 15))
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-size", "12px")
        .style("font-weight", "500")
        .attr("fill", "#333")
        .text(d => d);

    // Draw the needle
    speedoGroup.append("line").attr("id", "speedo-needle")
        .attr("y1", 10)
        .attr("y2", -speedoRadius * 0.9)
        .attr("stroke", "#34495e")
        .attr("stroke-width", 3)
        .attr("stroke-linecap", "round")
        .attr("transform", `rotate(${degreeScale(Math.min(speedoDomain[1], results.conveyorSpeed || 0))})`);

    // Add a center pivot for the needle
    speedoGroup.append("circle")
        .attr("r", 8)
        .attr("fill", "#34495e")
        .attr("stroke", "white")
        .attr("stroke-width", 2);

    // Digital readout text, shifted down for better clearance
    speedoGroup.append("text")
        .text(`${(results.conveyorSpeed || 0).toFixed(1)}`)
        .attr("y", speedoRadius * 0.55) // Shifted down
        .attr("text-anchor", "middle")
        .style("font-size", "22px")
        .style("font-weight", "bold")
        .attr("fill", "#2c3e50");
    speedoGroup.append("text")
        .text("ft/min")
        .attr("y", speedoRadius * 0.8) // Shifted down
        .attr("text-anchor", "middle")
        .style("font-size", "12px") // Easier to read
        .attr("fill", "#666");

    const binConfig = { productPixelSize: 12, itemsPerRow: 10, padding: 5 };
    binConfig.binPixelWidth = (binConfig.itemsPerRow * binConfig.productPixelSize) + (2 * binConfig.padding);
    binConfig.binPixelX = containerWidth - binConfig.binPixelWidth - uiPadding;
    binConfig.binPixelY_bottom = containerHeight - uiPadding;
    const binTopY = binConfig.binPixelY_bottom - (containerHeight * 0.70);
    const actualBinHeight = binConfig.binPixelY_bottom - binTopY;

    svg.append("rect").attr("x", binConfig.binPixelX).attr("y", binTopY).attr("width", binConfig.binPixelWidth).attr("height", actualBinHeight).attr("fill", "#E5E7E9").attr("stroke", "#666").attr("stroke-width", 1);
    svg.append("text").text("Finished Goods").attr("x", binConfig.binPixelX + binConfig.binPixelWidth / 2).attr("y", binTopY + actualBinHeight / 2).attr("text-anchor", "middle").attr("dominant-baseline", "middle").style("font-size", "16px").attr("fill", "#333");

    const legendGroup = svg.append("g").attr("transform", `translate(${uiPadding}, ${containerHeight - 130})`);
    legendGroup.append("rect").attr("width", 160).attr("height", 120).attr("fill", "rgba(255,255,255,0.8)").attr("rx", 5).attr("stroke", "#ccc");
    legendGroup.append("text").text("Legend").attr("x", 10).attr("y", 20).style("font-weight", "bold").attr("fill", "black");
    const legendModels = [{ id: 1, name: "Super" }, { id: 2, name: "Ultra" }, { id: 3, name: "Mega" }];
    const modelColors = { 1: '#3498db', 2: '#f1c40f', 3: '#e74c3c' };
    const modelBorders = { 1: '#f39c12', 2: '#8e44ad', 3: '#1abc9c' };
    legendModels.forEach((model, i) => {
        const item = legendGroup.append("g").attr("transform", `translate(20, ${40 + i * 22})`);
        createProductShape(item, model.id, modelColors, modelBorders).attr("transform", "scale(8)");
        item.append("text").text(model.name).attr("x", 20).attr("y", 4).attr("fill", "black");
    });
    legendGroup.append("text").text("Grid: 10ft x 10ft").attr("x", 10).attr("y", 110).style("font-style", "italic").attr("fill", "black");


    // Draw Assembly Line & Grid
    const gridGroup = g.append("g");
    const gridBounds = {
        x1: (0 - translateX) / scale, y1: (0 - translateY) / scale,
        x2: (containerWidth - translateX) / scale, y2: (containerHeight - translateY) / scale
    };
    for (let x = Math.floor(gridBounds.x1 / 10) * 10; x <= gridBounds.x2; x += 10) {
        gridGroup.append("line").attr("x1", x).attr("y1", gridBounds.y1).attr("x2", x).attr("y2", gridBounds.y2);
    }
    for (let y = Math.floor(gridBounds.y1 / 10) * 10; y <= gridBounds.y2; y += 10) {
        gridGroup.append("line").attr("x1", gridBounds.x1).attr("y1", y).attr("x2", gridBounds.x2).attr("y2", y);
    }
    gridGroup.selectAll("line").attr("stroke", "rgba(0,0,0,0.1)").attr("stroke-width", 0.2);

    // Separate paths for rendering order.
    const buttPaths = allPaths.filter(p => p.lineCap === 'butt');
    const roundPaths = allPaths.filter(p => p.lineCap === 'round');

    // Helper function to draw the two path layers for each element.
    const drawElementPaths = (selection) => {
        // Darker background path
        selection.append("path")
            .attr("d", d => d.path)
            .attr("stroke", "#333333")
            .attr("stroke-width", 1.5)
            .attr("stroke-linecap", d => d.lineCap);
        // Colored foreground path
        selection.append("path")
            .attr("d", d => d.path)
            .attr("stroke", d => d.color)
            .attr("stroke-width", 1)
            .attr("stroke-linecap", d => d.lineCap)
            .append("title").text(d => `Element ${d.elId}\nWorkstation ${d.wsId}`);
    };

    // 1. Draw the 'butt' capped elements first.
    g.selectAll("g.element-group-butt")
        .data(buttPaths, d => `${d.wsId}-${d.elId}`)
        .join("g")
        .attr("class", "element-group-butt")      
        .call(drawElementPaths);

    // 2. Draw the 'round' capped elements on top.
    g.selectAll("g.element-group-round")
        .data(roundPaths, d => `${d.wsId}-${d.elId}`)
        .join("g")
        .attr("class", "element-group-round")
        .call(drawElementPaths);

    // Initialize and Start Product Animation
    const totalDurationSec = (ASSEMBLY_LINE_LENGTH / results.conveyorSpeed);
    const launchDelaySec = (results.productSpacing / results.conveyorSpeed);


    if (isFinite(totalDurationSec) && totalDurationSec > 0 && isFinite(launchDelaySec) && launchDelaySec > 0) {
        let masterPathString = "";
        allPaths.forEach((pathData, i) => { masterPathString += i === 0 ? pathData.path : pathData.path.replace('M', ' '); });
        const masterPathNode = g.append("path").attr("d", masterPathString).node();


        let cumulativeDist = 0;
        const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const elementMap = allPaths.map(p => {
            tempPath.setAttribute('d', p.path);
            const len = tempPath.getTotalLength();
            const segment = { elementId: p.elId, startDist: cumulativeDist, endDist: cumulativeDist + len };
            cumulativeDist += len;
            return segment;
        });


        startSimulation({
            svg, g, masterPathNode, clockDisplay, elementMap,
            opHours: opInputs.opHours,
            productionQueue: generateProductionQueue(opInputs.dailyDemand),
            totalDurationMs: totalDurationSec * 1000,
            launchDelayMs: launchDelaySec * 1000,
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
 * Schedule - Gathers data for the Gantt chart.
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
    let allFinishedTasks = [];
    let arrivalsForNextStation = productionQueue.map((modelId, index) => ({
        modelId: modelId,
        arrivalTime: index * launchInterval,
        uniqueId: `${modelId}-${index}`
    }));

    const sortedWorkstationIds = Object.keys(config).sort((a, b) => parseInt(a) - parseInt(b));

    for (const stationId of sortedWorkstationIds) {
        const elements = config[stationId] || [];
        if (elements.length === 0) continue;

        let stationFreeTime = 0;
        let processedModels = [];

        arrivalsForNextStation.sort((a, b) => a.arrivalTime - b.arrivalTime);

        for (const model of arrivalsForNextStation) {
            let currentTimeForModel = Math.max(stationFreeTime, model.arrivalTime);

            for (const elementId of elements) {

                if (doesElementBuildModel(elementId, model.modelId)) {
                    const task = state.taskData.get(elementId);
                    if (task) {
                        const taskStartTime = currentTimeForModel;
                        const taskEndTime = taskStartTime + task.elementTime;

                        allFinishedTasks.push({
                            workstationId: `WS ${stationId}`,
                            modelId: model.modelId,
                            taskId: elementId,
                            startTime: taskStartTime,
                            endTime: taskEndTime,
                            uniqueId: model.uniqueId
                        });

                        currentTimeForModel = taskEndTime;
                    }
                }
            }

            stationFreeTime = currentTimeForModel;
            processedModels.push({ ...model, arrivalTime: currentTimeForModel });
        }

        arrivalsForNextStation = processedModels;
    }

    return { tasks: allFinishedTasks };
}

/**
 * Schedule - Renders the scrolling Gantt chart animation, aligned with the left sidebar.
 */
function drawScheduleVisualization() {
    stopAllSimulations();
    const svg = d3.select("#schedule-panel");
    svg.selectAll("*").remove();

    const simulationResult = runGanttSimulation();
    const { clientWidth: containerWidth, clientHeight: containerHeight } = document.getElementById('svg-container');

    if (!simulationResult || simulationResult.tasks.length === 0) {
        svg.append("text").attr("x", containerWidth / 2).attr("y", containerHeight / 2).attr("text-anchor", "middle").attr("fill", "#666")
            .text("No data to display. Check configuration or inputs.");
        return;
    }

    animationState.schedule.isRunning = true;
    const { tasks } = simulationResult;
    const opHours = parseFloat(opHoursInput.value);

    const margin = { top: 40, right: 20, bottom: 20, left: 20 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const clockGroup = svg.append("g").attr("transform", `translate(${margin.left + 10}, 30)`);
    clockGroup.append("rect").attr("x", -10).attr("y", -15).attr("width", 100).attr("height", 20).attr("fill", "rgba(0,0,0,0.5)").attr("rx", 5);
    const clockDisplay = clockGroup.append("text").attr("id", "sim-clock-display").attr("fill", "white").style("font-size", "18px").style("font-family", "monospace").text("00:00");
    const contentGroup = chart.append("g").attr("class", "schedule-content-group");
    const gridGroup = contentGroup.append("g").attr("class", "vertical-grid");
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
    const totalRealSimDurationMs = (totalSimDurationMinutes * 60000) / 60;

    const animationStartTime = performance.now();

    function animationLoop(currentTime) {
        if (!animationState.schedule.isRunning) return;

        const elapsedRealTimeMs = currentTime - animationStartTime;
        const cappedElapsedRealTimeMs = Math.min(elapsedRealTimeMs, totalRealSimDurationMs);
        const elapsedSimTimeMinutes = (cappedElapsedRealTimeMs * 60) / 60000;

        const h = String(Math.floor(elapsedSimTimeMinutes / 60)).padStart(2, '0');
        const m = String(Math.floor(elapsedSimTimeMinutes % 60)).padStart(2, '0');
        clockDisplay.text(`${h}:${m}`);

        const viewStartTime = (elapsedRealTimeMs * 60) / 60000;
        xScale.domain([viewStartTime, viewStartTime + VIEW_WINDOW_MINS]);

        contentGroup.selectAll(".bar")
            .attr("x", d => xScale(d.startTime))
            .attr("width", d => Math.max(0, xScale(d.endTime) - xScale(d.startTime)));

        if (elapsedRealTimeMs < totalRealSimDurationMs) {
            animationState.schedule.frameId = requestAnimationFrame(animationLoop);
        } else {
            animationState.schedule.isRunning = false;
        }
    }
    workstationList.dispatchEvent(new Event('scroll'));
    animationState.schedule.frameId = requestAnimationFrame(animationLoop);
}

/**
 * Efficiency - Draws the per-workstation and line-level efficiency charts.
 */
function drawEfficiencyPanel() {
    const svg = d3.select("#efficiency-panel");

    // Panel size (used for the right-side summary)
    const { clientWidth: panelWidth, clientHeight: panelHeight } = document.getElementById('svg-container');

    // Inputs → metrics
    const opInputs = {
        dailyDemand: +dailyDemandInput.value,
        opHours: +opHoursInput.value,
        numEmployees: +numEmployeesInput.value
    };
    const finInputs = { laborCost: +laborCostInput.value };
    const results = calculateMetrics(opInputs, finInputs);
    if (!results) return;

    // === ROOT GROUP (persistent) ===
    const root = svg.selectAll("g#eff-root")
        .data([null])
        .join(enter => enter.append("g").attr("id", "eff-root"));

    // Layout params
    const wsBlockWidth = 500;
    const wsBlockHeight = 260;
    const margin = { top: 80, left: 40 };
    const cols = 4;
    const layoutTransform = (i) => {
        const col = i % cols;
        const row = Math.floor(i / cols) + 1;
        const x = margin.left + col * wsBlockWidth;
        const y = margin.top + row * wsBlockHeight;
        return `translate(${x},${y})`;
    };

    // === WORKSTATION GROUPS (proper data binding to maintain animation state) ===
    const wsSel = root.selectAll("g.ws")
        .data(results.workstations, d => d.id); // Use workstation ID as key for proper data binding

    const wsEnter = wsSel.enter()
        .append("g")
        .attr("class", "ws")
        .attr("transform", (d, i) => layoutTransform(i));

    // sub-groups created on enter only
    wsEnter.append("g").attr("class", "pie").attr("transform", "translate(75,75)");
    wsEnter.append("g").attr("class", "clock").attr("transform", "translate(275,75)");

    // Update positions for all workstations (including existing ones)
    const wsMerge = wsEnter.merge(wsSel)
        .attr("transform", (d, i) => layoutTransform(i));

    // Remove workstations that no longer exist
    wsSel.exit().remove();

    // === PIE (animated) ===
    const arc = d3.arc().innerRadius(0).outerRadius(100);

    wsMerge.each(function (ws) {
        const pieGroup = d3.select(this).select("g.pie");

        // Create data with fixed angles instead of using d3.pie()
        // Clamp efficiency to prevent exact 100% which causes flickering
        const clampedEfficiency = Math.min(ws.efficiency, 99.99) / 100; // convert to 0-1 range
        const workAngle = clampedEfficiency * 2 * Math.PI; // work portion angle

        const data = [
            {
                label: "Work",
                startAngle: 0,  // start at top (12 o'clock)
                endAngle: workAngle,  // end after work portion
                value: Math.min(ws.efficiency, 99.99)
            },
            {
                label: "Idle",
                startAngle: workAngle,  // start where work ends
                endAngle: 2 * Math.PI,  // complete the circle
                value: Math.max(100 - ws.efficiency, 0.01)
            }
        ];

        const slices = pieGroup.selectAll("path.slice")
            .data(data, d => d.label);

        const slicesEnter = slices.enter()
            .append("path")
            .attr("class", "slice")
            .attr("fill", d => d.label === "Work" ? "#2ecc71" : "#e74c3c")
            .each(function (d) {
                // Initialize with zero state for smooth animation from 0
                const zeroState = {
                    ...d,
                    startAngle: 0,
                    endAngle: 0
                };
                this._current = zeroState;
            })
            .attr("d", function (d) { return arc(this._current); });  // Set initial path from zero state

        // Add titles to new slices
        slicesEnter.append("title");

        // Merge enter and update selections
        const slicesMerged = slicesEnter.merge(slices);

        // Update the path geometry with smooth transitions
        slicesMerged.transition()
            .duration(750)
            .attrTween("d", function (d) {
                const i = d3.interpolate(this._current || d, d);
                this._current = i(1);
                return t => arc(i(t));
            });

        // Update tooltip text
        slicesMerged.select("title")
            .text(`WS${ws.id}: ${ws.efficiency.toFixed(1)}% efficiency`);

        slices.exit().remove();
    });

    // === CLOCK (animated hand via rotation) ===
    wsMerge.each(function (ws) {
        const clockGroup = d3.select(this).select("g.clock");

        // Clock face with proper data binding
        const clockFace = clockGroup.selectAll("circle.face")
            .data([null]);

        const clockFaceEnter = clockFace.enter()
            .append("circle")
            .attr("class", "face")
            .attr("r", 55)
            .attr("fill", "#ecf0f1")
            .attr("stroke", "#333");

        // Add title to new faces
        clockFaceEnter.append("title");

        // Update tooltip text for all clock faces
        clockFaceEnter.merge(clockFace).select("title")
            .text(`WS${ws.id}: ${(ws.dailyIdleTime / 60).toFixed(1)}h idle time`);

        const radius = 55;
        const angle = 2 * Math.PI * ((ws.dailyIdleTime / 60) / opInputs.opHours);

        // Clock hand with animation
        const wsHand = clockGroup.selectAll("line.hand")
            .data([angle]);

        wsHand.enter()
            .append("line")
            .attr("class", "hand")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", 0).attr("y2", -radius)
            .attr("stroke", "#e67e22").attr("stroke-width", 3)
            .attr("transform", "rotate(0)")  // Start from 0 rotation
            .each(function (a) { this._prev = 0; })  // Initialize previous state to 0
            .merge(wsHand)
            .transition()
            .duration(750)
            .attrTween("transform", function (a) {
                const prev = this._prev ?? a;
                const i = d3.interpolate(prev, a);
                this._prev = a;
                return t => `rotate(${(i(t) * 180) / Math.PI})`;
            });

        wsHand.exit().remove();
    });

    // === TOP ROW SUMMARY ===
    // Align with second column (col 1, index 1) - same x position as wsBlockWidth for 4-column layout
    const summaryX = margin.left + 1 * wsBlockWidth + 300; // align with pie chart position in second column
    const summaryY = margin.top + 60; // add padding to prevent clipping of pie chart top
    const summary = root.selectAll("g#eff-summary")
        .data([null])
        .join(enter => enter.append("g").attr("id", "eff-summary"))
        .attr("transform", `translate(${summaryX}, ${summaryY})`);

    // summary pie - make it bigger to match workstation pie charts
    const arcLine = d3.arc().innerRadius(0).outerRadius(100);

    // Create data with fixed angles instead of using d3.pie()
    // Clamp efficiency to prevent exact 100% which causes flickering
    const clampedEfficiency = Math.min(results.averageEfficiency, 99.99) / 100; // convert to 0-1 range
    const workAngle = clampedEfficiency * 2 * Math.PI; // work portion angle

    const linePieData = [
        {
            label: "Work",
            startAngle: 0,  // start at top (12 o'clock) - adjusted from -Math.PI/2
            endAngle: workAngle,  // end after work portion
            value: Math.min(results.averageEfficiency, 99.99)
        },
        {
            label: "Idle",
            startAngle: workAngle,  // start where work ends
            endAngle: 2 * Math.PI,  // complete the circle
            value: Math.max(100 - results.averageEfficiency, 0.01)
        }
    ];

    const sumSlices = summary.selectAll("path.sum-slice")
        .data(linePieData, d => d.label);

    const sumSlicesEnter = sumSlices.enter()
        .append("path")
        .attr("class", "sum-slice")
        .attr("fill", d => d.label === "Work" ? "#2ecc71" : "#e74c3c")
        .each(function (d) {
            // Initialize with zero state for smooth animation from 0
            const zeroState = {
                ...d,
                startAngle: 0,
                endAngle: 0
            };
            this._current = zeroState;
        })
        .attr("d", function (d) { return arcLine(this._current); });  // Set initial path from zero state

    // Add titles to new slices
    sumSlicesEnter.append("title");

    // Merge enter and update selections
    const sumSlicesMerged = sumSlicesEnter.merge(sumSlices);

    // Update the path geometry
    sumSlicesMerged.transition()
        .duration(750)
        .attrTween("d", function (d) {
            const i = d3.interpolate(this._current || d, d);
            this._current = i(1);
            return t => arcLine(i(t));
        });

    // Update tooltip text for all slices (both new and existing)
    sumSlicesMerged.select("title")
        .text(`Line Average: ${results.averageEfficiency.toFixed(1)}% efficiency`);

    sumSlices.exit().remove();

    // summary idle clock - moved closer to pie chart (same spacing as workstation charts)
    const sumClock = summary.selectAll("g.sum-clock")
        .data([null])
        .join(enter => enter.append("g").attr("class", "sum-clock"))
        .attr("transform", "translate(200,0)"); // spacing to match workstation layout

    const clockFace = sumClock.selectAll("circle.face")
        .data([null])
        .join(
            enter => {
                const circle = enter.append("circle")
                    .attr("class", "face")
                    .attr("r", 55)
                    .attr("fill", "#ecf0f1")
                    .attr("stroke", "#333");
                circle.append("title");
                return circle;
            }
        );

    // Update tooltip text for all clock faces (both new and existing)
    clockFace.select("title")
        .text(`Line Total: ${(results.totalIdleTime / 60).toFixed(1)}h idle time`);

    const idleFrac = (results.totalIdleTime / 60) / (opInputs.opHours * opInputs.numEmployees);
    const sumAngle = 2 * Math.PI * idleFrac;

    const sumHand = sumClock.selectAll("line.hand")
        .data([sumAngle]);

    sumHand.enter()
        .append("line")
        .attr("class", "hand")
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", 0).attr("y2", -55) // match workstation clock size
        .attr("stroke", "#e67e22").attr("stroke-width", 3) // increased stroke width to match workstation clocks
        .each(function (a) { this._prev = a; })
        .merge(sumHand)
        .transition()
        .duration(750)
        .attrTween("transform", function (a) {
            const prev = this._prev ?? a;
            const i = d3.interpolate(prev, a);
            this._prev = a;
            return t => `rotate(${(i(t) * 180) / Math.PI})`;
        });

    sumHand.exit().remove();

    // === LINE METRICS TEXT (next to clock) ===
    const metricsGroup = summary.selectAll("g.line-metrics")
        .data([null])
        .join(enter => enter.append("g").attr("class", "line-metrics"))
        .attr("transform", "translate(320,0)"); // position to the right of clock

    // Balance Delay text
    metricsGroup.selectAll("text.balance-delay")
        .data([null])
        .join("text")
        .attr("class", "balance-delay")
        .attr("x", 0)
        .attr("y", -10)
        .attr("text-anchor", "start")
        .attr("fill", "#2c3e50")
        .style("font-size", "14px")
        .style("font-weight", "bold")
        .text(`Balance Delay: ${results.balanceDelay.toFixed(1)}%`);

    // Idle CV text
    metricsGroup.selectAll("text.idle-cv")
        .data([null])
        .join("text")
        .attr("class", "idle-cv")
        .attr("x", 0)
        .attr("y", 10)
        .attr("text-anchor", "start")
        .attr("fill", "#2c3e50")
        .style("font-size", "14px")
        .style("font-weight", "bold")
        .text(`Idle CV: ${results.idleTimeCv.toFixed(1)}%`);
}

function enableMiddleDragNumberInput(input, step = 1, sensitivity = 0.1) {
    let isDragging = false;
    let startY, startValue;

    // Default values mapping - customize these based on your application's needs
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

    // Get min/max constraints from the input element
    const getConstraints = () => {
        const min = input.hasAttribute('min') ? parseFloat(input.min) : -Infinity;
        const max = input.hasAttribute('max') ? parseFloat(input.max) : Infinity;
        const stepValue = parseFloat(input.step) || 1;
        return { min, max, step: stepValue };
    };

    input.addEventListener("mousedown", (e) => {
        if (e.button === 1) { // middle mouse button for dragging
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            startY = e.clientY;
            startValue = parseFloat(input.value) || 0;

            const onMouseMove = (ev) => {
                if (!isDragging) return;
                const deltaY = startY - ev.clientY; // dragging up increases
                const constraints = getConstraints();
                let newVal = startValue + deltaY * sensitivity * step;

                // Clamp to min/max constraints
                newVal = Math.max(constraints.min, Math.min(constraints.max, newVal));

                // Format based on input type and step
                if (input.type === 'range' || constraints.step === 1) {
                    input.value = Math.round(newVal).toString();
                } else if (constraints.step < 1) {
                    const decimals = Math.max(0, -Math.floor(Math.log10(constraints.step)));
                    input.value = newVal.toFixed(decimals);
                } else {
                    input.value = newVal.toFixed(2);
                }

                input.dispatchEvent(new Event("input", { bubbles: true })); // trigger updates
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

    // Mouse wheel scrolling support
    input.addEventListener("wheel", (e) => {
        if (document.activeElement === input) {
            e.preventDefault();
            const constraints = getConstraints();
            const direction = e.deltaY > 0 ? -1 : 1;
            let currentValue = parseFloat(input.value) || 0;
            let newVal = currentValue + (direction * constraints.step);

            // Clamp to min/max constraints
            newVal = Math.max(constraints.min, Math.min(constraints.max, newVal));

            // Format based on input type and step
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

    // Ctrl+click to reset to default value (Houdini-style)
    input.addEventListener("click", (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const inputId = input.id;
            const defaultValue = defaultValues[inputId];

            if (defaultValue !== undefined) {
                const constraints = getConstraints();
                // Ensure default value is within constraints
                const clampedDefault = Math.max(constraints.min, Math.min(constraints.max, defaultValue));

                // Format the value appropriately based on input type
                if (input.type === 'range' || constraints.step === 1) {
                    input.value = Math.round(clampedDefault).toString();
                } else if (constraints.step < 1) {
                    const decimals = Math.max(0, -Math.floor(Math.log10(constraints.step)));
                    input.value = clampedDefault.toFixed(decimals);
                } else {
                    input.value = clampedDefault.toFixed(2);
                }

                // Trigger the input event to update the UI
                input.dispatchEvent(new Event("input", { bubbles: true }));

                // Visual feedback - briefly highlight the input
                input.style.backgroundColor = '#90EE90'; // light green
                setTimeout(() => {
                    input.style.backgroundColor = '';
                }, 200);
            }
        }
    });
}

function restoreActiveTab() {
    const savedTab = sessionStorage.getItem("activeTab");
    const defaultTab = "overview";
    const targetTab = savedTab || defaultTab;

    // Set active button
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    if (btn) btn.classList.add("active");

    // Show correct panel
    visPanels.forEach(panel => {
        panel.style.display = panel.id === `${targetTab}-panel` ? "block" : "none";
    });
}

function renderActiveTab() {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    if (activeTab === 'overview') drawOverviewPanel();
    else if (activeTab === 'precedence') drawPrecedenceChart();
    else if (activeTab === 'schedule') drawScheduleVisualization();
    else if (activeTab === 'efficiency') drawEfficiencyPanel();
    else if (activeTab === 'layout') drawLayoutVisualization();
    else if (activeTab === 'profit') drawProfitPanel();
}

// Run the application
main();