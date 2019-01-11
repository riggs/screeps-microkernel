
import {
    Task_Function,
    PRIORITY,
    Task_ID,
    Task,
    Task_Key,
    Kernel_Data,
    Tasks,
} from "./data_structures";

const DEFAULT_α_MIN = 0.02; // Last 100 ticks have ~85% influence on EMA, aka '100-day EMA'.
const DEFAULT_α_DECAY = 0.8; // Rate at which α decays from 0.5 to alpha_min each tick. Increase if high CPU
// costs when relaunching are negatively impacting CPU estimates later on.
const TASK_COUNT_LIMIT = 2**16;   // In anticipation of compact binary serialization.
const DEFAULT_BUCKET_THRESHOLD = 9000;  // 90% full
const DEFAULT_SHUTDOWN_CPU_ESTIMATE = 0.5;
const DEFAULT_SIGMA_RANGE = 3;  // CPU costs more than 3 std. deviations from their mean (~0.1%) will be logged.
const ROOT_TASK_ID = 0;
const RETURN_CODE_OK = 0;
const RETURN_CODE_ERROR = Symbol('Code Error');

// tasks, queues, current_task, max_task_id, & empty_task_IDs need to be available to create/kill_tasks and kernel core.
const PRIORITY_COUNT = PRIORITY.LOW + 1;
let i, j;
let raw_memory = RawMemory.get();
delete global.Memory;
if ( raw_memory.length === 0 ) {
    global.Memory = {};
} else {
    global.Memory = JSON.parse(RawMemory.get()) as Memory; // TODO: Binary => Base<2^15> serialization
}
const memory = global.Memory;
const kernel: Kernel_Data = memory.kernel === undefined
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
        queues: [],
        max_task_id: ROOT_TASK_ID,
        empty_task_ids: new Set<Task_ID>(),
    }
    : memory.kernel;
const { stats, queues, empty_task_ids } = kernel;

if ( queues.length !== PRIORITY_COUNT ) {
    for ( i = queues.length; i < PRIORITY_COUNT; i++ ) {
        queues.push([]);
    }
}

let { max_task_id } = kernel;   // Removes need to iterate over all task id space.

let reload = true;

export type Logger = (level: LOG_LEVEL, message: string) => void;

const logger_factory = (log_level: LOG_LEVEL, logger: Logger) => {
    const _ = (level: LOG_LEVEL) => {
        return (message: string) => {
            if ( level >= log_level ) {
                logger(level, message);
            }
        }
    };
    return {
        FATAL: _(LOG_LEVEL.FATAL),
        ERROR: _(LOG_LEVEL.ERROR),
        WARN: _(LOG_LEVEL.WARN),
        INFO: _(LOG_LEVEL.INFO),
        DEBUG: _(LOG_LEVEL.DEBUG),
        TRACE: _(LOG_LEVEL.TRACE),
    }
};

const Task_Functions: Record<Task_Key, Task_Function> = {};

/***********
 * Exports *
 ***********/
export { PRIORITY, Task_ID } from "./data_structures";

export enum LOG_LEVEL {
    OFF = 0,
    FATAL,
    ERROR,
    WARN,
    INFO,
    DEBUG,
    TRACE
}

/**
 * Returns the tasks scheduled to run the next tick.
 *
 * @return {Tasks} - Mapping of Tasks by Task_ID.
 */
export const { tasks } = kernel;

/**
 * Returns the ID of the current task.
 *
 * @return {Task_ID} - ID of current task.
 */
export let current_task: number = ROOT_TASK_ID;

/**
 * Register the code object to be run as part of a task. This function should only be called outside of the main
 * loop, before the kernel is run for the first time.
 *
 * @param {Task_Key} key - A unique key used to identify which function to call to run the task. Also used as the
 * `task_key` value that needs to be passed to `create_task`.
 * @param {Task_Function} fn - The function that will be run by the task.
 */
export const register_task_function = ({key, fn}: {key: Task_Key, fn: Task_Function}) => {
    if ( Task_Functions[key] !== undefined && Task_Functions[key] !== fn ) {
        throw new Error(`Task key used for multiple task functions: ${key}`)
    }
    Task_Functions[key] = fn;
};

