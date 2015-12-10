// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
/// <reference path="./definitions/node.d.ts"/>
var childProcess = require("child_process");
var cfgm = require("./configuration");
var ctxm = require('./context');
var listener = require('./messagelistener');
var dm = require('./diagnostics');
var path = require('path');
var cm = require('./common');
var tm = require('./tracing');
var webapim = require('vso-node-api/WebApi');
var heartbeat = require('./heartbeat');
var inDebugger = (typeof global.v8debug === 'object');
var supported = ['darwin', 'linux'];
if (supported.indexOf(process.platform) == -1) {
    console.error('Unsupported platform: ' + process.platform);
    console.error('Supported platforms are: ' + supported.toString());
    process.exit(1);
}
if (process.getuid() == 0 && !process.env['VSO_AGENT_RUNASROOT']) {
    console.error('Agent should not run elevated.  uid: ' + process.getuid());
    process.exit(1);
}
var hostContext;
var trace;
var cfgr = new cfgm.Configurator();
var messageListener;
var runWorker = function (hostContext, agentApi, workerMsg) {
    var worker = childProcess.fork(path.join(__dirname, 'vsoworker'), [], {
        env: process.env
    });
    var abandoned = false;
    // worker ipc callbacks
    worker.on('message', function (msg) {
        try {
            if (msg.messageType === 'log') {
            }
            else if (msg.messageType === 'status') {
            }
            else if (msg.messageType === 'updateJobRequest' && !abandoned) {
                var poolId = msg.poolId;
                var lockToken = msg.lockToken;
                var jobRequest = msg.jobRequest;
                agentApi.updateAgentRequest(jobRequest, poolId, jobRequest.requestId, lockToken, function (err, status, jobRequest) {
                    trace.write('err: ' + err);
                    trace.write('status: ' + status);
                    // bail on 400-level responses
                    if (status >= 400 && status < 500) {
                        abandoned = true;
                        worker.send({
                            // it could also be expired, but it doesn't make a difference here
                            messageType: cm.WorkerMessageTypes.Abandoned
                        });
                    }
                });
            }
        }
        catch (err) {
            hostContext.error("host" + err);
        }
    });
    hostContext.verbose('host::workerSend');
    worker.send(workerMsg);
};
var INIT_RETRY_DELAY = 15000;
var ensureInitialized = function (settings, creds, complete) {
    cfgr.readConfiguration(creds, settings)
        .then(function (config) {
        complete(null, config);
    })
        .fail(function (err) {
        console.error(err.message);
        // exit if the pool or agent does not exist anymore
        if (err.errorCode === cm.AgentError.PoolNotExist ||
            err.errorCode === cm.AgentError.AgentNotExist) {
            console.error('Exiting.');
            return;
        }
        // also exit if the creds are now invalid
        if (err.statusCode && err.statusCode == 401) {
            console.error('Invalid credentials.  Exiting.');
            return;
        }
        console.error('Could not initialize.  Retrying in ' + INIT_RETRY_DELAY / 1000 + ' sec');
        setTimeout(function () {
            ensureInitialized(settings, creds, complete);
        }, INIT_RETRY_DELAY);
    });
};
var _creds;
cm.readBasicCreds()
    .then(function (credentials) {
    _creds = credentials;
    return cfgr.ensureConfigured(credentials);
})
    .then(function (config) {
    var settings = config.settings;
    if (!settings) {
        throw (new Error('Settings not configured.'));
    }
    var agent = config.agent;
    hostContext = new ctxm.HostContext(config, getAgentDiagnosticWriter(config), true);
    trace = new tm.Tracing(__filename, hostContext);
    trace.callback('initAgent');
    hostContext.status('Agent Started.');
    var queueName = agent.name;
    hostContext.info('Listening for agent: ' + queueName);
    var agentApi = new webapim.WebApi(settings.serverUrl, cm.basicHandlerFromCreds(_creds)).getTaskAgentApi();
    messageListener = new listener.MessageListener(agentApi, agent, config.poolId);
    trace.write('created message listener');
    hostContext.info('starting listener...');
    heartbeat.write();
    messageListener.on('listening', function () {
        heartbeat.write();
    });
    messageListener.on('info', function (message) {
        hostContext.info('messenger: ' + message);
    });
    messageListener.on('sessionUnavailable', function () {
        hostContext.error('Could not create a session with the server.');
        gracefulShutdown(0);
    });
    messageListener.start(function (message) {
        trace.callback('listener.start');
        hostContext.info('Message received');
        hostContext.info('Message Type: ' + message.messageType);
        trace.state('message', message);
        var messageBody = null;
        try {
            messageBody = JSON.parse(message.body);
        }
        catch (e) {
            hostContext.error(e);
            return;
        }
        hostContext.verbose(JSON.stringify(messageBody, null, 2));
        if (message.messageType === 'JobRequest') {
            var workerMsg = {
                messageType: cm.WorkerMessageTypes.Job,
                config: config,
                data: messageBody
            };
            runWorker(hostContext, agentApi, workerMsg);
        }
        else {
            hostContext.error('Unknown Message Type: ' + message.messageType);
        }
    }, function (err) {
        if (!err || !err.hasOwnProperty('message')) {
            hostContext.error("Unknown error occurred while connecting to the message queue.");
        }
        else {
            hostContext.error('Message Queue Error:');
            hostContext.error(err.message);
        }
    });
})
    .fail(function (err) {
    console.error('Error starting the agent');
    console.error(err.message);
    if (hostContext) {
        hostContext.error(err.stack);
    }
    gracefulShutdown(0);
});
process.on('uncaughtException', function (err) {
    if (hostContext) {
        hostContext.error('agent unhandled:');
        hostContext.error(err.stack);
    }
    else {
        console.error(err.stack);
    }
});
function getAgentDiagnosticWriter(config) {
    if (config.createDiagnosticWriter) {
        return config.createDiagnosticWriter();
    }
    var agentPath = __dirname;
    var rootAgentDir = path.join(__dirname, '..');
    var diagFolder = path.join(rootAgentDir, '_diag');
    return dm.getDefaultDiagnosticWriter(config, diagFolder, 'agent');
}
//
// TODO: re-evaluate and match .net agent exit codes
// 0: agent will go down and host will not attempt restart
// 1: agent will attempt
//
var gracefulShutdown = function (code) {
    console.log("\nShutting down host.");
    if (messageListener) {
        messageListener.stop(function (err) {
            if (err) {
                hostContext.error('Error deleting agent session:');
                hostContext.error(err.message);
            }
            heartbeat.stop();
            process.exit(code);
        });
    }
    else {
        heartbeat.stop();
        process.exit(code);
    }
};
process.on('SIGINT', function () {
    gracefulShutdown(0);
});
process.on('SIGTERM', function () {
    gracefulShutdown(0);
});
