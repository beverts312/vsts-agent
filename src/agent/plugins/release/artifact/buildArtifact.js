// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var common = require('../../../common');
var webapim = require('vso-node-api/WebApi');
var barr = require('./buildArtifactResolver');
var Q = require('q');
var releaseCommon = require('../lib/common');
var async = require('async');
var BuildArtifact = (function () {
    function BuildArtifact() {
    }
    BuildArtifact.prototype.download = function (context, artifactDefinition, artifactFolder) {
        var defer = Q.defer();
        try {
            var buildDetails = JSON.parse(artifactDefinition.details, releaseCommon.reviver);
            var serverUrl = context.variables[common.vars.systemTfCollectionUri];
            var buildClient = new webapim.WebApi(serverUrl, context.jobInfo.systemAuthHandler).getQBuildApi();
            buildClient.getArtifacts(+artifactDefinition.version, buildDetails.project).then(function (buildArtifacts) {
                if (buildArtifacts.length === 0) {
                    defer.reject('No artifacts are available in the build ' + artifactDefinition.version + '. Make sure that the build is publishing an artifact and try again.');
                }
                var promises = [];
                for (var index = 0; index < buildArtifacts.length; index++) {
                    promises.push(new barr.BuildArtifactResolver().resolve(context, buildDetails, buildArtifacts[index], +artifactDefinition.version, artifactFolder));
                }
                Q.all(promises).then(function () {
                    defer.resolve(null);
                    return;
                }).fail(function (err) {
                    defer.reject(err);
                    return;
                });
            }).fail(function (err) {
                defer.reject(err);
                return;
            });
        }
        catch (error) {
            defer.reject(error);
            return;
        }
        return defer.promise;
    };
    return BuildArtifact;
})();
exports.BuildArtifact = BuildArtifact;
