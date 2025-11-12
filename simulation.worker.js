let highsScriptLoaded = false;
let highsScriptError = null;
let highsLoaderFunction = null;
let highsInstancePromise = null;

// Attempt to load the HiGHS solver script
try {
    // This assumes /libs/highs.js is in the same directory as the worker.
    importScripts('libs/highs.js');
    highsLoaderFunction = Module;
    highsScriptLoaded = true;
} catch (error) {
    highsScriptError = `Failed to import script 'libs/highs.js': ${error.message}`;
    console.error("WORKER: CRITICAL -", highsScriptError, error);
}

// --- Async Solver Loader ---
/**
 * Asynchronously initializes and returns the HiGHS WebAssembly solver instance.
 * Ensures only one instance is created.
 * @returns {Promise<object>} A promise that resolves to the HiGHS solver instance.
 */
async function getSolverInstance() {
    // Check if script loading failed or loader wasn't found
    if (!highsScriptLoaded || !highsLoaderFunction) {
        throw new Error(highsScriptError || "HiGHS script did not load or define loader.");
    }

    // If the instance promise doesn't exist yet, create it
    if (!highsInstancePromise) {
        // Path relative to this worker where highs.wasm is
        // If /libs is at the root, you might need: const wasmPath = '../libs/';
        const wasmPath = 'libs/';
        const memoryMB = 1024; // Request 1 GB memory
        const initialMemory = memoryMB * 1024 * 1024;

        highsInstancePromise = highsLoaderFunction({
            locateFile: (filename) => wasmPath + filename, // Helps locate .wasm file
            initialMemory: initialMemory // Request specific memory heap size
        })
            .then(instance => {
                if (!instance?.solve) { // Basic validation
                    throw new Error("HiGHS instance invalid or missing 'solve' method.");
                }
                return instance;
            })
            .catch(err => {
                console.error("WORKER: Failed to initialize HiGHS WASM instance:", err);
                highsInstancePromise = null; // Reset promise on failure
                throw err; // Re-throw error
            });
    }
    // Return the existing promise (or the newly created one)
    return highsInstancePromise;
}

// --- Async MILP Helper Function ---
/**
 * Generates and solves a Mixed Integer Linear Program (MILP) to find an optimal
 * shipment start day schedule for cities, minimizing the peak daily shipment load.
 * Populates the `scheduleData` array with the resulting schedule.
 * @param {Array<object>} cities - Array of city objects { name, qty, freq, chosenStartDay? }.
 * @param {Array<object>} scheduleData - Array representing 365 days, to be populated with schedule.
 * @returns {Promise<object>} A promise resolving to { status, peakDemand, dailyData: scheduleData } or an error status.
 */
