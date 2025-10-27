import { useState, useEffect, useCallback, useRef } from 'react';
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

    // Local and remote connection references using useRef to avoid stale closures
    const localConnectionRef = useRef(null);
    const remoteConnectionRef = useRef(null);
    const socketRef = useRef(null);
    const currentRoomRef = useRef(null);
    const currentUserRef = useRef(null);
    const localStreamRef = useRef(null);
    const [remoteVideo, setRemoteVideo] = useState(null);

    // ICE servers configuration
    const iceServers = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // Simplified peer connection creation
    const createPeerConnection = useCallback((remoteUserId, isInitiator = false) => {
        console.log(`Creating peer connection with ${remoteUserId}`, { isInitiator });

        const pc = new RTCPeerConnection(iceServers);

        // Add all tracks from local stream to peer connection
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current);
            });
        }

        // Send candidates to establish channel communication
        pc.onicecandidate = ({ candidate }) => {
            if (candidate && socketRef.current) {
                socketRef.current.emit('candidate', remoteUserId, candidate);
            }
        };

        // Receive stream from remote client and add to remote video area
        pc.ontrack = ({ streams: [stream] }) => {
            console.log('Remote track received from:', remoteUserId, 'Stream:', stream);
            if (stream) {
                // Set remote video directly (following your original pattern)
                setRemoteVideo(stream);

                setPeerConnections(prev => {
                    const newConnections = new Map(prev);
                    newConnections.set(remoteUserId, {
                        pc,
                        stream,
                        remoteUserId
                    });
                    console.log('Updated peer connections with remote stream for:', remoteUserId);
                    return newConnections;
                });
            }

            setPeerConnections(prev => {
                const newConnections = new Map(prev);
                newConnections.set(remoteUserId, {
                    pc,
                    remoteUserId,
                    stream: stream
                });
                return newConnections;
            });
        };

        // Store the peer connection

        // Set connection references for simplified logic
        if (isInitiator) {
            localConnectionRef.current = pc;
            createAndSendOffer(pc, remoteUserId);
        } else {
            remoteConnectionRef.current = pc;
        }

        return pc;
    }, []); // No dependencies needed since we're using refs

    const createAndSendOffer = async (pc, remoteUserId) => {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socketRef.current?.emit('webrtc', JSON.stringify({
                type: 'offer',
                roomId: currentRoomRef.current,
                sdp: offer,
                targetUserId: remoteUserId,
                userId: currentUserRef.current?.id
            }));
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    };

    // Receive Offer From Other Client
    const handleOffer = async (data) => {
        const { roomId, userId, sdp } = data;

        console.log('Received offer from:', data);

        // Initialize peer connection
        const pc = new RTCPeerConnection(iceServers);
        remoteConnectionRef.current = pc;

        // Add all tracks from stream to peer connection
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current);
            });
        }

        // Send candidates to establish channel communication
        pc.onicecandidate = ({ candidate, userId }) => {
            console.log('Ice candidate received ', userId)
            if (candidate && socketRef.current) {
                socketRef.current.emit('webrtc', { type: 'ice-candidate', roomId, candidate });
            }
        };

        // Receive stream from remote client and add to remote video area
        pc.ontrack = ({ streams: [stream] }) => {
            console.log('Remote track received in handleOffer from:', userId, 'Stream:', stream);
            if (stream) {
                // Set remote video directly (following your original pattern)
                setRemoteVideo(stream);

                setPeerConnections(prev => {
                    const newConnections = new Map(prev);
                    newConnections.set(userId, {
                        pc,
                        stream,
                        remoteUserId: userId
                    });
                    console.log('Updated peer connections with remote stream for:', userId);
                    return newConnections;
                });
            }
        };

        try {
            // Set Local And Remote description and create answer
            await pc.setRemoteDescription(sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socketRef.current.emit('webrtc', { type: 'answer', roomId, sdp: answer });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    };

    // Receive Answer to establish peer connection
    const handleAnswer = async ({ roomId, userId, sdp: description }) => {
        console.log('Received answer ', description, ' from ', userId);

        if (localConnectionRef.current) {
            try {
                await localConnectionRef.current.setRemoteDescription(description);
            } catch (error) {
                console.error('Error setting remote description:', error);
            }
        }
    };

    // Receive candidates and add to peer connection
    const handleIceCandidate = async ({ candidate }) => {
        console.log('Received ICE candidate ', candidate);

        // Get Local or Remote Connection
        const conn = localConnectionRef.current || remoteConnectionRef.current;

        if (conn) {
            try {
                await conn.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        } else console.warn('Connection not foudn for forwarding ice-candidate')
    };

    const connectToServer = async (serverUrl, userData) => {
        if (socket) {
            return socket;
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
            const user = {
                ...userData,
                id: newSocket.id  // Save our socket ID
            };
            setCurrentUser(user);
            currentUserRef.current = user;
        });

        setSocket(newSocket);
        socketRef.current = newSocket;
        setConnectionStatus('connecting');


        newSocket.on('connect', () => {
            setConnectionStatus('connected');
        });

        newSocket.on('disconnect', () => {
            setConnectionStatus('disconnected');
            peerConnections.forEach(({ pc }) => pc?.close());
            setPeerConnections(new Map());
            onDisconnect?.();
        });

        newSocket.on('room-update', (rawData) => {
            console.log('Raw room-update event:', rawData);
            const payload = Array.isArray(rawData) ? rawData[0] : rawData;
            if (payload && payload.users) {
                console.log('Setting users:', payload.users);
                const newUsers = payload.users;
                setUsers(newUsers);

                // Only update room ID if we're not already in a room
                if (!currentRoomRef.current) {
                    console.log('Setting initial room:', payload.roomId);
                    setCurrentRoom(payload.roomId);
                    currentRoomRef.current = payload.roomId;
                }

                console.log('Room update processed - Room:', payload.roomId, 'Users:', newUsers.length);

                // If we have local video stream, initiate connections with new users
                if (localStreamRef.current) {
                    console.log('Processing new users with existing local stream:', {
                        streamId: localStreamRef.current.id,
                        streamActive: localStreamRef.current.active,
                        newUsers: newUsers.length,
                        existingConnections: peerConnections.size
                    });

                    newUsers.forEach(user => {
                        // Don't create connection with ourselves or existing connections
                        if (user !== currentUserRef.current?.id && !peerConnections.has(user)) {
                            console.log('New user joined, initiating connection with:', user);
                            createPeerConnection(user, true);
                        } else if (user === currentUserRef.current?.id) {
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


        newSocket.on('offer', (rawData) => {
            const data = Array.isArray(rawData) ? rawData[0] : rawData;
            handleOffer(data);
        });
        newSocket.on('answer', (rawData) => {
            const data = Array.isArray(rawData) ? rawData[0] : rawData;
            handleAnswer(data);
        });
        newSocket.on('candidate', (rawData) => {
            const data = Array.isArray(rawData) ? rawData[0] : rawData;
            handleIceCandidate(data);
        });
        return newSocket;
    };

    const joinRoom = (roomId) => {
        if (!socket || !roomId) return;

        console.log(`Attempting to join room: ${roomId}`);
        // Set room ID before emitting to ensure it's available for subsequent events
        setCurrentRoom(roomId);
        currentRoomRef.current = roomId;

        socketRef.current.emit('webrtc', JSON.stringify({
            type: 'join-room',
            roomId,
            userData: currentUserRef.current
        }));
    };

    const leaveRoom = () => {
        if (!socket || !currentRoom) return;

        console.log(`Leaving room: ${currentRoomRef.current}`);
        socketRef.current.emit('webrtc', JSON.stringify({
            type: 'leave-room',
            roomId: currentRoomRef.current
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

            setLocalStream(stream);
            localStreamRef.current = stream;

            // If we're in a room, initiate connections with all users
            if (currentRoomRef.current && users.length > 0) {
                users.forEach(user => {
                    if (user !== currentUserRef.current?.id) {
                        createPeerConnection(user, true);
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
        localStreamRef.current = null;
    };



    // Connect to server on mount
    useEffect(() => {
        connectToServer(serverUrl, userData);

        return () => {
            socket?.disconnect();
        };
    }, [serverUrl, userData]);

    // Sync refs with state changes
    useEffect(() => {
        console.log('Current room changed:', currentRoom);
        currentRoomRef.current = currentRoom;
    }, [currentRoom]);

    useEffect(() => {
        currentUserRef.current = currentUser;
    }, [currentUser]);

    useEffect(() => {
        localStreamRef.current = localStream;
    }, [localStream]);

    useEffect(() => {
        socketRef.current = socket;
    }, [socket]);

    useEffect(() => {
        if (!socket) return;

        // socket.on('connect', () => {
        //     setConnectionStatus('connected');
        // });

        // socket.on('disconnect', () => {
        //     setConnectionStatus('disconnected');
        //     peerConnections.forEach(({ pc }) => pc?.close());
        //     setPeerConnections(new Map());
        //     onDisconnect?.();
        // });

        // socket.on('room-update', (data) => {
        //     console.log('Raw room-update event:', data);
        //     const payload = data[0];
        //     if (payload && payload.users) {
        //         console.log('Setting users:', payload.users);
        //         const newUsers = payload.users;
        //         setUsers(newUsers);

        //         // Only update room ID if we're not already in a room
        //         if (!currentRoomRef.current) {
        //             console.log('Setting initial room:', payload.roomId);
        //             setCurrentRoom(payload.roomId);
        //             currentRoomRef.current = payload.roomId;
        //         }

        //         console.log('Room update processed - Room:', payload.roomId, 'Users:', newUsers.length);

        //         // If we have local video stream, initiate connections with new users
        //         if (localStreamRef.current) {
        //             console.log('Processing new users with existing local stream:', {
        //                 streamId: localStreamRef.current.id,
        //                 streamActive: localStreamRef.current.active,
        //                 newUsers: newUsers.length,
        //                 existingConnections: peerConnections.size
        //             });

        //             newUsers.forEach(user => {
        //                 // Don't create connection with ourselves or existing connections
        //                 if (user !== currentUserRef.current?.id && !peerConnections.has(user)) {
        //                     console.log('New user joined, initiating connection with:', user);
        //                     createPeerConnection(user, true);
        //                 } else if (user === currentUserRef.current?.id) {
        //                     console.log('Skipping self connection:', user);
        //                 } else {
        //                     console.log('Connection already exists for user:', user);
        //                 }
        //             });
        //         }
        //     } else {
        //         console.warn('Invalid room-update payload:', payload);
        //     }
        // });


        // socket.on('offer', (socketId, description) => handleOffer(socketId, description));
        // socket.on('answer', (description) => handleAnswer(description));
        // socket.on('candidate', (candidate) => handleIceCandidate(candidate));
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
            socket.off('candidate');
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

                {/* Simple remote video following your pattern */}
                {remoteVideo && (
                    <div className="video-box">
                        <h3>Remote Video temp</h3>
                        {console.log('Direct rendering ', remoteVideo)}
                        <video
                            ref={node => {
                                if (node) node.srcObject = remoteVideo;
                            }}
                            autoPlay
                            playsInline
                        />
                    </div>
                )}

                {/* <div className="remote-streams">
                    {Array.from(peerConnections.entries()).map(([userId, connectionData]) => {
                        const { stream } = connectionData;
                        console.log('Rendering remote stream for user:', userId, 'Has stream:', stream);
                        return stream && (
                            <VideoStream
                                key={userId}
                                stream={stream}
                                isLocal={false}
                                userId={userId}
                            />
                        );
                    })}
                </div> */}
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