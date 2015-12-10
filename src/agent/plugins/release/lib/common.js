// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
exports.releaseVars = {};
exports.releaseVars.agentReleaseDirectory = 'agent.releaseDirectory';
exports.releaseVars.systemArtifactsDirectory = 'system.artifactsDirectory';
exports.releaseVars.skipArtifactsDownload = 'release.skipartifactsDownload';
exports.releaseVars.releaseId = 'release.releaseId';
exports.releaseVars.buildId = 'build.buildId';
exports.releaseVars.releaseDefinitionName = 'release.definitionName';
function reviver(key, val) {
    if (key) {
        this[key.charAt(0).toLowerCase() + key.slice(1)] = val;
    }
    else {
        return val;
    }
}
exports.reviver = reviver;
