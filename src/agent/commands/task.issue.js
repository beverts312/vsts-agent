function createSyncCommand(command) {
    return new TaskIssueCommand(command);
}
exports.createSyncCommand = createSyncCommand;
var TaskIssueCommand = (function () {
    function TaskIssueCommand(command) {
        this.command = command;
    }
    TaskIssueCommand.prototype.runCommand = function (executionContext) {
        if (!this.command.properties || !this.command.properties['type']) {
            executionContext.warning('command issue type not set');
            return;
        }
        switch (this.command.properties['type'].toLowerCase()) {
            case "error":
                executionContext.error(this.command.message);
                break;
            case "warning":
                executionContext.warning(this.command.message);
                break;
            default:
                executionContext.warning('Invalid command issue type: ' + this.command.properties['type']);
                break;
        }
    };
    return TaskIssueCommand;
})();
exports.TaskIssueCommand = TaskIssueCommand;
