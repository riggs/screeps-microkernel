const kernel = require("kernel.bundle.cjs");

global.kernel = kernel;

const fib = (n) => {
  if ( n === 1 || n === 0 ) return 1;
  return fib(n-1) + fib(n-2);
};

const fib_logger = (n, log=false) => () => {
  const f = fib(n);
  if ( log ) {
    console.log(`[${kernel.current_task}] fib(${n}): ${fib(n)}`)
  }
  return 0;
};

const FIB_TASK_KEY = "FIB_TASK_KEY";

kernel.register_task_factory({key: FIB_TASK_KEY, fn: fib_logger});

const SPAWN_TASK_KEY = "SPAWN_TASK_KEY";

const spawn_task = (n) => () => {
  let count = Memory.test[SPAWN_TASK_KEY];
  if ( count === undefined ) count = Memory.test[SPAWN_TASK_KEY] = 0;
  if ( count < n ) {
    const id = kernel.create_task({
      priority: kernel.PRIORITY.HIGH,
      task_key: FIB_TASK_KEY,
      task_args: [10, true],
      patience: 30,
      cost_μ: 1
    });
    console.log(`Spawning task ${n} with id: ${id}`);
    Memory.test[SPAWN_TASK_KEY] = count + 1;
  }
  return 0;
};

kernel.register_task_factory({key: SPAWN_TASK_KEY, fn: spawn_task});

if ( Memory.test === undefined ) {
  Memory.test = {};
  Memory.test[41] = kernel.create_task({
    priority: kernel.PRIORITY.LOW,
    task_key: FIB_TASK_KEY,
    task_args: [41, true],
    patience: 100,
    cost_μ: 2000
  });
  Memory.test[32] = kernel.create_task({
    priority: kernel.PRIORITY.MEDIUM,
    task_key: FIB_TASK_KEY,
    task_args: [32, true],
    patience: 20,
    cost_μ: 50
  });
  Memory.test[24] = kernel.create_task({
    priority: kernel.PRIORITY.HIGH,
    task_key: FIB_TASK_KEY,
    task_args: [24, true],
    patience: 10,
    cost_μ: 2
  });
  Memory.test.spawn_task = kernel.create_task({
    priority: kernel.PRIORITY.LOW,
    task_key: SPAWN_TASK_KEY,
    task_args: [4],
    patience: 15,
    cost_μ: 0.2
  });
}

exports.loop = () => {
  kernel.run({bucket_threshold: 100});
};