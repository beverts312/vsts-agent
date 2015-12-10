var path = require('path');
var fs = require('fs');
var zlib = require('zlib');
var Q = require("q");
var shell = require("shelljs");
var fchelperm = require('../../../filecontainerhelper');
var fcifm = require('vso-node-api/interfaces/FileContainerInterfaces');
var tm = require('../../../tracing');
var uuid = require('node-uuid');
var _temp;
var _ctx;
var _containerId;
var _stagingFolder;
var _containerRoot;
var _trace;
function _ensureTracing(ctx, area) {
    _trace = new tm.Tracing(__filename, ctx.traceWriter);
    _trace.enter(area);
}
function uploadFiles(ctx, stagingFolder, containerId, containerRoot, filePaths) {
    _ctx = ctx;
    _ensureTracing(_ctx, 'uploadFiles');
    _stagingFolder = stagingFolder;
    _containerId = containerId;
    _containerRoot = containerRoot;
    _ensureTemp(ctx.workingDirectory);
    return _uploadFiles(filePaths)
        .then(function () {
        shell.rm('-rf', _temp);
    });
}
exports.uploadFiles = uploadFiles;
function _ensureTemp(workingFolder) {
    _ensureTracing(_ctx, 'ensureTemp');
    _temp = path.join(workingFolder, 'tmp');
    if (shell.test('-d', _temp)) {
        shell.rm('-rf', _temp);
    }
    shell.mkdir('-p', _temp);
}
function _getFileSize(filePath) {
    _ensureTracing(_ctx, '_getFileSize');
    _trace.write('fileSize for: ' + filePath);
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
        _trace.write('end size: ' + l);
        defer.resolve(l);
    });
    rs.on('error', function (err) {
        _trace.error('_getFileSize error! - ' + filePath);
        defer.reject(err);
    });
    return defer.promise;
}
//
// TODO: change upload api to use itemPath query string param
//
function _zipToTemp(filePath) {
    _ensureTracing(_ctx, '_zipToTemp');
    var defer = Q.defer();
    try {
        var gzip = zlib.createGzip();
        var inputStream = fs.createReadStream(filePath);
        var zipDest = path.join(_temp, uuid.v1() + '.gz');
        var ws = fs.createWriteStream(zipDest);
        _trace.write('ws for: ' + zipDest);
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
}
function _uploadZip(filePath, fileSize, containerPath) {
    _ensureTracing(_ctx, '_uploadZip');
    var info = {};
    return _zipToTemp(filePath)
        .then(function (zipPath) {
        info.zipPath = zipPath;
        return _getFileSize(zipPath);
    })
        .then(function (zipSize) {
        _trace.write(info.zipPath + ':' + zipSize);
        var item = {
            fullPath: info.zipPath,
            containerItem: {
                containerId: _containerId,
                itemType: fcifm.ContainerItemType.File,
                path: containerPath
            },
            uploadHeaders: fchelperm.getUploadHeaders(true, fileSize, zipSize)
        };
        _trace.state('item', item);
        return _ctx.service.uploadFileToContainer(_containerId, item);
    });
}
function _uploadFile(filePath) {
    _ensureTracing(_ctx, '_uploadFile');
    var info = {};
    var containerPath = path.join(_containerRoot, filePath.substring(_stagingFolder.length + 1));
    _ctx.info(containerPath);
    _trace.state('containerPath', containerPath);
    return _getFileSize(filePath)
        .then(function (size) {
        info.originalSize = size;
        if (size > (65 * 1024)) {
            return _uploadZip(filePath, size, containerPath);
        }
        else {
            var item = {
                fullPath: filePath,
                containerItem: {
                    containerId: _containerId,
                    itemType: fcifm.ContainerItemType.File,
                    path: containerPath
                },
                uploadHeaders: fchelperm.getUploadHeaders(false, size)
            };
            _trace.state('item', item);
            return _ctx.service.uploadFileToContainer(_containerId, item);
        }
    });
}
var _uploadFiles = function (files) {
    _ensureTracing(_ctx, '_uploadFiles');
    var result = Q(null); // empty promise
    files.forEach(function (f) {
        result = result.then(function () {
            return _uploadFile(f);
        });
    });
    return result;
};