/**
 * Create a new task, which will be queued immediately.
 *
 * @param {PRIORITY} priority - Priority level at which the task will be run.
 * @param {number} patience - Number of ticks that task is allowed to 'starve' before being being
 * elevated to the next priority level.
 * @param {number} cost_μ - Estimated CPU cost to run the function. Actual CPU cost will be measured and recorded,
 * but an initial estimate is required. To avoid accidentally hitting cpu.tickLimit, don't underestimate.
 * @param {Task_Key} task_key - Unique key returned by `register_task_function` for the function to be called to run the
 * task.
 * @param {Task_Args} task_args - Array of names or ids for game objects that will be passed to the task function.
 * @param {Task_ID} [parent] - ID of parent task, if it is different from the caller.
 * @return {Task_ID} - ID of new task.
 */
export const create_task = (
    { priority, task_key, task_args, patience, cost_μ, parent, }:
        Pick<Task, | "priority" | "task_key" | "task_args" | "patience" | "cost_μ" | "parent" >
): Task_ID => {
    if ( parent !== undefined && ( tasks[parent] === undefined || tasks[parent].alive === false )) {
        throw new Error(`Invalid parent task ID: ${parent}`);
    }
    let id: number;
    if ( empty_task_ids.size > 0 ) {
        id = empty_task_ids.values().next().value;
        empty_task_ids.delete(id);
    } else if ( max_task_id + 1 === TASK_COUNT_LIMIT ) {
        throw new Error("Cannot create more tasks. (Also why are you trying to run more than 65535 different tasks?!)")
    } else {
        max_task_id++;
        id = max_task_id;
    }

    if ( parent === undefined && current_task !== ROOT_TASK_ID ) {
        parent = current_task;
    }
    if ( parent !== undefined ) {
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
        alive: true,
    };

    // FIXME: Add task to queue

    return id;
};

/**
 * Kill an existing task. If it hasn't yet run this tick, it won't. Also recursively kills child tasks.
 *
 * @param {Task_ID} id - ID of task to kill.
 * @return {Array<Task_ID>} - The IDs of all killed tasks.
 */
export const kill_task = (id: Task_ID = current_task): Array<Task_ID> => {
    const task = tasks[id];
    if ( task === undefined ) throw new Error("Invalid task ID");
    const killed = [id,];
    task.alive = false;
    // Remove from parent task's list of children
    if ( task.parent !== undefined ) {
        const siblings = tasks[task.parent].children;
        const idx = siblings.indexOf(id);
        if ( idx !== -1 ) siblings.splice(idx, 1);
    }

    // Make task id available for new tasks
    if ( id === max_task_id ) {
        max_task_id--;
    } else {
        empty_task_ids.add(id);
    }

    // Recursively kill child tasks, iterate backwards to help minimize size of empty_task_IDs
    for ( i = task.children.length - 1; i >= 0; i--) {
        killed.concat(kill_task(task.children[i]));
    }

    return killed;
};

/**
 * This function is called when CPU performance is outside of acceptable parameters.
 *
 * @callback logger_callback
 * @param {LOG_LEVEL} level - Log level.
 * @param {string} message - Message to log.
 */

/**
 * Run the kernel.
 *
 * Optional parameters for advanced configuration:
 * @param {number} [alpha_min] - A minimum value for the α parameter of the EMA. Must satisfy 0 < alpha_min < 0.5
 * @param {number} [alpha_decay] - Decay rate of α per tick from 0.5 to alpha_min. 0 < alpha_decay < 1
 * @param {number} [bucket_threshold] - Minimum bucket level for MEDIUM priority tasks to run if they will exceed
 * Game.cpu.limit
 * @param {number} [shutdown_cpu_estimate] - Initial CPU estimate for shutdown kernel process.
 * @param {number} [sigma_range] - Acceptable range of CPU performance measured in standard deviations from the mean.
 * @param {LOG_LEVEL} [log_level] - Minimum logging level.
 * @param {logger_callback} [logger] - Function that is called for logging.
 */
