// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var common = require('../../../common');
var utilm = require('../../../utilities');
var path = require('path');
var fs = require('fs');
var Q = require('q');
var cm = require('../../../common');
var webapim = require('vso-node-api/WebApi');
var shell = require('shelljs');
var BuildArtifactResolver = (function () {
    function BuildArtifactResolver() {
    }
    BuildArtifactResolver.prototype.resolve = function (context, buildDetails, buildArtifact, buildId, artifactFolder) {
        var defer = Q.defer();
        var artifactDownloadFolder = path.join(artifactFolder, buildArtifact.name);
        if (buildArtifact.resource.type === undefined && buildArtifact.id === 0 || buildArtifact.resource.type.toLowerCase() === 'filepath') {
            utilm.ensurePathExists(artifactDownloadFolder).then(function () {
                var fileShare = buildArtifact.id === 0 ? buildArtifact.resource.data : path.join(buildArtifact.resource.data, buildArtifact.name);
                shell.cp('-rf', path.join(fileShare, '*'), artifactDownloadFolder);
                var errorMessage = shell.error();
                if (errorMessage) {
                    context.info('Error while downloading artifact: ' + buildArtifact.name + ' (Source location: ' + fileShare + ')');
                    defer.reject(errorMessage);
                    return;
                }
                defer.resolve(null);
            }).fail(function (err) {
                defer.reject(err);
                return;
            });
        }
        else if (buildArtifact.resource.type.toLowerCase() === 'container') {
            var serverUrl = context.variables[common.vars.systemTfCollectionUri];
            var buildClient = new webapim.WebApi(serverUrl, context.jobInfo.systemAuthHandler).getBuildApi();
            var zipFilePath = artifactDownloadFolder + '.zip';
            buildClient.getArtifactContentZip(buildId, buildArtifact.name, buildDetails.project, function (err, statusCode, res) {
                if (err) {
                    defer.reject(err);
                    return;
                }
                var fileStream = fs.createWriteStream(zipFilePath);
                res.pipe(fileStream);
                fileStream.on('finish', function () {
                    cm.extractFile(artifactDownloadFolder + '.zip', artifactFolder, function (err) {
                        if (err) {
                            context.info('Error extracting artifact: ' + buildArtifact.name);
                            defer.reject(err);
                            return;
                        }
                        shell.rm('-rf', artifactDownloadFolder + '.zip');
                        var errorMessage = shell.error();
                        if (errorMessage) {
                            fileStream.end();
                            defer.reject(errorMessage);
                            return;
                        }
                        fileStream.end();
                        defer.resolve(null);
                        return;
                    });
                });
            });
        }
        else {
            context.info('Release management does not support download of this artifact type: ' + buildArtifact.resource.type);
            defer.resolve(null);
            return;
        }
        return defer.promise;
    };
    return BuildArtifactResolver;
})();
exports.BuildArtifactResolver = BuildArtifactResolver;
