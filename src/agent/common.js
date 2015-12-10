// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
/// <reference path="./definitions/Q.d.ts" />
/// <reference path="./definitions/vso-node-api.d.ts" />
var Q = require('q');
var path = require('path');
var inputs = require('./inputs');
var agentifm = require('vso-node-api/interfaces/TaskAgentInterfaces');
var basicm = require('vso-node-api/handlers/basiccreds');
var crypto = require('crypto');
var zip = require('adm-zip');
var fs = require('fs');
require('./extensions');
//
// Variables - Keep grouped and ordered
// 
var AutomationVariables = (function () {
    function AutomationVariables() {
    }
    //
    // System Variables
    //
    AutomationVariables.system = "system";
    AutomationVariables.systemCollectionId = "system.collectionId";
    AutomationVariables.systemDefinitionId = "system.definitionId";
    AutomationVariables.systemTfsUri = "system.teamFoundationServerUri";
    AutomationVariables.systemTfCollectionUri = 'system.teamFoundationCollectionUri';
    AutomationVariables.systemTeamProjectId = 'system.teamProjectId';
    AutomationVariables.systemDebug = 'system.debug';
    AutomationVariables.defaultWorkingDirectory = 'system.defaultWorkingDirectory';
    AutomationVariables.systemTaskDefinitionsUri = 'system.taskDefinitionsUri';
    AutomationVariables.systemAccessToken = 'system.accessToken';
    AutomationVariables.systemEnableAccessToken = 'system.enableAccessToken';
    //
    // Agent Variables
    //    
    AutomationVariables.agentRootDirectory = 'agent.rootDirectory';
    AutomationVariables.agentWorkingDirectory = 'agent.workingDirectory';
    AutomationVariables.agentWorkFolder = 'agent.workFolder';
    AutomationVariables.agentHomeDirectory = 'agent.homeDirectory';
    AutomationVariables.agentAgentId = 'agent.agentId';
    AutomationVariables.agentBuildDirectory = 'agent.buildDirectory';
    //
    // Build Variables
    //
    AutomationVariables.buildSourcesDirectory = 'build.sourcesDirectory';
    AutomationVariables.buildArtifactStagingDirectory = 'build.artifactStagingDirectory';
    AutomationVariables.buildStagingDirectory = 'build.stagingDirectory';
    AutomationVariables.buildBinariesDirectory = 'build.binariesDirectory';
    AutomationVariables.buildDefinitionName = 'build.definitionName';
    AutomationVariables.buildDefinitionVersion = 'build.definitionVersion';
    AutomationVariables.buildNumber = 'build.buildNumber';
    AutomationVariables.buildUri = 'build.buildUri';
    AutomationVariables.buildId = 'build.buildId';
    AutomationVariables.buildQueuedBy = 'build.queuedBy';
    AutomationVariables.buildQueuedById = 'build.queuedById';
    AutomationVariables.buildRequestedFor = 'build.requestedFor';
    AutomationVariables.buildRequestedForId = 'build.requestedForId';
    AutomationVariables.buildSourceVersion = 'build.sourceVersion';
    AutomationVariables.buildSourceBranch = 'build.sourceBranch';
    AutomationVariables.buildSourceBranchName = 'build.sourceBranchName';
    AutomationVariables.buildContainerId = 'build.containerId';
    //
    // Common Variables
    //       
    AutomationVariables.commonTestResultsDirectory = "common.testResultsDirectory";
    return AutomationVariables;
})();
exports.AutomationVariables = AutomationVariables;
exports.vars = AutomationVariables;
//-----------------------------------------------------------
// ENV VARS
//-----------------------------------------------------------
exports.envTrace = 'VSO_AGENT_TRACE';
exports.envCredTrace = 'VSO_CRED_TRACE';
exports.envVerbose = 'VSO_AGENT_VERBOSE';
// comma delimited list of envvars to ignore when registering agent with server
exports.envIgnore = 'VSO_AGENT_IGNORE';
exports.envService = 'VSO_AGENT_SVC';
exports.envWorkerDiagPath = 'WORKER_DIAG_PATH';
//-----------------------------------------------------------
// Enums
//-----------------------------------------------------------
(function (DiagnosticLevel) {
    DiagnosticLevel[DiagnosticLevel["Error"] = 1] = "Error";
    DiagnosticLevel[DiagnosticLevel["Warning"] = 2] = "Warning";
    DiagnosticLevel[DiagnosticLevel["Status"] = 3] = "Status";
    DiagnosticLevel[DiagnosticLevel["Info"] = 4] = "Info";
    DiagnosticLevel[DiagnosticLevel["Verbose"] = 5] = "Verbose";
})(exports.DiagnosticLevel || (exports.DiagnosticLevel = {}));
var DiagnosticLevel = exports.DiagnosticLevel;
//-----------------------------------------------------------
// Agent Errors
//-----------------------------------------------------------
(function (AgentError) {
    // config errors 100 - 199
    AgentError[AgentError["PoolNotExist"] = 100] = "PoolNotExist";
    AgentError[AgentError["AgentNotExist"] = 101] = "AgentNotExist";
})(exports.AgentError || (exports.AgentError = {}));
var AgentError = exports.AgentError;
function throwAgentError(errorCode, message) {
    var err = new Error(message);
    err['errorCode'] = errorCode;
    throw err;
}
exports.throwAgentError = throwAgentError;
//-----------------------------------------------------------
// Constants
//-----------------------------------------------------------
exports.CMD_PREFIX = '##vso[';
exports.DEFAULT_LOG_LINESPERFILE = 5000;
exports.DEFAULT_LOG_MAXFILES = 5;
var WorkerMessageTypes = (function () {
    function WorkerMessageTypes() {
    }
    WorkerMessageTypes.Abandoned = "abandoned";
    WorkerMessageTypes.Job = "job";
    return WorkerMessageTypes;
})();
exports.WorkerMessageTypes = WorkerMessageTypes;
//-----------------------------------------------------------
// Helpers
//-----------------------------------------------------------
function execAll(func, items, state) {
    var initialState = state;
    var current = Q(null);
    items.forEach(function (item) {
        current = current.then(function (state) {
            return func(item, state || initialState);
        });
    });
    return current;
}
exports.execAll = execAll;
//
// during config, there's no context, working directory or logs.  So, if tracing enabled, we should go to console.
//
function consoleTrace(message) {
    console.log(new Date().toString() + " : " + message);
}
exports.consoleTrace = consoleTrace;
function jsonString(obj) {
    if (!obj) {
        return '(null)';
    }
    return JSON.stringify(obj, null, 2);
}
exports.jsonString = jsonString;
//
// get creds from CL args or prompt user if not in args
//
function getCreds(done) {
    var creds = {};
    creds['username'] = process.env.USERNAME;
    creds['password'] = result['password'];
    done(null, creds);
}
exports.getCreds = getCreds;
exports.MASK_REPLACEMENT = "********";
;
;
function createMaskFunction(jobEnvironment) {
    var noReplacement = function (input) {
        return input;
    };
    var envMasks = jobEnvironment.mask || [];
    var maskHints = [];
    envMasks.forEach(function (maskHint) {
        if (maskHint.type === agentifm.MaskType.Variable && maskHint.value) {
            if (jobEnvironment.variables[maskHint.value]) {
                maskHints.push(maskHint);
            }
        }
    });
    if (maskHints.length === 0) {
        return noReplacement;
    }
    else if (maskHints.length === 1) {
        var maskHint = maskHints[0];
        if (maskHint.type === agentifm.MaskType.Variable) {
            var toReplace = jobEnvironment.variables[maskHint.value];
            return function (input) {
                return input.replace(toReplace, exports.MASK_REPLACEMENT);
            };
        }
        return noReplacement;
    }
    else {
        // multiple strings to replace
        var indexFunctions = [];
        maskHints.forEach(function (maskHint, index) {
            if (maskHint.type === agentifm.MaskType.Variable) {
                var toReplace = jobEnvironment.variables[maskHint.value];
                indexFunctions.push(function (input) {
                    var results = [];
                    var index = input.indexOf(toReplace);
                    while (index > -1) {
                        results.push({ start: index, length: toReplace.length });
                        index = input.indexOf(toReplace, index + 1);
                    }
                    return results;
                });
            }
        });
        return function (input) {
            // gather all the substrings to replace
            var substrings = [];
            indexFunctions.forEach(function (find) {
                substrings = substrings.concat(find(input));
            });
            // order substrings by start index
            substrings = substrings.sort(function (a, b) {
                return a.start - b.start;
            });
            // merge
            var replacements = [];
            var currentReplacement;
            var currentEnd;
            for (var i = 0; i < substrings.length; i++) {
                if (!currentReplacement) {
                    currentReplacement = substrings[i];
                    currentEnd = currentReplacement.start + currentReplacement.length;
                }
                else {
                    if (substrings[i].start <= currentEnd) {
                        // overlap
                        currentEnd = Math.max(currentEnd, substrings[i].start + substrings[i].length);
                        currentReplacement.length = currentEnd - currentReplacement.start;
                    }
                    else {
                        //no overlap
                        replacements.push(currentReplacement);
                        currentReplacement = substrings[i];
                        currentEnd = currentReplacement.start + currentReplacement.length;
                    }
                }
            }
            if (currentReplacement) {
                replacements.push(currentReplacement);
            }
            // replace in reverse order
            var charArray = input.split("");
            for (var i = replacements.length - 1; i >= 0; i--) {
                charArray.splice(replacements[i].start, replacements[i].length, "*", "*", "*", "*", "*", "*", "*", "*");
            }
            return charArray.join("");
        };
    }
}
//
// TODO: JobInfo is going away soon.  We should just offer the task context the full job message.
//       Until then, we're making the full job message available
//       
function jobInfoFromJob(job, systemAuthHandler) {
    var info = {
        description: job.jobName,
        jobId: job.jobId,
        jobMessage: job,
        planId: job.plan.planId,
        timelineId: job.timeline.id,
        requestId: job.requestId,
        lockToken: job.lockToken,
        systemAuthHandler: systemAuthHandler,
        variables: job.environment.variables,
        mask: createMaskFunction(job.environment)
    };
    return info;
}
exports.jobInfoFromJob = jobInfoFromJob;
function versionStringFromTaskDef(task) {
    return task.version.major + '.' + task.version.minor + '.' + task.version.patch;
}
exports.versionStringFromTaskDef = versionStringFromTaskDef;
function sha1HexHash(content) {
    return crypto.createHash('sha1').update(content).digest('hex');
}
exports.sha1HexHash = sha1HexHash;
function extractFile(source, dest, done) {
    if (!fs.existsSync(source)) {
        done(new Error('Source file ' + source + ' does not exist.'));
        return;
    }
    try {
        var file = new zip(source);
        file.extractAllTo(dest, true);
        done(null);
    }
    catch (err) {
        done(new Error('Failed to extract zip: ' + source));
    }
}
exports.extractFile = extractFile;
function getWorkPath(config) {
    var rootAgentDir = path.join(__dirname, '..');
    return path.resolve(rootAgentDir, config.settings.workFolder);
}
exports.getWorkPath = getWorkPath;
function getWorkerDiagPath(config) {
    return path.join(getWorkPath(config), '_diag');
}
exports.getWorkerDiagPath = getWorkerDiagPath;
function getWorkerLogsPath(config) {
    return path.join(getWorkPath(config), '_logs');
}
exports.getWorkerLogsPath = getWorkerLogsPath;
//-----------------------------------------------------------
// Cred Utilities
//-----------------------------------------------------------
function basicHandlerFromCreds(creds) {
    return new basicm.BasicCredentialHandler(creds.username, creds.password);
}
exports.basicHandlerFromCreds = basicHandlerFromCreds;
// gets basic creds from args or prompts
function readBasicCreds() {
    var defer = Q.defer();
    var credInputs = [
        {
            name: 'username', description: 'alternate username', arg: 'u', type: 'string', req: true
        },
        {
            name: 'password', description: 'alternate password', arg: 'p', type: 'password', req: true
        }
    ];
    inputs.get(credInputs, function (err, result) {
        if (err) {
            defer.reject(err);
            return;
        }
        var cred = {};
        cred.username = result['username'];
        cred.password = result['password'];
        defer.resolve(cred);
    });
    return defer.promise;
}
exports.readBasicCreds = readBasicCreds;
