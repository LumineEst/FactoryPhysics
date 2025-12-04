# Factory Flow to Fortune: Mixed-Model Assembly Line Simulation

A browser-based simulation designed to model, optimize, and analyze a mixed-model refrigerator assembly line. Unlike static calculators, this application integrates factory physics, capacity planning, financial forecasting, and geospatial logistics optimization into a single interactive dashboard.  It is both a powerful educational and decision-making tool for how to design a mixed-model assembly line.

[![▶ Watch the Overview Video](https://img.youtube.com/vi/hzbBAcDX-VM/hqdefault.jpg)](https://youtu.be/hzbBAcDX-VM)


## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Algorithms & Mathematical Models](#-algorithms--mathematical-models)
- [Technical Architecture](#-technical-architecture)
- [Getting Started](#-getting-started)
- [Project Structure](#-project-structure)
- [Dependencies](#-dependencies)

## 📖 Overview

**Factory Flow to Fortune** challenges users to design an assembly line for three distinct refrigerator models (Super, Ultra, Mega) with a fixed production ratio (35%/45%/20%). The objective is to maximize profitablity while navigating strictly enforced engineering constraints.

The system simulates the friction of real-world manufacturing:
* **Task-Times:** Assembly is based on 31 atomic elements with defined task-times, and order constraints.
* **Quality:** Yield is not a static input but a dynamic outcome of worker stress, conveyor speed, and wage competitiveness.
* **Logistics:** Shipping costs fluctuate based on the Producer Price Index (PPI) and real-world geography.

## 🚀 Key Features

### 1. Operational Balancing (Efficiency Tab)
* **Visual Line Balancing:** Interactive drag-and-drop interface to assign tasks across 3–13 workstations.
* **Real-Time Metrics:** Instantly calculates Cycle Time, Balance Delay, and Idle Time CV (Coefficient of Variation) to diagnose line health.
* **Bottleneck Detection:** Visualizes workstation utilization to identify capacity constraints.
  
*Note:* Idle-Time will always exist due to delays between the start/end of production, and when a model reaches the workstation. 

### 2. Physical Simulation (Layout & Schedule Tabs)
* **U-Shaped Layout:** An animated SVG visualization of product flow, demonstrating the physical movement of units and identifying spacing issues.
* **Build Sequencing:** The optimal build sequence to smooth labor between variations in models, tracking accumulation of WIP (Work-In-Progress).
* **Gantt Scheduling:** A discrete-event timeline tracks every unit's start and end time, visualizing cascading delays caused by variability.

*Note:* Advanced Controls for Schedule can be shown by clicking the ! button on the bottom right. 

### 3. Financial & Investment Analysis (Profit & Investment Tabs)
* **Profit Maximization:** Performs a search across demand levels (50–552 units) to find the optimal configuration (Headcount & Operational Hours).
* **CapEx Modeling:** Calculates NPV, IRR, and Payback Period using MACRS depreciation schedules for both new and expanding assembly lines.
* **Probabilistic Forecasting:** Uses P10/P50/P90 demand scenarios to assess investment risk under uncertainty.

*Note:* Working Days per Year are allocated with a Calendar which can be accessed in the menu, impacting the Annual Demand levels. 

### 4. Logistics Optimization (Location Tab)
* **Facility Location:** Solves for the optimal US geographic location to minimize freight costs based on customer demand clusters.
* **Inventory Simulation:** Runs a daily inventory simulation to balance holding costs against shipping frequency.
* **Annual Production Schedule:** Finds an optimal build schedule which meets customer demands while minimizing operational costs.

*Note:* Inventory Simulations can be accessed with a popup ribbon on the bottom. 

## 🧮 Algorithms & Mathematical Models

This project implements several advanced industrial engineering algorithms to drive the simulation:

### Production & Sequencing
* **BIRW (Backpropagating Iterative Ranked Weights):** A custom line-balancing algorithm. It performs a forward propagation using Ranked Positional Weights to establish a baseline, then iteratively back-propagates using standard deviation ratios to find the task assignment with the lowest idle time variance.
* **MSSA (Model-Mix Sequencing Algorithm):** Implements Heijunka (production leveling) logic. It calculates an interval `w` for each model and uses an accumulator `a` to sequence production (e.g., A-B-A-C), ensuring smooth demand on upstream components.

### Optimization & Logistics
* **Weiszfeld Algorithm:** Used in the "Greenfield" location analysis to iteratively solve the **Weber Problem**, finding the geometric median that minimizes weighted distances to all distribution hubs.
* **MILP (Mixed Integer Linear Programming):** Utilizes the `highs.js` solver to optimize the shipment start-day schedule, minimizing peak daily loads subject to frequency constraints.
* **Non-Linear LTL Costing:** Calculates Less-Than-Truckload (LTL) shipping rates using a density-based formula derived from the Producer Price Index (PPI) and shipment weight/distance.

### Quality & Stress Modeling
First Pass Yield (FPY) is calculated by subtracting penalties from four distinct stress vectors:
1.  **Process Stress:** Probability of task overruns calculated using CV and available slack time between models based on MSSA Bayesian probabilities.
2.  **Conveyor Stress:** Penalizes yield as conveyor speed approaches human reaction limits (derated by task variability).
3.  **Wage Stress:** Compares the user-set labor rate against the **Median Household Income** of the facility's specific census block (via API) to model workforce quality.
4.  **Fatigue (Sigmoid):** Applies a logistic function to penalize quality drastically once overtime exceeds a specific "burnout" threshold (~20%).

## 🏗 Technical Architecture

Built as a high-performance Single Page Application (SPA) utilizing modern browser capabilities:

* **Visualization:** **D3.js (v7)** handles all data-driven SVG rendering (Gantt charts, Maps, Gauges).
* **Web Workers:** Heavy computational tasks (MILP solver, Inventory Simulation) run on background threads (`simulation.worker.js`) to ensure UI responsiveness.
* **WebAssembly (WASM):** Integrates the **HiGHS** optimization solver via WASM for near-native performance on linear programming tasks.
* **Geography:** **TopoJSON** renders the US map for the location analysis.

## ⚡ Getting Started

The website can be directly accessed at https://dataviscourse2025.github.io/final-project-factoryflow/
An overview video introducing the Project is embedded within the top of the Overview Tab.

*Note:* Due to the use of ES Modules and Web Workers, this project requires a local web server. It cannot be run directly from the file system.

### Prerequisites
* Python (pre-installed on macOS/Linux) OR Node.js.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/yourusername/factory-flow.git](https://github.com/yourusername/factory-flow.git)
    cd factory-flow
    ```

2. **Start a Local Server:**

* **Using Python 3:**
    ```bash
    python -m http.server 8000
    ```

* **Using Node (http-server):**
    ```bash
    npx http-server .
    ```

3.  **Open in Browser:**
    Navigate to `http://localhost:8000`.

## 📂 Project Structure

```text
/
├── Data/
│   ├── CONFIGS.csv             # Pre-computed BIRW Workstation Assignments
│   ├── PERT.csv                # Task times, Precedence, and Model Requirements
│   └── PPI.csv                 # Historical Producer Price Index data
├── libs/
│   ├── highs.js                # JS Interface for the optimization solver
│   └── highs.wasm              # Compiled WASM binary for MILP solving
├── Pages/
│   ├── backend.html            # Detailed documentation of algorithms & math
│   ├── intro.mp4               # Short Video Introducing Website on Overview Tab
│   ├── investmentInputs.html   # DOM user inputs for the Investment Tab
│   ├── overview.html           # Main dashboard UI
│   ├── ProcessBook             # Development Documentation viewable on Overview Tab
│   ├── readme_viewer.html      # Processes README.md into HTML page viewed on Overview Tab
│   └── VidThumb.jpg            # Image of Website for Video Thumbnail
├── Tabs/
│   ├── Efficiency.js           # Line balancing and utilization logic
│   ├── Investment.js           # NPV, IRR, and Cash Flow calculations
│   ├── Layout.js               # Physical U-line animation logic
│   ├── Location.js             # Shipping and Inventory Optimization
│   ├── Precedence.js           # Force-directed network graph (PERT)
│   ├── Profit.js               # Gross Profit maximization search
│   └── Schedule.js             # Moving Gantt Chart for Daily Production
├── index.html                  # Application entry point
├── QualityYield.js             # Stress factor and yield calculations
├── README.md                   # Markdown Documentation for Website
├── script.js                   # Primary script to manage tabs and calculations
├── style.css                   # Css Stylesheet across all tabs
└── simulation.worker.js        # Background thread for inventory simulations

```
## 👨‍💻 Developers

This project was designed and developed for CS 6630 (Visualization for Data Science), taught by Paul Rosen, Ph.D - Associate Professor, University of Utah.

The Project Team was:
- **Joel Wood** - MS in Engineering Management (MEM), University of Utah
- **Dhruv Ram** - MS in Computing (Graphics and Visualization Track), University of Utah
- **Sumaiya Azad** - MS in Computing (Database Management and Analysis Track), University of Utah

The core premise of this website is an extension of content provided for the Final Project of ME-EN 6182 (Design of Production and Service Systems).  
This is used with the expressed permission of Pedro Huebner Ph.D. - Associate Professor and Director of Systems Engineering Programs, University of Utah.  
For additional details on data shown, consult Pages/backend.html which introduces base constraints, algorithms, and calculations used to derive results.  

📫 For questions or collaboration inquiries, feel free to reach out!

---

