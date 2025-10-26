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
            if (connectionLock.isAddingTracks || connectionLock.tracksAdded) {
                console.log(`Tracks already being added or added for ${remoteUserId}`);
                return;
            }

            connectionLock.isAddingTracks = true;
            console.log(`Adding local stream tracks to peer connection for ${remoteUserId}:`, {
                streamId: stream.id,
                trackCount: stream.getTracks().length,
                videoTracks: stream.getVideoTracks().length,
                audioTracks: stream.getAudioTracks().length
            });

            try {
                stream.getTracks().forEach((track, index) => {
                    console.log(`Adding track ${index} (${track.kind}) to ${remoteUserId}:`, {
                        trackId: track.id,
                        trackLabel: track.label,
                        trackEnabled: track.enabled,
                        trackReadyState: track.readyState
                    });

                    // Add track with explicit stream association
                    const sender = pc.addTrack(track, stream);
                    console.log(`Track added successfully for ${remoteUserId}:`, {
                        trackKind: track.kind,
                        senderId: sender.track?.id,
                        streamId: stream.id
                    });
                });

                connectionLock.tracksAdded = true;
                console.log(`All tracks successfully added to peer connection for ${remoteUserId}`);
            } catch (error) {
                console.error(`Error adding tracks to peer connection for ${remoteUserId}:`, error);
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
            console.log(`Received remote track from ${remoteUserId}:`, {
                trackKind: event.track.kind,
                trackId: event.track.id,
                trackLabel: event.track.label,
                streamCount: event.streams.length,
                streamIds: event.streams.map(s => s.id)
            });

            if (event.streams && event.streams.length > 0) {
                const remoteStream = event.streams[0];
                console.log(`Processing remote stream from ${remoteUserId}:`, {
                    streamId: remoteStream.id,
                    trackCount: remoteStream.getTracks().length,
                    videoTracks: remoteStream.getVideoTracks().length,
                    audioTracks: remoteStream.getAudioTracks().length,
                    active: remoteStream.active
                });

                // Validate stream integrity
                if (remoteStream.getTracks().length === 0) {
                    console.warn(`Empty remote stream received from ${remoteUserId}`);
                    return;
                }

                // Update peer connection with validated stream
                setPeerConnections(prev => {
                    const newConnections = new Map(prev);
                    const existingConnection = newConnections.get(remoteUserId);

                    if (existingConnection) {
                        newConnections.set(remoteUserId, {
                            ...existingConnection,
                            stream: remoteStream,
                            streamId: remoteStream.id,
                            lastStreamUpdate: Date.now()
                        });
                        console.log(`Stream associated with peer connection for ${remoteUserId}`);
                    } else {
                        console.warn(`No existing peer connection found for stream from ${remoteUserId}`);
                    }

                    return newConnections;
                });

                // Monitor stream health
                remoteStream.addEventListener('addtrack', (e) => {
                    console.log(`Track added to remote stream from ${remoteUserId}:`, e.track.kind);
                });

                remoteStream.addEventListener('removetrack', (e) => {
                    console.log(`Track removed from remote stream from ${remoteUserId}:`, e.track.kind);
                });
            } else {
                console.warn(`No streams in track event from ${remoteUserId}`);
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
                            usernameFragment: event.candidate.usernameFragment,
                            type: event.candidate.type,
                            protocol: event.candidate.protocol
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

        console.log('Processing answer:', {
            remoteUserId,
            eventRoomId,
            currentRoom,
            existingConnections: Array.from(peerConnections.keys())
        });

        const existingConnection = peerConnections.get(remoteUserId);
        const pc = existingConnection?.pc;

        if (pc) {
            try {
                if (pc.signalingState === 'stable') {
                    console.log('Warning: RTCPeerConnection is already stable');
                    return;
                }
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                console.log('Successfully set remote description from answer');
            } catch (error) {
                console.error('Error handling answer:', error);
            }
        } else {
            console.warn('No peer connection found for:', remoteUserId, 'Creating new connection');
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
                video: true,
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
            console.log('Adding tracks to existing peer connections:', peerConnections.size);
            peerConnections.forEach(({ pc, addLocalTracksToConnection, connectionLock, remoteUserId }) => {
                if (pc && addLocalTracksToConnection && !connectionLock?.tracksAdded) {
                    console.log(`Adding tracks to existing connection for ${remoteUserId}`);
                    addLocalTracksToConnection(stream);
                } else if (connectionLock?.tracksAdded) {
                    console.log(`Tracks already added to connection for ${remoteUserId}`);
                } else {
                    console.warn(`Cannot add tracks to connection for ${remoteUserId}:`, {
                        hasPc: !!pc,
                        hasAddFunction: !!addLocalTracksToConnection,
                        hasLock: !!connectionLock
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
        console.log('Validating stream integrity across all connections:');

        peerConnections.forEach(({ pc, remoteUserId, stream, streamId }) => {
            if (pc) {
                const senders = pc.getSenders();
                const receivers = pc.getReceivers();

                console.log(`Connection ${remoteUserId}:`, {
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState,
                    sendersCount: senders.length,
                    receiversCount: receivers.length,
                    hasRemoteStream: !!stream,
                    remoteStreamId: streamId,
                    remoteStreamActive: stream?.active
                });

                // Validate senders
                senders.forEach((sender, index) => {
                    if (sender.track) {
                        console.log(`  Sender ${index}:`, {
                            trackKind: sender.track.kind,
                            trackId: sender.track.id,
                            trackEnabled: sender.track.enabled,
                            trackReadyState: sender.track.readyState
                        });
                    }
                });

                // Validate receivers
                receivers.forEach((receiver, index) => {
                    if (receiver.track) {
                        console.log(`  Receiver ${index}:`, {
                            trackKind: receiver.track.kind,
                            trackId: receiver.track.id,
                            trackReadyState: receiver.track.readyState
                        });
                    }
                });
            }
        });
    }, [peerConnections]);

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
                        <button onClick={validateStreamIntegrity} style={{ marginLeft: '10px' }}>
                            Validate Streams
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
                    {Array.from(peerConnections.entries()).map(([userId, { stream }]) => (
                        stream && (
                            <VideoStream
                                key={userId}
                                stream={stream}
                                isLocal={false}
                                userId={userId}
                            />
                        )
                    ))}
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

            <EventLog />
        </div>
    );
};

export default VideoRoom;