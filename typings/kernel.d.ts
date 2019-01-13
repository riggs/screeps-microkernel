import { Task_Factory, Task } from "./data_structures";
/***************************
 ********* Exports *********
 ***************************/
export { PRIORITY, Task_ID } from "./data_structures";
/**
 * Optional parameters for advanced kernel configuration:
 *
 * A minimum value for the α parameter of the EMA. Must satisfy 0 < alpha_min < 0.5
 */
export declare const alpha_min = 0.02;
/**
 * Decay rate of α per tick from 0.5 to alpha_min. 0 < alpha_decay < 1
 */
export declare const alpha_decay = 0.8;
/**
 * Minimum bucket level for MEDIUM priority tasks to run if they will exceed
 */
export declare const bucket_threshold = 9000;
/**
 * Initial CPU estimate for shutdown kernel process.
 */
export declare const shutdown_cpu_estimate = 0.5;
/**
 * Acceptable range of CPU performance measured in standard deviations from the mean.
 */
export declare const sigma_range = 3;
declare enum LEVEL {
    OFF = 0,
    FATAL = 1,
    ERROR = 2,
    WARN = 3,
    INFO = 4,
    DEBUG = 5,
    TRACE = 6
}
/**
 * This function is called for logging.
 *
 * @param {LOG.LEVEL} level - Log level.
 * @param {string} message - Message to log.
 */
export declare type Logger = (level: LEVEL, message: string) => void;
export declare const logger: {
    /**
     * Minimum logging level.
     */
    level: LEVEL;
    /**
     * Set this attribute to define a custom logging function.
     */
    fn: Logger;
};
export declare const LOG: {
    LEVEL: typeof LEVEL;
    /**
     * Convenience functions for logging.
     */
    FATAL: (message: string) => void;
    ERROR: (message: string) => void;
    WARN: (message: string) => void;
    INFO: (message: string) => void;
    DEBUG: (message: string) => void;
    TRACE: (message: string) => void;
};
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
 * Register the code object to be generate the task function.
 *
 * Note - This function should only be called outside of the main loop, before the kernel is run for the first time.
 * It should also be called before any `create_task` calls that reference this factory.
 *
 * @param {Task_Factory_Key} key - A unique key used to identify which function to call to run the task. Also used as the
 * `task_key` value that needs to be passed to `create_task`.
 * @param {Task_Factory} fn - The function that will be run by the task.
 */
export declare const register_task_factory: ({ key, fn }: {
    key: string;
    fn: Task_Factory;
}) => void;
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
export declare const create_task: ({ priority, task_key, task_args, patience, cost_μ, parent, }: Pick<Task, "priority" | "task_key" | "task_args" | "patience" | "cost_μ" | "parent">) => number;
/**
 * Kill an existing task. If it hasn't yet run this tick, it won't. Also recursively kills child tasks.
 *
 * @param {Task_ID} id - ID of task to kill.
 * @return {Array<Task_ID>} - The IDs of all killed tasks.
 */
export declare const kill_task: (id?: number) => number[];
/**
 * Run the kernel.
 */
export declare const run: () => void;
/***********
 * Default *
 ***********/
export default run;
//# sourceMappingURL=kernel.d.ts.map