async function findOptimalShipmentSchedule(cities, scheduleData) {
    let solverInstance;

    // Get the solver instance
    try {
        solverInstance = await getSolverInstance();
    } catch (error) {
        console.error("WORKER: Solver failed load/init in findOptimalShipmentSchedule", error);
        // Fallback: Provide a basic schedule if solver fails
        const safeScheduleData = scheduleData || Array.from({ length: 365 }, () => ({ shipments: 0, shipmentDetails: [] }));
        safeScheduleData.forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } });

        if (Array.isArray(cities)) {
            // *** FALLBACK LOGIC *** Simple heuristic: Stagger start days using modulo
            let dayCounter = 0;
            cities.forEach(c => {
                const freq = c.freq || 7;
                // Use chosen start day if valid, otherwise stagger
                let startDay = (c.chosenStartDay > 0 && c.chosenStartDay <= freq) ? c.chosenStartDay : (dayCounter % freq) + 1;

                const startDay_0idx = startDay - 1;
                for (let t = startDay_0idx; t < 365; t += freq) {
                    if (safeScheduleData[t]) {
                        safeScheduleData[t].shipments += c.qty;
                        safeScheduleData[t].shipmentDetails.push({ city: c.name, qty: c.qty, freq: freq, startDay: startDay });
                    }
                }
                dayCounter++;
            });
        }
        return { status: 'error_loading_solver', peakDemand: -1, dailyData: safeScheduleData, message: `Solver init error: ${error.message}` };
    }

    // --- LP String Generation ---
    let lpString = "";
    const cityVarMap = new Map();
    const binaryVars = [];
    const generalVars = ["Z"];
    let objectiveParts = ["1 Z"]; // Minimize Z

    try {
        lpString += "Minimize\n obj: " + objectiveParts.join(' + ') + "\n";
        lpString += "Subject To\n";

        // Constraints for each city: Choose one start day or use forced start day
        (cities || []).forEach((city, cityIndex) => {
            if (city.chosenStartDay > 0) {
                const startDay = city.chosenStartDay;
                const varName = `x_${cityIndex}_${startDay}`;
                binaryVars.push(varName);
                cityVarMap.set(varName, { cityIndex, cityQty: city.qty, startDay: startDay, freq: city.freq, forced: true });
                lpString += ` city_${cityIndex}_forced: 1 ${varName} = 1\n`;
            } else {
                const freq = Math.max(1, Math.round(city.freq));
                let possibleStartDays = [];
                for (let d = 1; d <= freq; d++) possibleStartDays.push(d);
                possibleStartDays = [...new Set(possibleStartDays)];

                // Add constraints and variables for the chosen possible start days
                const constraintName = `city_${cityIndex}_start`;
                let cityConstraintParts = [];
                possibleStartDays.forEach((d) => {
                    const varName = `x_${cityIndex}_${d}`;
                    cityConstraintParts.push(`1 ${varName}`);
                    binaryVars.push(varName);
                    cityVarMap.set(varName, { cityIndex, cityQty: city.qty, startDay: d, freq, forced: false });
                });
                if (cityConstraintParts.length > 0) {
                    lpString += ` ${constraintName}: ${cityConstraintParts.join(' + ')} = 1\n`;
                }
            }
        });

        // Constraints for each day: Daily load <= Z
        for (let t = 0; t < 365; t++) {
            const constraintName = `day_${t}_load`;
            let dayConstraintParts = [];
            cityVarMap.forEach((v, varName) => {
                const startDay_0idx = v.startDay - 1;
                if (t >= startDay_0idx && (t - startDay_0idx) % v.freq === 0) {
                    dayConstraintParts.push(`${v.cityQty} ${varName}`);
                }
            });
            if (dayConstraintParts.length > 0) {
                lpString += ` ${constraintName}: ${dayConstraintParts.join(' + ')} - 1 Z <= 0\n`;
            }
        }

        // Variable Types
        lpString += "Bounds\n";
        lpString += "General\n";
        lpString += ` ${generalVars.join(' ')}\n`;
        lpString += "Binary\n";
        lpString += ` ${binaryVars.join(' ')}\n`;
        lpString += "End\n";

    } catch (genError) {
        console.error("WORKER: Error during LP String Generation:", genError);
        return { status: 'error_lp_generation', peakDemand: -1, dailyData: scheduleData, message: `LP Gen Error: ${genError.message}` };
    }

    // --- Solve the LP ---
    try {
        const result = await solverInstance.solve(lpString);

        // --- Parse Results ---
        const rawStatus = result?.Status ?? 'Unknown';
        const statusString = typeof rawStatus === 'string' ? rawStatus.trim() : 'Unknown';
        const isOptimalOrFeasible = statusString === 'Optimal' || statusString === 'Feasible';

        if (!isOptimalOrFeasible) {
            console.error(`WORKER: Non-optimal/feasible status '${statusString}'. Result:`, result);
            const simpleStatus = statusString.toLowerCase().replace(/[\s\(\)]+/g, '_') || 'unknown';
            return { status: `solver_status_${simpleStatus}`, peakDemand: -1, dailyData: scheduleData, message: `Solver status: ${statusString}` };
        }

        let peakDemand = -1;
        const columnsData = result.Columns;
        if (columnsData?.Z?.Primal !== undefined) peakDemand = columnsData.Z.Primal;
        (scheduleData || []).forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } });

        // Extract solution values for binary variables
        let solutionValues = {};
        if (columnsData && typeof columnsData === 'object') {
            for (const varName in columnsData) {
                let v;
                if (Object.hasOwnProperty.call(columnsData, varName) && columnsData[varName]) {
                    v = columnsData[varName].Primal ?? columnsData[varName].Value ?? columnsData[varName].value;
                }
                if (typeof v === 'number') solutionValues[varName] = v;
            }
        } else {
            return { status: 'solver_result_error', peakDemand: -1, dailyData: scheduleData, message: 'Solver result Columns object missing/invalid.' };
        }

        // --- Apply Schedule to scheduleData ---
        try {
            cityVarMap.forEach((v, varName) => {
                if (solutionValues[varName] > 0.5 || v.forced) {
                    const chosenStartDay = v.startDay;
                    for (let t = chosenStartDay - 1; t < 365; t += v.freq) {
                        if (t >= 0 && t < scheduleData.length && scheduleData[t]) {
                            scheduleData[t].shipments += v.cityQty;
                            const cityName = cities[v.cityIndex]?.name || `City ${v.cityIndex}`;
                            scheduleData[t].shipmentDetails.push({
                                city: cityName,
                                qty: v.cityQty,
                                freq: v.freq,
                                startDay: chosenStartDay
                            });
                        }
                    }
                }
            });
        } catch (assignmentError) {
            console.error("WORKER: Error during solver assignment:", assignmentError);
            return { status: 'solver_assignment_error', peakDemand: peakDemand, dailyData: scheduleData, message: `Assign error: ${assignmentError.message}` };
        }

        return { status: 'optimal', peakDemand: peakDemand, dailyData: scheduleData };

    } catch (error) {
        console.error("WORKER: Error during HiGHS solve execution or result parsing:", error);
        return { status: 'solver_execution_error', peakDemand: -1, dailyData: scheduleData, message: `Solve/Parse error: ${error.message}` };
    }
}

