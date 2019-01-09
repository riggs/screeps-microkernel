# Best Damn Screeps Microkernel

An opinionated microkernel for [Screeps](http://screeps.com) that schedules tasks and monitors CPU usage.

`npm install screeps-microkernel --save`

Be sure to `import * as kernel from 'screeps-microkernel';` / `let kernel = require('screeps-microkernel')` the package at the top of your `main.js` 
 (before any other `import`/`require`s) for best performance. Also be sure to call `kernel.run(...)` / `kernel(...)` 
 at the start of your main loop.

## Kernel
### Theory of Operation

### Functionality Overview
##### Startup
* Deserialize Memory
* Boost Priority of anything that didn't get run in a tick, updating starvation counts
* Fill priority queues based on task list
##### Task Execution
* Monitors CPU usage & executes tasks from queue if sufficient CPU based on estimate
* Updates CPU cost after task completes (via EMA)
##### Shutdown
* Record kernel CPU stats
* Serialize Memory

## Writing Tasks

#### Task Functions
Task functions must have a signature of `(...args) => RETURN_CODE`. If `RETURN_CODE` is non-zero, the kernel will log
 an error.

The task's `args` are provided when creating the task. These can only be `string`s or `number`s
 because of serialization. The `args` are intended to be used to provide the name(s) or id(s) of
 game entities for the task to operate on.

#### Registering Task Functions
Because object references are lost on a code reload, the kernel needs references to the appropriate function to run for 
 each task. The kernel function `register_task_function` is used to provide this reference to the kernel and returns
 a 'task key' for the task. Every task function must be registered with the kernel before the kernel is run, and should
 be done outside of the main loop, as `register` doesn't deduplicate registrations. The 'task key' returned by 
 `register_task_function` must be passed as the `task_key` parameter to `create_task`.

#### Creating Tasks
The function will be called with the arguments provided to the `create_task` function via the `task_args` parameter.
 Multiple tasks that run the same code with different arguments can readibly be created, all referencing the same task
 key, but a separate task key is needed for each different function that should be run as a task. Task code must 
 first be registered as described above.

## Priorities

Tasks of a lower priority number are always run before tasks of a higher priority number.
 Note that `CRITICAL` priority is the lowest, at `0`, and `LOW` is the highest number at `3`.
 While the relationship between the numbers and names are counter-intuitive, 
 the `enum` names do what an English speaker would generally expect.

### Priority Levels
##### `CRITICAL` 
These tasks are run every tick, regardless of CPU cost.

##### `HIGH`
These tasks are run only if they are anticipated not to exceed `Game.cpu.tickLimit`.
Note that high CPU costs at this priority level will drain your CPU bucket.

##### `MEDIUM`
These tasks are run if they are anticipated not to exceed `Game.cpu.limit`, 
or anticipated not to exceed `Game.cpu.tickLimit` if `Game.cpu.bucket > 5000` (half or more full).

##### `LOW`
These tasks are run only if they are anticipated not to exceed `Game.cpu.limit`.

### Task Starvation
Every tick that a task is not able to run due to CPU limits is recorded as being stagnant.
As a task becomes more stagnant, it will be bumped up to a higher priority level until it
is able to run.

## System Calls ## FIXME

##### `register_task_function`
Registers a code object with the kernel that can be run by one or more tasks.

##### `create_task`
Adds Task to Task List. Task will not start running until next tick.

If `create_task` is called from within another task, the created task becomes a child of the
first task. If called from code not being run via the kernel, the task has no parent.

##### `kill_task`
Stops a task from running in the future. Also stops child tasks.

##### `get_task_ID`
Returns the ID of the currently running task.

##### `get_tasks`
Returns the tasks currently scheduled to run, mapped by Task ID.
