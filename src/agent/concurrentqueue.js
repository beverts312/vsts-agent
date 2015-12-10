var Q = require('q');
var ConcurrentArray = (function () {
    function ConcurrentArray(process, onError, msDelay) {
        this._finishedAdding = false;
        this._processing = false;
        this._finalBatch = false;
        this._currentArray = [];
        this._deferred = Q.defer();
        this._process = process;
        this._onError = onError;
        this._msDelay = msDelay;
    }
    ConcurrentArray.prototype.push = function (value) {
        if (this._finishedAdding) {
            // be passive - if we shut the queue off, then just don't queue the item
            return;
        }
        this._currentArray.push(value);
    };
    ConcurrentArray.prototype.startProcessing = function () {
        if (!this._processing && !this._finishedAdding) {
            this._processing = true;
            this._processMoreBatches();
        }
    };
    ConcurrentArray.prototype.waitForEmpty = function () {
        return this._deferred.promise;
    };
    ConcurrentArray.prototype.finishAdding = function () {
        this._finishedAdding = true;
    };
    ConcurrentArray.prototype._processMoreBatches = function () {
        var _this = this;
        if (!this._finishedAdding) {
            setTimeout(function () {
                _this._processBatch();
            }, this._msDelay);
        }
        else if (!this._finalBatch) {
            this._finalBatch = true;
            this._processBatch();
        }
        else {
            this._deferred.resolve(null);
        }
    };
    ConcurrentArray.prototype._processBatch = function () {
        var _this = this;
        // swap arrays
        var values = this._currentArray;
        this._currentArray = [];
        this._process(values, function (err) {
            if (err) {
                _this._onError(err);
            }
            _this._processMoreBatches();
        });
    };
    return ConcurrentArray;
})();
exports.ConcurrentArray = ConcurrentArray;
var ConcurrentBatch = (function () {
    function ConcurrentBatch(factory, process, onError, msDelay) {
        this._finishedAdding = false;
        this._processing = false;
        this._finalBatch = false;
        this._currentBatch = {};
        this._deferred = Q.defer();
        this._factory = factory;
        this._process = process;
        this._onError = onError;
        this._msDelay = msDelay;
    }
    ConcurrentBatch.prototype.getOrAdd = function (key) {
        if (this._finishedAdding) {
            var error = new Error("can't add to finished batch");
            throw error;
        }
        var item = this._currentBatch[key];
        if (!item) {
            item = this._factory(key);
            this._currentBatch[key] = item;
        }
        return item;
    };
    ConcurrentBatch.prototype.startProcessing = function () {
        if (!this._processing && !this._finishedAdding) {
            this._processing = true;
            this._processMoreBatches();
        }
    };
    ConcurrentBatch.prototype.waitForEmpty = function () {
        return this._deferred.promise;
    };
    ConcurrentBatch.prototype.finishAdding = function () {
        this._finishedAdding = true;
    };
    ConcurrentBatch.prototype._processMoreBatches = function () {
        var _this = this;
        if (!this._finishedAdding) {
            setTimeout(function () {
                _this._processBatch();
            }, this._msDelay);
        }
        else if (!this._finalBatch) {
            this._finalBatch = true;
            this._processBatch();
        }
        else {
            this._deferred.resolve(null);
        }
    };
    ConcurrentBatch.prototype._processBatch = function () {
        var _this = this;
        // swap batches
        var batch = this._currentBatch;
        this._currentBatch = {};
        var values = [];
        for (var key in batch) {
            if (batch.hasOwnProperty(key)) {
                values.push(batch[key]);
            }
        }
        this._process(values, function (err) {
            if (err) {
                _this._onError(err);
            }
            _this._processMoreBatches();
        });
    };
    return ConcurrentBatch;
})();
exports.ConcurrentBatch = ConcurrentBatch;
