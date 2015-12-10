// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
/// <reference path="./definitions/async.d.ts"/>
var async = require('async');
var ctxm = require('./context');
var fs = require('fs');
var agentifm = require('vso-node-api/interfaces/TaskAgentInterfaces');
var path = require('path');
var plgm = require('./plugins');
var taskm = require('./taskmanager');
var tm = require('./tracing');
var cm = require('./common');
var shell = require('shelljs');
// TODO: remove this hack in a couple of sprints.  Some tasks were not loading shelljs
//       and the issue was masked.  Fixing tasks now and then we will remove.
require('shelljs/global');
var trace;
//
// TODO: fix this for context API changes
//       get compiling
//       add more tracing
//       discuss ordering on log creation, associating timeline with logid
//
var JobRunner = (function () {
    function JobRunner(hostContext, executionContext) {
        this.taskExecution = {};
        this.taskMetadata = {};
        this._hostContext = hostContext;
        trace = new tm.Tracing(__filename, hostContext);
        trace.enter('JobRunner');
        this._executionContext = executionContext;
        this._job = executionContext.jobInfo.jobMessage;
    }
    JobRunner.prototype._processVariables = function () {
        this._hostContext.info('_processVariables');
        // replace variables in inputs
        var vars = this._job.environment.variables;
        if (vars) {
            // we don't want vars to be case sensitive
            var lowerVars = {};
            for (var varName in vars) {
                lowerVars[varName.toLowerCase()] = vars[varName];
            }
            this._job.tasks.forEach(function (task) {
                trace.write(task.name);
                for (var key in task.inputs) {
                    if (task.inputs[key]) {
                        task.inputs[key] = task.inputs[key].replaceVars(lowerVars);
                    }
                }
            });
            // set env vars
            for (var variable in vars) {
                var envVarName = variable.replace(".", "_").toUpperCase();
                process.env[envVarName] = vars[variable];
            }
            trace.state('variables', process.env);
        }
        trace.state('tasks', this._job.tasks);
    };
    JobRunner.prototype.run = function (complete) {
        trace.enter('run');
        var hostContext = this._hostContext;
        this._processVariables();
        var _this = this;
        var executionContext = this._executionContext;
        //
        // default directory is the working directory.
        // plugins will have the opportunity to change the working directory
        // which will get preserved and reset after each task executes.
        // for example, the build plugin sets the cwd as the repo root.
        //
        shell.cd(executionContext.workingDirectory);
        trace.write('Setting job to in progress');
        executionContext.setJobInProgress();
        executionContext.writeConsoleSection('Preparing tasks');
        hostContext.info('Downloading required tasks');
        var taskManager = new taskm.TaskManager(executionContext);
        taskManager.ensureTasksExist(this._job.tasks).then(function () {
            // prepare (might download) up to 5 tasks in parallel and then run tasks sequentially
            hostContext.info('Preparing Tasks');
            async.forEach(_this._job.tasks, function (pTask, callback) {
                _this.prepareTask(pTask, callback);
            }, function (err) {
                if (err) {
                    trace.write('error preparing tasks');
                    complete(err, agentifm.TaskResult.Failed);
                    return;
                }
                hostContext.info('Task preparations complete.');
                // TODO: replace build with sender id once confirm how sent
                hostContext.info('loading plugins...');
                var system = _this._job.environment.variables[cm.vars.system];
                plgm.load(system, hostContext, executionContext, function (err, plugins) {
                    if (err) {
                        trace.write('error loading plugins');
                        complete(err, agentifm.TaskResult.Failed);
                        return;
                    }
                    //
                    // Write out plug-ins and tasks we are about to run.
                    // Create timeline entries for each in Pending state
                    //
                    var order = 1;
                    hostContext.info('beforeJob Plugins:');
                    plugins['beforeJob'].forEach(function (plugin) {
                        hostContext.info(plugin.pluginName() + ":" + plugin.beforeId);
                        executionContext.registerPendingTask(plugin.beforeId, plugin.pluginTitle(), order++);
                    });
                    hostContext.info('tasks:');
                    executionContext.jobInfo.jobMessage.tasks.forEach(function (task) {
                        hostContext.info(task.name + ":" + task.id);
                        executionContext.registerPendingTask(task.instanceId, task.displayName, order++);
                    });
                    hostContext.info('afterJob Plugins:');
                    plugins['afterJob'].forEach(function (plugin) {
                        hostContext.info(plugin.pluginName() + ":" + plugin.afterId);
                        if (plugin.shouldRun(true, executionContext)) {
                            hostContext.info('shouldRun');
                            executionContext.registerPendingTask(plugin.afterId, plugin.pluginTitle(), order++);
                        }
                    });
                    trace.write(process.cwd());
                    var jobResult = agentifm.TaskResult.Succeeded;
                    async.series([
                        function (done) {
                            hostContext.info('Running beforeJob Plugins ...');
                            plgm.beforeJob(plugins, executionContext, hostContext, function (err, success) {
                                hostContext.info('Finished running beforeJob plugins');
                                trace.state('variables after plugins:', _this._job.environment.variables);
                                // plugins can contribute to vars so replace again
                                _this._processVariables();
                                jobResult = !err && success ? agentifm.TaskResult.Succeeded : agentifm.TaskResult.Failed;
                                trace.write('jobResult: ' + jobResult);
                                // we always run afterJob plugins
                                done(null);
                            });
                        },
                        function (done) {
                            // if prepare plugins fail, we should not run tasks (getting code failed etc...)
                            if (jobResult == agentifm.TaskResult.Failed) {
                                trace.write('skipping running tasks since prepare plugins failed.');
                                done(null);
                            }
                            else {
                                hostContext.info('Running Tasks ...');
                                _this.runTasks(function (err, result) {
                                    hostContext.info('Finished running tasks');
                                    jobResult = result;
                                    trace.write('jobResult: ' + result);
                                    done(null);
                                });
                            }
                        },
                        function (done) {
                            hostContext.info('Running afterJob Plugins ...');
                            plgm.afterJob(plugins, executionContext, hostContext, jobResult != agentifm.TaskResult.Failed, function (err, success) {
                                hostContext.info('Finished running afterJob plugins');
                                trace.write('afterJob Success: ' + success);
                                jobResult = !err && success ? jobResult : agentifm.TaskResult.Failed;
                                trace.write('jobResult: ' + jobResult);
                                done(err);
                            });
                        }
                    ], function (err) {
                        trace.write('jobResult: ' + jobResult);
                        if (err) {
                            jobResult = agentifm.TaskResult.Failed;
                        }
                        complete(err, jobResult);
                    });
                });
            });
        }, function (err) {
            complete(err, agentifm.TaskResult.Failed);
            return;
        });
    };
    JobRunner.prototype.runTasks = function (callback) {
        trace.enter('runTasks');
        var job = this._job;
        var hostContext = this._hostContext;
        var executionContext = this._executionContext;
        var jobResult = agentifm.TaskResult.Succeeded;
        var _this = this;
        trace.state('tasks', job.tasks);
        var cwd = process.cwd();
        async.forEachSeries(job.tasks, function (item, done) {
            // ensure we reset cwd after each task runs
            shell.cd(cwd);
            trace.write('cwd: ' + cwd);
            executionContext.writeConsoleSection('Running ' + item.name);
            var taskContext = new ctxm.ExecutionContext(executionContext.jobInfo, executionContext.authHandler, item.instanceId, executionContext.service, hostContext);
            taskContext.on('message', function (message) {
                taskContext.service.queueConsoleLine(message);
            });
            if (item.enabled) {
                taskContext.setTaskStarted(item.name);
                _this.runTask(item, taskContext, function (err) {
                    var taskResult = taskContext.result;
                    if (err || taskResult == agentifm.TaskResult.Failed) {
                        if (item.continueOnError) {
                            taskResult = jobResult = agentifm.TaskResult.SucceededWithIssues;
                            err = null;
                        }
                        else {
                            taskResult = jobResult = agentifm.TaskResult.Failed;
                            err = new Error('Task Failed');
                        }
                    }
                    trace.write('taskResult: ' + taskResult);
                    taskContext.setTaskResult(item.name, taskResult);
                    taskContext.end();
                    done(err);
                });
            }
            else {
                var err = '';
                var taskResult = agentifm.TaskResult.Skipped;
                trace.write('taskResult: ' + taskResult);
                taskContext.setTaskResult(item.name, taskResult);
                done(err);
            }
        }, function (err) {
            hostContext.info('Done running tasks.');
            trace.write('jobResult: ' + jobResult);
            if (err) {
                hostContext.error(err.message);
                callback(err, jobResult);
                return;
            }
            callback(null, jobResult);
        });
    };
    JobRunner.prototype.prepareTask = function (task, callback) {
        var _this = this;
        trace.enter('prepareTask');
        var hostContext = this._hostContext;
        var taskPath = path.join(this._executionContext.workingDirectory, 'tasks', task.name, task.version);
        trace.write('taskPath: ' + taskPath);
        hostContext.info('preparing task ' + task.name);
        var taskJsonPath = path.join(taskPath, 'task.json');
        trace.write('taskJsonPath: ' + taskJsonPath);
        fs.exists(taskJsonPath, function (exists) {
            if (!exists) {
                trace.write('cannot find task: ' + taskJsonPath);
                callback(new Error('Could not find task: ' + taskJsonPath));
                return;
            }
            // TODO: task metadata should be typed
            try {
                // Using require to help strip out BOM information
                // Using JSON.stringify/JSON.parse in order to clone the task.json object
                // Otherwise we modify the cached object for everyone
                var taskMetadata = JSON.parse(JSON.stringify(require(taskJsonPath)));
                trace.state('taskMetadata', taskMetadata);
                _this.taskMetadata[task.id] = taskMetadata;
                var execution = taskMetadata.execution;
                // in preference order
                var handlers = ['Node', 'Bash', 'JavaScript'];
                var instructions;
                handlers.some(function (handler) {
                    if (execution.hasOwnProperty(handler)) {
                        instructions = execution[handler];
                        instructions["handler"] = handler;
                        trace.write('handler: ' + handler);
                        return true;
                    }
                });
                if (!instructions) {
                    trace.write('no handler for this task');
                    callback(new Error('Agent could not find a handler for this task'));
                    return;
                }
                instructions['target'] = path.join(taskPath, instructions.target);
                trace.state('instructions', instructions);
                _this.taskExecution[task.id] = instructions;
            }
            catch (e) {
                trace.write('exception getting metadata: ' + e.message);
                callback(new Error('Invalid metadata @ ' + taskJsonPath));
                return;
            }
            callback();
        });
    };
    //
    // TODO: add beforeTask plugin step and move to their.  This is build specific code
    // and should not be in the generic agent code
    //
    JobRunner.prototype._processInputs = function (task) {
        trace.enter('processInputs');
        //
        // Resolve paths for filePath inputs
        //
        var metadata = this.taskMetadata[task.id];
        trace.write('retrieved metadata for ' + task.name);
        var filePathInputs = {};
        metadata.inputs.forEach(function (input) {
            trace.write('input ' + input.name + ' is type ' + input.type);
            if (input.type === 'filePath') {
                trace.write('adding ' + input.name);
                filePathInputs[input.name] = true;
            }
        });
        trace.state('filePathInputs', filePathInputs);
        var srcFolder = this._job.environment.variables[cm.vars.buildSourcesDirectory];
        trace.write('srcFolder: ' + srcFolder);
        for (var key in task.inputs) {
            trace.write('checking ' + key);
            if (filePathInputs.hasOwnProperty(key)) {
                trace.write('rewriting value for ' + key);
                var resolvedPath = path.resolve(srcFolder, task.inputs[key] || '');
                trace.write('resolvedPath: ' + resolvedPath);
                task.inputs[key] = resolvedPath;
            }
            this._executionContext.verbose(key + ': ' + task.inputs[key]);
        }
        trace.state('task.inputs', task.inputs);
    };
    JobRunner.prototype.runTask = function (task, executionContext, callback) {
        trace.enter('runTask');
        this._hostContext.info('Task: ' + task.name);
        //TODO: This call should be made to the plugin as it is build specific
        if (executionContext.variables[cm.vars.system].toLowerCase() === 'Build'.toLowerCase()) {
            this._processInputs(task);
        }
        for (var key in task.inputs) {
            executionContext.verbose(key + ': ' + task.inputs[key]);
        }
        executionContext.verbose('');
        executionContext.inputs = task.inputs;
        var execution = this.taskExecution[task.id];
        trace.state('execution', execution);
        var handler = require('./handlers/' + execution.handler);
        this._hostContext.info('running ' + execution.target + ' with ' + execution.handler);
        trace.write('calling handler.runTask');
        // task should set result.  If it doesn't and the script runs to completion should default to success
        executionContext.result = agentifm.TaskResult.Succeeded;
        handler.runTask(execution.target, executionContext, callback);
    };
    return JobRunner;
})();
exports.JobRunner = JobRunner;
