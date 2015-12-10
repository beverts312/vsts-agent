// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var cm = require('./common');
var dm = require('./diagnostics');
var events = require('events');
var agentifm = require('vso-node-api/interfaces/TaskAgentInterfaces');
var lm = require('./logging');
var os = require("os");
var path = require('path');
var tm = require('./tracing');
var um = require('./utilities');
var trace;
function ensureTrace(writer) {
    if (!trace) {
        trace = new tm.Tracing(__filename, writer);
    }
}
var WellKnownVariables = (function () {
    function WellKnownVariables() {
    }
    WellKnownVariables.sourceFolder = cm.vars.buildSourcesDirectory;
    WellKnownVariables.stagingFolder = cm.vars.buildStagingDirectory;
    WellKnownVariables.buildId = cm.vars.buildId;
    WellKnownVariables.projectId = cm.vars.systemTeamProjectId;
    WellKnownVariables.containerId = cm.vars.buildContainerId;
    return WellKnownVariables;
})();
exports.WellKnownVariables = WellKnownVariables;
var Context = (function (_super) {
    __extends(Context, _super);
    function Context(writers) {
        _super.call(this);
        this.writers = writers;
        this.hasErrors = false;
    }
    // TODO: parse line to direct appropriately
    Context.prototype.output = function (line) {
        this.writers.forEach(function (writer) {
            writer.write(line);
        });
    };
    Context.prototype.error = function (message) {
        this.hasErrors = true;
        // in case some js task/plugins end up passing through an Error object.
        var obj = message;
        if (typeof (message) === 'object' && obj.hasOwnProperty('message')) {
            message = obj.message;
        }
        this._write(cm.DiagnosticLevel.Error, 'Error', message);
    };
    Context.prototype.warning = function (message) {
        this._write(cm.DiagnosticLevel.Warning, 'Warning', message);
    };
    Context.prototype.info = function (message) {
        this._write(cm.DiagnosticLevel.Info, null, message);
    };
    Context.prototype.verbose = function (message) {
        this._write(cm.DiagnosticLevel.Verbose, 'Debug', message);
    };
    Context.prototype.debug = function (message) {
        this._write(cm.DiagnosticLevel.Verbose, 'task.debug', message);
    };
    Context.prototype._write = function (level, tag, message) {
        if (typeof (message) !== 'string') {
            trace.error('invalid message type: ' + typeof (message));
            return;
        }
        var lines = message.split(os.EOL);
        for (var i in lines) {
            var line = lines[i].replace(/(\r\n|\n|\r)/gm, '');
            var prefix = tag ? '##[' + tag + '] ' : '';
            var dateTime = new Date().toISOString() + ': ';
            var logLine = prefix + dateTime + line + os.EOL;
            var hasWritten = false;
            this.writers.forEach(function (writer) {
                if (writer.level >= level) {
                    hasWritten = true;
                    if (level == cm.DiagnosticLevel.Error) {
                        writer.writeError(logLine);
                    }
                    else {
                        writer.write(logLine);
                    }
                }
            });
            if (hasWritten) {
                this.emit('message', prefix + line);
            }
        }
    };
    Context.prototype.heading = function (message) {
        var _this = this;
        this.writers.forEach(function (writer) {
            if (writer.level >= cm.DiagnosticLevel.Status) {
                var delim = '----------------------------------------------------------------------' + os.EOL;
                _this._write(cm.DiagnosticLevel.Info, null, delim + message + delim);
            }
        });
    };
    Context.prototype.status = function (message) {
        this._write(cm.DiagnosticLevel.Status, null, message);
    };
    Context.prototype.section = function (message) {
        var _this = this;
        this.writers.forEach(function (writer) {
            if (writer.level >= cm.DiagnosticLevel.Status) {
                _this._write(cm.DiagnosticLevel.Info, null, ' ' + os.EOL + '+++++++' + message + ' ' + os.EOL);
            }
        });
    };
    Context.prototype.end = function () {
        this.writers.forEach(function (writer) {
            writer.end();
        });
    };
    return Context;
})(events.EventEmitter);
exports.Context = Context;
var HostContext = (function (_super) {
    __extends(HostContext, _super);
    function HostContext(config, fileWriter, consoleOutput) {
        this.config = config;
        this.workFolder = cm.getWorkPath(config);
        ensureTrace(this);
        this._fileWriter = fileWriter;
        var writers = [this._fileWriter];
        if (consoleOutput) {
            writers.push(new dm.DiagnosticConsoleWriter(cm.DiagnosticLevel.Status));
        }
        _super.call(this, writers);
    }
    HostContext.prototype.trace = function (message) {
        this._fileWriter.write(message);
    };
    return HostContext;
})(Context);
exports.HostContext = HostContext;
var ExecutionContext = (function (_super) {
    __extends(ExecutionContext, _super);
    function ExecutionContext(jobInfo, authHandler, recordId, service, hostContext) {
        ensureTrace(hostContext);
        trace.enter('ExecutionContext');
        this.jobInfo = jobInfo;
        this.authHandler = authHandler;
        this.traceWriter = hostContext;
        this.variables = jobInfo.variables;
        this.recordId = recordId;
        this.hostContext = hostContext;
        this.service = service;
        this.config = hostContext.config;
        this.workingDirectory = this.variables[cm.vars.agentWorkingDirectory];
        var logFolder = path.join(this.workingDirectory, '_logs');
        var logData = {};
        logData.jobInfo = jobInfo;
        logData.recordId = recordId;
        this.debugOutput = this.variables[cm.vars.systemDebug] == 'true';
        var logger = new lm.PagingLogger(logFolder, logData);
        logger.level = this.debugOutput ? cm.DiagnosticLevel.Verbose : cm.DiagnosticLevel.Info;
        logger.on('pageComplete', function (info) {
            service.queueLogPage(info);
        });
        this.util = new um.Utilities(this);
        this.scmPath = path.join(__dirname, 'scm');
        _super.call(this, [logger]);
    }
    ExecutionContext.prototype.getWebApi = function () {
        return this.service.getWebApi();
    };
    ExecutionContext.prototype.writeConsoleSection = function (message) {
        this.service.queueConsoleSection(message);
    };
    ExecutionContext.prototype.trace = function (message) {
        this.hostContext.trace(message);
    };
    ExecutionContext.prototype.error = function (message) {
        var obj = message;
        if (typeof (message) === 'object' && obj.hasOwnProperty('message')) {
            message = obj.message;
        }
        this.service.addError(this.recordId, "Console", message, null);
        _super.prototype.error.call(this, message);
    };
    ExecutionContext.prototype.warning = function (message) {
        this.service.addWarning(this.recordId, "Console", message, null);
        _super.prototype.warning.call(this, message);
    };
    ExecutionContext.prototype.setTaskStarted = function (name) {
        trace.enter('setTaskStarted');
        // set the job operation
        this.service.setCurrentOperation(this.jobInfo.jobId, 'Starting ' + name);
        // update the task
        this.service.setCurrentOperation(this.recordId, "Starting " + name);
        this.service.setStartTime(this.recordId, new Date());
        this.service.setState(this.recordId, agentifm.TimelineRecordState.InProgress);
        this.service.setType(this.recordId, "Task");
        this.service.setName(this.recordId, name);
    };
    ExecutionContext.prototype.setTaskResult = function (name, result) {
        trace.enter('setTaskResult');
        this.service.setCurrentOperation(this.recordId, "Completed " + name);
        this.service.setState(this.recordId, agentifm.TimelineRecordState.Completed);
        this.service.setFinishTime(this.recordId, new Date());
        this.service.setResult(this.recordId, result);
        this.service.setType(this.recordId, "Task");
        this.service.setName(this.recordId, name);
    };
    ExecutionContext.prototype.registerPendingTask = function (id, name, order) {
        trace.enter('registerPendingTask');
        this.service.setCurrentOperation(id, "Initializing");
        this.service.setParentId(id, this.jobInfo.jobId);
        this.service.setName(id, name);
        this.service.setState(id, agentifm.TimelineRecordState.Pending);
        this.service.setType(id, "Task");
        this.service.setWorkerName(id, this.config.settings.agentName);
        this.service.setOrder(id, order);
    };
    ExecutionContext.prototype.setJobInProgress = function () {
        trace.enter('setJobInProgress');
        // job
        this.service.setCurrentOperation(this.recordId, "Starting");
        this.service.setName(this.recordId, this.jobInfo.jobMessage.jobName);
        this.service.setStartTime(this.recordId, new Date());
        this.service.setState(this.recordId, agentifm.TimelineRecordState.InProgress);
        this.service.setType(this.recordId, "Job");
        this.service.setWorkerName(this.recordId, this.config.settings.agentName);
    };
    ExecutionContext.prototype.finishJob = function (result) {
        var _this = this;
        trace.enter('finishJob');
        trace.state('result', agentifm.TaskResult[result]);
        this.setTaskResult(this.jobInfo.jobMessage.jobName, result);
        var jobRequest = {};
        jobRequest.requestId = this.jobInfo.requestId;
        jobRequest.finishTime = new Date();
        jobRequest.result = result;
        trace.state('jobRequest', jobRequest);
        trace.state('this.config', this.config);
        // stop the lock renewal timer, mark the job complete and then drain so the next worker can start
        return this.service.finishJobRequest(this.config.poolId, this.jobInfo.lockToken, jobRequest).fin(function () {
            trace.write('draining feedback');
            return _this.service.drain();
        });
    };
    return ExecutionContext;
})(Context);
exports.ExecutionContext = ExecutionContext;
