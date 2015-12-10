// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
/// <reference path="./definitions/node.d.ts"/>
var path = require('path');
var fs = require('fs');
var shell = require('shelljs');
var events = require('events');
var async = require('async');
var uuid = require('node-uuid');
// TODO: support elapsed time as well
var PAGE_SIZE = 256;
//
// Synchronous logger with paging for upload to server.  Worker and tasks are synchronous via a child process so no need for async
//
var PagingLogger = (function (_super) {
    __extends(PagingLogger, _super);
    function PagingLogger(logFolder, metadata) {
        _super.call(this);
        this.stream = null;
        this.pageCount = 0;
        this.lineCount = 0;
        this.metadata = metadata;
        this.pagesId = uuid.v1();
        var logName = new Date().toISOString().replace(':', '-') + '_' + process.pid + '.log';
        this.logPath = path.join(logFolder, logName);
        this.pageFolder = path.join(logFolder, 'pages');
        shell.mkdir('-p', this.pageFolder);
        shell.chmod(775, this.pageFolder);
    }
    PagingLogger.prototype.write = function (line) {
        // lazy creation on write
        if (!this._fd) {
            this.create();
        }
        fs.writeSync(this._fd, this.metadata.jobInfo.mask(line));
        // TODO: split lines - line count not completely accurate
        if (++this.lineCount >= PAGE_SIZE) {
            this.newPage();
        }
    };
    PagingLogger.prototype.writeError = function (line) {
        this.write(line);
    };
    PagingLogger.prototype.end = function () {
        this.endPage();
    };
    //------------------------------------------------------------------
    // PRIVATE
    //------------------------------------------------------------------
    PagingLogger.prototype.create = function () {
        // write the log metadata file
        this.metadata.pagesId = this.pagesId;
        this.metadata.logPath = this.logPath;
        this.newPage();
        this.created = true;
    };
    PagingLogger.prototype.newPage = function () {
        this.endPage();
        this.pageFilePath = path.join(this.pageFolder, this.pagesId + '_' + ++this.pageCount + '.page');
        this._fd = fs.openSync(this.pageFilePath, 'a'); // append, create if not exist
        this.created = true;
        this.lineCount = 0;
    };
    PagingLogger.prototype.endPage = function () {
        if (this._fd) {
            fs.closeSync(this._fd);
            this.created = false;
            var info = {};
            info.logInfo = this.metadata;
            info.pagePath = this.pageFilePath;
            info.pageNumber = this.pageCount;
            this.emit('pageComplete', info);
        }
    };
    return PagingLogger;
})(events.EventEmitter);
exports.PagingLogger = PagingLogger;
