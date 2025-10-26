let highsScriptLoaded = false;
let highsScriptError = null;
let highsLoaderFunction = null; // Stores the function to initialize HiGHS
let highsInstancePromise = null; // Stores the promise resolving to the HiGHS instance

// Attempt to load the HiGHS solver script
try {
    console.log("WORKER: Attempting to import HiGHS script from 'libs/highs.js'...");
    // Assumes highs.js is in a 'libs' folder relative to this worker
    importScripts('libs/highs.js');
    console.log("WORKER: Script 'libs/highs.js' imported.");

    // Check various ways the HiGHS loader function might be exposed globally
    if (typeof Module === 'function') {
        highsLoaderFunction = Module;
        highsScriptLoaded = true;
        console.log("WORKER: Loader found as global 'Module'.");
    } else if (typeof Module === 'object' && typeof Module.highs === 'function') {
        highsLoaderFunction = Module.highs;
        highsScriptLoaded = true;
        console.log("WORKER: Loader found as 'Module.highs'.");
    } else if (typeof Module === 'object' && typeof Module.default === 'function') {
        highsLoaderFunction = Module.default;
        highsScriptLoaded = true;
        console.log("WORKER: Loader found as 'Module.default'.");
    } else if (typeof highs === 'function') {
        highsLoaderFunction = highs;
        highsScriptLoaded = true;
        console.log("WORKER: Loader found as global 'highs'.");
    } else if (typeof self.highs === 'function') {
        highsLoaderFunction = self.highs;
        highsScriptLoaded = true;
        console.log("WORKER: Loader found at 'self.highs'.");
    } else {
        highsScriptError = "Could not find HiGHS loader function.";
        console.error("WORKER:", highsScriptError);
    }
} catch (error) {
    highsScriptError = `Failed to import script 'libs/highs.js': ${error.message}`;
    console.error("WORKER: CRITICAL -", highsScriptError, error);
}

