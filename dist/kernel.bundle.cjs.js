'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

(function (PRIORITY) {
    PRIORITY[PRIORITY["CRITICAL"] = 0] = "CRITICAL";
    PRIORITY[PRIORITY["HIGH"] = 1] = "HIGH";
    PRIORITY[PRIORITY["MEDIUM"] = 2] = "MEDIUM";
    PRIORITY[PRIORITY["LOW"] = 3] = "LOW";
})(exports.PRIORITY || (exports.PRIORITY = {}));
const PRIORITY_COUNT = exports.PRIORITY.LOW + 1;

const DEFAULT_α_MIN = 0.02; // Last 100 ticks have ~85% influence on EMA, aka '100-day EMA'.
const DEFAULT_α_DECAY = 0.8; // Rate at which α decays from 0.5 to alpha_min each tick. Increase if high CPU
// costs when relaunching are negatively impacting CPU estimates later on.
const TASK_COUNT_LIMIT = 2 ** 16; // In anticipation of compact binary serialization.
const DEFAULT_BUCKET_THRESHOLD = 9000; // 90% full
const DEFAULT_SHUTDOWN_CPU_ESTIMATE = 0.5;
const DEFAULT_SIGMA_RANGE = 3; // CPU costs more than 3 std. deviations from their mean (~0.1%) will be logged.
const ROOT_TASK_ID = 0;
const RETURN_CODE_OK = 0;
const RETURN_CODE_ERROR = Symbol('Code Error');
let booting = true;
let raw_memory = RawMemory.get();
delete global.Memory;
if (raw_memory.length === 0) {
    global.Memory = {};
}
else {
    global.Memory = JSON.parse(raw_memory); // TODO: Binary => Base<2^15> serialization
}
const memory = global.Memory;
const kernel = memory.kernel === undefined
    ? memory.kernel = {
        stats: {
            α: 0.5,
            boot_μ: undefined,
            boot_σ2: 0,
            startup_μ: undefined,
            startup_σ2: 0,
            shutdown_μ: undefined,
            shutdown_σ2: 0,
        },
        tasks: {},
        max_task_id: ROOT_TASK_ID,
        unused_ids: [],
    }
    : memory.kernel;
const { stats, unused_ids } = kernel;
const empty_task_ids = new Set(unused_ids);
const queues = [];
const idx = [];
if (queues.length !== PRIORITY_COUNT) {
    for (let i = queues.length; i < PRIORITY_COUNT; i++) {
        queues.push([]);
        idx.push(0);
    }
}
let min_task_priority = exports.PRIORITY.LOW;
let { max_task_id } = kernel; // Removes need to iterate over all task id space.
/**
 * This object holds the factory functions used to initialize the actual functions called by the kernel.
 */
const Task_Factories = {};
/**
 * This object holds the actual functions to be called for each task.
 */
const Task_Functions = {};
/**
 * Optional parameters for advanced kernel configuration:
 *
 * A minimum value for the α parameter of the EMA. Must satisfy 0 < alpha_min < 0.5
 */
const alpha_min = DEFAULT_α_MIN;
/**
 * Decay rate of α per tick from 0.5 to alpha_min. 0 < alpha_decay < 1
 */
const alpha_decay = DEFAULT_α_DECAY;
/**
 * Minimum bucket level for MEDIUM priority tasks to run if they will exceed
 */
const bucket_threshold = DEFAULT_BUCKET_THRESHOLD;
/**
 * Initial CPU estimate for shutdown kernel process.
 */
const shutdown_cpu_estimate = DEFAULT_SHUTDOWN_CPU_ESTIMATE;
/**
 * Acceptable range of CPU performance measured in standard deviations from the mean.
 */
const sigma_range = DEFAULT_SIGMA_RANGE;
var LEVEL;
(function (LEVEL) {
    LEVEL[LEVEL["OFF"] = 0] = "OFF";
    LEVEL[LEVEL["FATAL"] = 1] = "FATAL";
    LEVEL[LEVEL["ERROR"] = 2] = "ERROR";
    LEVEL[LEVEL["WARN"] = 3] = "WARN";
    LEVEL[LEVEL["INFO"] = 4] = "INFO";
    LEVEL[LEVEL["DEBUG"] = 5] = "DEBUG";
    LEVEL[LEVEL["TRACE"] = 6] = "TRACE";
})(LEVEL || (LEVEL = {}));
const logger = {
    /**
     * Minimum logging level.
     */
    level: LEVEL.WARN,
    /**
     * Set this attribute to define a custom logging function.
     */
    fn: ((level, message) => console.log(`[${LEVEL[level]}]`, message))
};
const l = (level) => {
    return (message) => {
        if (level <= logger.level) {
            logger.fn(level, message);
        }
    };
};
const LOG = {
    LEVEL,
    /**
     * Convenience functions for logging.
     */
    FATAL: l(LEVEL.FATAL),
    ERROR: l(LEVEL.ERROR),
    WARN: l(LEVEL.WARN),
    INFO: l(LEVEL.INFO),
    DEBUG: l(LEVEL.DEBUG),
    TRACE: l(LEVEL.TRACE),
};
/**
 * Returns the tasks scheduled to run the next tick.
 *
 * @return {Tasks} - Mapping of Tasks by Task_ID.
 */
