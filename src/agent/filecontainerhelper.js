var Q = require('q');
var utils = require('./utilities');
var path = require('path');
var shell = require("shelljs");
var fs = require('fs');
var zlib = require('zlib');
var fcifm = require('vso-node-api/interfaces/FileContainerInterfaces');
var uuid = require('node-uuid');
function copyToFileContainer(executionContext, localPath, containerId, containerFolder) {
    var fc = new FileContainerHelper(executionContext);
    return fc.copyToFileContainer(localPath, containerId, containerFolder);
}
exports.copyToFileContainer = copyToFileContainer;
function getUploadHeaders(isGzipped, uncompressedLength, compressedLength, contentIdentifier) {
    var addtlHeaders = {};
    var byteLengthToSend = isGzipped ? compressedLength : uncompressedLength;
    addtlHeaders["Content-Range"] = "bytes 0-" + (byteLengthToSend - 1) + "/" + byteLengthToSend;
    addtlHeaders["Content-Length"] = byteLengthToSend;
    if (isGzipped) {
        addtlHeaders["Accept-Encoding"] = "gzip";
        addtlHeaders["Content-Encoding"] = "gzip";
        addtlHeaders["x-tfs-filelength"] = uncompressedLength;
    }
    if (contentIdentifier) {
        addtlHeaders["x-vso-contentId"] = contentIdentifier.toString("base64");
    }
    return addtlHeaders;
}
exports.getUploadHeaders = getUploadHeaders;
var FileContainerHelper = (function () {
    function FileContainerHelper(executionContext) {
        this._executionContext = executionContext;
    }
    FileContainerHelper.prototype.copyToFileContainer = function (localPath, containerId, containerFolder) {
        var _this = this;
        this._executionContext.verbose("copyToFileContainer(" + localPath + ", " + containerId + ", " + containerFolder + ")");
        return utils.readDirectory(localPath, true, false)
            .then(function (files) {
            _this._executionContext.verbose("found " + files.length + " files");
            return _this._uploadFiles(localPath, containerId, containerFolder, files);
        })
            .then(function () {
            return '#/' + containerId + containerFolder;
        });
    };
    FileContainerHelper.prototype._uploadFiles = function (localPath, containerId, containerRoot, filePaths) {
        var _this = this;
        var tempFolder = this._ensureTemp(this._executionContext.workingDirectory);
        var fileUploadPromise = Q(null); // empty promise
        filePaths.forEach(function (filePath) {
            fileUploadPromise = fileUploadPromise.then(function () {
                return _this._uploadFile(filePath, localPath, tempFolder, containerId, containerRoot);
            });
        });
        return fileUploadPromise.then(function () {
            shell.rm('-rf', tempFolder);
        });
    };
    FileContainerHelper.prototype._ensureTemp = function (workingFolder) {
        var tempFolder = path.join(workingFolder, 'tmp');
        if (shell.test('-d', tempFolder)) {
            shell.rm('-rf', tempFolder);
        }
        shell.mkdir('-p', tempFolder);
        return tempFolder;
    };
    FileContainerHelper.prototype._getFileSize = function (filePath) {
        var _this = this;
        this._executionContext.verbose('fileSize for: ' + filePath);
        var defer = Q.defer();
        var l = 0;
        var rs = fs.createReadStream(filePath);
        rs.on('readable', function () {
            var chunk;
            while (null !== (chunk = rs.read())) {
                l += chunk.length;
            }
        });
        rs.on('end', function () {
            _this._executionContext.verbose('end size: ' + l);
            defer.resolve(l);
        });
        rs.on('error', function (err) {
            _this._executionContext.error('_getFileSize error! - ' + filePath);
            defer.reject(err);
        });
        return defer.promise;
    };
    FileContainerHelper.prototype._uploadFile = function (filePath, rootFolder, tempFolder, containerId, containerRoot) {
        var _this = this;
        var info = {};
        var containerPath = path.join(containerRoot, filePath.substring(rootFolder.length + 1));
        this._executionContext.verbose('containerPath = ' + containerPath);
        return this._getFileSize(filePath).then(function (size) {
            info.originalSize = size;
            if (size > (65 * 1024)) {
                return _this._uploadZip(filePath, tempFolder, size, containerId, containerPath);
            }
            else {
                var item = {
                    fullPath: filePath,
                    uploadHeaders: getUploadHeaders(false, size),
                    containerItem: {
                        containerId: containerId,
                        itemType: fcifm.ContainerItemType.File,
                        path: containerPath
                    }
                };
                return _this._executionContext.service.uploadFileToContainer(containerId, item);
            }
        });
    };
    //
    // TODO: change upload api to use itemPath query string param
    //
    FileContainerHelper.prototype._zipToTemp = function (filePath, tempFolder) {
        var defer = Q.defer();
        try {
            var gzip = zlib.createGzip();
            var inputStream = fs.createReadStream(filePath);
            var zipDest = path.join(tempFolder, uuid.v1() + '.gz');
            var ws = fs.createWriteStream(zipDest);
            this._executionContext.verbose('ws for: ' + zipDest);
            gzip.on('end', function () {
                defer.resolve(zipDest);
            });
            gzip.on('error', function (err) {
                defer.reject(err);
            });
            inputStream.on('error', function (err) {
                defer.reject(err);
            });
            ws.on('error', function (err) {
                defer.reject(err);
            });
            inputStream.pipe(gzip).pipe(ws);
        }
        catch (err) {
            defer.reject(err);
        }
        return defer.promise;
    };
    FileContainerHelper.prototype._uploadZip = function (filePath, tempFolder, fileSize, containerId, containerPath) {
        var _this = this;
        var info = {};
        return this._zipToTemp(filePath, tempFolder)
            .then(function (zipPath) {
            info.zipPath = zipPath;
            return _this._getFileSize(zipPath);
        })
            .then(function (zipSize) {
            _this._executionContext.verbose(info.zipPath + ':' + zipSize);
            var item = {
                fullPath: info.zipPath,
                uploadHeaders: getUploadHeaders(true, fileSize, zipSize),
                containerItem: {
                    containerId: containerId,
                    itemType: fcifm.ContainerItemType.File,
                    path: containerPath
                }
            };
            return _this._executionContext.service.uploadFileToContainer(containerId, item);
        });
    };
    return FileContainerHelper;
})();
exports.FileContainerHelper = FileContainerHelper;