// --- Constants ---
const HIGH_FREQUENCY_THRESHOLD = 11; // Frequencies above this use the heuristic
const HEURISTIC_CANDIDATE_COUNT = 7; // Number of best candidates to pass to MILP for high freq
const SCORE_DOW_WEIGHT = 0.1; // Weight for day-of-week variance in heuristic score

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
        console.log("WORKER: Initializing HiGHS WASM instance...");
        const wasmPath = 'libs/'; // Path relative to this worker where highs.wasm is
        const memoryMB = 1024; // Request 1 GB memory
        const initialMemory = memoryMB * 1024 * 1024;
        console.log(`WORKER: Requesting ${memoryMB}MB of memory for HiGHS...`);

        highsInstancePromise = highsLoaderFunction({
            locateFile: (filename) => wasmPath + filename, // Helps locate .wasm file
            initialMemory: initialMemory // Request specific memory heap size
        })
            .then(instance => {
                console.log("WORKER: HiGHS WASM instance initialized.");
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

// --- Heuristic Scoring Helper ---
/**
 * Calculates a score for a potential start day based on potential clashes and day-of-week distribution.
 * Lower scores are better (fewer clashes, more even distribution).
 * @param {number} startDay - The candidate start day (1-based).
 * @param {number} frequency - The frequency of the city being scored.
 * @param {number} quantity - The quantity shipped by the city being scored.
 * @param {Array<object>} allCities - The full list of cities for clash checking.
 * @param {number} cityIndexToScore - The index of the city being scored in allCities.
 * @returns {number} The calculated score.
 */
function scoreCandidateStartDay(startDay, frequency, quantity, allCities, cityIndexToScore) {
    let clashScore = 0;
    const dowCounts = [0, 0, 0, 0, 0, 0, 0]; // Counts for Sunday (0) to Saturday (6)

    for (let k = 0; ; k++) {
        const shipDay_0idx = (startDay - 1) + k * frequency;
        if (shipDay_0idx >= 365) break;

        // --- Day of Week Calculation ---
        const dayOfWeek = shipDay_0idx % 7; // Simple modulo for relative day of week
        dowCounts[dayOfWeek]++;

        // --- Clash Calculation ---
        // Check against all *other* cities, assuming they start on day 1 (or forced day)
        for (let otherCityIdx = 0; otherCityIdx < allCities.length; otherCityIdx++) {
            if (otherCityIdx === cityIndexToScore) continue; // Don't check against self

            const otherCity = allCities[otherCityIdx];
            const otherFreq = Math.max(1, Math.round(otherCity.freq));
            const otherStart_0idx = (otherCity.chosenStartDay > 0 ? otherCity.chosenStartDay : 1) - 1;

            if (shipDay_0idx >= otherStart_0idx && (shipDay_0idx - otherStart_0idx) % otherFreq === 0) {
                clashScore += otherCity.qty; // Add the quantity of the clashing shipment
            }
        }
    }

    // --- Calculate Day-of-Week Variance ---
    const totalShipments = dowCounts.reduce((a, b) => a + b, 0);
    const meanDowCount = totalShipments / 7;
    const dowVariance = dowCounts.reduce((sumSqDiff, count) => sumSqDiff + Math.pow(count - meanDowCount, 2), 0) / 7;

    // --- Combine Scores ---
    // Lower clash score is better, lower variance is better.
    // Weighting can be adjusted.
    const totalScore = clashScore + (dowVariance * quantity * SCORE_DOW_WEIGHT); // Scale variance by quantity

    return totalScore;
}


// --- Async MILP Helper Function ---
/**
 * Generates and solves a Mixed Integer Linear Program (MILP) to find an optimal
 * shipment start day schedule for cities, minimizing the peak daily shipment load.
 * Populates the `scheduleData` array with the resulting schedule.
 * Uses a heuristic to select candidate start days for high-frequency shipments.
 * @param {Array<object>} cities - Array of city objects { name, qty, freq, chosenStartDay? }.
 * @param {Array<object>} scheduleData - Array representing 365 days, to be populated with schedule.
 * @returns {Promise<object>} A promise resolving to { status, peakDemand, dailyData: scheduleData } or an error status.
 */
async function findOptimalShipmentSchedule(cities, scheduleData) {
    console.log("WORKER: Entered findOptimalShipmentSchedule (with Heuristic).");
    let solverInstance;

    // Get the solver instance
    try {
        solverInstance = await getSolverInstance();
    } catch (error) {
        console.error("WORKER: Solver failed load/init in findOptimalShipmentSchedule", error);
        // Fallback: Provide a basic schedule if solver fails (remains unchanged)
        const safeScheduleData = scheduleData || Array.from({ length: 365 }, () => ({ shipments: 0, shipmentDetails: [] }));
        safeScheduleData.forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } });
        if (Array.isArray(cities)) {
            cities.forEach(c => {
                const freq = c.freq || 7;
                const startDay = (c.chosenStartDay > 0 && c.chosenStartDay <= freq) ? c.chosenStartDay : 1;
                const startDay_0idx = startDay - 1;
                if (safeScheduleData?.[startDay_0idx]) {
                    safeScheduleData[startDay_0idx].shipments += c.qty;
                    safeScheduleData[startDay_0idx].shipmentDetails.push({ city: c.name, qty: c.qty, freq: freq, startDay: startDay });
                }
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
        console.log("WORKER: Starting LP string generation with Heuristic...");
        lpString += "Minimize\n obj: " + objectiveParts.join(' + ') + "\n";
        lpString += "Subject To\n";

        // Constraints for each city: Choose one start day or use forced start day
        (cities || []).forEach((city, cityIndex) => {
            if (city.chosenStartDay > 0) { // User forced start day
                const startDay = city.chosenStartDay;
                const varName = `x_${cityIndex}_${startDay}`;
                binaryVars.push(varName);
                cityVarMap.set(varName, { cityIndex, cityQty: city.qty, startDay: startDay, freq: city.freq, forced: true });
                lpString += ` city_${cityIndex}_forced: 1 ${varName} = 1\n`;
            } else { // Solver chooses start day
                const freq = Math.max(1, Math.round(city.freq));
                let possibleStartDays = [];

                if (freq <= HIGH_FREQUENCY_THRESHOLD) {
                    // Low frequency: consider all possible start days
                    for (let d = 1; d <= freq; d++) possibleStartDays.push(d);
                    console.log(`WORKER: City ${cityIndex} (freq ${freq}): Using all ${possibleStartDays.length} start days.`);
                } else {
                    // High frequency: Use the heuristic
                    console.log(`WORKER: City ${cityIndex} (freq ${freq}): Applying heuristic...`);
                    const initialCandidates = [];
                    // 1. Generate evenly spaced candidates
                    for (let i = 0; i < HIGH_FREQUENCY_THRESHOLD; i++) {
                        initialCandidates.push(Math.floor(i * freq / HIGH_FREQUENCY_THRESHOLD) + 1);
                    }

                    // 2. Score candidates
                    const scoredCandidates = initialCandidates.map(startDay => ({
                        startDay: startDay,
                        score: scoreCandidateStartDay(startDay, freq, city.qty, cities, cityIndex)
                    }));

                    // 3. Select best N candidates
                    scoredCandidates.sort((a, b) => a.score - b.score); // Sort by score ascending (lower is better)
                    possibleStartDays = scoredCandidates.slice(0, HEURISTIC_CANDIDATE_COUNT).map(c => c.startDay);
                    console.log(`WORKER: City ${cityIndex} selected candidates: [${possibleStartDays.join(', ')}] (Scores: ${scoredCandidates.slice(0, HEURISTIC_CANDIDATE_COUNT).map(c => c.score.toFixed(1)).join(', ')})`);
                }

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
                } else {
                    console.warn(`WORKER: City ${cityIndex} generated no solver variables (Freq: ${freq}).`);
                }
            }
        });

        // Constraints for each day: Daily load <= Z (Unchanged)
        for (let t = 0; t < 365; t++) { // t is 0-indexed day
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

        // Variable Types (Unchanged)
        lpString += "Bounds\n";
        lpString += "General\n";
        lpString += ` ${generalVars.join(' ')}\n`;
        lpString += "Binary\n";
        lpString += ` ${binaryVars.join(' ')}\n`;
        lpString += "End\n";

        console.log("WORKER: LP string generation complete.");

    } catch (genError) {
        console.error("WORKER: Error during LP String Generation:", genError);
        return { status: 'error_lp_generation', peakDemand: -1, dailyData: scheduleData, message: `LP Gen Error: ${genError.message}` };
    }

    // --- Solve the LP ---
    console.log("WORKER: Attempting to solve MILP...");
    try {
        const result = await solverInstance.solve(lpString);

        // --- Parse Results --- (Unchanged from previous version)
        const rawStatus = result?.Status ?? 'Unknown';
        const statusString = typeof rawStatus === 'string' ? rawStatus.trim() : 'Unknown';
        const isOptimalOrFeasible = statusString === 'Optimal' || statusString === 'Feasible';

        if (!isOptimalOrFeasible) {
            console.error(`WORKER: Non-optimal/feasible status '${statusString}'. Result:`, result);
            const simpleStatus = statusString.toLowerCase().replace(/[\s\(\)]+/g, '_') || 'unknown';
            return { status: `solver_status_${simpleStatus}`, peakDemand: -1, dailyData: scheduleData, message: `Solver status: ${statusString}` };
        }
        console.log(`WORKER: Status '${statusString}' OK. Parsing results.`);

        let peakDemand = -1;
        const columnsData = result.Columns;
        if (columnsData?.Z?.Primal !== undefined) peakDemand = columnsData.Z.Primal;
        else console.warn("WORKER: Could not extract Z value.");
        console.log(`WORKER: PeakLoadVar(Z)=${peakDemand}`);

        // Clear existing schedule data before applying results
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

        // --- Apply Schedule to scheduleData --- (Unchanged from previous version)
        let assignmentsMade = 0;
        try {
            cityVarMap.forEach((v, varName) => {
                // If this variable was chosen (>0.5) OR it was forced by user
                if (solutionValues[varName] > 0.5 || v.forced) {
                    assignmentsMade++;
                    const chosenStartDay = v.startDay; // The chosen/forced 1-based start day
                    // Apply shipments to all relevant days (using 0-based index t)
                    for (let t = chosenStartDay - 1; t < 365; t += v.freq) {
                        if (t >= 0 && t < scheduleData.length && scheduleData[t]) {
                            scheduleData[t].shipments += v.cityQty;
                            const cityName = cities[v.cityIndex]?.name || `City ${v.cityIndex}`;
                            scheduleData[t].shipmentDetails.push({ // Add details to schedule
                                city: cityName,
                                qty: v.cityQty,
                                freq: v.freq,
                                startDay: chosenStartDay // Store 1-based start day
                            });
                        }
                    }
                }
            });
        } catch (assignmentError) {
            console.error("WORKER: Error during solver assignment:", assignmentError);
            return { status: 'solver_assignment_error', peakDemand: peakDemand, dailyData: scheduleData, message: `Assign error: ${assignmentError.message}` };
        }
        if (assignmentsMade < (cities?.length || 0)) console.warn(`WORKER: Assignments (${assignmentsMade}) < cities (${cities?.length || 0}).`);

        console.log("WORKER: findOptimalShipmentSchedule finished successfully.");
        // Return structure matches error cases
        return { status: 'optimal', peakDemand: peakDemand, dailyData: scheduleData };

    } catch (error) {
        console.error("WORKER: Error during HiGHS solve execution or result parsing:", error);
        return { status: 'solver_execution_error', peakDemand: -1, dailyData: scheduleData, message: `Solve/Parse error: ${error.message}` };
    }
}

/**
 * Runs the main day-by-day inventory simulation based on a pre-calculated schedule.
 * Includes logic for handling shortfalls using overtime (OT) and offsetting OT hours.
 * Implements a simple first-week delay for shipments if inventory is insufficient.
 * @param {object} params - Simulation parameters including cities, schedule, costs, etc.
 * @returns {Promise<object>} A promise resolving to { results } or { error, results }.
 */
async function performSimulation(params) {
    const simStartTime = performance.now();
    console.log("WORKER: >>> performSimulation START (Reverted to Simple Delay + OT Logic) <<<");

    let dailyData = null; // Holds the final state, including shifted shipments
    let functionStep = "1. Deconstruct Params"; // Track current step

    try {
        // --- 1. Deconstruct params --- (Unchanged)
        console.log(`WORKER: ${functionStep}...`);
        const {
            cities, workingDaysSchedule, standardOpHours, numEmployees, laborCost,
            holdingCostRate, annualMfgOverhead, annualSgaExpenses,
            superCogsVal, ultraCogsVal, mcInputVal, buildRatios, standardDailyProduction
        } = params;
        const workingDaysSet = new Set(workingDaysSchedule);
        const numWorkingDays = workingDaysSchedule.length;
        const dailyHoldingRate = holdingCostRate / 365.0;
        const dailyMfgOverhead = numWorkingDays > 0 ? annualMfgOverhead / numWorkingDays : 0;
        const dailySgaExpenses = numWorkingDays > 0 ? annualSgaExpenses / numWorkingDays : 0;
        const avgCogs = (superCogsVal * buildRatios.super) + (ultraCogsVal * buildRatios.ultra) + (mcInputVal * buildRatios.mega);
        if (!standardDailyProduction || standardDailyProduction <= 0) throw new Error("Std daily production must be > 0.");
        if (standardOpHours <= 0) throw new Error("Std operating hours must be > 0.");
        const productionPerStdHour = standardDailyProduction / standardOpHours;
        console.log(`WORKER: ${functionStep} complete.`);

        // --- 2. Initialize Data Array (Single array approach) --- (Unchanged)
        functionStep = "2. Initialize dailyData";
        console.log(`WORKER: ${functionStep}...`);
        dailyData = Array.from({ length: 365 }, (_, i) => {
            const year = new Date().getFullYear();
            const date = new Date(Date.UTC(year, 0, i + 1));
            const dayStr = date.toISOString().split('T')[0];
            return {
                day: i, date: dayStr, isWorkingDay: workingDaysSet.has(dayStr),
                inventoryStart: 0, production: 0, opHours: 0, inventoryAvailable: 0,
                shipments: 0,       // Populated by solver/heuristic
                shipmentDetails: [], // Populated by solver/heuristic
                actualShipments: 0, // Calculated during simulation
                actualShipmentDetails: [], // **Crucial**: Initialize as empty array
                demandMet: true,    // Flag for simulation outcome
                inventoryEnd: 0,
                holdingCost: 0, exceptionCost: 0, isExceptionDay: false, isReductionDay: false, exceptionDetails: null,
                shipmentDeferred: false // Flag for delayed shipments
            };
        });
        console.log(`WORKER: ${functionStep} complete.`);

        let simulationError = null; // For critical errors during simulation loop

        // --- 3. Run Optimizer / Heuristic (Populates dailyData.shipments/Details) --- (Unchanged)
        functionStep = "3. Run Optimizer/Heuristic";
        console.log(`WORKER: ${functionStep}...`);
        if (cities && cities.length > 0) {
            console.log("WORKER: Calling findOptimalShipmentSchedule...");
            const optStartTime = performance.now();
            // Pass dailyData to be populated by the solver
            const optimizationResult = await findOptimalShipmentSchedule(cities, dailyData);
            const optEndTime = performance.now();
            console.log(`WORKER: findOptimalShipmentSchedule finished in ${(optEndTime - optStartTime).toFixed(0)} ms with status: ${optimizationResult?.status}`);

            if (!optimizationResult || optimizationResult.status !== 'optimal') {
                console.warn(`WORKER: Optimizer failed (${optimizationResult?.status}), using heuristic schedule.`);
                dailyData.forEach(d => { d.shipments = 0; d.shipmentDetails = []; }); // Clear just in case
                cities.forEach(city => { // Apply heuristic schedule
                    const freq = city.freq || 7;
                    let startDay = (city.chosenStartDay > 0 && city.chosenStartDay <= freq) ? city.chosenStartDay : 1;
                    const startDay_0idx = startDay - 1;
                    for (let t = startDay_0idx; t < 365; t += freq) {
                        if (dailyData[t]) {
                            dailyData[t].shipments += city.qty;
                            dailyData[t].shipmentDetails.push({ city: city.name, qty: city.qty, freq: freq, startDay: startDay });
                        }
                    }
                });
                console.log("WORKER: Heuristic schedule applied.");
            } else {
                console.log(`WORKER: Optimal schedule applied. Peak var (Z): ${optimizationResult.peakDemand?.toFixed(0) ?? 'N/A'}.`);
                // dailyData is already populated by reference
            }
        } else {
            console.log("WORKER: No cities, ensuring schedule is empty.");
            dailyData.forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } });
        }
        console.log(`WORKER: ${functionStep} complete.`);

        // --- 4. Run Simulation Loop with First-Week Delay --- (Unchanged)
        functionStep = "4. Simulation Loop";
        console.log(`WORKER: ${functionStep} starting...`);
        let accumulatedExtraHours = 0;
        const loopStartTime = performance.now();

        for (let day = 0; day < 365; day++) {
            if (!dailyData?.[day]) continue; // Skip if data for day is missing

            // A. Inventory & Production
            dailyData[day].inventoryStart = (day === 0) ? 0 : (dailyData[day - 1]?.inventoryEnd ?? 0); // NO BUFFER
            dailyData[day].production = 0;
            dailyData[day].opHours = 0;
            if (dailyData[day].isWorkingDay && !dailyData[day].isReductionDay && !dailyData[day].isExceptionDay) {
                dailyData[day].production = standardDailyProduction;
                dailyData[day].opHours = standardOpHours;
            }
            // *** Production added BEFORE shipment check ***
            dailyData[day].inventoryAvailable = dailyData[day].inventoryStart + dailyData[day].production;

            // B. Check Scheduled Shipments for Today
            let shipmentsScheduledToday = dailyData[day].shipments || 0;
            let detailsScheduledToday = dailyData[day].shipmentDetails || [];
            dailyData[day].actualShipments = 0; // Reset actual for today
            dailyData[day].actualShipmentDetails = []; // Reset actual details for today

            // C. Delay Logic (First Week Only, if needed)
            let wasDeferred = false;
            if (day < 7 && shipmentsScheduledToday > 0 && dailyData[day].inventoryAvailable < shipmentsScheduledToday) {
                let foundSpot = false;
                const maxDelayTargetDay = Math.min(364, day + 7); // Simplified delay window
                // console.log(`WORKER: Day ${day} - Shortfall ${shipmentsScheduledToday - dailyData[day].inventoryAvailable}. Trying delay up to day ${maxDelayTargetDay}.`);

                for (let targetDay = day + 1; targetDay <= maxDelayTargetDay; targetDay++) {
                    // Check if target day exists and is a working day
                    if (dailyData[targetDay] && dailyData[targetDay].isWorkingDay) {
                        console.log(`WORKER: --> Deferring Day ${day} shipment (${shipmentsScheduledToday} units) to Day ${targetDay}.`);
                        // Move the scheduled shipment quantity and details
                        dailyData[targetDay].shipments = (dailyData[targetDay].shipments || 0) + shipmentsScheduledToday;
                        dailyData[targetDay].shipmentDetails = (dailyData[targetDay].shipmentDetails || []).concat(detailsScheduledToday);

                        // Clear from original day and mark
                        dailyData[day].shipments = 0;
                        dailyData[day].shipmentDetails = [];
                        dailyData[day].shipmentDeferred = true;
                        dailyData[day].exceptionDetails = `Shipment deferred to day ${targetDay}.`;

                        foundSpot = true;
                        wasDeferred = true; // Mark that deferral happened for this day
                        break; // Stop searching once moved
                    }
                }
                if (!foundSpot) {
                    console.warn(`WORKER: Day ${day} - Could not find spot to delay. Treating as shortfall.`);
                    // Shipment remains scheduled for today, shortfall logic will run
                }
            } // End delay check

            // D. Determine Shipments Actually Needed Today (after potential deferral)
            const finalShipmentsNeededToday = dailyData[day].shipments || 0;
            const finalDetailsNeededToday = dailyData[day].shipmentDetails || [];


            // E. Shortfall Handling (If needed for shipments STILL scheduled today)
            if (finalShipmentsNeededToday > 0 && dailyData[day].inventoryAvailable < finalShipmentsNeededToday) {
                let remainingShortfall = finalShipmentsNeededToday - dailyData[day].inventoryAvailable;
                dailyData[day].demandMet = false; // Mark demand potentially unmet
                let exceptionDaysUsed = [];
                console.log(`WORKER: Day ${day} - Shortfall ${remainingShortfall.toFixed(0)}u (after delay check). Looking back for OT...`);

                // --- OT LOOKBACK LOGIC (Operates on dailyData) ---
                for (let p = day - 1; p >= 0 && remainingShortfall > 0.01; p--) {
                    if (!dailyData[p]) continue;
                    if (dailyData[p].isWorkingDay && !dailyData[p].isReductionDay) {
                        if (dailyData[p].isExceptionDay) { break; } // Stop if already an exception day
                        const prevDayRecordedHours = dailyData[p].opHours;
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
                            // Apply OT changes to the previous day 'p'
                            const finalPrevDayOpHours = prevDayRecordedHours + actualHoursToAdd;
                            const finalPrevDayProduction = dailyData[p].production + actualProductionToAdd;
                            dailyData[p].production = finalPrevDayProduction;
                            dailyData[p].opHours = finalPrevDayOpHours;
                            dailyData[p].isExceptionDay = true;
                            // Calculate costs
                            const overtimePremiumCost = actualHoursToAdd * numEmployees * laborCost * 0.5;
                            const overheadScaleFactor = finalPrevDayOpHours / standardOpHours;
                            const prevOverheadScale = (prevDayRecordedHours / standardOpHours);
                            const overheadIncrease = Math.max(0, (dailyMfgOverhead * (overheadScaleFactor > 1 ? overheadScaleFactor : 1)) - (dailyMfgOverhead * (prevOverheadScale > 1 ? prevOverheadScale : 1))) + Math.max(0, (dailySgaExpenses * (overheadScaleFactor > 1 ? overheadScaleFactor : 1)) - (dailySgaExpenses * (prevOverheadScale > 1 ? prevOverheadScale : 1)));
                            dailyData[p].exceptionCost = (dailyData[p].exceptionCost || 0) + overtimePremiumCost + overheadIncrease;
                            accumulatedExtraHours += actualHoursToAdd;
                            const detailMsg = `Added ${actualHoursToAdd.toFixed(2)}h (Total: ${finalPrevDayOpHours.toFixed(2)}) for day ${day}. Cost: \$${(overtimePremiumCost + overheadIncrease).toFixed(0)}`;
                            dailyData[p].exceptionDetails = dailyData[p].exceptionDetails ? `${dailyData[p].exceptionDetails}; ${detailMsg}` : detailMsg;
                            // Increase current day's availability
                            dailyData[day].inventoryAvailable += actualProductionToAdd;
                            remainingShortfall -= actualProductionToAdd;
                            exceptionDaysUsed.push(p);
                            if (remainingShortfall <= 0.01) {
                                dailyData[day].demandMet = true; // Demand met with OT
                                break; // Exit OT loop
                            }
                        }
                    }
                } // --- END OT LOGIC ---

                // Check if demand was ultimately met
                if (!dailyData[day].demandMet) {
                    // --- MODIFICATION: Generate detailed conflict error message ---
                    let conflictDetails = [];
                    // finalDetailsNeededToday holds the shipments that were *scheduled* for this day
                    if (finalDetailsNeededToday && finalDetailsNeededToday.length > 0) {
                        finalDetailsNeededToday.forEach(detail => {
                            conflictDetails.push(`- City: ${detail.city} (Qty: ${detail.qty}, Freq: ${detail.freq}, Start: ${detail.startDay})`);
                        });
                    } else {
                        conflictDetails.push("- No specific city details found for this day's failed shipment.");
                    }

                    simulationError = `Demand Conflict: Day ${day + 1}\n` +
                        `Cannot meet scheduled ${finalShipmentsNeededToday.toFixed(0)}u. Short by ${remainingShortfall.toFixed(0)}u.\n\n` +
                        `Conflicting Shipments:\n` +
                        `${conflictDetails.join('\n')}`;
                    // --- END MODIFICATION ---

                    console.error("WORKER:", simulationError); // Log the new detailed error
                    dailyData[day].exceptionDetails = (dailyData[day].exceptionDetails ? dailyData[day].exceptionDetails + "; " : "") + `CRITICAL SHORTFALL: ${remainingShortfall.toFixed(0)}u`; // Keep exception detail simple
                    dailyData[day].isExceptionDay = true;
                    // Let simulation continue to record failure state
                } else {
                    dailyData[day].exceptionDetails = (dailyData[day].exceptionDetails ? dailyData[day].exceptionDetails + "; " : "") + `Met shortfall via OT on day(s) ${exceptionDaysUsed.join(', ')}.`;
                }
            } // End Shortfall Handling

            // F. Fulfill Actual Shipments & Update Inventory
            // actualShipments = MIN(inventory available AFTER OT, shipments STILL scheduled today)
            dailyData[day].actualShipments = Math.min(dailyData[day].inventoryAvailable, finalShipmentsNeededToday);
            dailyData[day].inventoryEnd = dailyData[day].inventoryAvailable - dailyData[day].actualShipments;

            // Populate actualShipmentDetails based on what was ACTUALLY shipped today
            let remainingToFulfill = dailyData[day].actualShipments;
            dailyData[day].actualShipmentDetails = []; // Reset for the day
            // Iterate through the details STILL scheduled for today
            for (const detail of finalDetailsNeededToday) {
                if (remainingToFulfill <= 0) break;
                const qtyToShip = Math.min(detail.qty, remainingToFulfill);
                if (qtyToShip > 0) {
                    dailyData[day].actualShipmentDetails.push({
                        city: detail.city,
                        qty: qtyToShip, // Use actual shipped quantity
                        freq: detail.freq,
                        startDay: detail.startDay
                    });
                    remainingToFulfill -= qtyToShip;
                }
            }
            if (remainingToFulfill < -0.01) { console.warn(`WORKER: Day ${day} - Negative remaining fulfillment: ${remainingToFulfill.toFixed(2)}`); }


            // G. Calculate Holding Cost
            dailyData[day].holdingCost = Math.max(0, dailyData[day].inventoryEnd) * avgCogs * dailyHoldingRate;

        } // --- End daily loop ---

        const loopEndTime = performance.now();
        console.log(`WORKER: ${functionStep} finished in ${(loopEndTime - loopStartTime).toFixed(0)} ms.`);

        if (simulationError) { console.error("WORKER: Sim loop finished with CRITICAL error."); }
        else { console.log("WORKER: Finished 365-day sim loop successfully."); }


        // --- 7. Offsetting Logic (Operates on dailyData) --- (Unchanged)
        functionStep = "7. Offsetting Logic";
        console.log(`WORKER: ${functionStep} starting...`);
        // ... (Offsetting logic remains unchanged) ...
        let hoursToOffset = accumulatedExtraHours; const finalInventory = dailyData[364]?.inventoryEnd ?? 0; const targetEndInventory = 0; let productionRemoved = 0; if (hoursToOffset > 0.01) { console.log(`WORKER: Offsetting ${hoursToOffset.toFixed(2)} hrs...`); let daysReduced = 0; for (let day = 364; day >= 0 && hoursToOffset > 0.01; day--) { if (!dailyData?.[day]) continue; if (dailyData[day].isWorkingDay && !dailyData[day].isExceptionDay && !dailyData[day].isReductionDay && Math.abs(dailyData[day].opHours - standardOpHours) < 0.01) { const whatIfFinalInventory = finalInventory - productionRemoved - standardDailyProduction; if (whatIfFinalInventory >= targetEndInventory) { const reduction = standardOpHours; dailyData[day].isWorkingDay = false; dailyData[day].isReductionDay = true; dailyData[day].opHours = 0; dailyData[day].production = 0; dailyData[day].exceptionDetails = `Day cancelled (reduced ${reduction.toFixed(2)}h) to offset exceptions.`; hoursToOffset -= reduction; productionRemoved += standardDailyProduction; daysReduced++; } else { console.log(`WORKER: Stopping offset...`); break; } } } console.log(`WORKER: Reduced ${daysReduced} days. Remaining offset: ${hoursToOffset.toFixed(2)}`); }
        console.log(`WORKER: ${functionStep} complete.`);


        // --- 8. Return Results --- (Unchanged)
        functionStep = "8. Return Results";
        console.log(`WORKER: ${functionStep}...`);
        const simEndTime = performance.now();
        console.log(`WORKER: <<< performSimulation END (${simulationError ? 'WITH ERROR' : 'SUCCESS'}) - Total Time: ${(simEndTime - simStartTime).toFixed(0)} ms >>>`);

        // Return the final dailyData array which includes simulation results
        if (simulationError) {
            return { error: simulationError, results: dailyData };
        } else {
            return { results: dailyData };
        }

    } catch (error) {
        console.error(`WORKER: Uncaught error during performSimulation (Step: ${functionStep}):`, error);
        const errorEndTime = performance.now();
        console.log(`WORKER: <<< performSimulation END (UNCAUGHT ERROR) - Total Time: ${(errorEndTime - simStartTime).toFixed(0)} ms >>>`);
        return { error: `Worker crashed at Step ${functionStep}: ${error.message || "Unknown sim error."}`, results: scheduleData || null };
    }
}


