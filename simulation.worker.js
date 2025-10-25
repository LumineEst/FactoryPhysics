// --- simulation.worker.js ---

// Load solver script (assuming local libs/highs.js)
let highsScriptLoaded = false;
let highsScriptError = null;
let highsLoaderFunction = null;
let highsInstancePromise = null;
try {
    console.log("WORKER: Attempting to import HiGHS script from 'libs/highs.js'...");
    importScripts('libs/highs.js'); // Assuming highs.js is in a 'libs' folder relative to this worker
    console.log("WORKER: Script 'libs/highs.js' imported.");
    // Check various ways the loader might be exposed
    if (typeof Module === 'function') {
        console.log("WORKER: Loader function found as global 'Module'.");
        highsLoaderFunction = Module;
        highsScriptLoaded = true;
    } else if (typeof Module === 'object' && typeof Module.highs === 'function') {
        console.log("WORKER: Loader function found as 'Module.highs'.");
        highsLoaderFunction = Module.highs;
        highsScriptLoaded = true;
    } else if (typeof Module === 'object' && typeof Module.default === 'function') {
        console.log("WORKER: Loader function found as 'Module.default'.");
        highsLoaderFunction = Module.default;
        highsScriptLoaded = true;
    } else if (typeof highs === 'function') {
        console.log("WORKER: Loader function found as global 'highs'.");
        highsLoaderFunction = highs;
        highsScriptLoaded = true;
    } else if (typeof self.highs === 'function') {
        console.log("WORKER: Loader function found at 'self.highs'.");
        highsLoaderFunction = self.highs;
        highsScriptLoaded = true;
    } else {
        highsScriptError = "Could not find HiGHS loader function (checked Module variations, highs, self.highs).";
        console.error("WORKER:", highsScriptError);
        try { console.log("WORKER: 'Module' object details:", Module); } catch { /* ignore */ }
    }
} catch (error) {
    highsScriptError = `Failed to import script 'libs/highs.js': ${error.message}`;
    console.error("WORKER: CRITICAL -", highsScriptError, error);
}


// --- Constants ---
const MAX_START_DAY_OPTIONS = 11;
// const HOLDING_COST_PENALTY_FACTOR = 0.001; // Not used in this version (no cost penalty objective)

// --- Async Solver Loader ---
async function getSolverInstance() {
    if (!highsScriptLoaded || !highsLoaderFunction) {
        throw new Error(highsScriptError || "HiGHS script did not load correctly or define loader.");
    }
    if (!highsInstancePromise) {
        console.log("WORKER: Initializing HiGHS WASM instance...");
        const wasmPath = 'libs/'; // Path relative to this worker file where highs.wasm is
        highsInstancePromise = highsLoaderFunction({
            locateFile: (filename) => wasmPath + filename
        }).then(instance => {
            console.log("WORKER: HiGHS WASM instance initialized.");
            if (!instance?.solve) throw new Error("HiGHS instance invalid or missing 'solve'.");
            return instance;
        }).catch(err => {
            console.error("WORKER: Failed to initialize HiGHS WASM instance:", err);
            highsInstancePromise = null; throw err;
        });
    }
    return highsInstancePromise;
}

