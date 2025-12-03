/**
 * Quality Yield Module
 *
 * This module calculates a *stress breakdown* based on four factors.
 */

// The only global adjustable parameter. Defaults to 15%.
window.stDevPercentage = 0.15;

/**
 * --- WageManager (Background Service) ---
 * Handles async fetching of wage data so the main UI thread isn't blocked.
 */
const WageManager = (() => {
    let _currentStress = 0;
    let _currentMedianHourly = 0;
    let _lastParams = { lat: null, lon: null, cost: null };

    // --- API HELPER FUNCTIONS ---
    async function fetchFipsFromLatLon(lat, lon, timeoutMs = 8000) {
        const corsProxy = 'https://corsproxy.io/?';
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        try {
            // Try Block Level
            const targetUrl = `https://geo.fcc.gov/api/census/block/find?format=json&latitude=${lat}&longitude=${lon}&showall=true`;
            const res = await fetch(`${corsProxy}${encodeURIComponent(targetUrl)}`, { signal: controller.signal });

            if (!res.ok) throw new Error(`FCC block lookup failed: ${res.status}`);

            const json = await res.json();
            clearTimeout(id);

            const blockFIPS = (json.Block && json.Block.FIPS) ? json.Block.FIPS : null;

            if (blockFIPS) {
                return {
                    stateFips: (json.State && json.State.FIPS) ? json.State.FIPS : null,
                    countyFips: (json.County && json.County.FIPS) ? json.County.FIPS : null,
                    tract: blockFIPS.substring(0, 11),
                };
            }
        } catch (err) {

        } finally {
            clearTimeout(id);
        }
        return null;
    }

    async function fetchMedianHouseholdIncome({ stateFips, countyFips, tract }, censusApiKey = '') {
        const corsProxy = 'https://corsproxy.io/?';
        const year = '2021';
        const varName = 'B19013_001E';
        const commonKey = censusApiKey ? `&key=${encodeURIComponent(censusApiKey)}` : '';

        const safeFetch = async (targetUrl) => {
            try {
                const res = await fetch(`${corsProxy}${encodeURIComponent(targetUrl)}`);
                if (res.ok) return await res.json();
                console.warn(`Census API Error ${res.status}:`, targetUrl);
            } catch (e) { return null; }
        };

        const buildUrl = (forParam, inParam) => {
            return `https://api.census.gov/data/${year}/acs/acs5?get=${varName}&for=${forParam}&in=${inParam}${commonKey}`;
        };

        // Try Tract
        if (stateFips && countyFips && tract) {
            const countyCode = countyFips.slice(-3);
            const tractCode = tract.substring(5, 11);
            const url = buildUrl(`tract:${tractCode}`, `state:${stateFips}%20county:${countyCode}`);
            const data = await safeFetch(url);
            if (data && data[1] && !isNaN(data[1][0]) && data[1][0] > 0) return Number(data[1][0]);
        }

        // Fallback to County
        if (stateFips && countyFips) {
            const countyCode = countyFips.slice(-3);
            const url = buildUrl(`county:${countyCode}`, `state:${stateFips}`);
            const data = await safeFetch(url);
            if (data && data[1] && !isNaN(data[1][0]) && data[1][0] > 0) return Number(data[1][0]);
        }
        return null;
    }

    function mapWageToStress(medianHourly, setLaborCost) {
        if (!medianHourly || medianHourly <= 0) return 0;
        if (setLaborCost >= medianHourly) return 0;
        const lowBound = medianHourly * 0.6;
        if (setLaborCost <= lowBound) return 1;
        return (medianHourly - setLaborCost) / (medianHourly - lowBound);
    }

    // --- PUBLIC METHODS ---

    async function update(lat, lon, laborCost) {
        // 1. Cache Check
        if (_lastParams.lat === lat && _lastParams.lon === lon && _lastParams.cost === laborCost && _currentMedianHourly > 0) {
            return { medianHourly: _currentMedianHourly, stress: _currentStress };
        }

        // 2. Fetch Logic (Only if location changed)
        let newMedianHourly = 0;

        if (lat !== _lastParams.lat || lon !== _lastParams.lon) {
            const fips = await fetchFipsFromLatLon(lat, lon);
            if (fips) {
                const income = await fetchMedianHouseholdIncome(fips);
                if (income) {
                    newMedianHourly = income / (52 * 40);
                }
            }
        } else {
            newMedianHourly = _currentMedianHourly;
        }

        // 3. State Update Logic
        if (newMedianHourly > 0) {
            _currentMedianHourly = newMedianHourly;
            _currentStress = mapWageToStress(newMedianHourly, laborCost);
        } else {
            // Failure: Keep old wage if available, but recalc stress with new cost
            if (_currentMedianHourly > 0) {
                _currentStress = mapWageToStress(_currentMedianHourly, laborCost);
            } else {
                _currentStress = 0;
            }
        }

        // 4. Update Cache Params
        _lastParams = { lat, lon, cost: laborCost };

        return { medianHourly: _currentMedianHourly, stress: _currentStress };
    }

    return {
        update,
        getStress: () => _currentStress,
        getMedianHourly: () => _currentMedianHourly
    };
})();

// Expose WageManager to other tabs
window.WageManager = WageManager;


/**
 * Helper function to calculate the probabilistic details
 * for a single model type within a single workstation.
 */