// --- Web Worker Event Listener --- (Unchanged)
self.onmessage = async (e) => {
    const { type, payload } = e.data;
    console.log("WORKER: Received message:", type);
    if (type === 'start') {
        try {
            console.log("WORKER: Calling performSimulation...");
            const output = await performSimulation(payload);
            console.log("WORKER: performSimulation finished. Output has error:", !!output.error, "Output has results:", !!output.results);

            if (output.error && output.results === null) { // Conflict check failure
                console.log("WORKER: Posting 'error' back (Conflict Check Failure).");
                self.postMessage({ type: 'error', message: output.error, results: null });
            } else if (output.error) { // Simulation loop failure or uncaught
                console.log("WORKER: Posting 'error' back (Simulation Loop/Uncaught Failure).");
                self.postMessage({ type: 'error', message: output.error, results: output.results }); // Send partial/full results with error
            } else { // Success
                console.log("WORKER: Posting 'complete' back.");
                self.postMessage({ type: 'complete', results: output.results });
            }
        } catch (e) {
            console.error("WORKER: Unhandled exception processing 'start' message:", e);
            self.postMessage({ type: 'error', message: `Unhandled worker exception: ${e.message || e.toString()}` });
        }
    } else {
        console.warn("WORKER: Unknown message type received:", type);
    }
};

// --- Global Error Handler --- (Unchanged)
self.onerror = function (event) {
    console.error("WORKER: Uncaught global error:", event.message, event);
    self.postMessage({ type: 'error', message: `Uncaught worker error: ${event.message}` });
};

console.log("WORKER: simulation.worker.js evaluated and ready.");