/**
 * Runs the main day-by-day inventory simulation based on a pre-calculated schedule.
 * Implements a 3-Tier "pull" logic:
 * 1. Build to a "target" level (from main demand input) to smooth production.
 * 2. Flex up to "max" standard capacity (no cost) to meet daily shipments.
 * 3. Reactive OT (costly) as a last resort for large shortfalls.
 *
 * Includes a new two-stage optimization (Step 7) to:
 * 1. (Forward Pass) Remove full "slack" days as early as possible.
 * 2. (Backward Pass) Remove any remaining days to offset OT.
 *
 * @param {object} params - Simulation parameters including cities, schedule, costs, etc.
 * @returns {Promise<object>} A promise resolving to { results } or { error, results }.
 */
async function performSimulation(params) {
    let dailyData = null; // Holds the final state, including shifted shipments
    let functionStep = "1. Deconstruct Params"; // Track current step

    try {
        // --- 1. Deconstruct params ---
        const {
            cities, workingDaysSchedule, standardOpHours, numEmployees, laborCost,
            holdingCostRate, annualMfgOverhead, annualSgaExpenses,
            superCogsVal, ultraCogsVal, mcInputVal, buildRatios,
            targetDailyProduction,
            maxStandardProduction
        } = params;

        if (typeof targetDailyProduction === 'undefined' || typeof maxStandardProduction === 'undefined') {
            throw new Error("Missing critical parameters: targetDailyProduction or maxStandardProduction was not provided by LocationTab.js.");
        }

        const workingDaysSet = new Set(workingDaysSchedule);
        const numWorkingDays = workingDaysSchedule.length;
        const dailyHoldingRate = holdingCostRate / 365.0;
        const dailyMfgOverhead = numWorkingDays > 0 ? annualMfgOverhead / numWorkingDays : 0;
        const dailySgaExpenses = numWorkingDays > 0 ? annualSgaExpenses / numWorkingDays : 0;
        const avgCogs = (superCogsVal * buildRatios.super) + (ultraCogsVal * buildRatios.ultra) + (mcInputVal * buildRatios.mega);

        if (maxStandardProduction <= 0) throw new Error("Max standard production must be > 0.");
        if (standardOpHours <= 0) throw new Error("Std operating hours must be > 0.");

        const productionPerStdHour = maxStandardProduction / standardOpHours;
        if (productionPerStdHour <= 0) throw new Error("Production per std hour must be > 0.");

        const targetEndInventory = 0;

        // --- 2. Initialize Data Array ---
        functionStep = "2. Initialize dailyData";
        dailyData = Array.from({ length: 365 }, (_, i) => {
            const year = new Date().getFullYear();
            const date = new Date(Date.UTC(year, 0, i + 1));
            const dayStr = date.toISOString().split('T')[0];
            return {
                day: i, date: dayStr,
                isWorkingDay: workingDaysSet.has(dayStr), // The *original* working day flag
                production: 0, opHours: 0, inventoryStart: 0, inventoryAvailable: 0,
                shipments: 0,
                shipmentDetails: [],
                actualShipments: 0,
                actualShipmentDetails: [],
                demandMet: true,
                inventoryEnd: 0,
                holdingCost: 0, exceptionCost: 0,
                isExceptionDay: false,
                isReductionDay: false,
                shipmentDeferred: false
            };
        });

        let simulationError = null;

        // --- 3. Run Optimizer / Heuristic (Populates dailyData.shipments/Details) ---
        functionStep = "3. Run Optimizer/Heuristic";
        if (cities && cities.length > 0) {
            const optimizationResult = await findOptimalShipmentSchedule(cities, dailyData);

            if (!optimizationResult || optimizationResult.status !== 'optimal') {
                console.error(`WORKER: Optimizer failed (${optimizationResult?.status}), using heuristic schedule.`);
                dailyData.forEach(d => { d.shipments = 0; d.shipmentDetails = []; });
                // Simple heuristic: Stagger start days using modulo
                let dayCounter = 0;
                cities.forEach(city => {
                    const freq = city.freq || 7;
                    // Use chosen start day if valid, otherwise stagger
                    let startDay = (city.chosenStartDay > 0 && city.chosenStartDay <= freq) ? city.chosenStartDay : (dayCounter % freq) + 1;

                    const startDay_0idx = startDay - 1;
                    for (let t = startDay_0idx; t < 365; t += freq) {
                        if (dailyData[t]) {
                            dailyData[t].shipments += city.qty;
                            dailyData[t].shipmentDetails.push({ city: city.name, qty: city.qty, freq: freq, startDay: startDay });
                        }
                    }
                    dayCounter++; // Increment for the next city
                });
            }
        } else {
            // No cities, ensure schedule is empty
            dailyData.forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } });
        }

        // If no cities are provided, bypass the entire simulation.
        if (!cities || cities.length === 0) {
            return { results: dailyData };
        }

        // --- 4. Run Simulation Loop (Forward Pass 1) ---
        functionStep = "4. Simulation Loop (Pass 1 - Safety Build)";
        let accumulatedExtraHours = 0;

        // This helper function will be run multiple times
        /**
         * @param {Array} dataArray The simulation data array to operate on.
         * @param {string} passName A name for logging. "Pass 1" is special.
         * @param {number} minInventoryCushion The minimum inventory level to maintain.
         * @returns {{error: string|null, otHours: number}}
         */
        function runSimLoop(dataArray, passName = "Pass 1", minInventoryCushion = -Infinity) {
            let simError = null;
            let otHours = 0;

            for (let day = 0; day < 365; day++) {
                const d = dataArray[day];
                if (!d) continue;

                // A. Inventory & Production
                d.inventoryStart = (day === 0) ? 0 : (dataArray[day - 1]?.inventoryEnd ?? 0);

                // --- TIER 1 (Smoothing) ---
                if (passName === "Pass 1") {
                    d.production = 0;
                    d.opHours = 0;

                    if (d.isWorkingDay && !d.isReductionDay && !d.isExceptionDay) {
                        if (targetDailyProduction > 0) {

                            let productionToSet = targetDailyProduction;
                            let hoursToSet = 0;

                            if (targetDailyProduction > maxStandardProduction) {
                                console.error(`WORKER: Day ${day} - Target Production (${targetDailyProduction}) exceeds Max Standard (${maxStandardProduction}). Capping at max.`);
                                productionToSet = maxStandardProduction;
                                hoursToSet = standardOpHours;
                            } else {
                                hoursToSet = (productionPerStdHour > 0) ? (targetDailyProduction / productionPerStdHour) : 0;
                            }

                            d.production = productionToSet;
                            d.opHours = hoursToSet;
                        }
                    }
                }

                d.inventoryAvailable = d.inventoryStart + d.production;

                // B. Check Scheduled Shipments for Today
                let shipmentsScheduledToday = d.shipments || 0;
                let detailsScheduledToday = d.shipmentDetails || [];

                if (passName !== "Pass 1") {
                    shipmentsScheduledToday = d.actualShipments;
                    detailsScheduledToday = d.actualShipmentDetails;
                }

                d.actualShipments = 0;
                if (passName === "Pass 1") {
                    d.actualShipmentDetails = [];
                }

                // C. Delay Logic (First Week Only, if needed)
                if (passName === "Pass 1" && day < 7 && shipmentsScheduledToday > 0 && d.inventoryAvailable < shipmentsScheduledToday) {
                    let foundSpot = false;
                    const maxDelayTargetDay = Math.min(364, day + 7);
                    for (let targetDay = day + 1; targetDay <= maxDelayTargetDay; targetDay++) {
                        if (dataArray[targetDay] && dataArray[targetDay].isWorkingDay) {
                            dataArray[targetDay].shipments = (dataArray[targetDay].shipments || 0) + shipmentsScheduledToday;
                            dataArray[targetDay].shipmentDetails = (dataArray[targetDay].shipmentDetails || []).concat(detailsScheduledToday);
                            d.shipments = 0;
                            d.shipmentDetails = [];
                            d.shipmentDeferred = true;
                            d.exceptionDetails = `Shipment deferred to day ${targetDay}.`;
                            foundSpot = true;
                            break;
                        }
                    }
                }

                // D. Determine Shipments Actually Needed Today
                const finalShipmentsNeededToday = (passName === "Pass 1") ? (d.shipments || 0) : shipmentsScheduledToday;
                const finalDetailsNeededToday = (passName === "Pass 1") ? (d.shipmentDetails || []) : detailsScheduledToday;

                // E. Shortfall Handling
                if (finalShipmentsNeededToday > 0 && d.inventoryAvailable < finalShipmentsNeededToday) {
                    let remainingShortfall = finalShipmentsNeededToday - d.inventoryAvailable;
                    d.demandMet = false;
                    let exceptionDaysUsed = [];

                    // --- *** TIER 2: CURRENT DAY FLEX (NO OT) *** ---
                    if (remainingShortfall > 0.01 && workingDaysSet.has(d.date) && !d.isReductionDay && !d.isExceptionDay) {

                        const currentProduction = d.production;
                        const currentHours = d.opHours;

                        if (currentHours < standardOpHours && currentProduction < maxStandardProduction) {

                            const potentialExtraProduction = maxStandardProduction - currentProduction;
                            const potentialExtraHours = standardOpHours - currentHours;

                            if (potentialExtraProduction > 0.01) {

                                const productionToAdd = Math.min(remainingShortfall, potentialExtraProduction);
                                let hoursToAdd = (productionPerStdHour > 0) ? (productionToAdd / productionPerStdHour) : 0;
                                let actualProductionToAdd = 0;

                                if (hoursToAdd > potentialExtraHours) {
                                    hoursToAdd = potentialExtraHours;
                                    actualProductionToAdd = Math.floor(hoursToAdd * productionPerStdHour);
                                } else {
                                    actualProductionToAdd = Math.floor(productionToAdd);
                                }

                                if (actualProductionToAdd > 0) {
                                    d.production += actualProductionToAdd;
                                    d.opHours += hoursToAdd;
                                    d.inventoryAvailable += actualProductionToAdd;
                                    remainingShortfall -= actualProductionToAdd;

                                    if (passName === "Pass 1") {
                                        const detailMsg = `Flexed to max capacity (+${actualProductionToAdd.toFixed(0)}u) for shortfall.`;
                                        d.exceptionDetails = (d.exceptionDetails ? `${d.exceptionDetails}; ${detailMsg}` : detailMsg);
                                    }
                                }
                            }
                        }
                    }

                    // --- *** TIER 3: REACTIVE OT LOOKBACK *** ---
                    if (remainingShortfall > 0.01) {
                        for (let p = day - 1; p >= 0 && remainingShortfall > 0.01; p--) {
                            if (!dataArray[p]) continue;
                            const dp = dataArray[p];

                            if (workingDaysSet.has(dp.date) && !dp.isReductionDay) {
                                const prevDayRecordedHours = dp.opHours;
                                const maxExceptionHours = Math.min(24, Math.max(12, standardOpHours * 1.5));
                                const potentialExtraHours = maxExceptionHours - prevDayRecordedHours;

                                if (potentialExtraHours > 0.01) {
                                    const maxExtraProduction = Math.floor(potentialExtraHours * productionPerStdHour);
                                    if (maxExtraProduction <= 0) continue;

                                    const productionToAdd = Math.min(remainingShortfall, maxExtraProduction);
                                    const hoursToAdd = productionToAdd / productionPerStdHour;
                                    const actualHoursToAdd = Math.min(hoursToAdd, potentialExtraHours);
                                    const actualProductionToAdd = Math.floor(actualHoursToAdd * productionPerStdHour);

                                    if (actualProductionToAdd <= 0) continue;

                                    const finalPrevDayOpHours = prevDayRecordedHours + actualHoursToAdd;
                                    const finalPrevDayProduction = dp.production + actualProductionToAdd;

                                    dp.production = finalPrevDayProduction;
                                    dp.opHours = finalPrevDayOpHours;
                                    dp.isExceptionDay = true;

                                    if (passName === "Pass 1") {
                                        const overtimePremiumCost = actualHoursToAdd * numEmployees * laborCost * 0.5;
                                        const overheadScaleFactor = finalPrevDayOpHours / standardOpHours;
                                        const prevOverheadScale = (prevDayRecordedHours / standardOpHours);

                                        const overheadIncrease = Math.max(0, (dailyMfgOverhead * (overheadScaleFactor > 1 ? overheadScaleFactor : 1)) - (dailyMfgOverhead * (prevOverheadScale > 1 ? prevOverheadScale : 1)))
                                            + Math.max(0, (dailySgaExpenses * (overheadScaleFactor > 1 ? overheadScaleFactor : 1)) - (dailySgaExpenses * (prevOverheadScale > 1 ? prevOverheadScale : 1)));

                                        dp.exceptionCost = (dp.exceptionCost || 0) + overtimePremiumCost + overheadIncrease;
                                        otHours += actualHoursToAdd;

                                        const detailMsg = `Reactive OT: Added ${actualHoursToAdd.toFixed(2)}h (Total: ${finalPrevDayOpHours.toFixed(2)}) for day ${day}. Cost: \$${(overtimePremiumCost + overheadIncrease).toFixed(0)}`;
                                        dp.exceptionDetails = dp.exceptionDetails ? `${dp.exceptionDetails}; ${detailMsg}` : detailMsg;
                                    }

                                    d.inventoryAvailable += actualProductionToAdd;
                                    remainingShortfall -= actualProductionToAdd;
                                    exceptionDaysUsed.push(p);

                                    if (remainingShortfall <= 0.01) {
                                        d.demandMet = true;
                                        break;
                                    }
                                }
                            }
                        }
                    } else {
                        d.demandMet = true;
                    }

                    // Check if demand was ultimately met
                    if (!d.demandMet) {
                        let conflictDetails = [];
                        if (finalDetailsNeededToday && finalDetailsNeededToday.length > 0) {
                            finalDetailsNeededToday.forEach(detail => {
                                conflictDetails.push(`- City: ${detail.city} (Qty: ${detail.qty}, Freq: ${detail.freq}, Start: ${detail.startDay})`);
                            });
                        }

                        const errorMsg = `Conflict: Day ${day + 1}, Short by ${remainingShortfall.toFixed(0)}u.`;
                        if (passName === "Pass 1") {
                            simError = `Demand Conflict: Day ${day + 1}\n` +
                                `Cannot meet scheduled ${finalShipmentsNeededToday.toFixed(0)}u. Short by ${remainingShortfall.toFixed(0)}u.\n\n` +
                                `Conflicting Shipments:\n` +
                                `${conflictDetails.join('\n')}`;

                            console.error("WORKER:", simError);
                            d.exceptionDetails = (d.exceptionDetails ? d.exceptionDetails + "; " : "") + `CRITICAL SHORTFALL: ${remainingShortfall.toFixed(0)}u`;
                            d.isExceptionDay = true;
                        } else {
                            console.error(`WORKER: (${passName}) Safety Check Failed: ${errorMsg}`);
                            simError = `Optimization Failure on Day ${day + 1}.`;
                        }
                    } else if (exceptionDaysUsed.length > 0 && passName === "Pass 1") {
                        d.exceptionDetails = (d.exceptionDetails ? d.exceptionDetails + "; " : "") + `Met shortfall via reactive OT on day(s) ${exceptionDaysUsed.join(', ')}.`;
                    }
                }

                if (passName !== "Pass 1" && d.inventoryAvailable - finalShipmentsNeededToday < (minInventoryCushion - 0.01)) { // 0.01 tolerance
                    simError = `Optimization Failure on Day ${day + 1}: Dipped below cushion.`;
                }

                if (simError) {
                    d.inventoryEnd = d.inventoryAvailable - d.actualShipments;
                    break;
                }

                // F. Fulfill Actual Shipments & Update Inventory
                d.actualShipments = Math.min(d.inventoryAvailable, finalShipmentsNeededToday);
                d.inventoryEnd = d.inventoryAvailable - d.actualShipments;

                // Populate actualShipmentDetails (Only on Pass 1)
                if (passName === "Pass 1") {
                    let remainingToFulfill = d.actualShipments;
                    d.actualShipmentDetails = [];
                    for (const detail of finalDetailsNeededToday) {
                        if (remainingToFulfill <= 0) break;
                        const qtyToShip = Math.min(detail.qty, remainingToFulfill);
                        if (qtyToShip > 0) {
                            d.actualShipmentDetails.push({
                                city: detail.city,
                                qty: qtyToShip,
                                freq: detail.freq,
                                startDay: detail.startDay
                            });
                            remainingToFulfill -= qtyToShip;
                        }
                    }
                }

                // G. Calculate Holding Cost (Only on Pass 1)
                if (passName === "Pass 1") {
                    d.holdingCost = Math.max(0, d.inventoryEnd) * avgCogs * dailyHoldingRate;
                }
            }

            return { error: simError, otHours: otHours };
        }

        // Run the first pass to get a safe, working schedule
        const pass1Result = runSimLoop(dailyData, "Pass 1");
        accumulatedExtraHours = pass1Result.otHours;
        simulationError = pass1Result.error;

        if (simulationError) { console.error("WORKER: Sim loop (Pass 1) finished with CRITICAL error."); }

        // --- 7. Smart Inventory Optimization ---
        if (!simulationError) {

            // --- Helper function for optimization passes ---
            function runSafetyCheck(startIndex, newProd, minLevel) {
                // This checks if making a change *today* will ever cause a future failure
                let hypotheticalInventory = (startIndex === 0) ? 0 : dailyData[startIndex - 1].inventoryEnd;

                for (let i = startIndex; i < 365; i++) {
                    const d = dailyData[i];
                    const prod = (i === startIndex) ? newProd : d.production; // Use the new production for the day being tested

                    const invAvailable = hypotheticalInventory + prod;

                    // Check if we can meet *actual* shipments
                    if (invAvailable < d.actualShipments) {
                        return false; // Unsafe
                    }
                    hypotheticalInventory = invAvailable - d.actualShipments;

                    // Check if we drop below the cushion
                    if (hypotheticalInventory < (minLevel - 0.01)) { // 0.01 tolerance
                        return false; // Unsafe
                    }
                }
                return true; // Safe
            }

            // --- Forward Pass: Remove "Slack" Inventory ---
            functionStep = "7.1. Forward Pass (Slack Removal)";

            // Find the minimum "cushion" of inventory required
            let minSafeInventory = Infinity;
            for (let day = 0; day < 365; day++) {
                // We only care about inventory *before* a shipment is needed
                if (dailyData[day].actualShipments > 0) {
                    if (dailyData[day].inventoryStart < minSafeInventory) {
                        minSafeInventory = dailyData[day].inventoryStart;
                    }
                }
            }
            if (minSafeInventory === Infinity) minSafeInventory = 0;
            minSafeInventory = Math.max(targetEndInventory, minSafeInventory);

            let daysRemoved = 0;

            // Iterate *forward* and try to remove full days
            for (let day = 0; day < 365; day++) {
                const d = dailyData[day];

                if (workingDaysSet.has(d.date) && !d.isExceptionDay && !d.isReductionDay && d.production > 0 && Math.abs(d.production - targetDailyProduction) < 0.01) {

                    if (runSafetyCheck(day, 0, minSafeInventory)) {
                        // This removal is safe! Make it permanent.
                        d.production = 0;
                        d.opHours = 0;
                        d.isReductionDay = true;
                        d.exceptionDetails = (d.exceptionDetails ? d.exceptionDetails + "; " : "") + `Slack day removed.`;
                        daysRemoved++;

                        // Propagate this change forward to all subsequent days
                        for (let i = day; i < 365; i++) {
                            const d_i = dailyData[i];
                            d_i.inventoryStart = (i === 0) ? 0 : (dailyData[i - 1].inventoryEnd);
                            d_i.inventoryAvailable = d_i.inventoryStart + d_i.production;
                            d_i.inventoryEnd = d_i.inventoryAvailable - d_i.actualShipments;
                        }
                    }
                }
            }

            // --- Backward Pass: Offset OT ---
            functionStep = "7.2. Backward Pass (OT Offset)";
            let hoursToOffset = accumulatedExtraHours;
            let otDaysRemoved = 0;

            if (hoursToOffset > 0.01) {
                // Now we iterate backward to remove days to offset OT
                for (let day = 364; day >= 0; day--) {
                    if (hoursToOffset <= 0.01) break;

                    const d = dailyData[day];

                    if (workingDaysSet.has(d.date) && !d.isExceptionDay && !d.isReductionDay && d.production > 0) {
                        let productionToRemove = d.production;
                        let hoursSaved = d.opHours;

                        // Only consider removing *full, standard-hour* days
                        let isRemovableDay = false;
                        if (Math.abs(d.production - targetDailyProduction) < 0.01) {
                            isRemovableDay = true;
                            hoursSaved = (productionPerStdHour > 0) ? (targetDailyProduction / productionPerStdHour) : 0;
                        } else if (Math.abs(d.production - maxStandardProduction) < 0.01 && Math.abs(d.opHours - standardOpHours) < 0.01) {
                            isRemovableDay = true;
                            hoursSaved = standardOpHours;
                        }

                        if (isRemovableDay && hoursToOffset >= hoursSaved) {

                            if (runSafetyCheck(day, 0, targetEndInventory)) {
                                // This removal is safe! Make it permanent.
                                d.production = 0;
                                d.opHours = 0;
                                d.isReductionDay = true;
                                d.exceptionDetails = (d.exceptionDetails ? d.exceptionDetails + "; " : "") + `Day removed to offset OT.`;
                                otDaysRemoved++;

                                // Propagate this change forward
                                for (let i = day; i < 365; i++) {
                                    const d_i = dailyData[i];
                                    d_i.inventoryStart = (i === 0) ? 0 : (dailyData[i - 1].inventoryEnd);
                                    d_i.inventoryAvailable = d_i.inventoryStart + d_i.production;
                                    d_i.inventoryEnd = d_i.inventoryAvailable - d_i.actualShipments;
                                }

                                hoursToOffset -= hoursSaved;
                            }
                        }
                    }
                }
            }
        }

        // --- 8. Recalculate Holding Costs ---
        functionStep = "8. Recalculate Holding Costs";
        for (let day = 0; day < 365; day++) {
            if (dailyData[day]) {
                // Update the isWorkingDay flag for the final chart
                dailyData[day].isWorkingDay = workingDaysSet.has(dailyData[day].date) && !dailyData[day].isReductionDay;

                dailyData[day].holdingCost = Math.max(0, dailyData[day].inventoryEnd) * avgCogs * dailyHoldingRate;
            }
        }

        // --- 9. Return Results ---
        functionStep = "9. Return Results";

        console.log("WORKER: Simulation Complete.", {
            finalInventory: dailyData[364].inventoryEnd,
            totalHoldingCost: dailyData.reduce((sum, d) => sum + (d.holdingCost || 0), 0),
            totalExceptionCost: dailyData.reduce((sum, d) => sum + (d.exceptionCost || 0), 0),
            simResults: dailyData
        });

        // Return the final dailyData array
        if (simulationError) {
            return { error: simulationError, results: dailyData };
        } else {
            return { results: dailyData };
        }

    } catch (error) {
        console.error(`WORKER: Uncaught error during performSimulation (Step: ${functionStep}):`, error);
        return { error: `Worker crashed at Step ${functionStep}: ${error.message || "Unknown sim error."}`, results: dailyData || null };
    }
}

// --- Web Worker Event Listener ---
self.onmessage = async (e) => {
    const { type, payload } = e.data;
    if (type === 'start') {
        try {
            const output = await performSimulation(payload);

            if (output.error && output.results === null) {
                self.postMessage({ type: 'error', message: output.error, results: null });
            } else if (output.error) { // Simulation loop failure or uncaught
                self.postMessage({ type: 'error', message: output.error, results: output.results }); // Send partial/full results with error
            } else { // Success
                self.postMessage({ type: 'complete', results: output.results });
            }
        } catch (e) {
            console.error("WORKER: Unhandled exception processing 'start' message:", e);
            self.postMessage({ type: 'error', message: `Unhandled worker exception: ${e.message || e.toString()}` });
        }
    }
};

// --- Global Error Handler ---
self.onerror = function (event) {
    console.error("WORKER: Uncaught global error:", event.message, event);
    self.postMessage({ type: 'error', message: `Uncaught worker error: ${event.message}` });
};