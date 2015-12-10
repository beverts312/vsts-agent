var TaskCommand = (function () {
    function TaskCommand(command, properties, message) {
        this.command = command;
        this.properties = properties;
        this.message = message;
        this.lines = [];
    }
    TaskCommand.prototype.info = function (message) {
        this.lines.push(message);
    };
    TaskCommand.prototype.warning = function (message) {
        this.lines.push('[warning]' + message);
    };
    TaskCommand.prototype.error = function (message) {
        this.lines.push('[error]' + message);
    };
    return TaskCommand;
})();
exports.TaskCommand = TaskCommand;