function getModelProbabilistics(elementTimes, taktTime, stDevPercentage) {
    if (!elementTimes || elementTimes.length === 0) {
        return { mean: 0, stdDev: 0, probOverage: 0 };
    }

    const mean = elementTimes.reduce((sum, t) => sum + t, 0);

    const variance = elementTimes.reduce((sum, t) => {
        const taskStDev = t * stDevPercentage;
        const taskVariance = taskStDev * taskStDev;
        return sum + taskVariance;
    }, 0);
    const stdDev = Math.sqrt(variance);

    let probOverage = 0.0;
    if (!isFinite(stdDev) || stdDev <= 0) {
        probOverage = (mean > taktTime) ? 1.0 : 0.0;
    } else {
        const z = (taktTime - mean) / stdDev;
        probOverage = 1 - normalCDF(z);
    }

    return {
        mean: mean,
        stdDev: stdDev,
        probOverage: Math.min(1, Math.max(0, probOverage))
    };
}

const transitionProbs = {
    super: { super: 0.0, ultra: 0.7143, mega: 0.2857 },
    ultra: { super: 0.5618, ultra: 0.2135, mega: 0.2247 },
    mega: { super: 0.50, ultra: 0.0, mega: 0.50 }
};

function calculateWorkstationStress(workstationDetails, taktTime, stDevPercentage, buildRatios) {
    if (!workstationDetails || workstationDetails.length === 0 || !taktTime || taktTime <= 0 || !buildRatios) {
        return 0;
    }

    let totalStress = 0;
    let workstationCount = 0;
    const modelKeys = ['super', 'ultra', 'mega'];

    for (let i = 0; i < workstationDetails.length; i++) {
        const ws = workstationDetails[i];

        const p = {
            super: getModelProbabilistics(ws.superElementTimes, taktTime, stDevPercentage),
            ultra: getModelProbabilistics(ws.ultraElementTimes, taktTime, stDevPercentage),
            mega: getModelProbabilistics(ws.megaElementTimes, taktTime, stDevPercentage)
        };

        let pFailGiven = { super: 0, ultra: 0, mega: 0 };

        for (const i_key of modelKeys) {
            const prob_i_overruns = p[i_key].probOverage;

            if (prob_i_overruns === 0) {
                pFailGiven[i_key] = 0;
                continue;
            }

            let pNextFailsToCompensate = 0;

            for (const j_key of modelKeys) {
                const prob_i_to_j = transitionProbs[i_key][j_key];
                if (prob_i_to_j === 0) continue;

                const model_j = p[j_key];
                const compensationTakt = 2 * taktTime - p[i_key].mean;

                let p_j_fails_comp = 0.0;
                if (!isFinite(model_j.stdDev) || model_j.stdDev <= 0) {
                    p_j_fails_comp = (model_j.mean > compensationTakt) ? 1.0 : 0.0;
                } else {
                    const z_comp = (compensationTakt - model_j.mean) / model_j.stdDev;
                    p_j_fails_comp = 1 - normalCDF(z_comp);
                }

                pNextFailsToCompensate += p_j_fails_comp * prob_i_to_j;
            }

            pFailGiven[i_key] = prob_i_overruns * pNextFailsToCompensate;
        }

        const workstationStress = (buildRatios.super * pFailGiven.super) +
            (buildRatios.ultra * pFailGiven.ultra) +
            (buildRatios.mega * pFailGiven.mega);

        totalStress += workstationStress;
        workstationCount++;
    }

    const averageStress = workstationCount > 0 ? totalStress / workstationCount : 0;
    return averageStress;
}

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

function calculateQualityStressBreakdown(stDevPercentage, conveyorSpeed, workstationDetails, taktTime, overtimeStress, wageStress, buildRatios) {
    const MAX_CONVEYOR_SPEED = 15;

    if (!isFinite(stDevPercentage) || stDevPercentage < 0) { stDevPercentage = 0; }
    if (!isFinite(conveyorSpeed) || conveyorSpeed < 0) { conveyorSpeed = 10; }
    if (!isFinite(taktTime) || taktTime <= 0) { taktTime = 2.5; }
    overtimeStress = isFinite(overtimeStress) ? Math.max(0, Math.min(1, overtimeStress)) : 0;
    wageStress = isFinite(wageStress) ? Math.max(0, Math.min(1, wageStress)) : 0;

    const workstationStress = calculateWorkstationStress(workstationDetails, taktTime, stDevPercentage, buildRatios);

    let conveyorFatigue = 0;
    const speedStDev = conveyorSpeed * stDevPercentage;
    let z_speed = Infinity;

    if (speedStDev > 0) {
        z_speed = (MAX_CONVEYOR_SPEED - conveyorSpeed) / speedStDev;
        conveyorFatigue = 1 - normalCDF(z_speed);
    } else if (conveyorSpeed > MAX_CONVEYOR_SPEED) {
        conveyorFatigue = 1;
    }

    const overtimeStressFactor = overtimeStress || 0;
    const wageStressFactor = wageStress || 0;

    const breakdown = {
        workstationLoss: 0.4 * workstationStress,
        conveyorLoss: 0.2 * conveyorFatigue,
        overtimeLoss: 0.2 * overtimeStressFactor,
        wageLoss: 0.2 * wageStressFactor
    };

    breakdown.totalStress = breakdown.workstationLoss +
        breakdown.conveyorLoss +
        breakdown.overtimeLoss +
        breakdown.wageLoss;

    breakdown.totalStress = Math.min(1.0, breakdown.totalStress);

    return breakdown;
}

window.calculateQualityStressBreakdown = calculateQualityStressBreakdown;