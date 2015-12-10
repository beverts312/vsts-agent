// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var releaseIfm = require('vso-node-api/interfaces/ReleaseManagementInterfaces');
var jenkinsArtifact = require('./jenkinsArtifact');
var Q = require('q');
var buildArtifact = require('./buildArtifact');
var ArtifactResolver = (function () {
    function ArtifactResolver() {
    }
    ArtifactResolver.prototype.download = function (context, artifactDefinition, artifactFolder) {
        if (artifactDefinition.artifactType === releaseIfm.AgentArtifactType.Jenkins) {
            return new jenkinsArtifact.JenkinsArtifact().download(context, artifactDefinition, artifactFolder);
        }
        else if (artifactDefinition.artifactType === releaseIfm.AgentArtifactType.Build) {
            return new buildArtifact.BuildArtifact().download(context, artifactDefinition, artifactFolder);
        }
        else {
            var defer = Q.defer();
            defer.reject('The artifact type is not yet supported: ' + artifactDefinition.artifactType);
            return defer.promise;
        }
    };
    return ArtifactResolver;
})();
exports.ArtifactResolver = ArtifactResolver;
