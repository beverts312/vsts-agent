// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var cm = require('./common');
var agentifm = require('vso-node-api/interfaces/TaskAgentInterfaces');
var webapim = require('vso-node-api/WebApi');
var fs = require('fs');
var tm = require('./tracing');
var cq = require('./concurrentqueue');
var Q = require('q');
var events = require('events');
var async = require('async');
var CONSOLE_DELAY = 373;
var TIMELINE_DELAY = 487;
var LOG_DELAY = 1137;
var LOCK_DELAY = 29323;
var CHECK_INTERVAL = 1000;
var MAX_DRAIN_WAIT = 60 * 1000; // 1 min
var Events = (function () {
    function Events() {
    }
    Events.Abandoned = "abandoned";
    return Events;
})();
exports.Events = Events;
var TimedWorker = (function (_super) {
    __extends(TimedWorker, _super);
    function TimedWorker(msDelay) {
        _super.call(this);
        this._msDelay = msDelay;
        this.enabled = true;
        this._waitAndSend();
    }
    //------------------------------------------------------------------
    // Work
    //------------------------------------------------------------------
    TimedWorker.prototype.end = function () {
        this.enabled = false;
    };
    // need to override
    TimedWorker.prototype.doWork = function () {
        return Q.reject(new Error('Abstract.  Must override.'));
    };
    // should likely override
    TimedWorker.prototype.shouldDoWork = function () {
        return this.enabled;
    };
    TimedWorker.prototype._waitAndSend = function () {
        var _this = this;
        setTimeout(function () {
            if (_this.shouldDoWork()) {
                _this.doWork().fin(function () {
                    _this.continueSending();
                });
            }
            else {
                _this.continueSending();
            }
        }, this._msDelay);
    };
    TimedWorker.prototype.continueSending = function () {
        if (this.enabled) {
            this._waitAndSend();
        }
    };
    return TimedWorker;
})(events.EventEmitter);
exports.TimedWorker = TimedWorker;
//----------------------------------------------------------------------------------------
// Feedback Channels
// - All customer feedback funnels through this point
// - Feedback channels are pluggable for development and testing
// - The service channel is a timed worker and creates timed queues for logs and console
//----------------------------------------------------------------------------------------
var trace;
function ensureTrace(writer) {
    if (!trace) {
        trace = new tm.Tracing(__filename, writer);
    }
}
var ServiceChannel = (function (_super) {
    __extends(ServiceChannel, _super);
    function ServiceChannel(agentUrl, collectionUrl, jobInfo, hostContext) {
        var _this = this;
        _super.call(this);
        ensureTrace(hostContext);
        trace.enter('ServiceChannel');
        this.agentUrl = agentUrl;
        this.collectionUrl = collectionUrl;
        this.jobInfo = jobInfo;
        this.hostContext = hostContext;
        this._recordCount = 0;
        this._issues = {};
        // service apis
        var webapi = this.getWebApi();
        this._agentApi = webapi.getTaskAgentApi(agentUrl);
        this.taskApi = webapi.getTaskApi();
        this._fileContainerApi = webapi.getQFileContainerApi();
        this._buildApi = webapi.getQBuildApi();
        this._totalWaitTime = 0;
        this._lockRenewer = new LockRenewer(jobInfo, hostContext.config.poolId);
        // pass the Abandoned event up to the owner
        this._lockRenewer.on(Events.Abandoned, function () {
            _this.emit(Events.Abandoned);
        });
        // timelines
        this._timelineRecordQueue = new cq.ConcurrentBatch(function (key) {
            return {
                id: key
            };
        }, function (values, callback) {
            if (values.length === 0) {
                callback(0);
            }
            else {
                _this.taskApi.updateRecords({ value: values, count: values.length }, _this.jobInfo.variables[cm.vars.systemTeamProjectId], _this.jobInfo.description, _this.jobInfo.planId, _this.jobInfo.timelineId, function (err, status, records) {
                    callback(err);
                });
            }
        }, function (err) {
            trace.write(err);
        }, TIMELINE_DELAY);
        // console lines
        this._consoleQueue = new WebConsoleQueue(this, this.hostContext, CONSOLE_DELAY);
        // log pages
        this._logPageQueue = new LogPageQueue(this, this.hostContext, LOG_DELAY);
        this._timelineRecordQueue.startProcessing();
        this._consoleQueue.startProcessing();
        this._logPageQueue.startProcessing();
    }
    ServiceChannel.prototype.getWebApi = function () {
        return new webapim.WebApi(this.collectionUrl, this.jobInfo.systemAuthHandler);
    };
    // wait till all the queues are empty and not processing.
    ServiceChannel.prototype.drain = function () {
        var _this = this;
        trace.enter('servicechannel:drain');
        var consoleFinished = this._consoleQueue.waitForEmpty();
        var logFinished = this._logPageQueue.waitForEmpty();
        var timelineFinished = this._timelineRecordQueue.waitForEmpty();
        // no more console lines or log pages should be generated
        this._consoleQueue.finishAdding();
        this._logPageQueue.finishAdding();
        // don't complete the timeline queue until the log queue is done
        logFinished.then(function () {
            _this._timelineRecordQueue.finishAdding();
        });
        return Q.all([consoleFinished, logFinished, timelineFinished]);
    };
    //------------------------------------------------------------------
    // Queue Items
    //------------------------------------------------------------------  
    ServiceChannel.prototype.queueLogPage = function (page) {
        trace.enter('servicechannel:queueLogPage');
        this._logPageQueue.push(page);
    };
    ServiceChannel.prototype.queueConsoleLine = function (line) {
        if (line.length > 512) {
            line = line.substring(0, 509) + '...';
        }
        trace.write('qline: ' + line);
        this._consoleQueue.push(line);
    };
    ServiceChannel.prototype.queueConsoleSection = function (line) {
        trace.enter('servicechannel:queueConsoleSection: ' + line);
        this._consoleQueue.section(line);
    };
    ServiceChannel.prototype.updateJobRequest = function (poolId, lockToken, jobRequest) {
        trace.enter('servicechannel:updateJobRequest');
        trace.write('poolId: ' + poolId);
        trace.write('lockToken: ' + lockToken);
        process.send({
            messageType: 'updateJobRequest',
            poolId: poolId,
            lockToken: lockToken,
            jobRequest: jobRequest
        });
        return Q.resolve(null);
    };
    ServiceChannel.prototype.finishJobRequest = function (poolId, lockToken, jobRequest) {
        var _this = this;
        trace.enter('servicechannel:finishJobRequest');
        // end the lock renewer. if it's currently waiting on its timeout, .finished will be a previously resolved promise
        trace.write('shutting down lock renewer...');
        this._lockRenewer.end();
        // wait for the lock renewer to finish. this is only really meaningful if it's actually in the middle of an HTTP request
        return this._lockRenewer.finished.then(function () {
            trace.write('lock renewer shut down');
            return _this.updateJobRequest(poolId, lockToken, jobRequest);
        });
    };
    // Factory for scriptrunner to create a queue per task script execution
    // This also allows agent tests to create a queue that doesn't process to a real server (just print out work it would do)
    ServiceChannel.prototype.createAsyncCommandQueue = function (executionContext) {
        return new AsyncCommandQueue(executionContext, 1000);
    };
    //------------------------------------------------------------------
    // Timeline APIs
    //------------------------------------------------------------------  
    ServiceChannel.prototype.addError = function (recordId, category, message, data) {
        var current = this._getIssues(recordId);
        var record = this._getFromBatch(recordId);
        if (current.errorCount < process.env.VSO_ERROR_COUNT ? process.env.VSO_ERROR_COUNT : 10) {
            var error = {};
            error.category = category;
            error.type = agentifm.IssueType.Error;
            error.message = message;
            error.data = data;
            current.issues.push(error);
            record.issues = current.issues;
        }
        current.errorCount++;
        record.errorCount = current.errorCount;
    };
    ServiceChannel.prototype.addWarning = function (recordId, category, message, data) {
        var current = this._getIssues(recordId);
        var record = this._getFromBatch(recordId);
        if (current.warningCount < process.env.VSO_WARNING_COUNT ? process.env.VSO_WARNING_COUNT : 10) {
            var warning = {};
            warning.category = category;
            warning.type = agentifm.IssueType.Error;
            warning.message = message;
            warning.data = data;
            current.issues.push(warning);
            record.issues = current.issues;
        }
        current.warningCount++;
        record.warningCount = current.warningCount;
    };
    ServiceChannel.prototype.setCurrentOperation = function (recordId, operation) {
        trace.state('operation', operation);
        this._getFromBatch(recordId).currentOperation = operation;
    };
    ServiceChannel.prototype.setName = function (recordId, name) {
        trace.state('name', name);
        this._getFromBatch(recordId).name = name;
    };
    ServiceChannel.prototype.setStartTime = function (recordId, startTime) {
        trace.state('startTime', startTime);
        this._getFromBatch(recordId).startTime = startTime;
    };
    ServiceChannel.prototype.setFinishTime = function (recordId, finishTime) {
        trace.state('finishTime', finishTime);
        this._getFromBatch(recordId).finishTime = finishTime;
    };
    ServiceChannel.prototype.setState = function (recordId, state) {
        trace.state('state', state);
        this._getFromBatch(recordId).state = state;
    };
    ServiceChannel.prototype.setResult = function (recordId, result) {
        trace.state('result', result);
        this._getFromBatch(recordId).result = result;
    };
    ServiceChannel.prototype.setType = function (recordId, type) {
        trace.state('type', type);
        this._getFromBatch(recordId).type = type;
    };
    ServiceChannel.prototype.setParentId = function (recordId, parentId) {
        trace.state('parentId', parentId);
        this._getFromBatch(recordId).parentId = parentId;
    };
    ServiceChannel.prototype.setWorkerName = function (recordId, workerName) {
        trace.state('workerName', workerName);
        this._getFromBatch(recordId).workerName = workerName;
    };
    ServiceChannel.prototype.setLogId = function (recordId, logRef) {
        trace.state('logRef', logRef);
        this._getFromBatch(recordId).log = logRef;
    };
    ServiceChannel.prototype.setOrder = function (recordId, order) {
        trace.state('order', order);
        this._getFromBatch(recordId).order = order;
    };
    ServiceChannel.prototype.uploadFileToContainer = function (containerId, containerItemTuple) {
        trace.state('containerItemTuple', containerItemTuple);
        var contentStream = fs.createReadStream(containerItemTuple.fullPath);
        return this._fileContainerApi.createItem(containerItemTuple.uploadHeaders, contentStream, containerId, containerItemTuple.containerItem.path, this.jobInfo.variables[cm.vars.systemTeamProjectId]);
    };
    ServiceChannel.prototype.postArtifact = function (projectId, buildId, artifact) {
        trace.state('artifact', artifact);
        return this._buildApi.createArtifact(artifact, buildId, projectId);
    };
    //------------------------------------------------------------------
    // Timeline internal batching
    //------------------------------------------------------------------
    ServiceChannel.prototype._getFromBatch = function (recordId) {
        trace.enter('servicechannel:_getFromBatch');
        return this._timelineRecordQueue.getOrAdd(recordId);
    };
    ServiceChannel.prototype._getIssues = function (recordId) {
        if (!this._issues.hasOwnProperty(recordId)) {
            this._issues[recordId] = { errorCount: 0, warningCount: 0, issues: [] };
        }
        return this._issues[recordId];
    };
    //------------------------------------------------------------------
    // Test publishing Items
    //------------------------------------------------------------------  
    ServiceChannel.prototype.initializeTestManagement = function (projectName) {
        trace.enter('servicechannel:initializeTestManagement');
        this._testApi = new webapim.WebApi(this.jobInfo.variables[cm.AutomationVariables.systemTfCollectionUri], this.jobInfo.systemAuthHandler).getQTestApi();
        this._projectName = projectName;
    };
    ServiceChannel.prototype.createTestRun = function (testRun) {
        trace.enter('servicechannel:createTestRun');
        return this._testApi.createTestRun(testRun, this._projectName);
    };
    ServiceChannel.prototype.endTestRun = function (testRunId) {
        trace.enter('servicechannel:endTestRun');
        var endedRun = {
            state: "Completed"
        };
        return this._testApi.updateTestRun(endedRun, this._projectName, testRunId);
    };
    ServiceChannel.prototype.createTestRunResult = function (testRunId, testRunResults) {
        trace.enter('servicechannel:createTestRunResult');
        return this._testApi.addTestResultsToTestRun(testRunResults, this._projectName, testRunId);
    };
    ServiceChannel.prototype.createTestRunAttachment = function (testRunId, fileName, contents) {
        trace.enter('servicechannel:createTestRunAttachment');
        var attachmentData = {
            attachmentType: "GeneralAttachment",
            comment: "",
            fileName: fileName,
            stream: contents
        };
        return this._testApi.createTestRunAttachment(attachmentData, this._projectName, testRunId);
    };
    return ServiceChannel;
})(events.EventEmitter);
exports.ServiceChannel = ServiceChannel;
//------------------------------------------------------------------------------------
// Server Feedback Queues
//------------------------------------------------------------------------------------
var BaseQueue = (function () {
    function BaseQueue(outputChannel, msDelay) {
        this._outputChannel = outputChannel;
        this._msDelay = msDelay;
    }
    BaseQueue.prototype.push = function (value) {
        this._queue.push(value);
    };
    BaseQueue.prototype.finishAdding = function () {
        this._queue.finishAdding();
    };
    BaseQueue.prototype.waitForEmpty = function () {
        return this._queue.waitForEmpty();
    };
    BaseQueue.prototype.startProcessing = function () {
        var _this = this;
        if (!this._queue) {
            this._queue = new cq.ConcurrentArray(function (values, callback) {
                _this._processQueue(values, callback);
            }, function (err) {
                _this._outputChannel.error(err);
            }, this._msDelay);
            this._queue.startProcessing();
        }
    };
    BaseQueue.prototype._processQueue = function (values, callback) {
        throw new Error("abstract");
    };
    return BaseQueue;
})();
exports.BaseQueue = BaseQueue;
var WebConsoleQueue = (function (_super) {
    __extends(WebConsoleQueue, _super);
    function WebConsoleQueue(feedback, hostContext, msDelay) {
        _super.call(this, hostContext, msDelay);
        this._jobInfo = feedback.jobInfo;
        this._taskApi = feedback.getWebApi().getTaskApi();
    }
    WebConsoleQueue.prototype.section = function (line) {
        this.push('[section] ' + this._jobInfo.mask(line));
    };
    WebConsoleQueue.prototype.push = function (line) {
        _super.prototype.push.call(this, this._jobInfo.mask(line));
    };
    WebConsoleQueue.prototype._processQueue = function (values, callback) {
        if (values.length === 0) {
            callback(null);
        }
        else {
            this._taskApi.postLines({ value: values, count: values.length }, this._jobInfo.variables[cm.vars.systemTeamProjectId], this._jobInfo.description, this._jobInfo.planId, this._jobInfo.timelineId, this._jobInfo.jobId, function (err, status) {
                trace.write('done writing lines');
                if (err) {
                    trace.write('err: ' + err.message);
                }
                callback(err);
            });
        }
    };
    return WebConsoleQueue;
})(BaseQueue);
exports.WebConsoleQueue = WebConsoleQueue;
var AsyncCommandQueue = (function (_super) {
    __extends(AsyncCommandQueue, _super);
    function AsyncCommandQueue(executionContext, msDelay) {
        _super.call(this, executionContext, msDelay);
        this.failed = false;
    }
    AsyncCommandQueue.prototype._processQueue = function (commands, callback) {
        var _this = this;
        if (commands.length === 0) {
            callback(null);
        }
        else {
            async.forEachSeries(commands, function (asyncCmd, done) {
                if (_this.failed) {
                    done(null);
                    return;
                }
                var outputLines = function (asyncCmd) {
                    asyncCmd.executionContext.info(' ');
                    asyncCmd.executionContext.info('Start: ' + asyncCmd.description);
                    asyncCmd.command.lines.forEach(function (line) {
                        asyncCmd.executionContext.info(line);
                    });
                    asyncCmd.executionContext.info('End: ' + asyncCmd.description);
                    asyncCmd.executionContext.info(' ');
                };
                asyncCmd.runCommandAsync()
                    .then(function () {
                    outputLines(asyncCmd);
                })
                    .fail(function (err) {
                    _this.failed = true;
                    _this.errorMessage = err.message;
                    outputLines(asyncCmd);
                    asyncCmd.executionContext.error(_this.errorMessage);
                    asyncCmd.executionContext.info('Failing task since command failed.');
                })
                    .fin(function () {
                    done(null);
                });
            }, function (err) {
                // queue never fails - we simply don't process items once one has failed.
                callback(null);
            });
        }
    };
    return AsyncCommandQueue;
})(BaseQueue);
exports.AsyncCommandQueue = AsyncCommandQueue;
var LogPageQueue = (function (_super) {
    __extends(LogPageQueue, _super);
    function LogPageQueue(service, hostContext, msDelay) {
        _super.call(this, hostContext, msDelay);
        this._recordToLogIdMap = {};
        this._service = service;
        this._jobInfo = service.jobInfo;
        this._taskApi = service.getWebApi().getTaskApi();
        this._hostContext = hostContext;
    }
    LogPageQueue.prototype._processQueue = function (logPages, callback) {
        var _this = this;
        trace.enter('LogQueue:processQueue: ' + logPages.length + ' pages to process');
        if (logPages.length === 0) {
            callback(null);
        }
        else {
            for (var i = 0; i < logPages.length; i++) {
                trace.write('page: ' + logPages[i].pagePath);
            }
            var planId = this._jobInfo.planId;
            async.forEachSeries(logPages, function (logPageInfo, done) {
                var pagePath = logPageInfo.pagePath;
                trace.write('process:logPagePath: ' + pagePath);
                var recordId = logPageInfo.logInfo.recordId;
                trace.write('logRecordId: ' + recordId);
                var serverLogPath;
                var logId;
                var pageUploaded = false;
                async.series([
                    function (doneStep) {
                        trace.write('creating log record');
                        //
                        // we only want to create the log metadata record once per 
                        // timeline record Id.  So, create and put it in a map
                        //
                        if (!_this._recordToLogIdMap.hasOwnProperty(logPageInfo.logInfo.recordId)) {
                            serverLogPath = 'logs\\' + recordId; // FCS expects \
                            _this._taskApi.createLog({ path: serverLogPath }, _this._jobInfo.variables[cm.vars.systemTeamProjectId], _this._jobInfo.description, planId, function (err, statusCode, log) {
                                if (err) {
                                    trace.write('error creating log record: ' + err.message);
                                    doneStep(err);
                                    return;
                                }
                                // associate log with timeline recordId
                                _this._recordToLogIdMap[recordId] = log.id;
                                trace.write('added log id to map: ' + log.id);
                                doneStep(null);
                            });
                        }
                        else {
                            doneStep(null);
                        }
                    },
                    function (doneStep) {
                        // check logId in map first
                        logId = _this._recordToLogIdMap[recordId];
                        if (logId) {
                            trace.write('uploading log page: ' + pagePath);
                            fs.stat(pagePath, function (err, stats) {
                                if (err) {
                                    trace.write('Error reading log file: ' + err.message);
                                    return;
                                }
                                var pageStream = fs.createReadStream(pagePath);
                                _this._taskApi.appendLog({ "Content-Length": stats.size }, pageStream, _this._jobInfo.variables[cm.vars.systemTeamProjectId], _this._jobInfo.description, planId, logId, function (err, statusCode, obj) {
                                    if (err) {
                                        trace.write('error uploading log file: ' + err.message);
                                    }
                                    fs.unlink(pagePath, function (err) {
                                        // we're going to continue here so we can get the next logs
                                        // TODO: we should consider requeueing?
                                        doneStep(null);
                                    });
                                });
                            });
                        }
                        else {
                            _this._hostContext.error('Skipping log upload.  Log record does not exist.');
                            doneStep(null);
                        }
                    },
                    function (doneStep) {
                        var logRef = {};
                        logRef.id = logId;
                        _this._service.setLogId(recordId, logRef);
                        doneStep(null);
                    }
                ], function (err) {
                    if (err) {
                        _this._hostContext.error(err.message);
                        _this._hostContext.error(JSON.stringify(logPageInfo));
                    }
                    done(err);
                });
            }, function (err) {
                callback(err);
            });
        }
    };
    return LogPageQueue;
})(BaseQueue);
exports.LogPageQueue = LogPageQueue;
// Job Renewal
var LockRenewer = (function (_super) {
    __extends(LockRenewer, _super);
    function LockRenewer(jobInfo, poolId) {
        trace.enter('LockRenewer');
        // finished is initially a resolved promise, because a renewal is not in progress
        this.finished = Q(null);
        this._jobInfo = jobInfo;
        this._poolId = poolId;
        trace.write('_poolId: ' + this._poolId);
        _super.call(this, LOCK_DELAY);
    }
    LockRenewer.prototype.doWork = function () {
        return this._renewLock();
    };
    LockRenewer.prototype._renewLock = function () {
        var jobRequest = {};
        jobRequest.requestId = this._jobInfo.requestId;
        // create a new, unresolved "finished" promise
        var deferred = Q.defer();
        this.finished = deferred.promise;
        process.send({
            messageType: 'updateJobRequest',
            poolId: this._poolId,
            lockToken: this._jobInfo.lockToken,
            jobRequest: jobRequest
        });
        deferred.resolve(null);
        return deferred.promise;
    };
    return LockRenewer;
})(TimedWorker);
exports.LockRenewer = LockRenewer;