// --- Async MILP Helper Function (Stores Shipment Details) ---
async function findOptimalShipmentSchedule(cities, dailyData) { // Removed optimizationMode param
    console.log("WORKER: Entered findOptimalShipmentSchedule.");
    let solverInstance;
    try {
        console.log("WORKER: Attempting to get solver instance...");
        solverInstance = await getSolverInstance();
        console.log("WORKER: Solver instance obtained.");
    } catch (error) {
        console.error("WORKER: Solver failed to load or initialize in findOptimalShipmentSchedule", error);
        const safeDailyData = dailyData || Array.from({ length: 365 }, () => ({ shipments: 0 }));
        safeDailyData.forEach(d => { if (d) d.shipments = 0; });
        if (Array.isArray(cities)) cities.forEach(c => { if (safeDailyData?.[1]) safeDailyData[1].shipments += c.qty; });
        return { status: 'error_loading_solver', peakDemand: -1, dailyData: safeDailyData, message: `Solver init error: ${error.message}` };
    }

    let lpString = "";
    const cityVarMap = new Map();
    const binaryVars = [];
    const generalVars = ["Z"];
    let objectiveParts = ["1 Z"]; // Simple objective: Minimize Z

    try {
        console.log("WORKER: Starting LP string generation...");
        lpString += "Subject To\n"; // Start constraints

        (cities || []).forEach((city, cityIndex) => {
            const freq = Math.max(1, Math.round(city.freq));
            const k = Math.min(freq, MAX_START_DAY_OPTIONS);
            const possibleStartDays = [];
            // Corrected Heuristic Calculation
            if (k === freq) { for (let d = 1; d <= freq; d++) possibleStartDays.push(d); }
            else { for (let i = 0; i < k; i++) possibleStartDays.push(Math.floor(i * freq / k) + 1); }

            const constraintName = `city_${cityIndex}_start`; let cityConstraintParts = [];
            possibleStartDays.forEach((d) => {
                const varName = `x_${cityIndex}_${d}`;
                cityConstraintParts.push(`1 ${varName}`);
                binaryVars.push(varName);
                cityVarMap.set(varName, { cityIndex, cityQty: city.qty, startDay: d, freq });
                // No objective penalty added here
            });
            if (cityConstraintParts.length > 0) lpString += ` ${constraintName}: ${cityConstraintParts.join(' + ')} = 1\n`;
            else console.warn(`WORKER: City ${cityIndex} generated no vars.`);
        });
        if (binaryVars.length === 0 && cities?.length > 0) console.warn("WORKER: No binary vars defined.");

        // Construct full objective string (simple version)
        let fullObjectiveString = "Minimize\n obj: " + objectiveParts.join(' + ') + "\n";

        // Daily load constraints
        for (let t = 0; t < 365; t++) {
            const constraintName = `day_${t}_load`; let dayConstraintParts = [];
            cityVarMap.forEach((v, varName) => { if (t >= v.startDay && (t - v.startDay) % v.freq === 0) dayConstraintParts.push(`${v.cityQty} ${varName}`); });
            if (dayConstraintParts.length > 0) lpString += ` ${constraintName}: ${dayConstraintParts.join(' + ')} - 1 Z <= 0\n`;
        }
        lpString += "Bounds\nGeneral\n"; lpString += ` ${generalVars.join(' ')}\n`;
        if (binaryVars.length > 0) { lpString += "Binary\n"; lpString += ` ${binaryVars.join(' ')}\n`; } else { lpString += "Binary\n"; }
        lpString += "End\n";
        lpString = fullObjectiveString + lpString; // Prepend objective
        console.log("WORKER: LP string generation complete.");
        // console.log("WORKER: LP String:\n", lpString); // Keep uncommented if debugging the string itself

    } catch (genError) {
        console.error("WORKER: Error during LP String Generation:", genError);
        return { status: 'error_lp_generation', peakDemand: -1, dailyData: dailyData, message: `LP Gen Error: ${genError.message}` };
    }

    console.log("WORKER: Attempting to solve MILP with HiGHS instance...");
    try {
        const startTime = performance.now();
        const result = await solverInstance.solve(lpString); // Await the solve call
        const endTime = performance.now();
        console.log(`WORKER: HiGHS Solver finished in ${(endTime - startTime).toFixed(2)} ms.`);
        console.log("WORKER: HiGHS Result Raw:", result);

        // --- Parse HiGHS Results (Use Capitalized properties + detailed check) ---
        const rawStatus = result?.Status ?? 'Unknown';
        console.log(`WORKER: Raw status: "${rawStatus}" (Type: ${typeof rawStatus})`);
        const statusString = typeof rawStatus === 'string' ? rawStatus.trim() : 'Unknown';
        console.log(`WORKER: Trimmed status: "${statusString}"`);
        const isOptimal = statusString === 'Optimal';
        const isFeasible = statusString === 'Feasible';
        const isOptimalOrFeasible = isOptimal || isFeasible;
        console.log(`WORKER: Status check: Optimal? ${isOptimal}, Feasible? ${isFeasible}, Combined? ${isOptimalOrFeasible}`);

        if (!isOptimalOrFeasible) {
            console.error(`WORKER: Non-optimal/feasible status '${statusString}'. Result:`, result);
            const simpleStatus = statusString.toLowerCase().replace(/[\s\(\)]+/g, '_') || 'unknown';
            return { status: `solver_status_${simpleStatus}`, peakDemand: -1, dailyData: dailyData, message: `Solver status: ${statusString}` };
        }

        console.log(`WORKER: Status '${statusString}' OK. Parsing results.`);
        // Extract Z value directly as peakDemand
        let peakDemand = -1;
        const columnsData = result.Columns;
        if (columnsData?.Z?.Primal !== undefined) peakLoadZ = columnsData.Z.Primal;
        else console.warn("WORKER: Could not extract Z value from result.Columns.");
        console.log(`WORKER: PeakLoadVar(Z)=${peakLoadZ}`);

        // Ensure dailyData exists before modification
        (dailyData || []).forEach(d => {
            if (d) {
                d.shipments = 0; // Reset total
                d.shipmentDetails = []; // Initialize details array
            }
        });
        console.log("WORKER: Shipments reset in dailyData.");

        let solutionValues = {}; let columnCount = 0;
        if (columnsData && typeof columnsData === 'object') {
            console.log("WORKER: Processing result.Columns object.");
            for (const varName in columnsData) {
                let varValue; if (Object.hasOwnProperty.call(columnsData, varName) && columnsData[varName]) { if (typeof columnsData[varName].Primal === 'number') varValue = columnsData[varName].Primal; else if (typeof columnsData[varName].Value === 'number') varValue = columnsData[varName].Value; else if (typeof columnsData[varName].value === 'number') varValue = columnsData[varName].value; } if (typeof varValue === 'number') { solutionValues[varName] = varValue; columnCount++; }
            }
            console.log(`WORKER: Extracted ${columnCount} var values.`);
            if (columnCount === 0 && binaryVars.length > 0) { return { status: 'solver_result_error', peakDemand: -1, dailyData: dailyData, message: 'Columns obj empty.' }; }
        } else { return { status: 'solver_result_error', peakDemand: -1, dailyData: dailyData, message: 'Columns obj missing/invalid.' }; }

        let assignmentsMade = 0;
        try {
            console.log("WORKER: Applying assignments...");
            cityVarMap.forEach((v, varName) => {
                if (solutionValues[varName] > 0.5) { // If this start day is selected
                    assignmentsMade++;
                    for (let t = v.startDay; t < 365; t += v.freq) {
                        if (t >= 0 && t < dailyData.length && dailyData[t]) {
                            // Add details and update total
                            dailyData[t].shipments = (dailyData[t].shipments || 0) + v.cityQty;
                            const cityName = cities[v.cityIndex]?.name || `City ${v.cityIndex}`;
                            dailyData[t].shipmentDetails.push({ city: cityName, qty: v.cityQty });
                        }
                    }
                }
            });
            console.log(`WORKER: Applied ${assignmentsMade} assignments.`);
        } catch (assignmentError) {
            console.error("WORKER: Error during assignment:", assignmentError);
            return { status: 'solver_assignment_error', peakDemand: peakLoadZ, dailyData: dailyData, message: `Assign error: ${assignmentError.message}` };
        }
        if (assignmentsMade < (cities?.length || 0)) console.warn(`WORKER: Assignments (${assignmentsMade}) < cities (${cities?.length || 0}).`);

        console.log("WORKER: findOptimalShipmentSchedule finished successfully.");
        return { status: 'optimal', peakDemand: peakLoadZ, dailyData }; // Success return

    } catch (error) {
        console.error("WORKER: Error during HiGHS solve execution or result parsing:", error);
        return { status: 'solver_execution_error', peakDemand: -1, dailyData: dailyData, message: `Solve/Parse error: ${error.message}` };
    }
}


