/*jshint esversion: 6 */
/*jslint latedef:false*/
/**
 * Expose the getUserMedia function.
 */

module.exports = getNativeUserMedia;

var cordova = window.cordova,
IosrtcRTCPeerConnection = require('./RTCPeerConnection'),
IosrtcRTCIceCandidate = require('./RTCIceCandidate'),
IosrtcRTCSessionDescription = require('./RTCSessionDescription');



let gumPlugin = (function () {
	'use strict';


	var pc_config = {
		"iceServers": [
			{
				"urls": "stun:stun.l.google.com:19302"
			}
		],
		"sdpSemantics": "unified-plan"
	},
		_iosrtcRTCPeerConnection,
		_nativeRTCPeerConnection,
		_debug = false,
		_ua = navigator.userAgent,
		event = (function () {

			var events = {},
			CustomEvent = function (eventName) {

				this.eventName = eventName;
				this.callbacks = [];

				this.registerCallback = function (callback) {
					this.callbacks.push(callback);
				};

				this.unregisterCallback = function (callback) {
					const index = this.callbacks.indexOf(callback);
					if (index > -1) {
						this.callbacks.splice(index, 1);
					}
				};

				this.fire = function (data) {
					const callbacks = this.callbacks.slice(0);
					callbacks.forEach((callback) => {
						callback(data);
					});
				};
			},
			on = function (eventName, callback) {
				let event = events[eventName];
				if (!event) {
					event = new CustomEvent(eventName);
					events[eventName] = event;
				}
				event.registerCallback(callback);
			},
			off = function (eventName, callback) {
				const event = events[eventName];
				if (event && event.callbacks.indexOf(callback) > -1) {
					event.unregisterCallback(callback);
					if (event.callbacks.length === 0) {
						delete events[eventName];
					}
				}
			},
			doesHandlerExist = function (eventName) {
				if (events[eventName] !== null && events[eventName].callbacks.length !== 0) {
					return true;
				} else {
					return false;
				}
			},
			dispatch = function (eventName, data) {
				if (!doesHandlerExist(eventName)) {
					return;
				}
				const event = events[eventName];
				if (event) {
					event.fire(data);
				}
			};

			return {
				dispatch: dispatch,
				on: on,
				off: off
			};
		}()),
		iosrtcLocalPeerConnection,
		nativeLocalWebRTCPeerConnection;

	if (!window.RTCRtpTransceiver.prototype.hasOwnProperty('currentDirection')) {
		pc_config.sdpSemantics = "plan-b";
	}

	function log(text) {
		if (!_debug) {
			return;
		}
		if (window.performance) {
			var now = (window.performance.now() / 1000).toFixed(3);
			console.log(now + ": " + text);
		} else {
			console.log(text);
		}
	}

	if (typeof cordova !== 'undefined' && (_ua.indexOf('iPad') !== -1 || _ua.indexOf('iPhone') !== -1 || _ua.indexOf('iPod') !== -1)) {
		iosrtcLocalPeerConnection = (function () {
			var iceQueue = [],
				_negotiating = false,
				_offerQueue = null;

			function setAnswer(message) {
				var description = new IosrtcRTCSessionDescription(message.sdp);

				return _iosrtcRTCPeerConnection.setRemoteDescription(description).then(function () {
					log('iosrtcLocalPeerConnection: answer received and applied');

					for (var i in iceQueue) {
						if (iceQueue.hasOwnProperty(i)) {
							if (iceQueue[i] !== null) {
								nativeLocalWebRTCPeerConnection.addIceCandidate(iceQueue[i]);
							}
							iceQueue[i] = null;
						}
					}
				});
			}

			function addIceCandidate(message) {
				log('iosrtcLocalPeerConnection: addIceCandidate: ' + message.candidate);

				var candidate = new IosrtcRTCIceCandidate({
					candidate: message.candidate,
					sdpMLineIndex: message.label,
					sdpMid: message.sdpMid
				});
				_iosrtcRTCPeerConnection.addIceCandidate(candidate)
					.catch(function (e) {
						console.error(e);
					});
			}

			function gotIceCandidate(event) {

				if (event.candidate) {

					if (event.candidate.candidate.indexOf("relay") < 0) { // if no relay address is found, assuming it means no TURN server
						log("");
					}
					var message = {
						type: "candidate",
						label: event.candidate.sdpMLineIndex,
						sdpMid: event.candidate.sdpMid,
						candidate: event.candidate.candidate,
						id: event.candidate.sdpMid
					};

					//iceQueue.push(message);

					nativeLocalWebRTCPeerConnection.addIceCandidate(message);

				}
			}

			function createOffer(callback) {
				log('iosrtcLocalPeerConnection: createOffer, negotiating = ' + _negotiating);

				if (_negotiating === true) {
					return;
				}
				_negotiating = true;
				var iosRTCPeerConnection = _iosrtcRTCPeerConnection;
				iosRTCPeerConnection.createOffer({'OfferToReceiveAudio': true, 'OfferToReceiveVideo': true})
					.then(function (offer) {
						log('iosrtcLocalPeerConnection: createOffer: offer created');

						var localDescription = new IosrtcRTCSessionDescription(offer);
						return iosRTCPeerConnection.setLocalDescription(localDescription).then(function () {
							log('iosrtcLocalPeerConnection: createOffer: send offer');

							//callback(iosRTCPeerConnection.localDescription.sdp);
							var message = {
								type: "offer",
								sdp: iosRTCPeerConnection.localDescription.sdp
							};

							return nativeLocalWebRTCPeerConnection.setOffer(message).then(function () {
								_negotiating = false;
								if (callback !== null) {
									callback();
								}

								if (_offerQueue !== null) {
									log('iosrtcLocalPeerConnection: send offer from queue');

									var newOffer = _offerQueue;
									_offerQueue = null;
									newOffer();
								}
							});

						});
					})
					.catch(function (error) {
						console.error(error);
					});
			}

			function setOffer(message) {
				var description = new IosrtcRTCSessionDescription({type: message.type, sdp: message.sdp});

				_nativeRTCPeerConnection.setRemoteDescription(description).then(function () {
					_nativeRTCPeerConnection.createAnswer()
						.then(function (answer) {
							var localDescription = new window.RTCSessionDescription(answer);

							return _iosrtcRTCPeerConnection.setLocalDescription(localDescription).then(function () {
								var message = {
									type: "answer",
									sdp: localDescription
								};
								nativeLocalWebRTCPeerConnection.setAnswer(message);
							});
						})

						.catch(function (error) {
							console.error(error);
						});
				});
			}

			function addStream(stream) {
				if (_iosrtcRTCPeerConnection === null) {
					return;
				}
				log('iosrtcRTCPeerConnection: addStream');
				let logError = '... addStream signalingState = ' + _iosrtcRTCPeerConnection.signalingState;
				logError += ', iceConnectionState = ' + _iosrtcRTCPeerConnection.iceConnectionState;
				logError += ', iceGatheringState = ' + _iosrtcRTCPeerConnection.iceGatheringState;
				log(logError);

				var
					newStreamKind,
					videoTracks = stream.getVideoTracks(),
					audioTracks = stream.getAudioTracks(),
					RTCLocalStreams = _iosrtcRTCPeerConnection.getLocalStreams();
				if (videoTracks.length !== 0 && audioTracks.length === 0) {
					newStreamKind = 'video';
				} else if (audioTracks.length !== 0 && videoTracks.length === 0) {
					newStreamKind = 'audio';
				}

				log('iosrtcRTCPeerConnection addStream: remove current ' + RTCLocalStreams.length + ' stream(s)');

				for (let t in RTCLocalStreams) {
					if (RTCLocalStreams.hasOwnProperty(t)) {
						let videoTracks = RTCLocalStreams[t].getVideoTracks();
						let audioTracks = RTCLocalStreams[t].getAudioTracks();
						let currentStreamkind;
						if (videoTracks.length !== 0 && audioTracks.length === 0) {
							currentStreamkind = 'video';
						} else if (audioTracks.length !== 0 && videoTracks.length === 0) {
							currentStreamkind = 'audio';
						}

						if (currentStreamkind !== newStreamKind) {
							continue;
						}
						RTCLocalStreams[t].stop();
						_iosrtcRTCPeerConnection.removeStream(RTCLocalStreams[t]);
					}
				}
				try {
					//var RTCLocalStreams = _iosrtcRTCPeerConnection.getLocalStreams();
					//_iosrtcRTCPeerConnection.removeStream(localParticipant.videoStream);
					console.log("");
				} catch (e) {
					console.error(e.message, e);
				}


				if (_negotiating) {
					_offerQueue = function () {
						_iosrtcRTCPeerConnection.addStream(stream);
					};
				} else {
					_iosrtcRTCPeerConnection.addStream(stream);
				}
			}

			function createIosrtcLocalPeerConnection(callback) {
				log('createIosrtcLocalPeerConnection');

				var iosRTCPeerConnection = new IosrtcRTCPeerConnection(pc_config);
				_iosrtcRTCPeerConnection = iosRTCPeerConnection;

				//if(options.streams) iosRTCPeerConnection.addStream(options.streams);

				iosRTCPeerConnection.onicecandidate = function (e) {
					gotIceCandidate(e);
				};

				iosRTCPeerConnection.onnegotiationneeded = function (e) {
					console.log(e);
					log('iosrtcLocalPeerConnection: onnegotiationneeded');
					if (iosRTCPeerConnection.connectionState === 'new' && iosRTCPeerConnection.iceConnectionState === 'new' && iosRTCPeerConnection.iceGatheringState === 'new') {
						return;
					}

					createOffer();
				};

				if (callback !== null) {
					callback();
				}

			}

			return {
				createPeerConnection: createIosrtcLocalPeerConnection,
				createOffer: createOffer,
				setAnswer: setAnswer,
				setOffer: setOffer,
				addIceCandidate: addIceCandidate,
				addStream: addStream
			};
		}());
		nativeLocalWebRTCPeerConnection = (function () {
			var iceQueue = [];

			function setOffer(message) {
				//log('nativeLocalWebRTCPeerConnection createOffer + ' + message.sdp)

				var description = new window.RTCSessionDescription({type: message.type, sdp: message.sdp});

				return _nativeRTCPeerConnection.setRemoteDescription(description).then(function () {
					log('nativeLocalWebRTCPeerConnection: offer received and applied');

					return _nativeRTCPeerConnection.createAnswer()
						.then(function (answer) {
							log('nativeLocalWebRTCPeerConnection: answer created');

							var localDescription = new window.RTCSessionDescription(answer);

							return _nativeRTCPeerConnection.setLocalDescription(localDescription).then(function () {
								log('nativeLocalWebRTCPeerConnection: answer created: send answer');

								var message = {
									type: "answer",
									sdp: localDescription
								};
								return iosrtcLocalPeerConnection.setAnswer(message).then(function () {

									for (var i in iceQueue) {
										if (iceQueue.hasOwnProperty(i)) {
											if (iceQueue[i] !== null) {
												iosrtcLocalPeerConnection.addIceCandidate(iceQueue[i]);
											}
											iceQueue[i] = null;
										}
									}
								});

							});
						})

						.catch(function (error) {
							console.error(error);
						});
				});
			}

			function setAnswer(message) {
				var description = new window.RTCSessionDescription(message.sdp);

				_iosrtcRTCPeerConnection.setRemoteDescription(description).then(function () {
					log('nativeLocalWebRTCPeerConnection: answer received and applied');
				});
			}

			function createOffer() {
				log('nativeLocalWebRTCPeerConnection: createOffer');
				var RTCPeerConnection = _nativeRTCPeerConnection;
				RTCPeerConnection.createOffer({'OfferToReceiveAudio': true, 'OfferToReceiveVideo': true})
					.then(function (offer) {
						var localDescription = new window.RTCSessionDescription(offer);
						return RTCPeerConnection.setLocalDescription(localDescription).then(function () {
							//callback(iosRTCPeerConnection.localDescription.sdp);
							var message = {
								type: "offer",
								sdp: RTCPeerConnection.localDescription.sdp
							};

							iosrtcLocalPeerConnection.setOffer(message);

						});
					})
					.catch(function (error) {
						console.error(error);
					});
			}

			function addIceCandidate(message) {
				log('nativeLocalWebRTCPeerConnection: addIceCandidate: ' + message.candidate);
				var candidate = new window.RTCIceCandidate({
					candidate: message.candidate,
					sdpMLineIndex: message.label,
					sdpMid: message.sdpMid
				});
				_nativeRTCPeerConnection.addIceCandidate(candidate)
					.catch(function (e) {
						console.error(e);
					});
			}

			function gotIceCandidate(event) {

				if (event.candidate) {
					var message = {
						type: "candidate",
						label: event.candidate.sdpMLineIndex,
						sdpMid: event.candidate.sdpMid,
						candidate: event.candidate.candidate,
						id: event.candidate.sdpMid
					};

					//iceQueue.push(message);
					iosrtcLocalPeerConnection.addIceCandidate(message);

				}
			}

			function trackReceived(e) {
				event.dispatch('trackReceived', e);
			}

			function createNativeLocalPeerConnection(callback) {
				log('createNativeLocalPeerConnection');

				var newPeerConnection = new window.RTCPeerConnection(pc_config);

				_nativeRTCPeerConnection = newPeerConnection;

				newPeerConnection.ontrack = function (e) {
					trackReceived(e);
				};

				newPeerConnection.onicecandidate = function (e) {
					gotIceCandidate(e);
				};

				newPeerConnection.onnegotiationneeded = function (e) {
					log('nativeLocalPeerConnection: onnegotiationneeded ' + e);

					if (newPeerConnection.connectionState === 'new' && newPeerConnection.iceConnectionState === 'new' && newPeerConnection.iceGatheringState === 'new') {
						return;
					}

					createOffer();

				};

				if (callback !== null) {
					callback();
				}

			}

			function removeRemoteStreams() {
				/*var localTracks = localParticipant.tracks;
				for (var t in localTracks) {
					if (localTracks[t].stream != null) {
						localTracks[t].medaStreamTrack.stop();
						_nativeRTCPeerConnection.removeStream(localTracks[t].stream);
					}
				}*/
			}

			return {
				createPeerConnection: createNativeLocalPeerConnection,
				setOffer: setOffer,
				setAnswer: setAnswer,
				addIceCandidate: addIceCandidate,
				removeRemoteStreams: removeRemoteStreams
			};
		}());
	}

	function retrieveUserMediaViaIosrtc(constrains, callback, failureCallback) {
		cordova.plugins.iosrtc.getUserMedia(
			constrains,
			function (stream) {
				callback(stream);
			},
			function (error) {
				failureCallback(error);
				console.error(error);
			}
		);
	}


	return {
		getUserMedia: function (constrains) {

			return new Promise(function (resolve, reject) {

				var receiveTrackAndResolve = function (stream) {
					log('getUserMedia: receiveTrackAndResolve');

					iosrtcLocalPeerConnection.addStream(stream);
					var tracks = stream.getTracks(),
					trackNum = 0,
					trackHandler = function (e) {
						log('getUserMedia: receiveTrackAndResolve: got track kind: ' + (e.track.kind));
						log('getUserMedia: receiveTrackAndResolve: got track id:' + (e.track.id));
						log('getUserMedia: receiveTrackAndResolve: got track stream.id :' + (e.streams[0].id));

						let receivedTrack = e.track;
						for (var t in tracks) {
							if (tracks[t].id === receivedTrack.id) {
								trackNum++;
								break;
							}
						}

						log('getUserMedia: receiveTrackAndResolve: got track trackNum:' + (trackNum) + '/' + (tracks.length));


						if (trackNum === tracks.length) {
							log('getUserMedia: receiveTrackAndResolve: all track received: resolve');

							event.off('trackAdded', trackHandler);
							resolve(e.streams[0]);

						}

					};
					event.on('trackReceived', trackHandler);
				};


				if (_iosrtcRTCPeerConnection !== null && _nativeRTCPeerConnection !== null) {

					retrieveUserMediaViaIosrtc(constrains, receiveTrackAndResolve, function (e) {
						reject(e);
					});
				} else {
					iosrtcLocalPeerConnection.createPeerConnection(function () {
						nativeLocalWebRTCPeerConnection.createPeerConnection(function () {
							iosrtcLocalPeerConnection.createOffer(function () {
								retrieveUserMediaViaIosrtc(constrains, receiveTrackAndResolve, function (e) {
									reject(e);
								});
							});

						});
					});
				}
			});

		}
	};
}());

/**
 * Dependencies.
 * var
*	//debug = require('debug')('iosrtc:getUserMedia'),
*	//debugerror = require('debug')('iosrtc:ERROR:getUserMedia'),
*	//exec = require('cordova/exec'),
*	//MediaStream = require('./MediaStream'),
*	//Errors = require('./Errors');
*
* debugerror.log = console.warn.bind(console);
 */



function getNativeUserMedia(constraints) {
	return gumPlugin.getUserMedia(constraints);
}
