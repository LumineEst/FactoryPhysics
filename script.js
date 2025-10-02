// Global Constants and Mapping
const MIN_TAKT_TIME = 2.5;
const BUILD_RATIOS = { super: 0.35, ultra: 0.45, mega: 0.20 };
const ASSEMBLY_LINE_LENGTH = 486; // in feet
let isRecalculating = false;
const state = {
    taskData: new Map(),
    configData: {}
};
const originalConfigData = {};
let sortableInstances = [];
let precedenceChartNodes = null;
let invalidPrecedenceNodes = new Set();
let productionQueue = [];
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
    console.log("Initializing application.");

    await loadData();
    setupEventListeners();
    setupUIEventListeners();
    updateUI();
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
    try {
        let dailyDemand = parseInt(dailyDemandInput.value) || 1;
        let opHours = parseFloat(opHoursInput.value) || 1;
        let numEmployees = parseInt(numEmployeesInput.value);
        if (driverId === 'numEmployees') {
            // Reset scroll position before redrawing to prevent graphical offsets.
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
    let totalIdleTime = 0,
        efficiencies = [],
        idleTimesPerCycle = [];
    wsDetails.workstations.forEach(ws => {
        const idleTimePerCycle = bottleneckCycleTime - ws.cycleTime;
        ws.dailyIdleTime = idleTimePerCycle * throughputUnitsPerDay;
        ws.efficiency = bottleneckCycleTime > 0 ? (ws.cycleTime / bottleneckCycleTime) * 100 : 0;
        totalIdleTime += ws.dailyIdleTime;
        efficiencies.push(ws.efficiency);
        idleTimesPerCycle.push(idleTimePerCycle);
    });
    const totalAvailableTime = op.opHours * op.numEmployees * 60;
    const averageEfficiency = totalAvailableTime > 0 ? ((totalAvailableTime - totalIdleTime) / totalAvailableTime) * 100 : 0;
    const balanceActive = efficiencies.length > 0 ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length : 0;
    const balanceDelay = 100 - balanceActive;
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
    productionQueue = [];
    const modelRatios = [0.35, 0.45, 0.20];
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
            wipEl.textContent = results.wip.toFixed(1);
            throughputEl.textContent = `${results.throughputUnitsPerHour.toFixed(1)}/hr`;
            conveyorSpeedEl.textContent = `${results.conveyorSpeed.toFixed(2)} ft/min`;
            productSpacingEl.textContent = `${results.productSpacing.toFixed(2)} ft`;
            grossProfitEl.textContent = results.dailyGrossProfit.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
            profitMarginEl.textContent = `${results.grossProfitMargin.toFixed(1)}%`;
            avgEfficiencyEl.textContent = `${results.averageEfficiency.toFixed(1)}%`;
            totalIdleTimeEl.textContent = `${(results.totalIdleTime / 60).toFixed(2)} hrs`;
            balanceDelayEl.textContent = `${results.balanceDelay.toFixed(1)}%`;
            idleTimeCvEl.textContent = `${results.idleTimeCv.toFixed(1)}%`;
            demandStatusEl.textContent = results.meetsDemand ? "Meets Demand" : "Fails to Meet Demand";
            demandStatusEl.className = results.meetsDemand ? "status success" : "status failure";
        }
    }

    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;

    stopAllSimulations();

    if (activeTab === 'layout' || activeTab === 'schedule') {
        const clockToReset = document.querySelector(`#${activeTab}-panel #sim-clock-display`);
        if (clockToReset) clockToReset.textContent = "00:00";
    }

    if (activeTab === 'layout') {
        drawLayoutVisualization();
    } else if (activeTab === 'schedule') {
        drawScheduleVisualization();
    }

    updatePrecedenceChartColors();
}

/**
 * UI - Creating the Left Sidebar for Workstation Configurations.
 */
