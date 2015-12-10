// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var common = require('../../common');
var utilm = require('../../utilities');
var releaseCommon = require('./lib/common');
var webapim = require('vso-node-api/WebApi');
var releaseIfm = require('vso-node-api/interfaces/ReleaseManagementInterfaces');
var artifactResolver = require('./artifact/artifactResolver');
var path = require('path');
var crypto = require('crypto');
var Q = require('q');
var async = require('async');
var shell = require("shelljs");
function pluginName() {
    return "Download artifacts";
}
exports.pluginName = pluginName;
// what shows in progress view
function pluginTitle() {
    return "pluginTitle: Downloading artifacts";
}
exports.pluginTitle = pluginTitle;
function beforeJob(context, callback) {
    context.info('Prepare artifacts download.');
    var skipArtifactDownload = context.variables[releaseCommon.releaseVars.skipArtifactsDownload].toLowerCase() === 'true';
    var releaseId = +context.variables[releaseCommon.releaseVars.releaseId];
    var teamProjectId = context.variables[common.vars.systemTeamProjectId];
    var releaseDefinitionName = context.variables[releaseCommon.releaseVars.releaseDefinitionName];
    context.info('SkipArtifactsDownload=' + skipArtifactDownload + ', ReleaseId=' + releaseId + ', TeamProjectId=' + teamProjectId + ', ReleaseDefintionName=' + releaseDefinitionName);
    var artifactsFolder = path.join(context.workingDirectory, 'release', createHash(teamProjectId, releaseDefinitionName));
    context.info('Artifacts folder:' + artifactsFolder);
    var serverUrl = context.jobInfo.jobMessage.environment.systemConnection.url;
    var rmClient = new webapim.WebApi(serverUrl, context.jobInfo.systemAuthHandler).getQReleaseManagemntApi();
    rmClient.getAgentArtifactDefinitions(teamProjectId, releaseId).then(function (artifactDefinitions) {
        if (skipArtifactDownload) {
            context.info('Skipping artifact download based on the setting specified.');
            utilm.ensurePathExists(artifactsFolder).then(function () {
                setAndLogLocalVariables(context, artifactsFolder, artifactDefinitions);
                callback();
                return;
            }).fail(function (err) {
                callback(err);
                return;
            });
        }
        else {
            cleanUpArtifactsDirectory(context, artifactsFolder, callback);
            context.info('Number of artifacts to download: ' + artifactDefinitions.length);
            context.info('Starting artifacts download...');
            var promises = artifactDefinitions.map(function (artifactDefinition) {
                var artifactFolder = path.join(artifactsFolder, artifactDefinition.alias);
                return utilm.ensurePathExists(artifactFolder).then(function () { return new artifactResolver.ArtifactResolver().download(context, artifactDefinition, artifactFolder); });
            });
            Q.all(promises).then(function () {
                context.info('Finished artifacts download.');
                setAndLogLocalVariables(context, artifactsFolder, artifactDefinitions);
                callback();
                return;
            }).fail(function (err) {
                context.info('There was problem in downloading the artifacts');
                callback(err);
                return;
            });
        }
    }).fail(function (err) {
        callback(err);
        return;
    });
}
exports.beforeJob = beforeJob;
function cleanUpArtifactsDirectory(context, artifactsFolder, callback) {
    context.info('Cleaning artifacts directory: ' + artifactsFolder);
    shell.rm('-rf', artifactsFolder);
    var errorMessage = shell.error();
    if (errorMessage) {
        callback(errorMessage);
    }
    shell.mkdir('-p', artifactsFolder);
    errorMessage = shell.error();
    if (errorMessage) {
        callback(errorMessage);
    }
    context.info('Cleaned artifacts directory: ' + artifactsFolder);
}
exports.cleanUpArtifactsDirectory = cleanUpArtifactsDirectory;
function createHash(teamProject, releaseDefinitionName) {
    var hashProvider = crypto.createHash("sha256");
    var hashInput = teamProject + ':' + releaseDefinitionName;
    hashProvider.update(hashInput, 'utf8');
    return hashProvider.digest('hex');
}
exports.createHash = createHash;
function setAndLogLocalVariables(context, artifactsFolder, artifactDefinitions) {
    // Remove after M90 as it is set by service
    if (artifactDefinitions.length === 1 && artifactDefinitions[0].artifactType === releaseIfm.AgentArtifactType.Build) {
        if (!context.variables[releaseCommon.releaseVars.buildId]) {
            context.variables[releaseCommon.releaseVars.buildId] = artifactDefinitions[0].version;
        }
    }
    context.variables[releaseCommon.releaseVars.agentReleaseDirectory] = artifactsFolder;
    context.variables[releaseCommon.releaseVars.systemArtifactsDirectory] = artifactsFolder;
    context.variables[common.AutomationVariables.defaultWorkingDirectory] = artifactsFolder;
    context.verbose('Environment variables available are below.  Note that these environment variables can be referred to in the task (in the ReleaseDefinition) by replacing "_" with "." e.g. AGENT_WORKINGDIRECTORY environment variable can be referenced using Agent.WorkingDirectory in the ReleaseDefinition:' + JSON.stringify(context.variables, null, 2));
}
exports.setAndLogLocalVariables = setAndLogLocalVariables;
