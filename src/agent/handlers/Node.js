// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var runner = require('./scriptrunner');
var path = require('path');
//--------------------------------------------------------------------------------
// Handle Task authored in node javascript 
//
//      scriptPath: abs path to script in tasks folder (infra figures that out)
///-------------------------------------------------------------------------------
function runTask(scriptPath, ctx, callback) {
    runner.run('node', scriptPath, ctx, callback);
}
exports.runTask = runTask;
