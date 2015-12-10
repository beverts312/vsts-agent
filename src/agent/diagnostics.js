// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
/// <reference path="./definitions/node.d.ts"/>
var fs = require('fs');
var path = require('path');
var os = require("os");
var cm = require('./common');
var shell = require('shelljs');
var async = require('async');
//
// Synchronous FileLogWriter
// This is a synchronous client app running synchronous tasks so not an issue. 
// Would not want to use this on a server
//
var DiagnosticFileWriter = (function () {
    function DiagnosticFileWriter(level, fullPath, fileName) {
        this.level = level;
        shell.mkdir('-p', fullPath);
        shell.chmod(775, fullPath);
        // TODO: handle failure cases.  It throws - Error: ENOENT, open '/nopath/somefile.log'
        //       we probably shouldn't handle - fail to start with good error - better than silence ...
        this._fd = fs.openSync(path.join(fullPath, fileName), 'a'); // append, create if not exist
    }
    DiagnosticFileWriter.prototype.write = function (message) {
        fs.writeSync(this._fd, message);
    };
    DiagnosticFileWriter.prototype.writeError = function (message) {
        fs.writeSync(this._fd, message);
    };
    DiagnosticFileWriter.prototype.divider = function () {
        this.write('----------------------------------------');
    };
    DiagnosticFileWriter.prototype.end = function () {
    };
    return DiagnosticFileWriter;
})();
exports.DiagnosticFileWriter = DiagnosticFileWriter;
var RollingDiagnosticFileWriter = (function () {
    function RollingDiagnosticFileWriter(level, folder, filenamePrefix, settings) {
        this._lineCount = 0;
        this._uniqueFileCounter = 1;
        this.level = level;
        this._folder = folder;
        this._filenamePrefix = filenamePrefix;
        this._maxLinesPerFile = settings.linesPerFile;
        this._filesToKeep = settings.maxFiles;
        this._initializeFileQueue();
    }
    RollingDiagnosticFileWriter.prototype.write = function (message) {
        var fileDescriptor = this._getFileDescriptor();
        fs.writeSync(fileDescriptor, message);
        if (message) {
            // count newlines
            this._lineCount += message.split('\n').length - 1;
        }
    };
    RollingDiagnosticFileWriter.prototype.writeError = function (message) {
        this.write(message);
    };
    RollingDiagnosticFileWriter.prototype.end = function () {
        if (this._fileDescriptor) {
            fs.closeSync(this._fileDescriptor);
        }
    };
    RollingDiagnosticFileWriter.prototype._getFileDescriptor = function () {
        if (this._fileDescriptor && this._lineCount >= this._maxLinesPerFile) {
            // close the current file
            fs.closeSync(this._fileDescriptor);
            this._fileDescriptor = undefined;
        }
        if (!this._fileDescriptor) {
            // create a new file and reset the line count
            var filename = this._generateFilename();
            this._lineCount = 0;
            this._fileDescriptor = fs.openSync(filename, 'a');
            // add the filename to the queue and delete any old ones
            this._fileQueue.push(filename);
            this._deleteOldFiles();
        }
        return this._fileDescriptor;
    };
    RollingDiagnosticFileWriter.prototype._generateFilename = function () {
        var datePart = new Date().toISOString().replace(/:/gi, '_');
        var filename = this._filenamePrefix + '_' + process.pid + '_' + datePart;
        if (filename === this._previouslyGeneratedFilename) {
            filename += '_' + this._uniqueFileCounter++;
        }
        else {
            this._previouslyGeneratedFilename = filename;
            this._uniqueFileCounter = 1;
        }
        filename += '.log';
        return path.join(this._folder, filename);
    };
    RollingDiagnosticFileWriter.prototype._initializeFileQueue = function () {
        var _this = this;
        if (fs.existsSync(this._folder)) {
            this._fileQueue = fs.readdirSync(this._folder).filter(function (filename) {
                // get files that start with the prefix
                return filename.substr(0, _this._filenamePrefix.length) == _this._filenamePrefix;
            }).map(function (filename) {
                // get last modified time
                return {
                    filename: filename,
                    lastModified: fs.statSync(path.join(_this._folder, filename)).mtime.getTime()
                };
            }).sort(function (a, b) {
                // sort by lastModified 
                return a.lastModified - b.lastModified;
            }).map(function (entry) {
                return path.join(_this._folder, entry.filename);
            });
            if (this._fileQueue.length > 0) {
                // open the most recent file and count the lines
                // these files should not be huge. if they become huge, and we need to stream them, we'll need to refactor
                var mostRecentFile = this._fileQueue[this._fileQueue.length - 1];
                var existingContents = fs.readFileSync(mostRecentFile).toString();
                var lineCount = existingContents.split(os.EOL).length;
                if (lineCount < this._maxLinesPerFile) {
                    // if the file isn't full, use it. if it is, we'll create a new one the next time _getFileDescriptor() is called
                    this._lineCount = lineCount;
                    this._fileDescriptor = fs.openSync(mostRecentFile, 'a');
                }
            }
            // delete any old log files
            this._deleteOldFiles();
        }
        else {
            shell.mkdir('-p', this._folder);
            shell.chmod(775, this._folder);
            this._fileQueue = [];
        }
    };
    RollingDiagnosticFileWriter.prototype._deleteOldFiles = function () {
        while (this._fileQueue.length > this._filesToKeep) {
            fs.unlinkSync(this._fileQueue.splice(0, 1)[0]);
        }
    };
    return RollingDiagnosticFileWriter;
})();
exports.RollingDiagnosticFileWriter = RollingDiagnosticFileWriter;
var DiagnosticConsoleWriter = (function () {
    function DiagnosticConsoleWriter(level) {
        this.level = level;
    }
    DiagnosticConsoleWriter.prototype.write = function (message) {
        process.stdout.write(message, 'utf8');
    };
    DiagnosticConsoleWriter.prototype.writeError = function (message) {
        process.stderr.write(message, 'utf8');
    };
    DiagnosticConsoleWriter.prototype.end = function () {
    };
    return DiagnosticConsoleWriter;
})();
exports.DiagnosticConsoleWriter = DiagnosticConsoleWriter;
function getDefaultDiagnosticWriter(config, folder, prefix) {
    // default writer is verbose. it's rolling, so it shouldn't take up too much space
    return new RollingDiagnosticFileWriter(cm.DiagnosticLevel.Verbose, folder, prefix, config.settings.logSettings);
}
exports.getDefaultDiagnosticWriter = getDefaultDiagnosticWriter;
