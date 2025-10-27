import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import VideoStream from './VideoStream';

const VideoRoom = ({ serverUrl, userData, onDisconnect }) => {
    const [socket, setSocket] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [roomInputValue, setRoomInputValue] = useState('');
    const [currentRoom, setCurrentRoom] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [users, setUsers] = useState([]);
    const [status, setStatus] = useState('Disconnected');

    const peerConnection = useRef(null);
    const socketRef = useRef(null);
    const currentUserRef = useRef(null);
    const currentRoomRef = useRef(null);
    const localStreamRef = useRef(null);
    const remoteStreamRef = useRef(null);

    // WebRTC configuration
    const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    // Update status display
    const updateStatus = (message) => {
        setStatus(message);
        console.log(message);
    };

    // Create peer connection
    const createPeerConnection = () => {
        peerConnection.current = new RTCPeerConnection(configuration);

        // Add local stream tracks
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                peerConnection.current.addTrack(track, localStreamRef.current);
            });
        }

        // Handle remote stream
        peerConnection.current.ontrack = (event) => {
            console.log('Remote track received');
            const stream = event.streams[0];
            remoteStreamRef.current = stream;
            setRemoteStream(stream);
            updateStatus('Receiving remote stream');
        };

        // Handle ICE candidates
        peerConnection.current.onicecandidate = (event) => {
            if (event.candidate && socketRef.current) {
                socketRef.current.emit('webrtc', JSON.stringify({
                    type: 'ice-candidate',
                    roomId: currentRoomRef.current,
                    candidate: event.candidate,
                    targetUserId: 'remote', // Simplified for 1-to-1
                    userId: currentUserRef.current?.id
                }));
            }
        };

        // Handle connection state changes
        peerConnection.current.onconnectionstatechange = () => {
            updateStatus('Connection state: ' + peerConnection.current.connectionState);
        };
    };

    // Handle incoming offer
    const handleOffer = async (data) => {
        console.log('Received offer from:', data.userId);

        createPeerConnection();

        try {
            await peerConnection.current.setRemoteDescription(data.sdp);
            const answer = await peerConnection.current.createAnswer();
            await peerConnection.current.setLocalDescription(answer);

            socketRef.current.emit('webrtc', JSON.stringify({
                type: 'answer',
                roomId: data.roomId,
                sdp: answer,
                targetUserId: data.userId,
                userId: currentUserRef.current?.id
            }));

            updateStatus('Incoming call answered');
        } catch (error) {
            console.error('Error handling offer:', error);
            updateStatus('Error handling offer: ' + error.message);
        }
    };

    // Handle incoming answer
    const handleAnswer = async (data) => {
        console.log('Received answer from:', data.userId);

        try {
            if (peerConnection.current) {
                await peerConnection.current.setRemoteDescription(data.sdp);
                updateStatus('Call established');
            }
        } catch (error) {
            console.error('Error handling answer:', error);
            updateStatus('Error handling answer: ' + error.message);
        }
    };

    // Handle ICE candidate
    const handleIceCandidate = async (data) => {
        console.log('Received ICE candidate from:', data.userId);

        try {
            if (peerConnection.current) {
                await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    };

    // Start call (create offer)
    const startCall = async () => {
        if (!localStreamRef.current) {
            updateStatus('Please start camera first');
            return;
        }

        createPeerConnection();

        try {
            const offer = await peerConnection.current.createOffer();
            await peerConnection.current.setLocalDescription(offer);

            socketRef.current.emit('webrtc', JSON.stringify({
                type: 'offer',
                roomId: currentRoomRef.current,
                sdp: offer,
                targetUserId: 'remote', // Simplified for 1-to-1
                userId: currentUserRef.current?.id
            }));

            updateStatus('Call initiated. Waiting for answer...');
        } catch (error) {
            console.error('Error creating offer:', error);
            updateStatus('Error creating offer: ' + error.message);
        }
    };

    // Start local camera
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            localStreamRef.current = stream;
            setLocalStream(stream);
            updateStatus('Camera started. Ready to make a call.');
        } catch (error) {
            console.error('Error accessing camera:', error);
            updateStatus('Error accessing camera: ' + error.message);
        }
    };

    // Stop local camera
    const stopCamera = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
            setLocalStream(null);
            updateStatus('Camera stopped');
        }
    };

    // Connect to server
    const connectToServer = (serverUrl, userData) => {
        const newSocket = io(serverUrl, {
            auth: {
                token: userData.token,
                userData: {
                    name: userData.name,
                    email: userData.email
                }
            }
        });

        // Get socket ID and set current user
        newSocket.once('connect', () => {
            console.log('Got socket ID:', newSocket.id);
            const user = { ...userData, id: newSocket.id };
            setCurrentUser(user);
            currentUserRef.current = user;
            updateStatus('Connected to server');
        });

        setSocket(newSocket);
        socketRef.current = newSocket;

        // Socket event handlers
        newSocket.on('disconnect', (reason) => {
            console.log('Socket disconnected:', reason);
            updateStatus('Disconnected from server');
            if (peerConnection.current) {
                peerConnection.current.close();
                peerConnection.current = null;
            }
            remoteStreamRef.current = null;
            setRemoteStream(null);
            onDisconnect?.();
        });

        newSocket.on('room-update', (rawData) => {
            console.log('Room update:', rawData);
            const payload = Array.isArray(rawData) ? rawData[0] : rawData;
            if (payload && payload.users) {
                setUsers(payload.users);
                if (!currentRoomRef.current) {
                    setCurrentRoom(payload.roomId);
                    currentRoomRef.current = payload.roomId;
                }
            }
        });

        // WebRTC signaling handlers
        newSocket.on('offer', (rawData) => {
            const data = Array.isArray(rawData) ? rawData[0] : rawData;
            handleOffer(data);
        });

        newSocket.on('answer', (rawData) => {
            const data = Array.isArray(rawData) ? rawData[0] : rawData;
            handleAnswer(data);
        });

        newSocket.on('ice-candidate', (rawData) => {
            const data = Array.isArray(rawData) ? rawData[0] : rawData;
            handleIceCandidate(data);
        });

        return newSocket;
    };

    // Join room
    const joinRoom = (roomId) => {
        if (!socket || !roomId) return;

        console.log(`Joining room: ${roomId}`);
        setCurrentRoom(roomId);
        currentRoomRef.current = roomId;

        socketRef.current.emit('webrtc', JSON.stringify({
            type: 'join-room',
            roomId,
            userData: currentUserRef.current
        }));

        updateStatus(`Joined room: ${roomId}`);
    };

    // Leave room
    const leaveRoom = () => {
        if (!socket || !currentRoom) return;

        console.log(`Leaving room: ${currentRoomRef.current}`);

        socketRef.current.emit('webrtc', JSON.stringify({
            type: 'leave-room',
            roomId: currentRoomRef.current
        }));

        // Clean up
        if (peerConnection.current) {
            peerConnection.current.close();
            peerConnection.current = null;
        }

        remoteStreamRef.current = null;
        setRemoteStream(null);
        setCurrentRoom(null);
        setUsers([]);
        updateStatus('Left room');
    };

    // Hang up call
    const hangUp = () => {
        if (peerConnection.current) {
            peerConnection.current.close();
            peerConnection.current = null;
        }

        remoteStreamRef.current = null;
        setRemoteStream(null);
        updateStatus('Call ended');
    };

    // Connect to server on mount
    useEffect(() => {
        connectToServer(serverUrl, userData);

        return () => {
            // Cleanup on unmount
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
            }
            if (peerConnection.current) {
                peerConnection.current.close();
                peerConnection.current = null;
            }
            remoteStreamRef.current = null;
            socket?.disconnect();
        };
    }, [serverUrl, userData]);

    // Sync refs with state changes
    useEffect(() => {
        currentRoomRef.current = currentRoom;
    }, [currentRoom]);

    useEffect(() => {
        currentUserRef.current = currentUser;
    }, [currentUser]);

    useEffect(() => {
        localStreamRef.current = localStream;
    }, [localStream]);

    useEffect(() => {
        remoteStreamRef.current = remoteStream;
    }, [remoteStream]);

    return (
        <div className="video-room">
            <div className="status">
                <p>Status: {status}</p>
            </div>

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
                                if (e.key === 'Enter' && roomInputValue) {
                                    joinRoom(roomInputValue);
                                }
                            }}
                        />
                        <button
                            onClick={() => joinRoom(roomInputValue)}
                            disabled={!roomInputValue}
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

            <div className="call-controls">
                <button onClick={startCamera} disabled={!!localStream}>
                    Start Camera
                </button>
                <button onClick={stopCamera} disabled={!localStream}>
                    Stop Camera
                </button>
                <button onClick={startCall} disabled={!localStream || !currentRoom}>
                    Start Call
                </button>
                <button onClick={hangUp} disabled={!peerConnection.current}>
                    Hang Up
                </button>
            </div>

            <div className="video-streams">
                <VideoStream
                    stream={localStream}
                    isLocal={true}
                    onStart={startCamera}
                    onStop={stopCamera}
                />

                {remoteStream && (
                    <VideoStream
                        stream={remoteStream}
                        isLocal={false}
                        userId="remote"
                    />
                )}
            </div>

            {users.length > 0 && (
                <div className="users-list">
                    <h3>Users in room:</h3>
                    <ul>
                        {users.map(userId => (
                            <li key={userId}>
                                {userId} {userId === currentUser?.id && '(You)'}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default VideoRoom;