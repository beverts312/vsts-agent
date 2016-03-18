/// <reference path="../definitions/vso-node-api.d.ts" />
var ctxm = require('../context');
var Q = require('q');
var fc = require('../filecontainerhelper');
function createAsyncCommand(executionContext, command) {
    return new ArtifactUploadCommand(executionContext, command);
}
exports.createAsyncCommand = createAsyncCommand;
var ArtifactUploadCommand = (function () {
    function ArtifactUploadCommand(executionContext, command) {
        this.command = command;
        this.executionContext = executionContext;
        this.description = "Upload a build artifact";
    }
    ArtifactUploadCommand.prototype.runCommandAsync = function () {
        var _this = this;
        var artifactName = this.command.properties["artifactname"];
        var containerFolder = this.command.properties["containerfolder"];
        if (!containerFolder) {
            ;
            return Q.reject(new Error("No container folder specified."));
        }
        else if (containerFolder.charAt(0) !== "/") {
            containerFolder = "/" + containerFolder;
        }
        var localPath = this.command.properties['localpath'] || this.command.message;
        var containerId = parseInt(this.executionContext.variables[ctxm.WellKnownVariables.containerId]);
        this.command.info('artifactName: ' + artifactName);
        this.command.info('containerFolder: ' + containerFolder);
        this.command.info('localPath: ' + localPath);
        this.command.info('Uploading contents...');
        this.command.info(fc.copyToFileContainer);
        return fc.copyToFileContainer(this.executionContext, localPath, containerId, containerFolder).then(function (artifactLocation) {
            _this.command.info('Associating artifact ' + artifactLocation + ' ...');
            var buildId = parseInt(_this.executionContext.variables[ctxm.WellKnownVariables.buildId]);
            var artifact = {
                name: artifactName,
                resource: {
                    type: "container",
                    data: artifactLocation
                }
            };
            var webapi = _this.executionContext.getWebApi();
            var buildClient = webapi.getQBuildApi();
            return buildClient.createArtifact(artifact, buildId, _this.executionContext.variables[ctxm.WellKnownVariables.projectId]);
        });
    };
    return ArtifactUploadCommand;
})();
exports.ArtifactUploadCommand = ArtifactUploadCommand;
