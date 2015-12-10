// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var path = require('path');
var url = require('url');
var shell = require('shelljs');
var cm = require('../../common');
var smm = require('./sourceMappings');
function pluginName() {
    return "prepareWorkspace";
}
exports.pluginName = pluginName;
// what shows in progress view
function pluginTitle() {
    return "Preparing Workspace";
}
exports.pluginTitle = pluginTitle;
function beforeJob(executionContext, callback) {
    executionContext.info('preparing Workspace');
    executionContext.info('cwd: ' + process.cwd());
    var job = executionContext.jobInfo.jobMessage;
    var variables = job.environment.variables;
    //
    // Get the valid scm providers and filter endpoints
    //
    var supported = [];
    var filter = path.join(executionContext.scmPath, '*.js');
    shell.ls(filter).forEach(function (provPath) {
        supported.push(path.basename(provPath, '.js'));
    });
    executionContext.debug('valid scm providers: ' + supported);
    var endpoints = job.environment.endpoints;
    var srcendpoints = endpoints.filter(function (endpoint) {
        if (!endpoint.type) {
            return false;
        }
        executionContext.info('Repository type: ' + endpoint.type);
        return (supported.indexOf(endpoint.type.toLowerCase()) >= 0);
    });
    if (srcendpoints.length == 0) {
        callback(new Error('Unsupported SCM system.  Supported: ' + supported.toString()));
        return;
    }
    // only support 1 SCM system
    var endpoint = srcendpoints[0];
    //
    // Get SCM plugin
    //
    var scmm;
    var providerType = endpoint.type.toLowerCase();
    executionContext.info('using source provider: ' + providerType);
    try {
        var provPath = path.join(executionContext.scmPath, providerType);
        executionContext.info('loading: ' + provPath);
        scmm = require(provPath);
    }
    catch (err) {
        callback(new Error('Source Provider failed to load: ' + providerType));
        return;
    }
    if (!scmm.getProvider) {
        callback(new Error('SCM Provider does not implement getProvider: ' + providerType));
        return;
    }
    var scmProvider = scmm.getProvider(executionContext, endpoint);
    scmProvider.initialize();
    scmProvider.debugOutput = executionContext.debugOutput;
    var hashKey = scmProvider.hashKey;
    //
    // Get source mappings and set variables
    //
    var workingFolder = variables[cm.vars.agentWorkingDirectory];
    var repoPath;
    var sm = new smm.SourceMappings(workingFolder, executionContext.hostContext);
    sm.supportsLegacyPaths = endpoint.type !== 'tfsversioncontrol';
    sm.getSourceMapping(hashKey, job, endpoint)
        .then(function (srcMap) {
        repoPath = scmProvider.targetPath = path.join(workingFolder, srcMap.build_sourcesdirectory);
        //
        // Variables
        //        
        variables[cm.vars.buildSourcesDirectory] = repoPath;
        variables[cm.vars.buildArtifactStagingDirectory] = path.join(workingFolder, srcMap.build_artifactstagingdirectory);
        // back compat with old publish artifacts task
        variables[cm.vars.buildStagingDirectory] = variables[cm.vars.buildArtifactStagingDirectory];
        variables[cm.vars.commonTestResultsDirectory] = path.join(workingFolder, srcMap.common_testresultsdirectory);
        var bd = variables[cm.vars.agentBuildDirectory] = path.join(workingFolder, srcMap.agent_builddirectory);
        shell.mkdir('-p', bd);
        shell.cd(bd);
        if (endpoint.data['clean'].replaceVars(job.environment.variables) === "true") {
            var behavior = job.environment.variables['build.clean'];
            if (behavior && behavior.toLowerCase() === 'delete') {
                executionContext.info('deleting ' + repoPath);
                shell.rm('-rf', repoPath);
                return 0;
            }
            else {
                executionContext.info('running clean');
                return scmProvider.clean();
            }
        }
        else {
            executionContext.info('running incremental');
            return 0;
        }
    })
        .then(function (code) {
        executionContext.info('getting code');
        return scmProvider.getCode();
    })
        .then(function (code) {
        executionContext.info('CD: ' + repoPath);
        shell.cd(repoPath);
        callback();
    })
        .fail(function (err) {
        callback(err);
        return;
    });
}
exports.beforeJob = beforeJob;
