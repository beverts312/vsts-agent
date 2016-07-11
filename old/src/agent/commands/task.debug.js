function createSyncCommand(command) {
    return new TaskDebugCommand(command);
}
exports.createSyncCommand = createSyncCommand;
var TaskDebugCommand = (function () {
    function TaskDebugCommand(command) {
        this.command = command;
    }
    TaskDebugCommand.prototype.runCommand = function (executionContext) {
        if (this.command.message) {
            executionContext.verbose(this.command.message);
        }
    };
    return TaskDebugCommand;
})();
exports.TaskDebugCommand = TaskDebugCommand;
