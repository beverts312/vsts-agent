// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var cm = require('./common');
var ctxm = require('./context');
var dm = require('./diagnostics');
var agentifm = require('vso-node-api/interfaces/TaskAgentInterfaces');
var jrm = require('./job');
var fm = require('./feedback');
var tm = require('./tracing');
var wapim = require('vso-node-api/WebApi');
var Q = require('q');
var hostContext;
var trace;
function setVariables(job, config) {
    trace.enter('setVariables');
    trace.state('variables', job.environment.variables);
    var variables = job.environment.variables;
    var rt = variables[cm.vars.agentRootDirectory] = __dirname;
    variables[cm.vars.agentHomeDirectory] = rt;
    variables[cm.vars.agentAgentId] = config.settings.agentName;
    var wp = variables[cm.vars.agentWorkingDirectory] = cm.getWorkPath(config);
    variables[cm.vars.agentWorkFolder] = wp;
    if (!variables[cm.vars.systemTfCollectionUri]) {
        variables[cm.vars.systemTfCollectionUri] = job.environment.systemConnection.url;
    }
    if (!!variables[cm.vars.systemEnableAccessToken]) {
        variables[cm.vars.systemAccessToken] = job.environment.systemConnection.authorization.parameters['AccessToken'];
    }
    trace.state('variables', job.environment.variables);
}
function deserializeEnumValues(job) {
    if (job && job.environment && job.environment.mask) {
        job.environment.mask.forEach(function (maskHint, index) {
            maskHint.type = agentifm.TypeInfo.MaskType.enumValues[maskHint.type];
        });
    }
}
function getWorkerDiagnosticWriter(config) {
    if (config.createDiagnosticWriter) {
        return config.createDiagnosticWriter();
    }
    var diagFolder = cm.getWorkerDiagPath(config);
    return dm.getDefaultDiagnosticWriter(config, diagFolder, 'worker');
}
//
// Worker process waits for a job message, processes and then exits
// The promise will resolve to true if the message was understood, false if not
//
function run(msg, consoleOutput, createFeedbackChannel) {
    var deferred = Q.defer();
    var config = msg.config;
    hostContext = new ctxm.HostContext(config, getWorkerDiagnosticWriter(config), true);
    trace = new tm.Tracing(__filename, hostContext);
    trace.enter('.onMessage');
    trace.state('message', msg);
    hostContext.info('worker::onMessage');
    if (msg.messageType === cm.WorkerMessageTypes.Abandoned) {
        hostContext.emit(fm.Events.Abandoned);
        deferred.resolve(true);
    }
    else if (msg.messageType === cm.WorkerMessageTypes.Job) {
        var job = msg.data;
        deserializeEnumValues(job);
        setVariables(job, config);
        trace.write('Creating AuthHandler');
        var systemAuthHandler;
        if (job.environment.systemConnection) {
            trace.write('using session token');
            var accessToken = job.environment.systemConnection.authorization.parameters['AccessToken'];
            trace.state('AccessToken:', accessToken);
            systemAuthHandler = wapim.getBearerHandler(accessToken);
        }
        else {
            trace.write('using altcreds');
            hostContext.error('system connection token not supplied.  unsupported deployment.');
        }
        // TODO: on output from context --> diag
        // TODO: these should be set beforePrepare and cleared postPrepare after we add agent ext
        if (msg.config && msg.config.creds) {
            var altCreds = msg.config.creds;
            process.env['altusername'] = altCreds.username;
            process.env['altpassword'] = altCreds.password;
        }
        hostContext.status('Running job: ' + job.jobName);
        hostContext.info('message:');
        trace.state('msg:', msg);
        var agentUrl = hostContext.config.settings.serverUrl;
        var taskUrl = job.environment.systemConnection.url;
        var jobInfo = cm.jobInfoFromJob(job, systemAuthHandler);
        var serviceChannel = createFeedbackChannel(agentUrl, taskUrl, jobInfo, hostContext);
        var jobContext = new ctxm.ExecutionContext(jobInfo, systemAuthHandler, job.jobId, serviceChannel, hostContext);
        trace.write('created JobContext');
        var jobRunner = new jrm.JobRunner(hostContext, jobContext);
        trace.write('created jobRunner');
        // guard to ensure we only "finish" once 
        var finishingJob = false;
        hostContext.on(fm.Events.Abandoned, function () {
            // if finishingJob is true here, then the jobRunner finished
            // ctx.finishJob will take care of draining the service channel
            if (!finishingJob) {
                finishingJob = true;
                hostContext.error("Job abandoned by the server.");
                // nothing much to do if drain rejects...
                serviceChannel.drain().fin(function () {
                    trace.write("Service channel drained");
                    deferred.resolve(true);
                });
            }
        });
        jobRunner.run(function (err, result) {
            trace.callback('job.run');
            hostContext.status('Job Completed: ' + job.jobName);
            if (err) {
                hostContext.error('Error: ' + err.message);
            }
            // if finishingJob is true here, then the lock renewer got a 404, which means the server abandoned the job
            // it's already calling serviceChannel.drain() and it's going to call finished()
            if (!finishingJob) {
                finishingJob = true;
                jobContext.finishJob(result).fin(function () {
                    // trace and status no matter what. if finishJob failed, the fail handler below will be called
                    trace.callback('ctx.finishJob');
                    hostContext.status('Job Finished: ' + job.jobName);
                }).fail(function (err) {
                    if (err) {
                        hostContext.error('Error: ' + err.message);
                    }
                }).fin(function () {
                    deferred.resolve(true);
                });
            }
        });
    }
    else {
        // don't know what to do with this message
        deferred.resolve(false);
    }
    return deferred.promise;
}
exports.run = run;
var processingMessage = false;
process.on('message', function (msg) {
    var serviceChannelFactory = function (agentUrl, taskUrl, jobInfo, hostContext) {
        return new fm.ServiceChannel(agentUrl, taskUrl, jobInfo, hostContext);
    };
    // process the message
    var runPromise = run(msg, true, serviceChannelFactory);
    // if this is the first message we've seen, set up a finally handler to exit when it's done
    // subsequent messages are probably "cancel" or "abandoned", so just process them and let the original message finish gracefully
    if (!processingMessage) {
        processingMessage = true;
        runPromise.fin(function () {
            process.exit();
        });
    }
});
process.on('uncaughtException', function (err) {
    console.error('unhandled:' + err.message);
    console.error(err.stack);
    if (hostContext) {
        hostContext.error('worker unhandled: ' + err.message);
        hostContext.error(err.stack);
    }
    process.exit();
});
process.on('SIGINT', function () {
    if (hostContext) {
        hostContext.info("\nShutting down agent.");
    }
    process.exit();
});
