import { Task_Function, Task } from "./data_structures";
export declare type Logger = (level: LOG_LEVEL, message: string) => void;
/***********
 * Exports *
 ***********/
export { PRIORITY, Task_ID } from "./data_structures";
export declare enum LOG_LEVEL {
    OFF = 0,
    FATAL = 1,
    ERROR = 2,
    WARN = 3,
    INFO = 4,
    DEBUG = 5,
    TRACE = 6
}
/**
 * Returns the tasks scheduled to run the next tick.
 *
 * @return {Tasks} - Mapping of Tasks by Task_ID.
 */
export declare const tasks: Record<number, Task>;
/**
 * Returns the ID of the current task.
 *
 * @return {Task_ID} - ID of current task.
 */
export declare let current_task: number;
/**
 * Register the code object to be run as part of a task. This function should only be called outside of the main
 * loop, before the kernel is run for the first time.
 *
 * @param {Task_Key} key - A unique key used to identify which function to call to run the task. Also used as the
 * `task_key` value that needs to be passed to `create_task`.
 * @param {Task_Function} fn - The function that will be run by the task.
 */
export declare const register_task_function: ({ key, fn }: {
    key: string;
    fn: Task_Function;
}) => void;
/**
 * Create a new task, which will be queued immediately (unless called after the kernel has executed).
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
export declare const create_task: ({ priority, task_key, task_args, patience, cost_μ, parent, }: Pick<Task, "priority" | "task_key" | "task_args" | "patience" | "cost_μ" | "parent">) => number;
/**
 * Kill an existing task. If it hasn't yet run this tick, it won't. Also recursively kills child tasks.
 *
 * @param {Task_ID} id - ID of task to kill.
 * @return {Array<Task_ID>} - The IDs of all killed tasks.
 */
export declare const kill_task: (id?: number) => number[];
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
export declare const run: ({ alpha_min, alpha_decay, bucket_threshold, shutdown_cpu_estimate, sigma_range, log_level, logger }: {
    alpha_min?: number | undefined;
    alpha_decay?: number | undefined;
    bucket_threshold?: number | undefined;
    shutdown_cpu_estimate?: number | undefined;
    sigma_range?: number | undefined;
    log_level?: LOG_LEVEL | undefined;
    logger?: Logger | undefined;
}) => void;
/***********
 * Default *
 ***********/
export default run;
//# sourceMappingURL=kernel.d.ts.map