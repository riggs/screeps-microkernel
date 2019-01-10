
export enum PRIORITY {
    CRITICAL = 0,
    HIGH,
    MEDIUM,
    LOW,
}

export type Object_ID = string | number;

export type Task_Args = Array<Object_ID>;

export type Task_Function = (...args: Task_Args) => number;

export type Task_Key = string;

export type Task_ID = number;

export type Task = {
    id: Task_ID,
    priority: PRIORITY,
    task_key: Task_Key,
    patience: number,
    cost_μ: number,
    cost_σ2: number,
    task_args: Task_Args,
    parent?: Task_ID,
    children: Array<Task_ID>,
    α: number,
    skips: number,
    alive: boolean,
};

export type Tasks = Record<Task_ID, Task>;

/**
 * Multilevel Priority Queues. Each Queue corresponds to a PRIORITY level. Lower priorities are run first.
 *
 * If tasks are left unfinished in a given tick, they may be bumped to a lower priority Queue.
 */
export type Queues = Array<Array<Task_ID>>;

export interface Kernel_Stats {
    α: number;
    boot_μ: number | undefined;
    boot_σ2: number;
    startup_μ: number | undefined;
    startup_σ2: number;
    shutdown_μ: number | undefined;
    shutdown_σ2: number;
}

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
            kernel_last_startup_cpu: number;
            kernel_last_shutdown_cpu: number;
            kernel_last_boot_cpu: number;
            kernel_last_tick_cpu: number;
        }
    }
    type _ = typeof _
}
