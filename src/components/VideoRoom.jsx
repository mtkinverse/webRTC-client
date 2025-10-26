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
        console.log(`Creating peer connection with ${remoteUserId} (initiator: ${isInitiator})`);

        const pc = new RTCPeerConnection(iceServers);

        // Add local stream if available
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        // Handle remote stream
        pc.ontrack = (event) => {
            console.log(`Received remote stream from ${remoteUserId}`);
            const remoteStream = event.streams[0];
            setPeerConnections(prev => {
                const newConnections = new Map(prev);
                newConnections.set(remoteUserId, { ...newConnections.get(remoteUserId), stream: remoteStream });
                return newConnections;
            });
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate && socket) {
                socket.emit('webrtc', JSON.stringify({
                    type: 'ice-candidate',
                    roomId: currentRoom,
                    candidate: event.candidate,
                    targetUserId: remoteUserId,
                    userId: currentUser?.id
                }));
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            console.log(`Peer connection state with ${remoteUserId}: ${pc.connectionState}`);
            setPeerConnections(prev => {
                const newConnections = new Map(prev);
                newConnections.set(remoteUserId, { ...newConnections.get(remoteUserId), state: pc.connectionState });
                return newConnections;
            });
        };

        setPeerConnections(prev => {
            const newConnections = new Map(prev);
            newConnections.set(remoteUserId, { pc, state: pc.connectionState });
            return newConnections;
        });

        // If we're the initiator, create and send offer
        if (isInitiator) {
            createAndSendOffer(pc, remoteUserId);
        }

        return pc;
    }, [localStream, socket, currentRoom]);

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

        console.log('Processing offer:', { remoteUserId, eventRoomId, currentRoom });

        // if (eventRoomId !== currentRoom) {
        //     console.warn('Received offer for wrong room', eventRoomId, currentRoom);
        //     return;
        // }

        let pc = peerConnections.get(remoteUserId)?.pc;

        if (!pc) {
            pc = createPeerConnection(remoteUserId, false);
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            console.log('Sending answer to:', {
                remoteUserId, roomId: currentRoom,
                sdp: answer,
                targetUserId: remoteUserId,
                userId: currentUser?.id
            });

            socket?.emit('webrtc', JSON.stringify({
                type: 'answer',
                roomId: eventRoomId,
                sdp: answer,
                targetUserId: remoteUserId,
                userId: currentUser?.id
            }));
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    };

    const handleAnswer = async (data) => {
        const eventData = Array.isArray(data) ? data[0] : data;
        const { userId: remoteUserId, sdp, roomId: eventRoomId } = eventData;

        console.log('Processing answer:', { remoteUserId, eventRoomId, currentRoom });

        const pc = peerConnections.get(remoteUserId)?.pc;

        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                console.log('Successfully set remote description from answer');
            } catch (error) {
                console.error('Error handling answer:', error);
            }
        } else {
            console.warn('No peer connection found for:', remoteUserId);
        }
    };

    const handleIceCandidate = async (data) => {
        const eventData = Array.isArray(data) ? data[0] : data;
        const { userId: remoteUserId, candidate, roomId: eventRoomId } = eventData;

        console.log('Processing ICE candidate:', { remoteUserId, eventRoomId, currentRoom });

        if (eventRoomId !== currentRoom) {
            console.warn('Received ICE candidate for wrong room', eventRoomId, currentRoom);
            return;
        }

        const pc = peerConnections.get(remoteUserId)?.pc;

        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('Successfully added ICE candidate');
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        } else {
            console.warn('No peer connection found for ICE candidate:', remoteUserId);
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
            setLocalStream(stream);

            // If we're in a room, initiate connections with all users
            if (currentRoom && users.length > 0) {
                console.log('Starting video call with users:', users);
                users.forEach(user => {
                    // Don't create connection with ourselves
                    if (user !== currentUser?.id) {
                        console.log('Initiating connection with:', user);
                        // Create peer connection as initiator
                        createPeerConnection(user, true);
                    }
                    else console.log('Skipping connection with self:', user, currentUser?.id)
                });
            }

            // Add tracks to existing peer connections
            peerConnections.forEach(({ pc }) => {
                stream.getTracks().forEach(track => {
                    pc?.addTrack(track, stream);
                });
            });
        } catch (error) {
            console.error('Error accessing media devices:', error);
        }
    };

    const stopLocalVideo = () => {
        localStream?.getTracks().forEach(track => track.stop());
        setLocalStream(null);
    };

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
                    newUsers.forEach(user => {
                        // Don't create connection with ourselves or existing connections
                        if (user !== currentUser?.id && !peerConnections.has(user)) {
                            console.log('New user joined, initiating connection with:', user);
                            createPeerConnection(user, true);
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
                            onKeyPress={(e) => {
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