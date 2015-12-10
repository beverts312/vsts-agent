// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var cm = require('./common');
var env = require('./environment');
var inputs = require('./inputs');
var webapi = require('vso-node-api/WebApi');
var utilm = require('./utilities');
var os = require('os');
var nconf = require("nconf");
var async = require("async");
var path = require("path");
var fs = require('fs');
var check = require('validator');
var shell = require('shelljs');
var configPath = path.join(__dirname, '..', '.agent');
var envPath = path.join(__dirname, '..', 'env.agent');
var pkgJsonPath = path.join(__dirname, '..', 'package.json');
function exists() {
    return fs.existsSync(configPath);
}
exports.exists = exists;
//
// creds are not persisted in the file.  
// They are tacked on after reading from CL or prompting
//
function read() {
    nconf.argv()
        .env()
        .file({ file: configPath });
    var settings = {
        poolName: nconf.get("poolName"),
        serverUrl: nconf.get("serverUrl"),
        agentName: nconf.get("agentName"),
        workFolder: nconf.get("workFolder"),
        logSettings: {
            linesPerFile: nconf.get("log.linesPerFile"),
            maxFiles: nconf.get("log.maxFiles")
        }
    };
    return settings;
}
exports.read = read;
var throwIf = function (condition, message) {
    if (condition) {
        throw new Error(message);
    }
};
var Configurator = (function () {
    function Configurator() {
    }
    //
    // ensure configured and return ISettings.  That's it
    // returns promise
    //
    Configurator.prototype.ensureConfigured = function (creds) {
        var readSettings = exports.read();
        if (!readSettings.serverUrl) {
            return this.create(creds);
        }
        else {
            // update agent to the server
            return this.update(creds, readSettings);
        }
    };
    Configurator.prototype.update = function (creds, settings) {
        return this.writeAgentToPool(creds, settings, true)
            .then(function (config) {
            return config;
        });
    };
    //
    // Gether settings, register with the server and save the settings
    //
    Configurator.prototype.create = function (creds) {
        var _this = this;
        var settings;
        var configuration;
        var newAgent;
        var agentPoolId = 0;
        var cfgInputs = [
            { name: 'serverUrl', description: 'server url', arg: 's', def: process.env.URL, type: 'string', req: false },
            { name: 'agentName', description: 'agent name', arg: 'a', def: os.hostname(), type: 'string', req: false },
            { name: 'poolName', description: 'agent pool name', arg: 'l', def: process.env.POOL, type: 'string', req: false }
        ];
        return inputs.Qget(cfgInputs)
            .then(function (result) {
            settings = {};
            settings.poolName = result['poolName'];
            settings.serverUrl = result['serverUrl'];
            settings.agentName = result['agentName'];
            settings.workFolder = './_work';
            settings.logSettings = {
                maxFiles: cm.DEFAULT_LOG_MAXFILES,
                linesPerFile: cm.DEFAULT_LOG_LINESPERFILE
            };
            _this.validate(settings);
            return _this.writeAgentToPool(creds, settings, false);
        })
            .then(function (config) {
            configuration = config;
            console.log('Creating work folder ' + settings.workFolder + ' ...');
            return utilm.ensurePathExists(settings.workFolder);
        })
            .then(function () {
            console.log('Creating env file ' + envPath + '...');
            return env.ensureEnvFile(envPath);
        })
            .then(function () {
            console.log('Saving configuration ...');
            return utilm.objectToFile(configPath, settings);
        })
            .then(function () {
            return configuration;
        });
    };
    Configurator.prototype.readConfiguration = function (creds, settings) {
        var agentApi = new webapi.WebApi(settings.serverUrl, cm.basicHandlerFromCreds(creds)).getQTaskAgentApi();
        var agentPoolId = 0;
        var agent;
        return agentApi.connect()
            .then(function (connected) {
            console.log('successful connect as ' + connected.authenticatedUser.customDisplayName);
            return agentApi.getAgentPools(settings.poolName, null);
        })
            .then(function (agentPools) {
            if (agentPools.length == 0) {
                cm.throwAgentError(cm.AgentError.PoolNotExist, settings.poolName + ' pool does not exist.');
                return;
            }
            // we queried by name so should only get 1
            agentPoolId = agentPools[0].id;
            console.log('Retrieved agent pool: ' + agentPools[0].name + ' (' + agentPoolId + ')');
            return agentApi.getAgents(agentPoolId, settings.agentName);
        })
            .then(function (agents) {
            if (agents.length == 0) {
                cm.throwAgentError(cm.AgentError.AgentNotExist, settings.agentName + ' does not exist in pool ' + settings.poolName);
                return;
            }
            // should be exactly one agent by name in a given pool by id
            var agent = agents[0];
            var config = {};
            config.poolId = agentPoolId;
            config.settings = settings;
            config.agent = agent;
            return config;
        });
    };
    //-------------------------------------------------------------
    // Private
    //-------------------------------------------------------------
    Configurator.prototype.validate = function (settings) {
        throwIf(!check.isURL(settings.serverUrl, { protocols: ['http', 'https'], require_tld: false, require_protocol: true }), settings.serverUrl + ' is not a valid URL');
    };
    Configurator.prototype.getComputerName = function () {
        // I don't want the DNS resolved name - I want the computer name
        // OSX also has: 'scutil --get ComputerName'
        // but that returns machinename.local
        return utilm.exec('hostname');
    };
    Configurator.prototype.constructAgent = function (settings) {
        var caps = env.getCapabilities();
        caps['Agent.Name'] = settings.agentName;
        caps['Agent.OS'] = process.platform;
        var version;
        var computerName;
        return this.getComputerName()
            .then(function (ret) {
            computerName = ret.output;
            return utilm.objectFromFile(pkgJsonPath);
        })
            .then(function (pkg) {
            caps['Agent.NpmVersion'] = pkg['version'];
            caps['Agent.ComputerName'] = computerName;
            var newAgent = {
                maxParallelism: 1,
                name: settings.agentName,
                version: pkg['vsoAgentInfo']['serviceMilestone'],
                systemCapabilities: caps
            };
            return newAgent;
        });
    };
    Configurator.prototype.writeAgentToPool = function (creds, settings, update) {
        var _this = this;
        var agentApi = new webapi.WebApi(settings.serverUrl, cm.basicHandlerFromCreds(creds)).getQTaskAgentApi();
        var agentPoolId = 0;
        var agentId = 0;
        return agentApi.connect()
            .then(function (connected) {
            console.log('successful connect as ' + connected.authenticatedUser.customDisplayName);
            return agentApi.getAgentPools(settings.poolName, null);
        })
            .then(function (agentPools) {
            if (agentPools.length == 0) {
                throw new Error(settings.poolName + ' pool does not exist.');
            }
            // we queried by name so should only get 1
            agentPoolId = agentPools[0].id;
            console.log('Retrieved agent pool: ' + agentPools[0].name + ' (' + agentPoolId + ')');
            return agentApi.getAgents(agentPoolId, settings.agentName);
        })
            .then(function (agents) {
            if (update && agents.length == 1) {
                agentId = agents[0].id;
                return _this.constructAgent(settings);
            }
            else if (update && agents.length == 0) {
                throw new Error('Agent was deleted.  Reconfigure');
            }
            else if (agents.length == 0) {
                return _this.constructAgent(settings);
            }
            else {
                throw new Error('An agent already exists by the name ' + settings.agentName);
            }
        })
            .then(function (agent) {
            if (update) {
                agent.id = agentId;
                return agentApi.updateAgent(agent, agentPoolId, agentId);
            }
            else {
                return agentApi.addAgent(agent, agentPoolId);
            }
        })
            .then(function (agent) {
            var config = {};
            config.poolId = agentPoolId;
            config.settings = settings;
            config.agent = agent;
            return config;
        });
    };
    return Configurator;
})();
exports.Configurator = Configurator;
