/**
 * Quality Yield Module
 *
 * This module calculates a *stress breakdown* based on four factors.
 */

// The only global adjustable parameter. Defaults to 15%.
window.stDevPercentage = 0.15;

/**
 * Helper function to calculate the stress (probability of overage)
 * for a single model type within a single workstation.
 */
function calculateStressForModel(elementTimes, taktTime, stDevPercentage) {
    if (!elementTimes || elementTimes.length === 0) {
        return 0; // No tasks for this model, so no stress
    }

    // Calculate the mean total time for this model
    const workstationMeanTime = elementTimes.reduce((sum, t) => sum + t, 0);

    // Calculate the total workstation stDev for this model
    const workstationVariance = elementTimes.reduce((sum, t) => {
        const taskStDev = t * stDevPercentage;
        const taskVariance = taskStDev * taskStDev;
        return sum + taskVariance;
    }, 0);
    const workstationStDev = Math.sqrt(workstationVariance);

    if (!isFinite(workstationStDev) || workstationStDev <= 0) {
        // No variability, stress is 0 unless the mean is already over takt.
        return (workstationMeanTime > taktTime) ? 1.0 : 0.0;
    }

    // Calculate probability of exceeding takt time
    const z = (taktTime - workstationMeanTime) / workstationStDev;
    const probOverage = 1 - normalCDF(z);

    return Math.min(1, Math.max(0, probOverage));
}

/**
 * Calculates the average workstation stress across the entire line.
 * It iterates through each workstation and finds the weighted-average stress
 * based on the build ratios for Super, Ultra, and Mega models.
 */
function calculateWorkstationStress(workstationDetails, taktTime, stDevPercentage, buildRatios) {
    if (!workstationDetails || workstationDetails.length === 0 || !taktTime || taktTime <= 0 || !buildRatios) {
        return 0;
    }

    let totalStress = 0;
    let workstationCount = 0;

    for (let i = 0; i < workstationDetails.length; i++) {
        const ws = workstationDetails[i];

        // Calculate the stress (probOverage) for each model type
        const probSuper = calculateStressForModel(ws.superElementTimes, taktTime, stDevPercentage);
        const probUltra = calculateStressForModel(ws.ultraElementTimes, taktTime, stDevPercentage);
        const probMega = calculateStressForModel(ws.megaElementTimes, taktTime, stDevPercentage);

        // Calculate the weighted-average stress for this workstation
        const workstationStress = (buildRatios.super * probSuper) +
            (buildRatios.ultra * probUltra) +
            (buildRatios.mega * probMega);

        totalStress += workstationStress;
        workstationCount++;
    }

    const averageStress = workstationCount > 0 ? totalStress / workstationCount : 0;
    return averageStress;
}

/**
 * Approximation of the cumulative distribution function for standard normal distribution.
 */
function normalCDF(z) {
    if (!isFinite(z)) {
        return z > 0 ? 1 : 0;
    }
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    const result = z > 0 ? 1 - p : p;
    return Math.max(0, Math.min(1, result));
}

/**
 * Calculates the quality loss (stress) from all factors and returns a breakdown.
 *
 * @param {number} stDevPercentage - Standard deviation as a percentage of mean (e.g., 0.1)
 * @param {number} conveyorSpeed - Conveyor speed in ft/min
 * @param {Array} workstationDetails - Array of workstation objects
 * @param {number} taktTime - Required takt time in minutes
 * @param {number} overtimeStress - Overtime stress factor (0-1)
 * @param {number} wageStress - Local wage stress factor (0-1)
 * @param {Object} buildRatios - The {super: 0.35, ultra: 0.45, mega: 0.20} object
 * @returns {Object} A breakdown of quality loss.
 */
function calculateQualityStressBreakdown(stDevPercentage, conveyorSpeed, workstationDetails, taktTime, overtimeStress, wageStress, buildRatios) {
    const MAX_CONVEYOR_SPEED = 15;

    // --- Input Validation ---
    if (!isFinite(stDevPercentage) || stDevPercentage < 0) { stDevPercentage = 0; }
    if (!isFinite(conveyorSpeed) || conveyorSpeed < 0) { conveyorSpeed = 10; }
    if (!isFinite(taktTime) || taktTime <= 0) { taktTime = 2.5; }
    overtimeStress = isFinite(overtimeStress) ? Math.max(0, Math.min(1, overtimeStress)) : 0;
    wageStress = isFinite(wageStress) ? Math.max(0, Math.min(1, wageStress)) : 0;

    console.log("--- Calculating Quality Stress Breakdown ---");

    // --- Calculate individual stress factors ---

    // Workstation Stress (Probabilistic, State-Based)
    const workstationStress = calculateWorkstationStress(workstationDetails, taktTime, stDevPercentage, buildRatios);
    console.log(`[Quality] 1. Workstation Stress (Raw): ${workstationStress.toFixed(4)}`);


    // Conveyor Fatigue (Probabilistic)
    let conveyorFatigue = 0;
    const speedStDev = conveyorSpeed * stDevPercentage;
    let z_speed = Infinity; // For logging

    if (speedStDev > 0) {
        z_speed = (MAX_CONVEYOR_SPEED - conveyorSpeed) / speedStDev;
        conveyorFatigue = 1 - normalCDF(z_speed);
    } else if (conveyorSpeed > MAX_CONVEYOR_SPEED) {
        conveyorFatigue = 1; // If mean is already over max, stress is 1
    }
    console.log(`[Quality] 2. Conveyor Fatigue (Raw): ${conveyorFatigue.toFixed(4)} (Mean: ${conveyorSpeed.toFixed(2)}, Z: ${z_speed.toFixed(2)}, P(X > 15))`);


    // Overtime Stress (from Location tab)
    const overtimeStressFactor = overtimeStress || 0;
    console.log(`[Quality] 3. Overtime Stress (Raw): ${overtimeStressFactor.toFixed(4)}`);


    // 4. Wage Stress (from Location tab)
    const wageStressFactor = wageStress || 0;
    console.log(`[Quality] 4. Wage Stress (Raw): ${wageStressFactor.toFixed(4)}`);


    // --- Calculate Weighted Loss Breakdown ---
    // Weights: WorkStation 40%, Conveyor 20%, Overtime 20%, Wage 20%
    const breakdown = {
        workstationLoss: 0.4 * workstationStress,
        conveyorLoss: 0.2 * conveyorFatigue,
        overtimeLoss: 0.2 * overtimeStressFactor,
        wageLoss: 0.2 * wageStressFactor
    };

    // Calculate total stress (sum of losses)
    breakdown.totalStress = breakdown.workstationLoss +
        breakdown.conveyorLoss +
        breakdown.overtimeLoss +
        breakdown.wageLoss;

    // Clamp total stress to a max of 1.0 (100% loss)
    breakdown.totalStress = Math.min(1.0, breakdown.totalStress);

    console.log(`[Quality] Breakdown (Weighted): 
        Workstation: ${breakdown.workstationLoss.toFixed(4)} (40%)
        Conveyor: ${breakdown.conveyorLoss.toFixed(4)} (20%)
        Overtime: ${breakdown.overtimeLoss.toFixed(4)} (20%)
        Wage: ${breakdown.wageLoss.toFixed(4)} (20%)
        ---------------------
        Total Stress (Loss): ${breakdown.totalStress.toFixed(4)}`);

    return breakdown;
}

// Make the functions globally available
window.calculateQualityStressBreakdown = calculateQualityStressBreakdown;