export const run = ({ alpha_min, alpha_decay, bucket_threshold, shutdown_cpu_estimate, sigma_range, log_level, logger } = {
    alpha_min: DEFAULT_α_MIN,
    alpha_decay: DEFAULT_α_DECAY,
    bucket_threshold: DEFAULT_BUCKET_THRESHOLD,
    shutdown_cpu_estimate: DEFAULT_SHUTDOWN_CPU_ESTIMATE,
    sigma_range: DEFAULT_SIGMA_RANGE,
    log_level: LOG_LEVEL.WARN,
    logger: ((level, message) => console.log(`[${LOG_LEVEL[level]}]`, message)) as Logger,
}) => {
    let boot_cpu = 0;
    if ( reload ) boot_cpu = global.kernel_last_boot_cpu = Game.cpu.getUsed();
    /** Startup **/
    // Input Validation
    if ( !( alpha_min > 0 || alpha_min < 0.5 ) ) throw new Error("Invalid alpha_min parameter");
    if ( !( alpha_decay > 0 || alpha_decay < 1 ) ) throw new Error("Invalid alpha_decay parameter");
    if ( !( bucket_threshold > 0 || bucket_threshold < 10000 ) ) throw new Error("Invalid bucket_threshold parameter");

    delete global.Memory;
    global.Memory = memory;

    const {
        FATAL,
        ERROR,
        WARN,
        INFO,
        DEBUG,
        TRACE,  // On it's own line so I can easily remove every trace of TRACE.
    } = logger_factory(log_level, logger);

    // Update skips, elevate tasks as appropriate.
    for ( i = 1; i < queues.length ; i++ ) {    // Skip CRITICAL queue since it can't be elevated
        const queue = queues[i];
        for ( j = 0; j < queue.length; j++ ) {
            const id = queue[j];
            const task = tasks[id];
            task.skips++;
            if ( task.skips % task.patience === 0) {
                queue.splice(j, 1); // Returns id
                queues[i - 1].push(id);
                INFO(`Elevating task ${id}`);
            }
        }
    }

    // Populate queues based on tasks
    for ( i = 1; i <= max_task_id; i++ ) {
        let task = tasks[i];
        if ( task === undefined || task.alive === false ) {
            empty_task_ids.add(i);
            continue;
        }
        if ( task.skips !== 0 ) continue;   // Already in queue somewhere.
        let { priority } = task;
        queues[priority].push(i);
    }

    /**
     * Calculate and update exponential moving average and variance for task CPU cost.
     *
     * @param {number} cpu - CPU cost of task this tick
     * @param {Task} task - Parameters that define task, including stats.
     */
    const update_statistics = ( // Defined here because it relies on scope defined inside of `run`.
        cpu: number,
        task: Task,
    ) => {
        let { id, cost_μ, cost_σ2, α } = task;
        // Straight outta https://en.wikipedia.org/wiki/Moving_average#Exponentially_weighted_moving_variance_and_standard_deviation
        const δ = cpu - cost_μ;
        cost_μ = cost_μ + α * δ;
        cost_σ2 = ( 1 - α ) * ( cost_σ2 + α * δ ** 2 );
        if ( α > alpha_min ) α = α * alpha_decay;  // Update α for next tick.
        // Via https://en.wikipedia.org/wiki/Standard_score
        const σ = δ / Math.sqrt(cost_σ2);
        if ( Math.abs(σ) > sigma_range ) WARN(`Task ${id} had abnormal CPU cost: ${cpu}`);
        Object.assign(task, { cost_μ, cost_σ2, α }); // Update stats on task object.
    };

    const execute = (task: Task): number | symbol => {
        task.skips = 0;  // Update before running to avoid looping if function killed by tickLimit
        const { id, task_key, task_args } = task;
        current_task = id;
        if ( Task_Functions[task_key] === undefined ) {
            ERROR(`Unknown task function for key: ${task_key}`);
            return RETURN_CODE_ERROR
        }
        let ret: symbol | number = RETURN_CODE_ERROR;
        try {
            ret = Task_Functions[task_key](...task_args);
            if ( ret !== RETURN_CODE_OK ) ERROR(`Task ${task.id} returned nonzero exit code: ${ret}`);
        } catch ( e ) {
            ERROR(`Task ${task.id} threw ${e.name}: ${e}`);
        }
        current_task = ROOT_TASK_ID;
        return ret
    };

    const shutdown_μ = stats.shutdown_μ === undefined ? shutdown_cpu_estimate : stats.shutdown_μ;
    const shutdown_σ2 = stats.shutdown_σ2;
    const kernel_α = stats.α;
    let startup_cpu;
    let last_cpu;
    if ( reload ) {
        const boot_average = stats.boot_μ || boot_cpu;
        const δ = boot_cpu - boot_average;
        stats.boot_μ = boot_average + kernel_α * δ;
        stats.boot_σ2 = ( 1 - kernel_α ) * ( stats.boot_σ2 + kernel_α * δ ** 2 );
        DEBUG(`Boot cpu cost: ${boot_cpu}, δ: ${δ}`);
        reload = false;
    }
    last_cpu = Game.cpu.getUsed();
    startup_cpu = global.kernel_last_startup_cpu = last_cpu - boot_cpu;

    /** Run Tasks **/
    execute_tasks: {
        let strikes = 0;
        // FIXME: Re-iterate from the top after every task to catch any newly-added tasks at higher priorities
        for ( i = 0; i < queues.length; i++ ) { // Don't use for...of because `i` is needed below.
            let queue = queues[i];
            while ( queue.length > 0 ) {
                if ( strikes > 2 ) break execute_tasks; // After 3 scheduling fails, stop trying
                let task = tasks[queue[0]];
                if ( task.alive === false ) {   // Don't run killed tasks
                    queue.shift();
                    continue;
                }
                let average_cost = task.cost_μ + last_cpu + shutdown_μ;
                // Add 2 sigma to both task & shutdown estimates, should cover 99.95% of cases.
                let max_likely_cost = average_cost + Math.sqrt(task.cost_σ2 * 2) + Math.sqrt(shutdown_σ2 * 2);
                let ret: symbol | number = RETURN_CODE_ERROR;
                switch ( i ) {
                    case PRIORITY.CRITICAL:
                        // Run every tick, regardless of CPU cost.
                        ret = execute(task);
                        queue.shift();  // Remove task id from queue
                        break;
                    case PRIORITY.HIGH:
                        // Run only if task is anticipated not to exceed `Game.cpu.tickLimit`.
                        if ( max_likely_cost < Game.cpu.tickLimit ) {
                            ret = execute(task);
                            queue.shift();  // Remove task id from queue
                        } else {
                            strikes++;
                            queue.push(queue.shift()!);  // Move task id to back of queue
                            continue;
                        }
                        break;
                    case PRIORITY.MEDIUM:
                        // Run if task is anticipated not to exceed `Game.cpu.limit`,
                        // or anticipated not to exceed `Game.cpu.tickLimit` if `Game.cpu.bucket > bucket_threshold`
                        if ( average_cost < Game.cpu.limit ||
                             ( max_likely_cost < Game.cpu.tickLimit && Game.cpu.bucket > bucket_threshold )
                        ) {
                            ret = execute(task);
                            queue.shift();  // Remove task id from queue
                        } else {
                            strikes++;
                            queue.push(queue.shift()!);  // Move task id to back of queue
                            continue;
                        }
                        break;
                    case PRIORITY.LOW:
                        // Run only if task is anticipated not to exceed `Game.cpu.limit`.
                        if ( average_cost < Game.cpu.limit ) {
                            ret = execute(task);
                            queue.shift();  // Remove task id from queue
                        } else {
                            strikes++;
                            queue.push(queue.shift()!);  // Move task id to back of queue
                            continue;
                        }
                        break;
                }
                let task_cpu = Game.cpu.getUsed();
                if ( ret !== RETURN_CODE_ERROR) update_statistics(task_cpu - last_cpu, task);
                last_cpu = task_cpu;
            }
        }
    }

    /** Shutdown **/
    current_task = ROOT_TASK_ID;
    // Save kernel state
    if ( kernel_α > alpha_min ) stats.α = kernel_α * alpha_decay;
    const startup_delta = startup_cpu - ( stats.startup_μ === undefined ? startup_cpu : stats.startup_μ );
    stats.startup_μ = ( stats.startup_μ === undefined ? startup_cpu : stats.startup_μ ) + kernel_α * startup_delta;
    stats.startup_σ2 = ( 1 - kernel_α ) * ( stats.startup_σ2 + kernel_α * startup_delta ** 2 );
    kernel.stats = stats;
    kernel.queues = queues;
    kernel.tasks = tasks;
    kernel.max_task_id = max_task_id;
    kernel.empty_task_ids = empty_task_ids;
    memory.kernel = kernel;

    RawMemory.set(JSON.stringify(memory));  // TODO: Binary => Base<2^15> Serialization
    // Store the final shutdown CPU cost in cache after memory has been serialized.
    // Will occasionally loose 1 tick of data here, an acceptable trade-off for recording serialization costs.
    const shutdown_cpu = global.kernel_last_shutdown_cpu = ( global.kernel_last_tick_cpu = Game.cpu.getUsed() ) - last_cpu;
    DEBUG(`Shutdown CPU cost: ${shutdown_cpu}`);
    const shutdown_delta = shutdown_cpu - ( stats.shutdown_μ === undefined ? shutdown_cpu : stats.shutdown_μ );
    stats.shutdown_μ = ( stats.shutdown_μ === undefined ? 0 : stats.shutdown_μ ) + kernel_α * shutdown_delta;
    stats.shutdown_σ2 = ( 1 - kernel_α ) * ( stats.shutdown_σ2 + kernel_α * shutdown_delta ** 2 );
};

/***********
 * Default *
 ***********/
export default run;
