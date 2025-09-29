/**
 * script.js: Core logic for the Assembly Line Simulator.
 * Joel Wood
 */

console.log("script.js script started.");

// Global Constants and Mapping
const MIN_TAKT_TIME = 2.76;
const BUILD_RATIOS = { super: 0.35, ultra: 0.45, mega: 0.20 };
const ASSEMBLY_LINE_LENGTH = 486;
let isRecalculating = false;
const state = {
    taskData: new Map(),
    configData: {}
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
const workstationOutputsContainer = document.getElementById('workstationOutputsContainer');
const avgEfficiencyEl = document.getElementById('avgEfficiency');
const totalIdleTimeEl = document.getElementById('totalIdleTime');
const balanceDelayEl = document.getElementById('balanceDelay');
const idleTimeCvEl = document.getElementById('idleTimeCv');

//Main Initialization
async function main() {
    console.log("Initializing application.");
    await loadData();
    setupEventListeners();
    updateUI();
}

//Data Loading
async function loadData() {
    try {
        const [pertData, configsRaw] = await Promise.all([
            d3.csv("Data/PERT.csv"),
            d3.csv("Data/CONFIGS.csv")
        ]);
        pertData.forEach(d => {
            state.taskData.set(parseInt(d.Element), {
                laborTime: parseFloat(d.Labor_Time),
                elementTime: parseFloat(d.Element_Time)
            });
        });
        for (let i = 3; i <= 12; i++) {
            state.configData[i] = {};
        }
        configsRaw.forEach(row => {
            for (let i = 3; i <= 12; i++) {
                const wsKey = `${i}_Workstation`, elKey = `${i}_Element`;
                const workstation = row[wsKey], element = parseInt(row[elKey]);
                if (workstation && !isNaN(element)) {
                    if (!state.configData[i][workstation]) state.configData[i][workstation] = [];
                    state.configData[i][workstation].push(element);
                }
            }
        });
        console.log("CSV data loaded successfully.");
    } catch (error) {
        console.error("Fatal Error: Could not load data files.", error);
        demandStatusEl.textContent = "Error: Check console for details.";
    }
}

//Input Change Helper
function handleInputChange(driverId) {
    if (isRecalculating) return;
    isRecalculating = true;

    let dailyDemand = parseInt(dailyDemandInput.value) || 1;
    let opHours = parseFloat(opHoursInput.value) || 1;
    let numEmployees = parseInt(numEmployeesInput.value);

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
                if (requiredHours <= 24) {
                    opHours = roundUpToQuarter(requiredHours);
                } else {
                    opHours = 24;
                    dailyDemand = Math.floor((opHours * 60) / currentBottleneck);
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
    isRecalculating = false;
}

// UI Updating
function updateUI() {
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

    employeeCountDisplay.textContent = opInputs.numEmployees;

    const results = calculateMetrics(opInputs, finInputs);

    if (results) {
        wipEl.textContent = results.wip.toFixed(1);
        throughputEl.textContent = results.throughputUnitsPerHour.toFixed(1);
        conveyorSpeedEl.textContent = results.conveyorSpeed.toFixed(2);
        productSpacingEl.textContent = results.productSpacing.toFixed(2);

        grossProfitEl.textContent = results.dailyGrossProfit.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        profitMarginEl.textContent = `${results.grossProfitMargin.toFixed(1)}%`;

        avgEfficiencyEl.textContent = `${results.averageEfficiency.toFixed(1)}%`;
        totalIdleTimeEl.textContent = (results.totalIdleTime / 60).toFixed(2);
        balanceDelayEl.textContent = `${results.balanceDelay.toFixed(1)}%`;
        idleTimeCvEl.textContent = `${results.idleTimeCv.toFixed(1)}%`;

        demandStatusEl.textContent = results.meetsDemand ? "Meets Demand" : "Fails to Meet Demand";
        demandStatusEl.className = results.meetsDemand ? "status success" : "status failure";

        workstationOutputsContainer.innerHTML = '';
        results.workstations.forEach(ws => {
            const span = document.createElement('div');
            span.className = 'ws-span';
            span.innerHTML = `
                <span class="ws-span-id">Workstation ${ws.id}:</span>
                <span class="ws-span-stats">
                <span>Eff: <strong>${ws.efficiency.toFixed(1)}%</strong></span>
                <span>Idle: <strong>${(ws.dailyIdleTime / 60).toFixed(2)} hrs</strong></span>
                <span>Length: <strong>${ws.stationLength.toFixed(1)} ft</strong></span>
                </span>
                `;
            workstationOutputsContainer.appendChild(span);
        });
    }
}

//Calculating Per Workstation Details
function calculateWorkstationDetails(numEmployees) {
    const config = state.configData[numEmployees];
    if (!config || Object.keys(config).length === 0) return { workstations: [], bottleneckTime: 0, fastestTime: Infinity };

    let workstations = [], bottleneckTime = 0, fastestTime = Infinity;
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
        workstations.push({
            id: stationId,
            cycleTime: totalLaborTime,
            stationLength: stationLength
        });

        if (totalLaborTime > bottleneckTime) bottleneckTime = totalLaborTime;
        if (totalLaborTime < fastestTime && totalLaborTime > 0) fastestTime = totalLaborTime;
    }
    return { workstations, bottleneckTime, fastestTime };
}

//Calculating Updated Variable Values
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

    let totalIdleTime = 0, efficiencies = [], idleTimesPerCycle = [];
    wsDetails.workstations.forEach(ws => {
        const idleTimePerCycle = bottleneckCycleTime - ws.cycleTime;
        ws.dailyIdleTime = idleTimePerCycle * throughputUnitsPerDay;
        ws.efficiency = bottleneckCycleTime > 0 ? (ws.cycleTime / bottleneckCycleTime) * 100 : 0;

        totalIdleTime += ws.dailyIdleTime;
        efficiencies.push(ws.efficiency);
        idleTimesPerCycle.push(idleTimePerCycle);
    });

    const totalAvailableTime = op.opHours * op.numEmployees * 60; // Total minutes
    const averageEfficiency = totalAvailableTime > 0 ? ((totalAvailableTime - totalIdleTime) / totalAvailableTime) * 100 : 0;
    const balanceActive = efficiencies.length > 0 ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length : 0;
    const balanceDelay = 100 - balanceActive;
    const idleMean = idleTimesPerCycle.length > 0 ? idleTimesPerCycle.reduce((a, b) => a + b, 0) / idleTimesPerCycle.length : 0;
    const stdDev = Math.sqrt(idleTimesPerCycle.map(x => Math.pow(x - idleMean, 2)).reduce((a, b) => a + b, 0) / (idleTimesPerCycle.length || 1));
    const idleTimeCv = idleMean > 0 ? (stdDev / idleMean) * 100 : 0;
    const throughputUnitsPerHour = op.opHours > 0 ? throughputUnitsPerDay / op.opHours : 0;
    const totalDailyLaborCost = op.numEmployees * op.opHours * fin.laborCost;
    const totalRevenue = throughputUnitsPerDay * ((BUILD_RATIOS.super * fin.superSell) + (BUILD_RATIOS.ultra * fin.ultraSell) + (BUILD_RATIOS.mega * fin.megaSell));
    const totalCogs = throughputUnitsPerDay * ((BUILD_RATIOS.super * fin.superCogs) + (BUILD_RATIOS.ultra * fin.ultraCogs) + (BUILD_RATIOS.mega * fin.megaCogs));
    const dailyGrossProfit = totalRevenue - totalCogs - totalDailyLaborCost;
    const grossProfitMargin = totalRevenue > 0 ? (dailyGrossProfit / totalRevenue) * 100 : 0;

    return {
        wip, throughputUnitsPerHour, conveyorSpeed, productSpacing, dailyGrossProfit,
        grossProfitMargin, meetsDemand, effectiveCycleTime, workstations: wsDetails.workstations,
        averageEfficiency, totalIdleTime, balanceDelay, idleTimeCv
    };
}

//For Resolving Necessary Employee Count for Takt Time
function findBestEmployeeFit(requiredTaktTime, startingCount) {
    for (let i = startingCount; i <= 12; i++) {
        if (calculateWorkstationDetails(i).bottleneckTime <= requiredTaktTime) return i;
    }
    return 12;
}

//For Shifting Operational Hours in 15 minute intervals
function roundUpToQuarter(value) { return Math.ceil(value / 0.25) * 0.25; }

//Event-Listeners
function setupEventListeners() {
    const inputs = [
        dailyDemandInput, opHoursInput, numEmployeesInput, laborCostInput,
        superSellInput, superCogsInput, ultraSellInput, ultraCogsInput,
        megaSellInput, megaCogsInput
    ];
    inputs.forEach(input => input.addEventListener('input', (e) => handleInputChange(e.target.id)));
}

main();