const { tasks } = kernel;
/**
 * Returns the ID of the current task.
 *
 * @return {Task_ID} - ID of current task.
 */
exports.current_task = ROOT_TASK_ID;
/**
 * Register the code object to be generate the task function.
 *
 * Note - This function should only be called outside of the main loop, before the kernel is run for the first time.
 * It should also be called before any `create_task` calls that reference this factory.
 *
 * @param {Task_Factory_Key} key - A unique key used to identify which function to call to run the task. Also used as the
 * `task_key` value that needs to be passed to `create_task`.
 * @param {Task_Factory} fn - The function that will be run by the task.
 */
const register_task_factory = ({ key, fn }) => {
    if (Task_Factories[key] !== undefined && Task_Factories[key] !== fn) {
        throw new Error(`Task key used for multiple task factories: ${key}`);
    }
    Task_Factories[key] = fn;
};
/**
 * Create a new task, which will be queued immediately (unless called after the kernel has executed).
 *
 * @param {PRIORITY} priority - Priority level at which the task will be run.
 * @param {number} patience - Number of ticks that task is allowed to 'starve' before being being
 * elevated to the next priority level.
 * @param {number} cost_μ - Estimated CPU cost to run the function. Actual CPU cost will be measured and recorded,
 * but an initial estimate is required. To avoid accidentally hitting cpu.tickLimit, don't underestimate.
 * @param {Task_Factory_Key} task_key - Unique key returned by `register_task_factory` for the function to be called to run the
 * task.
 * @param {Task_Args} task_args - Array of names or ids for game objects that will be passed to the task function.
 * @param {Task_ID} [parent] - ID of parent task, if it is different from the caller.
 * @return {Task_ID} - ID of new task.
 */
const create_task = ({ priority, task_key, task_args, patience, cost_μ, parent, }) => {
    if (parent !== undefined && (tasks[parent] === undefined)) {
        throw new Error(`Invalid parent task ID: ${parent}`);
    }
    let id;
    if (empty_task_ids.size > 0) {
        id = empty_task_ids.values().next().value;
        empty_task_ids.delete(id);
    }
    else if (max_task_id + 1 === TASK_COUNT_LIMIT) {
        throw new Error("Cannot create more tasks. (Also why are you trying to run more than 65535 different tasks?!)");
    }
    else {
        max_task_id++;
        id = max_task_id;
    }
    if (parent === undefined && exports.current_task !== ROOT_TASK_ID) {
        parent = exports.current_task;
    }
    if (parent !== undefined) {
        tasks[parent].children.push(id);
    }
    tasks[id] = {
        id,
        priority,
        patience,
        cost_μ,
        cost_σ2: 0,
        task_key,
        task_args,
        parent,
        children: [],
        α: 0.5,
        skips: 0,
    };
    // Add to queue if this function was called by another, currently-executing task.
    // If current_task is ROOT_TASK_ID, then this function was called before or after the kernel ran, so don't add
    // it to one of the queues as the kernel will do that on its next run.
    if (exports.current_task !== ROOT_TASK_ID) {
        queues[priority].push(id);
        Task_Functions[id] = Task_Factories[task_key](...task_args);
        // Ensure this function gets called even if priority queue was empty.
        if (priority < min_task_priority)
            min_task_priority = priority;
    }
    return id;
};
/**
 * Kill an existing task. If it hasn't yet run this tick, it won't. Also recursively kills child tasks.
 *
 * @param {Task_ID} id - ID of task to kill.
 * @return {Array<Task_ID>} - The IDs of all killed tasks.
 */
const kill_task = (id = exports.current_task) => {
    const task = tasks[id];
    if (task === undefined)
        throw new Error("Invalid task ID");
    const killed = [id,];
    // Remove from parent task's list of children
    if (task.parent !== undefined) {
        const siblings = tasks[task.parent].children;
        const idx = siblings.indexOf(id);
        if (idx !== -1)
            siblings.splice(idx, 1);
    }
    // Make task id available for new tasks
    if (id === max_task_id) {
        max_task_id--;
    }
    else {
        empty_task_ids.add(id);
    }
    // Recursively kill child tasks, iterate backwards to help minimize size of empty_task_IDs
    for (let i = task.children.length - 1; i >= 0; i--) {
        killed.concat(kill_task(task.children[i]));
    }
    // Remove task object from task list
    delete tasks[id];
    delete Task_Functions[id];
    return killed;
};
/**
 * Run the kernel.
 */