function renderWorkstationSidebar(numEmployees) {
    // Clear everything except the clock
    while (workstationList.children.length > 0 && workstationList.firstChild.id !== 'sidebar-clock') {
        workstationList.firstChild.remove();
    }
    while (workstationList.children.length > 1) {
        workstationList.lastChild.remove();
    }

    const config = state.configData[numEmployees];
    if (!config || Object.keys(config).length === 0) return;
    let maxElementTime = 0;
    for (const stationId in config) {
        config[stationId].forEach(taskId => {
            const task = state.taskData.get(taskId);
            if (task && task.elementTime > maxElementTime) {
                maxElementTime = task.elementTime;
            }
        });
    }
    if (maxElementTime === 0) return;
    for (const stationId in config) {
        const workstationDiv = document.createElement('div');
        workstationDiv.className = 'workstation';
        const title = document.createElement('div');
        title.className = 'workstation-title';
        title.textContent = `Workstation ${stationId}`;
        workstationDiv.appendChild(title);
        const elementsContainer = document.createElement('div');
        elementsContainer.className = 'workstation-elements';
        config[stationId].forEach(taskId => {
            const task = state.taskData.get(taskId);
            if (task) {
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
                const laborTimeBar = document.createElement('div');
                laborTimeBar.className = 'labor-time-bar';
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
    }

    // ADDED: Dynamically align sidebar content with the top of the SVG container
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

function setupUIEventListeners() {
    let precedenceChartDrawn = false;
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

            tabs.querySelector('.active').classList.remove('active');
            e.target.classList.add('active');
            visPanels.forEach(panel => {
                panel.style.display = panel.id === `${targetTab}-panel` ? 'block' : 'none';
            });

            stopAllSimulations();

            if (targetTab === 'layout') {
                drawLayoutVisualization();
            } else if (targetTab === 'schedule') {
                drawScheduleVisualization();
            } else if (targetTab === 'precedence' && !precedenceChartDrawn) {
                drawPrecedenceChart();
                precedenceChartDrawn = true;
            }
        }
    });

    // ADDED: Synchronize sidebar scroll with the schedule visualization
    workstationList.addEventListener('scroll', () => {
        const scrollTop = workstationList.scrollTop;
        const schedulePanel = document.getElementById('schedule-panel');
        const contentGroup = schedulePanel.querySelector('.schedule-content-group');
        if (contentGroup) {
            // Apply a negative translation to move the SVG content up as the user scrolls down
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
 * Precedence - Generates a Precedence DAG for Elements connected by precedence.
 */
function drawPrecedenceChart() {
    const rawData = [{ id: 1, predecessors: [] }, { id: 2, predecessors: [1] }, { id: 3, predecessors: [1] }, { id: 4, predecessors: [1] }, { id: 5, predecessors: [2, 3] }, { id: 6, predecessors: [1] }, { id: 7, predecessors: [6] }, { id: 8, predecessors: [1] }, { id: 9, predecessors: [8] }, { id: 10, predecessors: [1] }, { id: 11, predecessors: [1] }, { id: 12, predecessors: [10, 11] }, { id: 13, predecessors: [4, 5, 7, 9, 12] }, { id: 14, predecessors: [13] }, { id: 15, predecessors: [14] }, { id: 16, predecessors: [15] }, { id: 17, predecessors: [16] }, { id: 18, predecessors: [14] }, { id: 19, predecessors: [18] }, { id: 20, predecessors: [19] }, { id: 21, predecessors: [20] }, { id: 22, predecessors: [18] }, { id: 23, predecessors: [22] }, { id: 24, predecessors: [23] }, { id: 25, predecessors: [19, 22] }, { id: 26, predecessors: [19, 22] }, { id: 27, predecessors: [25, 26] }, { id: 28, predecessors: [27] }, { id: 29, predecessors: [15] }, { id: 30, predecessors: [17, 21, 24, 27, 29] }, { id: 31, predecessors: [30] },];
    const nodes = rawData.map(d => ({ id: d.id }));
    const links = [];
    rawData.forEach(d => { d.predecessors.forEach(pId => { links.push({ source: pId, target: d.id }); }); });
    const svg = d3.select("#precedence-panel");
    const width = document.getElementById('svg-container').clientWidth;
    const height = document.getElementById('svg-container').clientHeight;
    const simulation = d3.forceSimulation(nodes).force("link", d3.forceLink(links).id(d => d.id).distance(60)).force("charge", d3.forceManyBody().strength(-200)).force("center", d3.forceCenter(width / 2, height / 2));
    const link = svg.append("g").attr("stroke", "#999").attr("stroke-opacity", 0.6).selectAll("line").data(links).join("line").attr("stroke-width", 2);
    precedenceChartNodes = svg.append("g").selectAll("g").data(nodes).join("g");
    precedenceChartNodes.append("circle").attr("r", 12).attr("stroke", "#fff").attr("stroke-width", 1.5).attr("fill", "steelblue");
    precedenceChartNodes.append("text").text(d => d.id).attr("text-anchor", "middle").attr("dy", "0.35em").style("fill", "white").style("font-size", "10px").style("pointer-events", "none");
    precedenceChartNodes.call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended));
    simulation.on("tick", () => { link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y); precedenceChartNodes.attr("transform", d => `translate(${d.x}, ${d.y})`); });
    function dragstarted(event) { if (!event.active) simulation.alphaTarget(0.3).restart(); event.subject.fx = event.subject.x; event.subject.fy = event.subject.y; }
    function dragged(event) { event.subject.fx = event.x; event.subject.fy = event.y; }
    function dragended(event) { if (!event.active) simulation.alphaTarget(0); event.subject.fx = null; event.subject.fy = null; }
}

/**
 * Layout - Determines if a given element works on a given model.
 */
function doesElementBuildModel(elementId, modelId) {
    const task = state.taskData.get(elementId);
    if (!task) return false;
    const modelMap = { 1: 'Super', 2: 'Ultra', 3: 'Mega' };
    return task[modelMap[modelId]] > 0;
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
    const realWorkdayDurationMs = (opHours * 60 * 60 * 1000) / 60; // 60x speed up
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
        shape.attr("fill", modelColors[modelId]).attr("stroke", modelBorders[modelId]).attr("stroke-width", 0.1);
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
        svg.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").attr("fill", "black").text("No configuration data for this number of workstations.");
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
        svg.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").attr("fill", "red").text("Error: A workstation's length is less than 13 feet.");
        return;
    }

    const opInputs = { dailyDemand: parseInt(dailyDemandInput.value), opHours: parseFloat(opHoursInput.value), numEmployees: parseInt(numEmployeesInput.value) };
    const finInputs = { laborCost: parseFloat(laborCostInput.value) };
    const results = calculateMetrics(opInputs, finInputs);
    const { clientWidth: containerWidth, clientHeight: containerHeight } = document.getElementById('svg-container');

    const isEven = numEmployees % 2 === 0;
    const numLeft = isEven ? numEmployees / 2 : Math.floor(numEmployees / 2);
    const middleWsId = isEven ? null : numLeft + 1;
    let connectionPoint;
    const baseHue = 150, goldenAngle = 137.5, baseChroma = 65, baseLuminance = 60, luminanceVary = 20, hueVary = 12;
    const workstationColors = [];
    for (let i = 0; i < numEmployees; i++) {
        workstationColors.push(d3.hcl((baseHue + i * goldenAngle) % 360, baseChroma, baseLuminance));
    }

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
        const baseColor = workstationColors[wsId - 1];
        const startColor = baseColor.copy(); startColor.h += hueVary; startColor.l += luminanceVary;
        const endColor = baseColor.copy(); endColor.h -= hueVary; endColor.l -= luminanceVary;
        const elementShader = d3.scaleLinear().domain([0, elements.length > 1 ? elements.length - 1 : 1]).range([startColor.toString(), endColor.toString()]).interpolate(d3.interpolateHcl);
        let currentPathPosFt = 0;
        elements.forEach((elId, index) => {
            const task = state.taskData.get(elId);
            allPaths.push({ wsId: i, elId: elId, path: generateSubPath(p, currentPathPosFt, (task?.elementTime || 0) * 15), color: elementShader(index) });
            currentPathPosFt += (task?.elementTime || 0) * 15;
        });
    }

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
    const clockGroup = svg.append("g").attr("transform", `translate(${uiPadding}, ${uiPadding + 10})`);
    clockGroup.append("rect").attr("x", -10).attr("y", -22).attr("width", 100).attr("height", 30).attr("fill", "rgba(0,0,0,0.5)").attr("rx", 5);
    const clockDisplay = clockGroup.append("text").attr("id", "sim-clock-display").attr("fill", "white").style("font-size", "18px").style("font-family", "monospace").text("00:00");
    const speedoX = containerWidth - (rightPanelWidth / 2) - uiPadding;
    const speedoY = 80;
    const speedoGroup = svg.append("g").attr("transform", `translate(${speedoX}, ${speedoY})`);
    const speedoRadius = 60;
    const speedoScale = d3.scaleLinear().domain([0, 15]).range([-90, 90]);
    const arcGen = d3.arc().innerRadius(speedoRadius * 0.7).outerRadius(speedoRadius).startAngle(-Math.PI / 2).endAngle(Math.PI / 2);
    speedoGroup.append("path").attr("d", arcGen).attr("fill", "#eee").attr("stroke", "#999");
    speedoGroup.selectAll("line.tick").data(speedoScale.ticks(3)).enter().append("line").attr("class", "tick").attr("x1", 0).attr("y1", -speedoRadius * 1.05).attr("x2", 0).attr("y2", -speedoRadius * 0.7).attr("transform", d => `rotate(${speedoScale(d)})`).attr("stroke", "black").attr("stroke-width", 2);
    speedoGroup.append("line").attr("id", "speedo-needle").attr("y2", -speedoRadius * 0.9).attr("stroke", "#e74c3c").attr("stroke-width", 3).attr("stroke-linecap", "round").attr("transform", `rotate(${speedoScale(Math.min(15, results.conveyorSpeed || 0))})`);
    speedoGroup.append("text").text(`${(results.conveyorSpeed || 0).toFixed(1)} ft/min`).attr("y", speedoRadius * 0.5).attr("text-anchor", "middle").style("font-size", "14px").attr("fill", "black");
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
    legendModels.forEach((model, i) => { const item = legendGroup.append("g").attr("transform", `translate(20, ${40 + i * 22})`); createProductShape(item, model.id, modelColors, modelBorders).attr("transform", "scale(8)"); item.append("text").text(model.name).attr("x", 20).attr("y", 4).attr("fill", "black"); });
    legendGroup.append("text").text("Grid: 10ft x 10ft").attr("x", 10).attr("y", 110).style("font-style", "italic").attr("fill", "black");
    const gridGroup = g.append("g");
    const gridBounds = { x1: (0 - translateX) / scale, y1: (0 - translateY) / scale, x2: (containerWidth - translateX) / scale, y2: (containerHeight - translateY) / scale };
    for (let x = Math.floor(gridBounds.x1 / 10) * 10; x <= gridBounds.x2; x += 10) { gridGroup.append("line").attr("x1", x).attr("y1", gridBounds.y1).attr("x2", x).attr("y2", gridBounds.y2); }
    for (let y = Math.floor(gridBounds.y1 / 10) * 10; y <= gridBounds.y2; y += 10) { gridGroup.append("line").attr("x1", gridBounds.x1).attr("y1", y).attr("x2", gridBounds.x2).attr("y2", y); }
    gridGroup.selectAll("line").attr("stroke", "rgba(0,0,0,0.1)").attr("stroke-width", 0.2);
    const elementGroups = g.selectAll("g.element-group").data(allPaths).join("g");
    elementGroups.append("path").attr("d", d => d.path).attr("stroke", "#333333").attr("stroke-width", 1.4).attr("stroke-linecap", "round");
    elementGroups.append("path").attr("d", d => d.path).attr("stroke", d => d.color).attr("stroke-width", 1).attr("stroke-linecap", "round").append("title").text(d => `Element ${d.elId}\nWorkstation ${d.wsId}`);
    const totalDurationSec = (ASSEMBLY_LINE_LENGTH / results.conveyorSpeed);
    const launchDelaySec = (results.productSpacing / results.conveyorSpeed);
    if (isFinite(totalDurationSec) && totalDurationSec > 0 && isFinite(launchDelaySec) && launchDelaySec > 0) {
        let masterPathString = "";
        allPaths.forEach((pathData, i) => { masterPathString += i === 0 ? pathData.path : pathData.path.replace('M', ' '); });
        const masterPathNode = g.append("path").attr("d", masterPathString).node();
        let cumulativeDist = 0;
        const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const elementMap = allPaths.map(p => { tempPath.setAttribute('d', p.path); const len = tempPath.getTotalLength(); const segment = { elementId: p.elId, startDist: cumulativeDist, endDist: cumulativeDist + len }; cumulativeDist += len; return segment; });
        startSimulation({ svg, g, masterPathNode, clockDisplay, elementMap, opHours: opInputs.opHours, productionQueue: generateProductionQueue(opInputs.dailyDemand), totalDurationMs: totalDurationSec * 1000, launchDelayMs: launchDelaySec * 1000, binConfig, scale });
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

    // Initial arrivals at the first station
    let arrivalsForNextStation = productionQueue.map((modelId, index) => ({
        modelId: modelId,
        arrivalTime: index * launchInterval,
        uniqueId: `${modelId}-${index}`
    }));

    const sortedWorkstationIds = Object.keys(config).sort((a, b) => parseInt(a) - parseInt(b));

    for (const stationId of sortedWorkstationIds) {
        const elements = config[stationId] || [];
        if (elements.length === 0) continue;

        let stationFreeTime = 0; // Tracks when the workstation is next available
        let processedModels = []; // Models that have completed this station

        // Sort models by their arrival time at this station
        arrivalsForNextStation.sort((a, b) => a.arrivalTime - b.arrivalTime);

        for (const model of arrivalsForNextStation) {
            // Work can only start after the model arrives AND the station is free.
            let currentTimeForModel = Math.max(stationFreeTime, model.arrivalTime);

            // Sequentially process elements for this model
            for (const elementId of elements) {
                // Check if this element is valid for the current model
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

                        // The current time for this model advances to the end of this task
                        currentTimeForModel = taskEndTime;
                    }
                }
            } // End of elements loop for one model

            // The station is now occupied until this model is fully processed
            stationFreeTime = currentTimeForModel;

            // The model's arrival time for the *next* station is when it departs this one.
            processedModels.push({ ...model, arrivalTime: currentTimeForModel });

        } // End of models loop for one station

        // The output of this station is the input for the next
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

    const clockGroup = svg.append("g").attr("transform", `translate(${margin.left+10}, 30)`);
    clockGroup.append("rect").attr("x", -10).attr("y", -15).attr("width", 100).attr("height", 20).attr("fill", "rgba(0,0,0,0.5)").attr("rx", 5);
    const clockDisplay = clockGroup.append("text").attr("id", "sim-clock-display").attr("fill", "white").style("font-size", "18px").style("font-family", "monospace").text("00:00");

    // All scrolling content (bars and borders) goes in this single group.
    const contentGroup = chart.append("g").attr("class", "schedule-content-group");

    const gridGroup = contentGroup.append("g").attr("class", "vertical-grid");

    // This combined offset accounts for the SVG's position on the page AND its internal top margin.
    const yOffset = document.getElementById('svg-container').getBoundingClientRect().top + margin.top;

    // 1. Map the precise geometry of each element row from the sidebar.
    const elementGeometry = new Map();
    document.querySelectorAll('.element-row').forEach(elRow => {
        const taskId = parseInt(elRow.dataset.taskId);
        const rect = elRow.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const barHeight = rect.height * 0.8; // Use 80% of the row height for the bar.
        const barY = (centerY - barHeight / 2) - yOffset;
        elementGeometry.set(taskId, { y: barY, height: barHeight });
    });

    // 2. Draw workstation title-centered borders inside the scrolling group.
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

    // 3. Draw the Gantt bars using the calculated geometry map.
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

        // Dynamically update vertical grid lines
        const interval = 15; // 15 minutes
        const viewEndTime = viewStartTime + VIEW_WINDOW_MINS;
        const firstTick = Math.ceil(viewStartTime / interval) * interval;
        const tickValues = d3.range(firstTick, viewEndTime, interval);

        gridGroup.selectAll("line")
            .data(tickValues, d => d)
            .join("line")
            .attr("x1", d => xScale(d))
            .attr("x2", d => xScale(d))
            .attr("y1", -margin.top)
            .attr("y2", height + containerHeight) // Ensure it covers the full scrollable area
            .attr("stroke", "#e0e0e0")
            .attr("stroke-width", 1);


        if (elapsedRealTimeMs < totalRealSimDurationMs) {
            animationState.schedule.frameId = requestAnimationFrame(animationLoop);
        } else {
            animationState.schedule.isRunning = false;
        }
    }
    workstationList.dispatchEvent(new Event('scroll'));
    animationState.schedule.frameId = requestAnimationFrame(animationLoop);
}

// Run the application
main();
