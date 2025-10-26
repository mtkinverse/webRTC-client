import { useState } from 'react'
import VideoRoom from './components/VideoRoom'
import { io } from 'socket.io-client'
import './App.css'

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [serverUrl, setServerUrl] = useState('http://localhost:7000');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [roomId, setRoomId] = useState('');

  const handleConnect = async (e) => {
    e.preventDefault();

    // Generate random data if needed
    const finalUserName = userName || `User-${Math.random().toString(36).substr(2, 9)}`;
    const finalToken = bearerToken || `test-token-${Math.random().toString(36).substr(2, 9)}`;

    // Update state with final values
    setUserName(finalUserName);
    setBearerToken(finalToken);

    try {
      // Attempt to establish socket connection before setting connected state
      const socket = io(serverUrl, {
        auth: {
          token: finalToken,
          userData: {
            name: finalUserName,
            email: userEmail
          }
        },
        extraHeaders: {
          'Authorization': `Bearer ${finalToken}`
        }
      });

      // Wait for connection to be established
      await new Promise((resolve, reject) => {
        socket.on('connect', () => {
          console.log('Connected to signaling server');
          resolve();
        });

        socket.on('connect_error', (error) => {
          console.error('Connection failed:', error);
          reject(error);
        });

        // Set a timeout for the connection attempt
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      // If we get here, connection was successful
      setIsConnected(true);
    } catch (error) {
      alert(`Failed to connect: ${error.message}`);
      console.error('Connection error:', error);
    }
  };

  return (
    <div className="app">
      <h1>WebRTC Video Chat</h1>

      {!isConnected ? (
        <div className="connection-form container">
          <h2>Connection Setup</h2>
          <form onSubmit={handleConnect}>
            <div className="form-group">
              <label htmlFor="serverUrl">Server URL:</label>
              <input
                type="text"
                id="serverUrl"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:7000"
              />
            </div>

            <div className="form-group">
              <label htmlFor="userName">Display Name:</label>
              <input
                type="text"
                id="userName"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="userEmail">Email (optional):</label>
              <input
                type="email"
                id="userEmail"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="Enter your email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="bearerToken">Bearer Token:</label>
              <input
                type="text"
                id="bearerToken"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="Enter bearer token"
              />
            </div>

            <button type="submit">Connect</button>
          </form>
        </div>
      ) : (
        <VideoRoom
          serverUrl={serverUrl}
          userData={{
            name: userName,
            email: userEmail,
            token: bearerToken
          }}
          onDisconnect={() => setIsConnected(false)}
        />
      )}
    </div>
  )
}

export default App
