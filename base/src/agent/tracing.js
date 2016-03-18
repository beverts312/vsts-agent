// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var path = require('path');
var os = require('os');
var Tracing = (function () {
    function Tracing(fullPath, writer) {
        var ext = path.extname(fullPath);
        this.scope = path.basename(fullPath, ext);
        this.writer = writer;
    }
    Tracing.prototype.enter = function (location) {
        this.write(location + '>>>>>>>>>> ');
    };
    Tracing.prototype.callback = function (location) {
        this.write(location + '<<<<<<<<<< ');
    };
    Tracing.prototype.state = function (name, data) {
        this.write(name + ':' + JSON.stringify(data, null, 2));
    };
    Tracing.prototype.write = function (message) {
        this.writer.trace('[' + new Date().toISOString() + '] ' + this.scope + ':' + '> ' + message + os.EOL);
    };
    Tracing.prototype.error = function (message) {
        this.write('[Error] ' + message);
    };
    return Tracing;
})();
exports.Tracing = Tracing;
