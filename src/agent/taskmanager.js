// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
/// <reference path="./definitions/async.d.ts"/>
var cm = require('./common');
var fs = require('fs');
var path = require('path');
var shell = require('shelljs');
var Q = require('q');
var webapi = require('vso-node-api/WebApi');
var TaskManager = (function () {
    function TaskManager(executionContext) {
        this.executionContext = executionContext;
        var taskDefinitionsUri = this.getTaskDefinitionsUri();
        this.executionContext.trace("TaskDownloader will download tasks from " + taskDefinitionsUri);
        this.taskApi = new webapi.WebApi(taskDefinitionsUri, executionContext.authHandler).getTaskAgentApi();
        this.taskFolder = path.resolve(executionContext.hostContext.workFolder, 'tasks');
    }
    TaskManager.prototype.ensureTaskExists = function (task) {
        if (!this.hasTask(task)) {
            return this.downloadTask(task);
        }
        else {
            return Q.resolve(null);
        }
    };
    TaskManager.prototype.hasTask = function (task) {
        if (fs.existsSync(this.getTaskPath(task))) {
            return true;
        }
        else {
            return false;
        }
    };
    TaskManager.prototype.ensureTasksExist = function (tasks) {
        var _this = this;
        // Check only once for each id/version combo
        var alreadyAdded = {};
        var uniqueTasks = [];
        for (var i = 0; i < tasks.length; i++) {
            var idVersion = tasks[i].id + ':' + tasks[i].version;
            if (!(idVersion in alreadyAdded)) {
                uniqueTasks.push(tasks[i]);
                alreadyAdded[idVersion] = true;
            }
        }
        var promises = tasks.map(function (task) {
            return _this.ensureTaskExists(task);
        });
        return Q.all(promises);
    };
    TaskManager.prototype.ensureLatestExist = function () {
        var _this = this;
        var deferred = Q.defer();
        // Get all tasks
        this.taskApi.getTaskDefinitions(null, null, null, function (err, status, tasks) {
            if (err) {
                deferred.reject(err);
            }
            // Sort out only latest versions
            var latestIndex = {};
            var latestTasks = [];
            for (var i = 0; i < tasks.length; i++) {
                var task = tasks[i];
                if (!(task.id in latestIndex)) {
                    // We haven't seen this task id before, add it to the array, 
                    // and track the "id":"array index" pair in the dictionary
                    latestTasks.push(_this.getTaskInstance(task));
                    latestIndex[task.id] = latestTasks.length - 1;
                }
                else if (cm.versionStringFromTaskDef(task) > latestTasks[latestIndex[task.id]].version) {
                    // We've seen this task id before, but this task is a newer version, update the task in the array
                    latestTasks[latestIndex[task.id]] = _this.getTaskInstance(task);
                }
            }
            // Call ensureTasksExist for those
            _this.ensureTasksExist(latestTasks).then(function () {
                deferred.resolve(null);
            }, function (err) {
                deferred.reject(err);
            });
        });
        return deferred.promise;
    };
    TaskManager.prototype.downloadTask = function (task) {
        var taskPath = this.getTaskPath(task);
        var filePath = taskPath + '.zip';
        if (fs.existsSync(filePath)) {
            return Q.reject(new Error('File ' + filePath + ' already exists.'));
        }
        var deferred = Q.defer();
        shell.mkdir('-p', taskPath);
        this.executionContext.trace("Downloading task " + task.id + " v" + task.version + " to " + taskPath);
        this.taskApi.getTaskContentZip(task.id, task.version, null, null, function (err, statusCode, res) {
            if (err) {
                deferred.reject(err);
            }
            var fileStream = fs.createWriteStream(filePath);
            res.pipe(fileStream);
            fileStream.on('finish', function () {
                cm.extractFile(filePath, taskPath, function (err) {
                    if (err) {
                        shell.rm('-rf', taskPath);
                        deferred.reject(err);
                    }
                    shell.rm('-rf', filePath);
                    fileStream.end();
                    deferred.resolve(null);
                });
            });
        });
        return deferred.promise;
    };
    TaskManager.prototype.getTaskPath = function (task) {
        return path.resolve(this.taskFolder, task.name, task.version);
    };
    TaskManager.prototype.getTaskInstance = function (task) {
        return { 'id': task.id, 'name': task.name, 'version': cm.versionStringFromTaskDef(task) };
    };
    TaskManager.prototype.getTaskDefinitionsUri = function () {
        var taskDefinitionsUri = this.executionContext.variables[cm.vars.systemTaskDefinitionsUri];
        if (!taskDefinitionsUri) {
            taskDefinitionsUri = this.executionContext.variables[cm.vars.systemTfCollectionUri];
        }
        if (!taskDefinitionsUri) {
            taskDefinitionsUri = this.executionContext.config.settings.serverUrl;
        }
        return taskDefinitionsUri;
    };
    return TaskManager;
})();
exports.TaskManager = TaskManager;