// --- Async Main Simulation Function (Multi-day OT with overlap check) ---
async function performSimulation(params) {
    console.log("WORKER: Simulation task started.");
    let dailyData = null;
    try {
        // --- 1. Deconstruct and validate params ---
        const { cities, workingDaysSchedule, standardOpHours, numEmployees, laborCost, holdingCostRate, annualMfgOverhead, annualSgaExpenses, superCogsVal, ultraCogsVal, mcInputVal, buildRatios, standardDailyProduction } = params; // No optimizationMode needed here
        const workingDaysSet = new Set(workingDaysSchedule); const numWorkingDays = workingDaysSchedule.length;
        const dailyHoldingRate = holdingCostRate / 365.0; const dailyMfgOverhead = numWorkingDays > 0 ? annualMfgOverhead / numWorkingDays : 0;
        const dailySgaExpenses = numWorkingDays > 0 ? annualSgaExpenses / numWorkingDays : 0;
        const avgCogs = (superCogsVal * buildRatios.super) + (ultraCogsVal * buildRatios.ultra) + (mcInputVal * buildRatios.mega);
        if (!standardDailyProduction || standardDailyProduction <= 0) throw new Error("Std daily production must be > 0.");
        if (standardOpHours <= 0) throw new Error("Std operating hours must be > 0.");
        const productionPerStdHour = standardDailyProduction / standardOpHours;

        // --- 2. Initialize Data Array ---
        dailyData = Array.from({ length: 365 }, (_, i) => { const year = new Date().getFullYear(); const date = new Date(Date.UTC(year, 0, i + 1)); const dayStr = date.toISOString().split('T')[0]; return { day: i, date: dayStr, isWorkingDay: workingDaysSet.has(dayStr), inventoryStart: 0, production: 0, opHours: 0, inventoryAvailable: 0, shipments: 0, shipmentDetails: [], actualShipments: 0, demandMet: true, inventoryEnd: 0, holdingCost: 0, exceptionCost: 0, isExceptionDay: false, isReductionDay: false, exceptionDetails: null }; });
        let simulationError = null;

        // --- 3. Run Optimizer (No mode passed) ---
        if (cities && cities.length > 0) {
            console.log("WORKER: Calling optimizer...");
            const optimizationResult = await findOptimalShipmentSchedule(cities, dailyData); // Call without mode
            if (!optimizationResult || optimizationResult.status !== 'optimal') { throw new Error(`Schedule optimization failed. Status: ${optimizationResult?.status || 'unknown'}. ${optimizationResult?.message || ''}`); }
            dailyData = optimizationResult.dailyData; // Get data with shipmentDetails populated
            console.log(`WORKER: Optimal schedule applied. Solver reported peak var (Z): ${optimizationResult.peakDemand?.toFixed(0) ?? 'N/A'}.`);
        } else { console.log("WORKER: No cities, skipping schedule opt."); dailyData.forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } }); }

        let accumulatedExtraHours = 0;

        // --- 4. Run Simulation Loop (Multi-day OT with overlap check) ---
        console.log(`WORKER: Starting 365-day sim loop...`);
        for (let day = 0; day < 365; day++) {
            if (!dailyData?.[day]) continue;
            dailyData[day].inventoryStart = (day === 0 || !dailyData[day - 1]) ? 0 : dailyData[day - 1].inventoryEnd;
            dailyData[day].production = 0; dailyData[day].opHours = 0;
            if (dailyData[day].isWorkingDay && !dailyData[day].isReductionDay && !dailyData[day].isExceptionDay) { dailyData[day].production = standardDailyProduction; dailyData[day].opHours = standardOpHours; }
            dailyData[day].inventoryAvailable = dailyData[day].inventoryStart + dailyData[day].production;
            const shipmentsNeededToday = dailyData[day].shipments || 0;

            // --- Shortfall Handling (Multi-day OT with overlap check) ---
            if (dailyData[day].inventoryAvailable < shipmentsNeededToday) {
                let remainingShortfall = shipmentsNeededToday - dailyData[day].inventoryAvailable;
                dailyData[day].demandMet = false; let exceptionDaysUsed = [];
                console.log(`WORKER: Day ${day} - Shortfall ${remainingShortfall.toFixed(0)}u. Looking back...`);
                for (let p = day - 1; p >= 0 && remainingShortfall > 0.01; p--) {
                    if (!dailyData[p]) continue;
                    if (dailyData[p].isWorkingDay && !dailyData[p].isReductionDay) {
                        // ** Break on overlap **
                        if (dailyData[p].isExceptionDay) { console.log(`WORKER: Day ${p} already exception. Stopping OT search.`); break; }

                        const prevDayRecordedHours = dailyData[p].opHours; const maxExceptionHours = Math.min(24, Math.max(12, standardOpHours * 1.5)); const potentialExtraHours = maxExceptionHours - prevDayRecordedHours;
                        if (potentialExtraHours > 0.01) {
                            const maxExtraProduction = Math.floor(potentialExtraHours * productionPerStdHour);
                            if (maxExtraProduction <= 0) continue;
                            const productionToAdd = Math.min(remainingShortfall, maxExtraProduction); const hoursToAdd = productionToAdd / productionPerStdHour; const actualHoursToAdd = Math.min(hoursToAdd, potentialExtraHours); const actualProductionToAdd = Math.floor(actualHoursToAdd * productionPerStdHour);
                            if (actualProductionToAdd <= 0) continue;
                            console.log(`WORKER: Day ${p}: Adding ${actualHoursToAdd.toFixed(2)}h for ${actualProductionToAdd}u (need ${remainingShortfall.toFixed(0)}).`);
                            const finalPrevDayOpHours = prevDayRecordedHours + actualHoursToAdd; const finalPrevDayProduction = dailyData[p].production + actualProductionToAdd;
                            dailyData[p].production = finalPrevDayProduction; dailyData[p].opHours = finalPrevDayOpHours; dailyData[p].isExceptionDay = true;
                            const overtimePremiumCost = actualHoursToAdd * numEmployees * laborCost * 0.5; const overheadScaleFactor = finalPrevDayOpHours / standardOpHours; const prevOverheadScale = (prevDayRecordedHours / standardOpHours); const overheadIncrease = Math.max(0, (dailyMfgOverhead * (overheadScaleFactor > 1 ? overheadScaleFactor : 1)) - (dailyMfgOverhead * (prevOverheadScale > 1 ? prevOverheadScale : 1))) + Math.max(0, (dailySgaExpenses * (overheadScaleFactor > 1 ? overheadScaleFactor : 1)) - (dailySgaExpenses * (prevOverheadScale > 1 ? prevOverheadScale : 1)));
                            dailyData[p].exceptionCost = (dailyData[p].exceptionCost || 0) + overtimePremiumCost + overheadIncrease; accumulatedExtraHours += actualHoursToAdd; const detailMsg = `Added ${actualHoursToAdd.toFixed(2)}h (Total: ${finalPrevDayOpHours.toFixed(2)}) for day ${day}. Cost: \$${(overtimePremiumCost + overheadIncrease).toFixed(0)}`; dailyData[p].exceptionDetails = dailyData[p].exceptionDetails ? `${dailyData[p].exceptionDetails}; ${detailMsg}` : detailMsg;
                            dailyData[day].inventoryAvailable += actualProductionToAdd; remainingShortfall -= actualProductionToAdd; exceptionDaysUsed.push(p);
                            if (remainingShortfall <= 0.01) { dailyData[day].demandMet = true; console.log(`WORKER: Day ${day} - Shortfall met using: ${exceptionDaysUsed.join(', ')}.`); break; }
                        } // else: no potential hours
                    } // else: not suitable day
                } // --- End backward loop ---
                if (!dailyData[day].demandMet) { simulationError = `Impossible: Cannot meet ${remainingShortfall.toFixed(0)}u shortfall on day ${day}. Insufficient prior capacity.`; console.error("WORKER:", simulationError); break; }
                else { dailyData[day].exceptionDetails = `Met shortfall via OT on day(s) ${exceptionDaysUsed.join(', ')}.`; }
            } // --- End Shortfall Handling ---
            dailyData[day].actualShipments = dailyData[day].demandMet ? shipmentsNeededToday : Math.max(0, dailyData[day].inventoryAvailable); dailyData[day].inventoryEnd = dailyData[day].inventoryAvailable - dailyData[day].actualShipments; dailyData[day].holdingCost = Math.max(0, dailyData[day].inventoryEnd) * avgCogs * dailyHoldingRate;
        } // --- End daily loop ---
        if (simulationError) console.error("WORKER: Sim loop ended early."); else console.log("WORKER: Finished 365-day sim loop.");

        // --- 5. Offsetting Logic ---
        if (simulationError === null) {
            let hoursToOffset = accumulatedExtraHours;
            if (hoursToOffset > 0.01) {
                console.log(`WORKER: Offsetting ${hoursToOffset.toFixed(2)} accumulated hours.`); let daysReduced = 0;
                for (let day = 364; day >= 0 && hoursToOffset > 0.01; day--) { if (!dailyData?.[day]) continue; if (dailyData[day].isWorkingDay && !dailyData[day].isExceptionDay && !dailyData[day].isReductionDay && Math.abs(dailyData[day].opHours - standardOpHours) < 0.01) { const reduction = standardOpHours; dailyData[day].isWorkingDay = false; dailyData[day].isReductionDay = true; dailyData[day].opHours = 0; dailyData[day].production = 0; dailyData[day].exceptionDetails = `Day cancelled (reduced ${reduction.toFixed(2)}h) to offset exceptions.`; hoursToOffset -= reduction; daysReduced++; } }
                console.log(`WORKER: Reduced ${daysReduced} days. Remaining offset: ${hoursToOffset.toFixed(2)}`);
            }
            console.log("WORKER: Sim/offsetting completed successfully."); return { results: dailyData };
        } else { console.log("WORKER: Sim loop failed, offsetting skipped."); return { error: simulationError, results: dailyData }; }
    } catch (error) { console.error("WORKER: Uncaught error during performSimulation:", error); return { error: error.message || "Unknown sim error.", results: dailyData || null }; }
}

// --- Web Worker Event Listener ---
self.onmessage = async (e) => {
    const { type, payload } = e.data; // Payload doesn't include optimizationMode in this version
    console.log("WORKER: Received message:", type /*, "payload:", payload */);
    if (type === 'start') {
        try {
            const output = await performSimulation(payload); // Pass payload directly
            if (output.error) { console.log("WORKER: Sim finished with error, posting 'error'."); self.postMessage({ type: 'error', message: output.error, results: output.results }); }
            else { console.log("WORKER: Sim finished successfully, posting 'complete'."); self.postMessage({ type: 'complete', results: output.results }); }
        } catch (e) { console.error("WORKER: Unhandled exception in onmessage:", e); self.postMessage({ type: 'error', message: `Unhandled worker exception: ${e.message || e.toString()}` }); }
    } else { console.warn("WORKER: Unknown message type:", type); }
};

// --- Global Error Handler ---
self.onerror = function (event) { console.error("WORKER: Uncaught global error:", event.message, event); self.postMessage({ type: 'error', message: `Uncaught worker error: ${event.message}` }); };

console.log("WORKER: simulation.worker.js evaluated and ready.");
