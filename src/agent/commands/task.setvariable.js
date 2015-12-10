function createSyncCommand(command) {
    return new TaskSetVariableCommand(command);
}
exports.createSyncCommand = createSyncCommand;
var TaskSetVariableCommand = (function () {
    function TaskSetVariableCommand(command) {
        this.command = command;
    }
    TaskSetVariableCommand.prototype.runCommand = function (executionContext) {
        if (!this.command.properties || !this.command.properties['variable']) {
            executionContext.warning('command setvariable variable not set');
            return;
        }
        var varName = this.command.properties['variable'];
        var varVal = this.command.message || '';
        executionContext.jobInfo.jobMessage.environment.variables[varName] = varVal;
    };
    return TaskSetVariableCommand;
})();
exports.TaskSetVariableCommand = TaskSetVariableCommand;