const run = () => {
    // Finish booting, if necessary
    let boot_cpu = 0;
    const kernel_α = stats.α;
    if (booting) {
        // Initialize Queues and Task_Functions via Task_Factories
        Object.entries(tasks).forEach((arg) => {
            const task = arg[1];
            Task_Functions[task.id] = Task_Factories[task.task_key](...task.task_args);
            if (task.skips !== 0) {
                queues[Math.max(0, task.priority - Math.floor(task.skips / task.patience))].push(task.id);
            }
            else {
                queues[task.priority].push(task.id);
            }
        });
        boot_cpu = global.kernel_last_boot_cpu = Game.cpu.getUsed();
        const boot_average = stats.boot_μ || boot_cpu;
        const δ = boot_cpu - boot_average;
        stats.boot_μ = boot_average + kernel_α * δ;
        stats.boot_σ2 = (1 - kernel_α) * (stats.boot_σ2 + kernel_α * δ ** 2);
        LOG.DEBUG(`Boot cpu cost: ${boot_cpu}, δ: ${δ}`);
        booting = false;
    }
    delete global.Memory;
    global.Memory = memory;
    const execute = (task, p, index) => {
        const { id, priority } = task;
        // TRACE(`${id} [${idx}]`);
        task.skips = 0; // Update before running to avoid looping if function killed by tickLimit
        if (Task_Functions[id] === undefined) {
            LOG.ERROR(`Task ${id} not initialized`);
            return RETURN_CODE_ERROR;
        }
        if (p !== priority)
            queues[priority].push(queues[p].splice(index, 1)[0]);
        exports.current_task = id;
        let ret = RETURN_CODE_ERROR;
        try {
            ret = Task_Functions[id]();
            if (ret !== RETURN_CODE_OK)
                LOG.ERROR(`Task ${id} returned nonzero exit code: ${ret}`);
        }
        catch (e) {
            LOG.ERROR(`Task ${id} threw ${e.name}: ${e}`);
        }
        exports.current_task = ROOT_TASK_ID;
        return ret;
    };
    const skip = (task, priority, index) => {
        task.skips++;
        if (task.skips % task.patience === 0) {
            queues[priority].splice(index, 1); // Returns id
            queues[priority - 1].push(task.id);
            LOG.INFO(`Elevating task ${task.id}`);
        }
    };
    /**
     * Calculate and update exponential moving average and variance for task CPU cost.
     *
     * @param {number} cpu - CPU cost of task this tick
     * @param {Task} task - Parameters that define task, including stats.
     */
    const update_statistics = (// Defined here because it relies on scope defined inside of `run`.
    cpu, task) => {
        let { id, cost_μ, cost_σ2, α } = task;
        // Straight outta https://en.wikipedia.org/wiki/Moving_average#Exponentially_weighted_moving_variance_and_standard_deviation
        const δ = cpu - cost_μ;
        cost_μ = cost_μ + α * δ;
        cost_σ2 = (1 - α) * (cost_σ2 + α * δ ** 2);
        if (α > alpha_min)
            α = α * alpha_decay; // Update α for next tick.
        // Via https://en.wikipedia.org/wiki/Standard_score
        const σ = δ / Math.sqrt(cost_σ2);
        if (Math.abs(σ) > sigma_range)
            LOG.WARN(`Task ${id} had abnormal CPU cost: ${cpu}`);
        Object.assign(task, { cost_μ, cost_σ2, α }); // Update stats on task object.
    };
    const shutdown_μ = stats.shutdown_μ === undefined ? shutdown_cpu_estimate : stats.shutdown_μ;
    const shutdown_σ2 = stats.shutdown_σ2;
    let startup_cpu;
    let last_cpu;
    last_cpu = Game.cpu.getUsed();
    startup_cpu = global.kernel_last_startup_cpu = last_cpu - boot_cpu;
    /** Run Tasks **/
    idx.fill(0);
    outer: for (let i = 0; i < queues.length; i++) {
        let queue = queues[i];
        // LOG.TRACE(`${PRIORITY[i]} [${queue}]`);
        min_task_priority = i;
        while (idx[i] < queue.length) {
            let j = idx[i];
            let task = tasks[queue[j]];
            if (task === undefined) { // Don't run killed tasks
                queue.splice(j, 1);
                continue;
            }
            let average_cost = task.cost_μ + last_cpu + shutdown_μ;
            // Add 2 sigma to both task & shutdown estimates, should cover 99.95% of cases.
            let max_likely_cost = average_cost + Math.sqrt(task.cost_σ2 * 2) + Math.sqrt(shutdown_σ2 * 2);
            // LOG.TRACE(`CPU: ${Game.cpu.getUsed() - last_cpu}`);
            // LOG.TRACE(`${task.id} [${idx}]`);
            let ret = RETURN_CODE_ERROR;
            switch (i) {
                case exports.PRIORITY.CRITICAL:
                    // Run every tick, regardless of CPU cost.
                    ret = execute(task, i, j);
                    break;
                case exports.PRIORITY.HIGH:
                    // Run only if task is anticipated not to exceed `Game.cpu.tickLimit`.
                    if (max_likely_cost < Game.cpu.tickLimit) {
                        ret = execute(task, i, j);
                    }
                    else {
                        skip(task, i, j);
                    }
                    break;
                case exports.PRIORITY.MEDIUM:
                    // Run if task is anticipated not to exceed `Game.cpu.limit`,
                    // or anticipated not to exceed `Game.cpu.tickLimit` if `Game.cpu.bucket > bucket_threshold`
                    if (average_cost < Game.cpu.limit ||
                        (max_likely_cost < Game.cpu.tickLimit && Game.cpu.bucket > bucket_threshold)) {
                        ret = execute(task, i, j);
                    }
                    else {
                        skip(task, i, j);
                    }
                    break;
                case exports.PRIORITY.LOW:
                    // Run only if task is anticipated not to exceed `Game.cpu.limit`.
                    if (average_cost < Game.cpu.limit) {
                        ret = execute(task, i, j);
                    }
                    else {
                        skip(task, i, j);
                    }
                    break;
            }
            let task_cpu = Game.cpu.getUsed();
            if (ret !== RETURN_CODE_ERROR)
                update_statistics(task_cpu - last_cpu, task);
            last_cpu = task_cpu;
            idx[i]++;
            // Check to see if any additional tasks with 'higher' priority were scheduled.
            if (min_task_priority < i) {
                // 'i' is incremented at end of 'for' loop, after breaking this loop, thus subtract 1 to compensate
                i = min_task_priority - 1;
                continue outer;
            }
        }
    }
    /** Shutdown **/
    exports.current_task = ROOT_TASK_ID;
    // Save kernel state
    if (kernel_α > alpha_min)
        stats.α = kernel_α * alpha_decay;
    const startup_delta = startup_cpu - (stats.startup_μ === undefined ? startup_cpu : stats.startup_μ);
    stats.startup_μ = (stats.startup_μ === undefined ? startup_cpu : stats.startup_μ) + kernel_α * startup_delta;
    stats.startup_σ2 = (1 - kernel_α) * (stats.startup_σ2 + kernel_α * startup_delta ** 2);
    kernel.stats = stats;
    kernel.tasks = tasks;
    kernel.max_task_id = max_task_id;
    kernel.unused_ids = Array.from(empty_task_ids);
    memory.kernel = kernel;
    RawMemory.set(JSON.stringify(memory)); // TODO: Binary => Base<2^15> Serialization
    // Store the final shutdown CPU cost in cache after memory has been serialized.
    // Will occasionally loose 1 tick of data here, an acceptable trade-off for recording serialization costs.
    const shutdown_cpu = global.kernel_last_shutdown_cpu = (global.kernel_last_tick_cpu = Game.cpu.getUsed()) - last_cpu;
    // TRACE(`Shutdown CPU cost: ${shutdown_cpu}`);
    const shutdown_delta = shutdown_cpu - (stats.shutdown_μ === undefined ? shutdown_cpu : stats.shutdown_μ);
    stats.shutdown_μ = (stats.shutdown_μ === undefined ? 0 : stats.shutdown_μ) + kernel_α * shutdown_delta;
    stats.shutdown_σ2 = (1 - kernel_α) * (stats.shutdown_σ2 + kernel_α * shutdown_delta ** 2);
};

exports.alpha_min = alpha_min;
exports.alpha_decay = alpha_decay;
exports.bucket_threshold = bucket_threshold;
exports.shutdown_cpu_estimate = shutdown_cpu_estimate;
exports.sigma_range = sigma_range;
exports.logger = logger;
exports.LOG = LOG;
exports.tasks = tasks;
exports.register_task_factory = register_task_factory;
exports.create_task = create_task;
exports.kill_task = kill_task;
exports.run = run;
exports.default = run;
