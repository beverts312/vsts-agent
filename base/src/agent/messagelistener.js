// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var events = require('events');
var uuid = require('node-uuid');
var QUEUE_RETRY_DELAY = 15000;
var MAX_SESSION_RETRIES = 10;
var lastMessageId = 0;
var MessageListener = (function (_super) {
    __extends(MessageListener, _super);
    function MessageListener(agentapi, agent, poolId) {
        this.agentapi = agentapi;
        this.agent = agent;
        this.poolId = poolId;
        this._sessionRetryCount = 0;
        _super.call(this);
    }
    MessageListener.prototype.getMessages = function (callback, onError) {
        var _this = this;
        this.emit('listening');
        this.agentapi.getMessage(this.poolId, this.sessionId, lastMessageId, function (err, statusCode, obj) {
            // exit on some conditions such as bad credentials
            if (statusCode == 401) {
                onError(new Error('Unauthorized.  Confirm credentials are correct and restart.  Exiting.'));
                return;
            }
            if (statusCode == 400) {
                onError(new Error('Invalid Configuration.  Check pools and agent configuration and restart'));
                return;
            }
            // resetting the long poll - reconnect immediately
            if (statusCode == 202 || (err && err.code === 'ECONNRESET')) {
                _this.getMessages(callback, onError);
                return;
            }
            _this.emit('info', 'working status code: ' + statusCode);
            // the queue should be robust to the server being unreachable - wait and reconnect
            if (err) {
                onError(new Error('Could not connect to the queue.  Retrying in ' + QUEUE_RETRY_DELAY / 1000 + ' sec'));
                onError(err);
                setTimeout(function () {
                    _this.getMessages(callback, onError);
                }, QUEUE_RETRY_DELAY);
                return;
            }
            callback(obj);
            // the message has been handed off to the caller - delete the message and listen for the next one
            lastMessageId = obj.messageId;
            _this.emit('info', 'processing messageId ' + lastMessageId);
            _this.agentapi.deleteMessage(_this.poolId, lastMessageId, _this.sessionId, function (err, statusCode) {
                // TODO: how to handle failure in deleting message?  Just log?  we need to continue nd get the next message ...
                if (err) {
                    onError(err);
                }
                _this.getMessages(callback, onError);
            });
        });
    };
    MessageListener.prototype.start = function (callback, onError) {
        var _this = this;
        this.sessionId = null;
        var session = {};
        session.agent = this.agent;
        session.ownerName = uuid.v1();
        this.agentapi.createAgentSession(session, this.poolId, function (err, statusCode, session) {
            // exit on some conditions such as bad credentials
            if (statusCode == 401) {
                console.error('Unauthorized.  Confirm credentials are correct and restart.  Exiting.');
                return;
            }
            if (err) {
                onError(new Error('Could not create an agent session.  Retrying in ' + QUEUE_RETRY_DELAY / 1000 + ' sec'));
                onError(err);
                // retry 409 (session already exists) a few times
                if (statusCode == 409) {
                    if (_this._sessionRetryCount++ < MAX_SESSION_RETRIES) {
                        setTimeout(function () {
                            _this.start(callback, onError);
                        }, QUEUE_RETRY_DELAY);
                    }
                    else {
                        console.error('A session already exists for this agent. Is there a copy of this agent running elsewhere?');
                        _this.emit('sessionUnavailable');
                    }
                }
                else {
                    // otherwise, just retry
                    setTimeout(function () {
                        _this.start(callback, onError);
                    }, QUEUE_RETRY_DELAY);
                }
                return;
            }
            else {
                // success. reset retry count 
                _this._sessionRetryCount = 0;
            }
            _this.sessionId = session.sessionId;
            _this.getMessages(callback, onError);
        });
    };
    MessageListener.prototype.stop = function (callback) {
        if (this.sessionId) {
            this.agentapi.deleteAgentSession(this.poolId, this.sessionId, function (err, statusCode) {
                callback(err);
            });
        }
        else {
            callback(null);
        }
    };
    return MessageListener;
})(events.EventEmitter);
exports.MessageListener = MessageListener;
