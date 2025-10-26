import { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import VideoStream from './VideoStream';
import UserList from './UserList';
import ConnectionStatus from './ConnectionStatus';
import EventLog from './EventLog';
import PeerConnections from './PeerConnections';

const VideoRoom = ({ serverUrl, userData, onDisconnect }) => {
    const [socket, setSocket] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [peerConnections, setPeerConnections] = useState(new Map());
    const [roomInputValue, setRoomInputValue] = useState('');
    const [currentRoom, setCurrentRoom] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [users, setUsers] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [streamValidationResult, setStreamValidationResult] = useState(null);

    // ICE servers configuration
    const iceServers = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    const createPeerConnection = useCallback((remoteUserId, isInitiator = false) => {
        console.log(`Creating peer connection with ${remoteUserId}:`, {
            isInitiator,
            currentRoom,
            existingConnections: Array.from(peerConnections.keys()),
            signalingState: peerConnections.get(remoteUserId)?.pc?.signalingState
        });

        // Check if we already have a connection
        const existingConnection = peerConnections.get(remoteUserId);
        if (existingConnection?.pc) {
            console.log(`Existing connection found for ${remoteUserId}:`, {
                state: existingConnection.pc.connectionState,
                signalingState: existingConnection.pc.signalingState
            });
            return existingConnection.pc;
        }

        const pc = new RTCPeerConnection(iceServers);

        // Create a connection-specific lock to prevent race conditions
        const connectionLock = {
            isAddingTracks: false,
            tracksAdded: false,
            remoteUserId: remoteUserId
        };

        // Safely add local stream tracks with locking mechanism
        const addLocalTracksToConnection = (stream) => {
            console.log(`🎵 TRACK ADDITION CALLED for ${remoteUserId}:`, {
                isAddingTracks: connectionLock.isAddingTracks,
                tracksAdded: connectionLock.tracksAdded,
                streamExists: !!stream,
                pcExists: !!pc,
                pcState: pc?.connectionState
            });

            if (connectionLock.isAddingTracks || connectionLock.tracksAdded) {
                console.log(`⚠️ Tracks already being added or added for ${remoteUserId}:`, {
                    isAddingTracks: connectionLock.isAddingTracks,
                    tracksAdded: connectionLock.tracksAdded
                });
                return;
            }

            connectionLock.isAddingTracks = true;
            console.log(`🎵 STARTING TRACK ADDITION for ${remoteUserId}:`, {
                streamId: stream.id,
                trackCount: stream.getTracks().length,
                videoTracks: stream.getVideoTracks().length,
                audioTracks: stream.getAudioTracks().length,
                currentSenders: pc.getSenders().length
            });

            try {
                stream.getTracks().forEach((track, index) => {
                    console.log(`🎵 Adding track ${index} (${track.kind}) to ${remoteUserId}:`, {
                        trackId: track.id,
                        trackLabel: track.label,
                        trackEnabled: track.enabled,
                        trackReadyState: track.readyState
                    });

                    // Add track with explicit stream association
                    const sender = pc.addTrack(track, stream);
                    console.log(`✅ Track added successfully for ${remoteUserId}:`, {
                        trackKind: track.kind,
                        senderId: sender.track?.id,
                        streamId: stream.id,
                        totalSendersNow: pc.getSenders().length
                    });
                });

                connectionLock.tracksAdded = true;
                console.log(`🎉 ALL TRACKS SUCCESSFULLY ADDED to peer connection for ${remoteUserId}:`, {
                    totalSenders: pc.getSenders().length,
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState
                });
            } catch (error) {
                console.error(`❌ ERROR adding tracks to peer connection for ${remoteUserId}:`, error);
            } finally {
                connectionLock.isAddingTracks = false;
            }
        };

        // Add local stream if available
        if (localStream) {
            addLocalTracksToConnection(localStream);
        }

        // Handle remote stream with proper validation and association
        pc.ontrack = (event) => {
            console.log(`🎥 REMOTE TRACK RECEIVED from ${remoteUserId}:`, {
                trackKind: event.track.kind,
                trackId: event.track.id,
                trackLabel: event.track.label,
                streamCount: event.streams.length,
                streamIds: event.streams.map(s => s.id),
                timestamp: new Date().toISOString()
            });

            if (event.streams && event.streams.length > 0) {
                const remoteStream = event.streams[0];
                console.log(`🔄 Processing remote stream from ${remoteUserId}:`, {
                    streamId: remoteStream.id,
                    trackCount: remoteStream.getTracks().length,
                    videoTracks: remoteStream.getVideoTracks().length,
                    audioTracks: remoteStream.getAudioTracks().length,
                    active: remoteStream.active
                });

                // Validate stream integrity
                if (remoteStream.getTracks().length === 0) {
                    console.warn(`⚠️ Empty remote stream received from ${remoteUserId}`);
                    return;
                }

                // Use setTimeout to avoid stale closure issues
                setTimeout(() => {
                    console.log(`🔄 Updating peer connections state for ${remoteUserId} with fresh state`);

                    setPeerConnections(currentConnections => {
                        const newConnections = new Map(currentConnections);
                        const existingConnection = newConnections.get(remoteUserId);

                        console.log(`🔍 Current connection state for ${remoteUserId}:`, {
                            exists: !!existingConnection,
                            hasPC: !!existingConnection?.pc,
                            currentStreamId: existingConnection?.streamId,
                            newStreamId: remoteStream.id
                        });

                        if (existingConnection) {
                            const updatedConnection = {
                                ...existingConnection,
                                stream: remoteStream,
                                streamId: remoteStream.id,
                                lastStreamUpdate: Date.now()
                            };

                            newConnections.set(remoteUserId, updatedConnection);
                            console.log(`✅ Stream successfully associated with peer connection for ${remoteUserId}`);

                            // Force a re-render by creating a completely new Map
                            return new Map(newConnections);
                        } else {
                            console.warn(`❌ No existing peer connection found for stream from ${remoteUserId}`);
                            return currentConnections;
                        }
                    });
                }, 0);

                // Monitor stream health
                remoteStream.addEventListener('addtrack', (e) => {
                    console.log(`➕ Track added to remote stream from ${remoteUserId}:`, e.track.kind);
                });

                remoteStream.addEventListener('removetrack', (e) => {
                    console.log(`➖ Track removed from remote stream from ${remoteUserId}:`, e.track.kind);
                });
            } else {
                console.warn(`❌ No streams in track event from ${remoteUserId}`);
            }
        };

        // Handle ICE candidates - Use a function that gets fresh state
        pc.onicecandidate = (event) => {
            console.log('ICE candidate event triggered:', {
                hasCandidate: !!event.candidate,
                candidateType: event.candidate?.type,
                protocol: event.candidate?.protocol,
                remoteUserId
            });

            if (event.candidate) {
                // Use a timeout to ensure we get the latest state
                setTimeout(() => {
                    // Get the most current socket and state references
                    const latestSocket = socket;
                    const latestRoom = currentRoom;
                    const latestUser = currentUser;

                    console.log('Attempting to emit ICE candidate with current state:', {
                        socketExists: !!latestSocket,
                        socketConnected: latestSocket?.connected,
                        roomId: latestRoom,
                        userId: latestUser?.id,
                        candidateType: event.candidate.type
                    });

                    if (!latestSocket) {
                        console.error('Socket not available for ICE candidate emission');
                        return;
                    }

                    if (!latestSocket.connected) {
                        console.error('Socket not connected for ICE candidate emission');
                        return;
                    }

                    if (!latestRoom) {
                        console.error('Current room not available for ICE candidate emission');
                        return;
                    }

                    if (!latestUser?.id) {
                        console.error('Current user ID not available for ICE candidate emission');
                        return;
                    }

                    console.log('Successfully emitting ICE candidate:', {
                        candidateType: event.candidate.type,
                        protocol: event.candidate.protocol,
                        toUser: remoteUserId,
                        roomId: latestRoom,
                        fromUser: latestUser.id
                    });

                    latestSocket.emit('webrtc', JSON.stringify({
                        type: 'ice-candidate',
                        roomId: latestRoom,
                        candidate: {
                            candidate: event.candidate.candidate,
                            sdpMid: event.candidate.sdpMid,
                            sdpMLineIndex: event.candidate.sdpMLineIndex,
                            usernameFragment: event.candidate.usernameFragment
                        },
                        targetUserId: remoteUserId,
                        userId: latestUser.id
                    }));
                }, 0);
            } else {
                console.log('ICE gathering complete for peer:', remoteUserId);
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            console.log(`Peer connection state with ${remoteUserId}:`, {
                connectionState: pc.connectionState,
                iceConnectionState: pc.iceConnectionState,
                iceGatheringState: pc.iceGatheringState
            });
            setPeerConnections(prev => {
                const newConnections = new Map(prev);
                newConnections.set(remoteUserId, {
                    ...newConnections.get(remoteUserId),
                    state: pc.connectionState,
                    iceState: pc.iceConnectionState
                });
                return newConnections;
            });
        };

        // Monitor ICE gathering state
        pc.onicegatheringstatechange = () => {
            console.log(`ICE gathering state changed for ${remoteUserId}:`, {
                iceGatheringState: pc.iceGatheringState,
                connectionState: pc.connectionState,
                hasLocalDescription: !!pc.localDescription,
                hasRemoteDescription: !!pc.remoteDescription,
                signalingState: pc.signalingState
            });

            if (pc.iceGatheringState === 'gathering') {
                console.log(`ICE gathering started for ${remoteUserId} - candidates should start flowing`);
            }
        };

        // Monitor ICE connection state
        pc.oniceconnectionstatechange = () => {
            console.log(`ICE connection state changed for ${remoteUserId}:`, {
                iceConnectionState: pc.iceConnectionState,
                connectionState: pc.connectionState,
                signalingState: pc.signalingState
            });
        };

        setPeerConnections(prev => {
            const newConnections = new Map(prev);
            newConnections.set(remoteUserId, {
                pc,
                state: pc.connectionState,
                remoteUserId,
                created: Date.now(),
                connectionLock,
                addLocalTracksToConnection, // Store the function for later use
                localTracksAdded: connectionLock.tracksAdded
            });
            return newConnections;
        });

        console.log(`Peer connection created for ${remoteUserId}:`, {
            isInitiator,
            hasLocalStream: !!localStream,
            localTracksAdded: connectionLock.tracksAdded,
            currentRoom,
            currentUser: currentUser?.id,
            socketConnected: socket?.connected
        });

        // If we're the initiator, create and send offer
        if (isInitiator) {
            createAndSendOffer(pc, remoteUserId);
        }

        return pc;
    }, [localStream, socket, currentRoom, currentUser]);

    const createAndSendOffer = async (pc, remoteUserId) => {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket?.emit('webrtc', JSON.stringify({
                type: 'offer',
                roomId: currentRoom,
                sdp: offer,
                targetUserId: remoteUserId,
                userId: currentUser?.id
            }));
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    };

    const handleOffer = async (data) => {
        const eventData = Array.isArray(data) ? data[0] : data;
        const { userId: remoteUserId, sdp, roomId: eventRoomId } = eventData;

        console.log('Processing offer:', {
            remoteUserId,
            eventRoomId,
            currentRoom,
            existingConnections: Array.from(peerConnections.keys())
        });

        // Check if we should process this offer
        // if (eventRoomId !== currentRoom) {
        //     console.warn('Received offer for wrong room', eventRoomId, currentRoom);
        //     return;
        // }

        let existingConnection = peerConnections.get(remoteUserId);
        let pc = existingConnection?.pc;

        if (!pc) {
            console.log('No existing connection, creating new one for offer');
            pc = createPeerConnection(remoteUserId, false);
        } else {
            console.log('Found existing connection:', {
                state: pc.connectionState,
                signalingState: pc.signalingState
            });

            // If connection is closed or failed, create a new one
            if (['closed', 'failed'].includes(pc.connectionState)) {
                console.log('Existing connection is closed/failed, creating new one');
                pc = createPeerConnection(remoteUserId, false);
            }
        }

        try {
            // Check signaling state before setting remote description
            if (pc.signalingState === 'stable') {
                console.log('Warning: RTCPeerConnection is already stable, may need to negotiate');
            }

            console.log('Setting remote description from offer');
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));

            // Create and set local description (answer)
            console.log('Creating answer');
            const answer = await pc.createAnswer();

            console.log('Setting local description');
            await pc.setLocalDescription(answer);

            // Update connection state in our Map
            setPeerConnections(prev => {
                const newConnections = new Map(prev);
                newConnections.set(remoteUserId, {
                    ...newConnections.get(remoteUserId),
                    state: pc.connectionState,
                    signalingState: pc.signalingState
                });
                return newConnections;
            });

            console.log('Sending answer:', {
                remoteUserId,
                roomId: eventRoomId,
                connectionState: pc.connectionState,
                signalingState: pc.signalingState
            });

            // Send the answer back
            socket?.emit('webrtc', JSON.stringify({
                type: 'answer',
                roomId: eventRoomId,
                sdp: answer,
                targetUserId: remoteUserId,
                userId: currentUser?.id
            }));
        } catch (error) {
            console.error('Error handling offer:', error);
            // Clean up failed connection
            if (pc.connectionState !== 'connected') {
                console.log('Connection failed, cleaning up');
                pc.close();
                setPeerConnections(prev => {
                    const newConnections = new Map(prev);
                    newConnections.delete(remoteUserId);
                    return newConnections;
                });
            }
        }
    };

    const handleAnswer = async (data) => {
        const eventData = Array.isArray(data) ? data[0] : data;
        const { userId: remoteUserId, sdp, roomId: eventRoomId } = eventData;

        console.log('🔄 ANSWER RECEIVED:', {
            remoteUserId,
            eventRoomId,
            currentRoom,
            existingConnections: Array.from(peerConnections.keys()),
            rawData: data
        });

        const existingConnection = peerConnections.get(remoteUserId);
        const pc = existingConnection?.pc;

        if (pc) {
            console.log('🔍 PC state before processing answer:', {
                connectionState: pc.connectionState,
                signalingState: pc.signalingState,
                iceConnectionState: pc.iceConnectionState,
                hasLocalDescription: !!pc.localDescription,
                hasRemoteDescription: !!pc.remoteDescription
            });

            try {
                if (pc.signalingState === 'stable') {
                    console.log('⚠️ Warning: RTCPeerConnection is already stable');
                    return;
                }

                if (pc.signalingState !== 'have-local-offer') {
                    console.log('⚠️ Warning: Expected have-local-offer but got:', pc.signalingState);
                }

                console.log('🔄 Setting remote description from answer...');
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));

                console.log('✅ Successfully set remote description from answer. New state:', {
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState,
                    iceConnectionState: pc.iceConnectionState
                });
            } catch (error) {
                console.error('❌ Error handling answer:', error);
                console.log('Answer SDP that failed:', sdp);
            }
        } else {
            console.warn('❌ No peer connection found for:', remoteUserId, 'Creating new connection');
            // Try to create a new connection if we don't have one
            createPeerConnection(remoteUserId, false);
        }
    };

    const handleIceCandidate = async (data) => {
        const eventData = Array.isArray(data) ? data[0] : data;
        const { userId: remoteUserId, candidate, roomId: eventRoomId } = eventData;

        console.log('Processing ICE candidate:', {
            remoteUserId,
            eventRoomId,
            currentRoom,
            candidateType: candidate.type,
            protocol: candidate.protocol,
            existingConnections: Array.from(peerConnections.keys())
        });

        // if (eventRoomId !== currentRoom) {
        //     console.warn('Received ICE candidate for wrong room', eventRoomId, currentRoom);
        //     return;
        // }

        const existingConnection = peerConnections.get(remoteUserId);
        const pc = existingConnection?.pc;

        if (pc) {
            try {
                // Check if we can add the candidate
                if (pc.remoteDescription === null) {
                    console.warn('Waiting for remote description before adding ICE candidate');
                    return;
                }

                if (pc.signalingState === 'closed') {
                    console.warn('Connection is closed, cannot add ICE candidate');
                    return;
                }

                console.log('ICE Connection state before adding candidate:', {
                    iceConnectionState: pc.iceConnectionState,
                    iceGatheringState: pc.iceGatheringState,
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState
                });

                // Create a proper RTCIceCandidate
                const iceCandidate = new RTCIceCandidate({
                    candidate: candidate.candidate,
                    sdpMid: candidate.sdpMid,
                    sdpMLineIndex: candidate.sdpMLineIndex,
                    usernameFragment: candidate.usernameFragment
                });

                await pc.addIceCandidate(iceCandidate);

                console.log('Successfully added ICE candidate, new states:', {
                    iceConnectionState: pc.iceConnectionState,
                    iceGatheringState: pc.iceGatheringState,
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState
                });
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
                console.log('Failed ICE candidate details:', {
                    candidateType: candidate.type,
                    protocol: candidate.protocol,
                    signalingState: pc.signalingState,
                    hasRemoteDescription: pc.remoteDescription !== null
                });
            }
        } else {
            console.warn('No peer connection found for ICE candidate:', {
                remoteUserId,
                candidateType: candidate.type,
                protocol: candidate.protocol
            });
        }
    };

    const connectToServer = async (serverUrl, userData) => {
        if (socket) {
            socket.disconnect();
        }

        const newSocket = io(serverUrl, {
            auth: {
                token: userData.token,
                userData: {
                    name: userData.name,
                    email: userData.email
                }
            }
        });

        // Set up one-time handler to get our socket ID
        newSocket.once('connect', () => {
            console.log('Got socket ID:', newSocket.id);
            setCurrentUser({
                ...userData,
                id: newSocket.id  // Save our socket ID
            });
        });

        setSocket(newSocket);
        setConnectionStatus('connecting');

        return newSocket;
    };

    const joinRoom = (roomId) => {
        if (!socket || !roomId) return;

        console.log(`Attempting to join room: ${roomId}`);
        // Set room ID before emitting to ensure it's available for subsequent events
        setCurrentRoom(roomId);

        socket.emit('webrtc', JSON.stringify({
            type: 'join-room',
            roomId,
            userData: currentUser
        }));
    };

    const leaveRoom = () => {
        if (!socket || !currentRoom) return;

        console.log(`Leaving room: ${currentRoom}`);
        socket.emit('webrtc', JSON.stringify({
            type: 'leave-room',
            roomId: currentRoom
        }));

        // Clean up peer connections
        peerConnections.forEach(({ pc }) => {
            console.log(`Closing peer connection for user`);
            pc?.close();
        });
        setPeerConnections(new Map());
        setCurrentRoom(null);
        setUsers([]);
        console.log('Room left and connections cleaned up');
    };

    const startLocalVideo = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                // video: true,
                audio: true
            });

            console.log('Local stream acquired:', {
                streamId: stream.id,
                trackCount: stream.getTracks().length,
                videoTracks: stream.getVideoTracks().length,
                audioTracks: stream.getAudioTracks().length,
                active: stream.active
            });

            setLocalStream(stream);

            // Add tracks to existing peer connections with proper locking
            console.log('🎵 ATTEMPTING TO ADD TRACKS TO EXISTING CONNECTIONS:', {
                connectionsCount: peerConnections.size,
                streamTracks: stream.getTracks().length,
                connections: Array.from(peerConnections.keys())
            });

            if (peerConnections.size === 0) {
                console.log('⚠️ No existing peer connections to add tracks to');
            }

            peerConnections.forEach(({ pc, addLocalTracksToConnection, connectionLock, remoteUserId }) => {
                console.log(`🔍 Checking connection ${remoteUserId}:`, {
                    hasPc: !!pc,
                    hasAddFunction: !!addLocalTracksToConnection,
                    hasLock: !!connectionLock,
                    tracksAlreadyAdded: connectionLock?.tracksAdded,
                    isAddingTracks: connectionLock?.isAddingTracks,
                    pcState: pc?.connectionState,
                    sendersCount: pc?.getSenders().length
                });

                if (pc && addLocalTracksToConnection && !connectionLock?.tracksAdded) {
                    console.log(`🎵 Adding tracks to existing connection for ${remoteUserId}`);
                    addLocalTracksToConnection(stream);
                } else if (connectionLock?.tracksAdded) {
                    console.log(`✅ Tracks already added to connection for ${remoteUserId}`);
                } else if (!pc) {
                    console.warn(`❌ No peer connection for ${remoteUserId}`);
                } else if (!addLocalTracksToConnection) {
                    console.warn(`❌ No addLocalTracksToConnection function for ${remoteUserId}`);
                    // Fallback: manually add tracks
                    console.log(`🔧 Fallback: manually adding tracks to ${remoteUserId}`);
                    try {
                        stream.getTracks().forEach((track, index) => {
                            console.log(`🎵 Manually adding track ${index} (${track.kind}) to ${remoteUserId}`);
                            pc.addTrack(track, stream);
                        });
                    } catch (error) {
                        console.error(`❌ Failed to manually add tracks to ${remoteUserId}:`, error);
                    }
                } else {
                    console.warn(`❌ Cannot add tracks to connection for ${remoteUserId}:`, {
                        hasPc: !!pc,
                        hasAddFunction: !!addLocalTracksToConnection,
                        hasLock: !!connectionLock,
                        tracksAdded: connectionLock?.tracksAdded
                    });
                }
            });

            // If we're in a room, initiate connections with all users
            if (currentRoom && users.length > 0) {
                console.log('Starting video call with users:', users);
                users.forEach(user => {
                    // Don't create connection with ourselves
                    if (user !== currentUser?.id) {
                        console.log('Initiating connection with:', user);
                        // Create peer connection as initiator (tracks will be added automatically)
                        createPeerConnection(user, true);
                    } else {
                        console.log('Skipping connection with self:', user, currentUser?.id);
                    }
                });
            }
        } catch (error) {
            console.error('Error accessing media devices:', error);
        }
    };

    const stopLocalVideo = () => {
        if (localStream) {
            console.log('Stopping local video stream:', {
                streamId: localStream.id,
                trackCount: localStream.getTracks().length
            });

            localStream.getTracks().forEach((track, index) => {
                console.log(`Stopping track ${index}:`, {
                    kind: track.kind,
                    id: track.id,
                    readyState: track.readyState
                });
                track.stop();
            });
        }
        setLocalStream(null);
    };

    // Utility function to validate stream integrity
    const validateStreamIntegrity = useCallback(() => {
        console.log('🔍 STREAM INTEGRITY VALIDATION REPORT');
        console.log('=====================================');

        const report = {
            timestamp: new Date().toISOString(),
            localStream: null,
            connections: [],
            summary: {
                totalConnections: peerConnections.size,
                healthyConnections: 0,
                problematicConnections: 0,
                totalSenders: 0,
                totalReceivers: 0,
                streamMismatches: [],
                issues: []
            }
        };

        // Validate local stream
        if (localStream) {
            report.localStream = {
                id: localStream.id,
                active: localStream.active,
                tracks: localStream.getTracks().map(track => ({
                    kind: track.kind,
                    id: track.id,
                    label: track.label,
                    enabled: track.enabled,
                    readyState: track.readyState,
                    muted: track.muted
                })),
                videoTracks: localStream.getVideoTracks().length,
                audioTracks: localStream.getAudioTracks().length
            };
            console.log('📹 Local Stream:', report.localStream);
        } else {
            console.log('❌ No local stream available');
            report.summary.issues.push('No local stream available');
        }

        // Validate each peer connection
        peerConnections.forEach(({ pc, remoteUserId, stream, streamId, connectionLock, localTracksAdded }) => {
            const connectionReport = {
                userId: remoteUserId,
                healthy: true,
                issues: [],
                connection: null,
                senders: [],
                receivers: [],
                remoteStream: null
            };

            if (pc) {
                const senders = pc.getSenders();
                const receivers = pc.getReceivers();

                connectionReport.connection = {
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState,
                    iceConnectionState: pc.iceConnectionState,
                    iceGatheringState: pc.iceGatheringState,
                    localTracksAdded: localTracksAdded || connectionLock?.tracksAdded,
                    sendersCount: senders.length,
                    receiversCount: receivers.length
                };

                // Validate connection states
                if (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting') {
                    connectionReport.healthy = false;
                    connectionReport.issues.push(`Connection state: ${pc.connectionState}`);
                }

                if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
                    connectionReport.healthy = false;
                    connectionReport.issues.push(`ICE connection state: ${pc.iceConnectionState}`);
                }

                // Check if tracks should have been added but weren't
                if (senders.length === 0) {
                    connectionReport.healthy = false;
                    connectionReport.issues.push(`No senders - tracks not added to connection`);

                    if (localStream) {
                        connectionReport.issues.push(`Local stream available but not added (${localStream.getTracks().length} tracks)`);
                    } else {
                        connectionReport.issues.push(`No local stream available`);
                    }
                }

                // Check signaling state issues
                if (pc.signalingState === 'have-local-offer' || pc.signalingState === 'have-remote-offer') {
                    connectionReport.healthy = false;
                    connectionReport.issues.push(`Stuck in signaling state: ${pc.signalingState}`);
                }

                // Check if connection is stuck
                if (pc.connectionState === 'new' && connectionReport.connection.created) {
                    const ageMinutes = (Date.now() - connectionReport.connection.created) / (1000 * 60);
                    if (ageMinutes > 1) {
                        connectionReport.healthy = false;
                        connectionReport.issues.push(`Connection stuck in 'new' state for ${ageMinutes.toFixed(1)} minutes`);
                    }
                }

                // Validate senders (outgoing tracks)
                senders.forEach((sender, index) => {
                    const senderInfo = {
                        index,
                        hasTrack: !!sender.track,
                        track: null
                    };

                    if (sender.track) {
                        senderInfo.track = {
                            kind: sender.track.kind,
                            id: sender.track.id,
                            enabled: sender.track.enabled,
                            readyState: sender.track.readyState,
                            muted: sender.track.muted
                        };

                        // Check if sender track matches local stream
                        if (localStream) {
                            const matchingTrack = localStream.getTracks().find(t => t.id === sender.track.id);
                            if (!matchingTrack) {
                                connectionReport.healthy = false;
                                connectionReport.issues.push(`Sender track ${sender.track.id} not found in local stream`);
                                report.summary.streamMismatches.push({
                                    connection: remoteUserId,
                                    issue: 'Sender track mismatch',
                                    trackId: sender.track.id
                                });
                            }
                        }
                    } else {
                        connectionReport.healthy = false;
                        connectionReport.issues.push(`Sender ${index} has no track`);
                    }

                    connectionReport.senders.push(senderInfo);
                });

                // Validate receivers (incoming tracks)
                receivers.forEach((receiver, index) => {
                    const receiverInfo = {
                        index,
                        hasTrack: !!receiver.track,
                        track: null
                    };

                    if (receiver.track) {
                        receiverInfo.track = {
                            kind: receiver.track.kind,
                            id: receiver.track.id,
                            readyState: receiver.track.readyState,
                            muted: receiver.track.muted
                        };
                    }

                    connectionReport.receivers.push(receiverInfo);
                });

                // Validate remote stream
                if (stream) {
                    connectionReport.remoteStream = {
                        id: stream.id,
                        active: stream.active,
                        tracks: stream.getTracks().map(track => ({
                            kind: track.kind,
                            id: track.id,
                            readyState: track.readyState,
                            muted: track.muted
                        })),
                        videoTracks: stream.getVideoTracks().length,
                        audioTracks: stream.getAudioTracks().length
                    };

                    // Check if remote stream matches receivers
                    const receiverTrackIds = receivers.map(r => r.track?.id).filter(Boolean);
                    const streamTrackIds = stream.getTracks().map(t => t.id);

                    const missingInStream = receiverTrackIds.filter(id => !streamTrackIds.includes(id));
                    const missingInReceivers = streamTrackIds.filter(id => !receiverTrackIds.includes(id));

                    if (missingInStream.length > 0 || missingInReceivers.length > 0) {
                        connectionReport.healthy = false;
                        connectionReport.issues.push('Remote stream and receivers mismatch');
                        report.summary.streamMismatches.push({
                            connection: remoteUserId,
                            issue: 'Remote stream mismatch',
                            missingInStream,
                            missingInReceivers
                        });
                    }
                } else {
                    if (receivers.some(r => r.track)) {
                        connectionReport.healthy = false;
                        connectionReport.issues.push('Has receiver tracks but no remote stream');
                    }
                }

                report.summary.totalSenders += senders.length;
                report.summary.totalReceivers += receivers.length;
            } else {
                connectionReport.healthy = false;
                connectionReport.issues.push('No peer connection object');
            }

            if (connectionReport.healthy) {
                report.summary.healthyConnections++;
                console.log(`✅ Connection ${remoteUserId}: HEALTHY`);
            } else {
                report.summary.problematicConnections++;
                console.log(`❌ Connection ${remoteUserId}: ISSUES FOUND`);
                connectionReport.issues.forEach(issue => {
                    console.log(`   - ${issue}`);
                });
            }

            console.log(`📊 Connection ${remoteUserId} Details:`, connectionReport);
            report.connections.push(connectionReport);
        });

        // Generate summary
        console.log('\n📋 VALIDATION SUMMARY');
        console.log('====================');
        console.log(`Total Connections: ${report.summary.totalConnections}`);
        console.log(`Healthy Connections: ${report.summary.healthyConnections}`);
        console.log(`Problematic Connections: ${report.summary.problematicConnections}`);
        console.log(`Total Senders: ${report.summary.totalSenders}`);
        console.log(`Total Receivers: ${report.summary.totalReceivers}`);
        console.log(`Stream Mismatches: ${report.summary.streamMismatches.length}`);

        if (report.summary.issues.length > 0) {
            console.log('\n⚠️  GLOBAL ISSUES:');
            report.summary.issues.forEach(issue => console.log(`   - ${issue}`));
        }

        if (report.summary.streamMismatches.length > 0) {
            console.log('\n🔄 STREAM MISMATCHES:');
            report.summary.streamMismatches.forEach(mismatch => {
                console.log(`   - ${mismatch.connection}: ${mismatch.issue}`);
            });
        }

        // Overall health status
        const overallHealthy = report.summary.problematicConnections === 0 &&
            report.summary.issues.length === 0 &&
            report.summary.streamMismatches.length === 0;

        console.log(`\n🎯 OVERALL STATUS: ${overallHealthy ? '✅ HEALTHY' : '❌ ISSUES DETECTED'}`);
        console.log('=====================================\n');

        // Return the report for programmatic use
        return report;
    }, [peerConnections, localStream]);

    // Debug function to check current peer connections state
    const debugPeerConnections = useCallback(() => {
        console.log('🔍 CURRENT PEER CONNECTIONS DEBUG:');
        console.log('==================================');

        peerConnections.forEach(({ pc, remoteUserId, stream, streamId }, userId) => {
            console.log(`Connection ${userId}:`, {
                remoteUserId,
                hasPC: !!pc,
                hasStream: !!stream,
                streamId,
                streamActive: stream?.active,
                streamTracks: stream?.getTracks().length || 0,
                pcState: pc?.connectionState,
                pcSignaling: pc?.signalingState,
                pcICE: pc?.iceConnectionState
            });
        });

        console.log('==================================');
    }, [peerConnections]);

    // Manual function to add tracks to all connections (for debugging)
    const manuallyAddTracksToAllConnections = useCallback(() => {
        console.log('🔧 MANUALLY ADDING TRACKS TO ALL CONNECTIONS');

        if (!localStream) {
            console.log('❌ No local stream available');
            return;
        }

        console.log('🎵 Local stream details:', {
            id: localStream.id,
            tracks: localStream.getTracks().length,
            active: localStream.active
        });

        peerConnections.forEach(({ pc, remoteUserId }) => {
            if (pc) {
                const currentSenders = pc.getSenders();
                console.log(`🔍 Connection ${remoteUserId} current state:`, {
                    senders: currentSenders.length,
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState
                });

                if (currentSenders.length === 0) {
                    console.log(`🎵 Adding tracks manually to ${remoteUserId}`);
                    try {
                        localStream.getTracks().forEach((track, index) => {
                            console.log(`🎵 Adding track ${index} (${track.kind})`);
                            const sender = pc.addTrack(track, localStream);
                            console.log(`✅ Track added:`, {
                                kind: track.kind,
                                id: track.id,
                                senderId: sender.track?.id
                            });
                        });
                        console.log(`✅ Tracks added to ${remoteUserId}. New sender count:`, pc.getSenders().length);
                    } catch (error) {
                        console.error(`❌ Failed to add tracks to ${remoteUserId}:`, error);
                    }
                } else {
                    console.log(`✅ Connection ${remoteUserId} already has ${currentSenders.length} senders`);
                }
            }
        });
    }, [localStream, peerConnections]);

    // Function to diagnose and attempt to fix common issues
    const diagnoseAndFix = useCallback(() => {
        console.log('🔧 DIAGNOSING AND ATTEMPTING TO FIX ISSUES');
        console.log('==========================================');

        const fixes = [];

        // Check if local stream exists but tracks aren't added
        if (localStream && localStream.getTracks().length > 0) {
            console.log('✅ Local stream available:', {
                id: localStream.id,
                tracks: localStream.getTracks().length,
                active: localStream.active
            });

            // Try to add tracks to connections that don't have senders
            peerConnections.forEach(({ pc, remoteUserId, addLocalTracksToConnection, connectionLock }) => {
                if (pc) {
                    const senders = pc.getSenders();
                    console.log(`Connection ${remoteUserId} has ${senders.length} senders`);

                    if (senders.length === 0 && addLocalTracksToConnection && !connectionLock?.tracksAdded) {
                        console.log(`🔧 Attempting to add tracks to ${remoteUserId}`);
                        try {
                            addLocalTracksToConnection(localStream);
                            fixes.push(`Added tracks to connection ${remoteUserId}`);
                        } catch (error) {
                            console.error(`Failed to add tracks to ${remoteUserId}:`, error);
                            fixes.push(`Failed to add tracks to ${remoteUserId}: ${error.message}`);
                        }
                    } else if (senders.length === 0) {
                        console.log(`🔧 Manually adding tracks to ${remoteUserId}`);
                        try {
                            localStream.getTracks().forEach(track => {
                                pc.addTrack(track, localStream);
                            });
                            fixes.push(`Manually added tracks to connection ${remoteUserId}`);
                        } catch (error) {
                            console.error(`Failed to manually add tracks to ${remoteUserId}:`, error);
                            fixes.push(`Failed to manually add tracks to ${remoteUserId}: ${error.message}`);
                        }
                    }
                }
            });
        } else {
            console.log('❌ No local stream available - cannot add tracks');
            fixes.push('No local stream available - start video first');
        }

        // Check for stuck connections and attempt renegotiation
        peerConnections.forEach(({ pc, remoteUserId }) => {
            if (pc) {
                if (pc.signalingState === 'have-local-offer') {
                    console.log(`🔧 Connection ${remoteUserId} stuck with local offer - may need to restart negotiation`);
                    fixes.push(`Connection ${remoteUserId} stuck with local offer`);
                }

                if (pc.iceConnectionState === 'failed') {
                    console.log(`🔧 ICE connection failed for ${remoteUserId} - may need to restart`);
                    fixes.push(`ICE connection failed for ${remoteUserId}`);
                }

                if (pc.connectionState === 'failed') {
                    console.log(`🔧 Connection failed for ${remoteUserId} - needs restart`);
                    fixes.push(`Connection failed for ${remoteUserId} - needs restart`);
                }
            }
        });

        console.log('🔧 FIXES ATTEMPTED:');
        fixes.forEach(fix => console.log(`   - ${fix}`));
        console.log('==========================================\n');

        return fixes;
    }, [localStream, peerConnections]);

    // Connect to server on mount
    useEffect(() => {
        connectToServer(serverUrl, userData);

        return () => {
            socket?.disconnect();
        };
    }, [serverUrl, userData]);

    // Set up socket event listeners
    // Debug effect for room changes
    useEffect(() => {
        console.log('Current room changed:', currentRoom);
    }, [currentRoom]);

    useEffect(() => {
        if (!socket) return;

        socket.on('connect', () => {
            setConnectionStatus('connected');
        });

        socket.on('disconnect', () => {
            setConnectionStatus('disconnected');
            peerConnections.forEach(({ pc }) => pc?.close());
            setPeerConnections(new Map());
            onDisconnect?.();
        });

        socket.on('room-update', (data) => {
            console.log('Raw room-update event:', data);
            const payload = data[0];
            if (payload && payload.users) {
                console.log('Setting users:', payload.users);
                const newUsers = payload.users;
                setUsers(newUsers);

                // Only update room ID if we're not already in a room
                if (!currentRoom) {
                    console.log('Setting initial room:', payload.roomId);
                    setCurrentRoom(payload.roomId);
                }

                console.log('Room update processed - Room:', payload.roomId, 'Users:', newUsers.length);

                // If we have local video stream, initiate connections with new users
                if (localStream) {
                    console.log('Processing new users with existing local stream:', {
                        streamId: localStream.id,
                        streamActive: localStream.active,
                        newUsers: newUsers.length,
                        existingConnections: peerConnections.size
                    });

                    newUsers.forEach(user => {
                        // Don't create connection with ourselves or existing connections
                        if (user !== currentUser?.id && !peerConnections.has(user)) {
                            console.log('New user joined, initiating connection with:', user);
                            createPeerConnection(user, true);
                        } else if (user === currentUser?.id) {
                            console.log('Skipping self connection:', user);
                        } else {
                            console.log('Connection already exists for user:', user);
                        }
                    });
                }
            } else {
                console.warn('Invalid room-update payload:', payload);
            }
        });


        socket.on('offer', data => handleOffer(data))
        socket.on('answer', data => handleAnswer(data))
        socket.on('ice-candidate', data => handleIceCandidate(data))
        // socket.on('webrtc', (message) => {
        //     const data = JSON.parse(message);
        //     switch (data.type) {
        //         case 'offer':
        //             handleOffer(data);
        //             break;
        //         case 'answer':
        //             handleAnswer(data);
        //             break;
        //         case 'ice-candidate':
        //             handleIceCandidate(data);
        //             break;
        //     }
        // });

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('room-update');
            socket.off('offer');
            socket.off('answer');
            socket.off('ice-candidate');
        };
    }, [socket]);

    return (
        <div className="video-room">
            <ConnectionStatus status={connectionStatus} />

            {currentUser && (
                <div className="user-info">
                    <h3>Current User</h3>
                    <p>{currentUser.name} ({currentUser.email || 'No email'})</p>
                </div>
            )}

            <div className="room-controls">
                {!currentRoom ? (
                    <div className="join-room-form">
                        <input
                            type="text"
                            placeholder="Enter Room ID (UUID)"
                            value={roomInputValue}
                            onChange={(e) => setRoomInputValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && roomInputValue && connectionStatus === 'connected') {
                                    joinRoom(roomInputValue);
                                }
                            }}
                        />
                        <button
                            onClick={() => joinRoom(roomInputValue)}
                            disabled={!roomInputValue || connectionStatus !== 'connected'}
                        >
                            Join Room
                        </button>
                    </div>
                ) : (
                    <div className="current-room">
                        <p>Current Room: {currentRoom}</p>
                        <button onClick={leaveRoom}>Leave Room</button>
                        <button
                            onClick={() => {
                                const result = validateStreamIntegrity();
                                setStreamValidationResult(result);
                            }}
                            style={{ marginLeft: '10px' }}
                        >
                            Validate Streams
                        </button>
                        <button
                            onClick={debugPeerConnections}
                            style={{ marginLeft: '10px' }}
                        >
                            Debug Connections
                        </button>
                        <button
                            onClick={manuallyAddTracksToAllConnections}
                            style={{ marginLeft: '10px' }}
                        >
                            Force Add Tracks
                        </button>
                    </div>
                )}
            </div>

            <div className="video-streams">
                <VideoStream
                    stream={localStream}
                    isLocal={true}
                    onStart={startLocalVideo}
                    onStop={stopLocalVideo}
                />

                <div className="remote-streams">
                    {Array.from(peerConnections.entries()).map(([userId, connectionData]) => {
                        const { stream, streamId, lastStreamUpdate } = connectionData;
                        console.log(`🎥 Rendering stream for ${userId}:`, {
                            hasStream: !!stream,
                            streamId,
                            streamActive: stream?.active,
                            lastUpdate: lastStreamUpdate
                        });

                        return stream && (
                            <VideoStream
                                key={`${userId}-${streamId || 'no-id'}-${lastStreamUpdate || 0}`}
                                stream={stream}
                                isLocal={false}
                                userId={userId}
                            />
                        );
                    })}
                </div>
            </div>

            <UserList
                users={users}
                currentUserId={currentUser?.id}
            />

            <PeerConnections
                connections={Array.from(peerConnections.entries()).map(([userId, { state }]) => ({
                    userId,
                    state
                }))}
            />

            {streamValidationResult && (
                <div className="stream-validation-result" style={{
                    margin: '20px 0',
                    padding: '15px',
                    border: '1px solid #ccc',
                    borderRadius: '5px',
                    backgroundColor: streamValidationResult.summary.problematicConnections === 0 ? '#d4edda' : '#f8d7da'
                }}>
                    <h3>Stream Validation Results</h3>
                    <p><strong>Timestamp:</strong> {new Date(streamValidationResult.timestamp).toLocaleString()}</p>
                    <p><strong>Status:</strong> {
                        streamValidationResult.summary.problematicConnections === 0 &&
                            streamValidationResult.summary.issues.length === 0 ?
                            '✅ All streams healthy' :
                            '❌ Issues detected'
                    }</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginTop: '10px' }}>
                        <div>
                            <strong>Connections:</strong> {streamValidationResult.summary.totalConnections}
                        </div>
                        <div>
                            <strong>Healthy:</strong> {streamValidationResult.summary.healthyConnections}
                        </div>
                        <div>
                            <strong>Issues:</strong> {streamValidationResult.summary.problematicConnections}
                        </div>
                        <div>
                            <strong>Senders:</strong> {streamValidationResult.summary.totalSenders}
                        </div>
                        <div>
                            <strong>Receivers:</strong> {streamValidationResult.summary.totalReceivers}
                        </div>
                        <div>
                            <strong>Mismatches:</strong> {streamValidationResult.summary.streamMismatches.length}
                        </div>
                    </div>

                    {streamValidationResult.localStream && (
                        <div style={{ marginTop: '10px' }}>
                            <strong>Local Stream:</strong> {streamValidationResult.localStream.active ? '✅' : '❌'}
                            ({streamValidationResult.localStream.videoTracks}V, {streamValidationResult.localStream.audioTracks}A)
                        </div>
                    )}

                    {streamValidationResult.summary.issues.length > 0 && (
                        <div style={{ marginTop: '10px' }}>
                            <strong>Global Issues:</strong>
                            <ul>
                                {streamValidationResult.summary.issues.map((issue, index) => (
                                    <li key={index}>{issue}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {streamValidationResult.summary.streamMismatches.length > 0 && (
                        <div style={{ marginTop: '10px' }}>
                            <strong>Stream Mismatches:</strong>
                            <ul>
                                {streamValidationResult.summary.streamMismatches.map((mismatch, index) => (
                                    <li key={index}>{mismatch.connection}: {mismatch.issue}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <button
                        onClick={() => setStreamValidationResult(null)}
                        style={{ marginTop: '10px', padding: '5px 10px' }}
                    >
                        Clear Results
                    </button>
                </div>
            )}

            <EventLog />
        </div>
    );
};

export default VideoRoom;