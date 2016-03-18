/// <reference path="../definitions/vso-node-api.d.ts" />
var agentifm = require('vso-node-api/interfaces/TaskAgentInterfaces');
function createSyncCommand(command) {
    return new TaskCompleteCommand(command);
}
exports.createSyncCommand = createSyncCommand;
var TaskCompleteCommand = (function () {
    function TaskCompleteCommand(command) {
        this.command = command;
    }
    TaskCompleteCommand.prototype.runCommand = function (executionContext) {
        if (this.command.message) {
            executionContext.resultMessage = this.command.message;
        }
        var result = this.command.properties['result'];
        switch (result.toLowerCase()) {
            case "failed":
                executionContext.result = agentifm.TaskResult.Failed;
                break;
            default:
                executionContext.result = agentifm.TaskResult.Succeeded;
                break;
        }
    };
    return TaskCompleteCommand;
})();
exports.TaskCompleteCommand = TaskCompleteCommand;
