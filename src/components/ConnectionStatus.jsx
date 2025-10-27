const ConnectionStatus = ({ status }) => {
    return (
        <div className={`status ${status}`}>
            {status === 'connected' && 'Connected to signaling server'}
            {status === 'connecting' && 'Connecting to signaling server...'}
            {status === 'reconnecting' && 'Reconnecting to signaling server...'}
            {status === 'disconnected' && 'Disconnected from signaling server'}
        </div>
    );
};

export default ConnectionStatus;