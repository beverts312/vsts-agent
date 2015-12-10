/// <reference path="../definitions/vso-node-api.d.ts" />
var ctxm = require('../context');
function createAsyncCommand(executionContext, command) {
    return new ArtifactAssociateCommand(executionContext, command);
}
exports.createAsyncCommand = createAsyncCommand;
var ArtifactAssociateCommand = (function () {
    function ArtifactAssociateCommand(executionContext, command) {
        this.command = command;
        this.executionContext = executionContext;
        this.description = "Associate an artifact with a build";
    }
    ArtifactAssociateCommand.prototype.runCommandAsync = function () {
        var artifactName = this.command.properties["artifactname"];
        var artifactType = this.command.properties["artifacttype"];
        var artifactLocation = this.command.message;
        this.command.info('artifactName: ' + artifactName);
        this.command.info('artifactType: ' + artifactType);
        this.command.info('artifactLocation: ' + artifactLocation);
        this.command.info('Associating artifact...');
        var buildId = parseInt(this.executionContext.variables[ctxm.WellKnownVariables.buildId]);
        var artifact = {
            name: artifactName,
            resource: {
                type: artifactType,
                data: artifactLocation
            }
        };
        var webapi = this.executionContext.getWebApi();
        var buildClient = webapi.getQBuildApi();
        return buildClient.createArtifact(artifact, buildId, this.executionContext.variables[ctxm.WellKnownVariables.projectId]);
    };
    return ArtifactAssociateCommand;
})();
exports.ArtifactAssociateCommand = ArtifactAssociateCommand;
