// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

/// <reference path="./definitions/node.d.ts"/>

import childProcess = require("child_process");
import os = require("os");
import fs = require("fs");
import cfgm = require("./configuration");
import ctxm = require('./context');
import listener = require('./messagelistener');
import agentifm = require('vso-node-api/interfaces/TaskAgentInterfaces');
import baseifm = require('vso-node-api/interfaces/common/VsoBaseInterfaces');
import dm = require('./diagnostics');
import path = require('path');
import cm = require('./common');
import tm = require('./tracing');
import taskm = require('./taskmanager');
import agentm = require('vso-node-api/TaskAgentApi');
import webapim = require('vso-node-api/WebApi');
import heartbeat = require('./heartbeat');
import fm = require('./feedback');
import Q = require('q');
var semver = require('semver');

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

if (semver.lt(process.versions.node, '4.2.0')) {
    console.error('Agent requires at least node 4.2.0');
    process.exit(1);
}

var hostContext: ctxm.HostContext;
var trace: tm.Tracing;
var cfgr: cfgm.Configurator = new cfgm.Configurator();
var messageListener: listener.MessageListener;

var runWorker = function(hostContext: ctxm.HostContext, agentApi: agentm.ITaskAgentApi, workerMsg: cm.IWorkerMessage) {

    var worker: childProcess.ChildProcess = childProcess.fork(path.join(__dirname, 'vsoworker'), [], {
        env: process.env
    });
    
    var abandoned: boolean = false;
    
    // worker ipc callbacks
    worker.on('message', function(msg) {
        try {
            if (msg.messageType === 'log') {
                // log data event - need to send to server
                // console.log('pageComplete: ', msg.data.logInfo.recordId, msg.data.pageNumber, msg.data.pagePath);
            }
            else if (msg.messageType === 'status') {
                // consoleWriter.writeStatus(msg.data);
            }
            else if (msg.messageType === 'updateJobRequest' && !abandoned) {
                var poolId: number = msg.poolId;
                var lockToken: string = msg.lockToken;
                var jobRequest: agentifm.TaskAgentJobRequest = msg.jobRequest;
                
                agentApi.updateAgentRequest(jobRequest, poolId, jobRequest.requestId, lockToken, (err, status, jobRequest) => {
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
}

var INIT_RETRY_DELAY = 15000;
var ensureInitialized = function(settings: cm.ISettings, creds: any, complete: (err:any, config: cm.IConfiguration) => void): void {
    cfgr.readConfiguration(creds, settings)
    .then((config: cm.IConfiguration) => {
        complete(null, config);
    })
    .fail((err) => {
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

        console.error('Could not initialize.  Retrying in ' + INIT_RETRY_DELAY/1000 + ' sec');

        setTimeout(() => {
                ensureInitialized(settings, creds, complete);
            }, INIT_RETRY_DELAY);        
    })
}

var _creds: baseifm.IBasicCredentials;

cm.readBasicCreds()
.then(function(credentials: baseifm.IBasicCredentials) {
    _creds = credentials;
    return cfgr.ensureConfigured(credentials);
})
.then((config: cm.IConfiguration) => {
    var settings: cm.ISettings = config.settings;

    if (!settings) {
        throw (new Error('Settings not configured.'));
    }

    var agent: agentifm.TaskAgent = config.agent;
    hostContext = new ctxm.HostContext(config, getAgentDiagnosticWriter(config), true);
    trace = new tm.Tracing(__filename, hostContext);
    trace.callback('initAgent');

    hostContext.status('Agent Started.');
      
    var queueName = agent.name;
    hostContext.info('Listening for agent: ' + queueName);

    var agentApi: agentm.ITaskAgentApi = new webapim.WebApi(settings.serverUrl, cm.basicHandlerFromCreds(_creds)).getTaskAgentApi();
    messageListener = new listener.MessageListener(agentApi, agent, config.poolId);
    trace.write('created message listener');
    hostContext.info('starting listener...');

    heartbeat.write();
    
    messageListener.on('listening', () => {
        heartbeat.write();
    });

    messageListener.on('info', (message: string) => {
        hostContext.info('messenger: ' + message);
    });

    messageListener.on('sessionUnavailable', () => {
        hostContext.error('Could not create a session with the server.');
        gracefulShutdown(0);
    });

    messageListener.start((message: agentifm.TaskAgentMessage) => {
        trace.callback('listener.start');
        
        hostContext.info('Message received');
        hostContext.info('Message Type: ' + message.messageType);

        trace.state('message', message);

        var messageBody = null;
        try  {
            messageBody = JSON.parse(message.body);
        } catch (e) {
            hostContext.error(e);
            return;
        }

        hostContext.verbose(JSON.stringify(messageBody, null, 2));
        
        if (message.messageType === 'JobRequest') {
            var workerMsg = <any>{ 
                messageType: cm.WorkerMessageTypes.Job,
                config: config,
                data: messageBody
            }
            
            if (settings.basic) {
                workerMsg.config.creds = _creds;
            }

            runWorker(hostContext, agentApi, workerMsg);
        }
        else {
            hostContext.error('Unknown Message Type: ' + message.messageType);
        }
    },
    (err: any) => {
        if (!err || !err.hasOwnProperty('message')) {
            hostContext.error("Unknown error occurred while connecting to the message queue.");
        } else {
            hostContext.error('Message Queue Error:');
            hostContext.error(err.message);
        }
    });
})
.fail(function(err) {
    console.error('Error starting the agent');
    console.error(err.message);
    if (hostContext) {
        hostContext.error(err.stack);
    }

    gracefulShutdown(0);
})

process.on('uncaughtException', function (err) {
    if (hostContext) {
        hostContext.error('agent unhandled:')
        hostContext.error(err.stack);
    }
    else {
        console.error(err.stack);
    }
});

function getAgentDiagnosticWriter(config: cm.IConfiguration): cm.IDiagnosticWriter {
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
var gracefulShutdown = function(code: number) {
    console.log("\nShutting down host.");
    if (messageListener) {
        messageListener.stop((err) => {
            if (err) {
                hostContext.error('Error deleting agent session:');
                hostContext.error(err.message);
            }
            heartbeat.stop();
            process.exit(code);
        });
    } else {
        heartbeat.stop();
        process.exit(code);
    }
}

process.on('SIGINT', () => {
    gracefulShutdown(0);
});

process.on('SIGTERM', () => {
    gracefulShutdown(0);
});
