/// <reference types="lodash" />
export interface Kernel_Stats {
    alpha: number;
    boot_average: number | undefined;
    boot_variance: number;
    startup_average: number | undefined;
    startup_variance: number;
    shutdown_average: number | undefined;
    shutdown_variance: number;
}
export declare const enum PRIORITY {
    CRITICAL = 0,
    HIGH = 1,
    MEDIUM = 2,
    LOW = 3,
    IGNORED = 4
}
export declare const enum RETURN_CODE {
    OK = 0
}
export declare type Object_ID = string | number;
export declare type Task_Args = Array<Object_ID>;
export declare type Task = (...args: Task_Args) => number;
export declare type Task_Key = string;
export declare type Task_ID = number;
export declare type Task_Parameters = {
    id: Task_ID;
    priority: PRIORITY;
    task_key: Task_Key;
    starvation_threshold: number;
    cost_average: number;
    cost_variance: number;
    task_args: Task_Args;
    parent?: Task_ID;
    children: Array<Task_ID>;
    alpha: number;
    starvation_count: number;
    alive: boolean;
};
export declare type Tasks = Record<Task_ID, Task_Parameters>;
/**
 * Multilevel Priority Queues. Each Queue corresponds to a PRIORITY level. Lower priorities are run first.
 *
 * If tasks are left unfinished in a given tick, they may be bumped to a lower priority Queue.
 */
export declare type Queues = Array<Array<Task_ID>>;
export interface Kernel_Data {
    stats: Kernel_Stats;
    tasks: Tasks;
    queues: Queues;
    max_task_id: number;
    empty_task_ids: Set<Task_ID>;
}
declare global {
    interface Memory {
        kernel?: Kernel_Data;
    }
    namespace NodeJS {
        interface Global {
            Memory: Memory;
        }
    }
    type _ = typeof _;
}
//# sourceMappingURL=data_structures.d.ts.map