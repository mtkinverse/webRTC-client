const PeerConnections = ({ connections }) => {
    return (
        <div className="peer-connections">
            <h3>Peer Connections</h3>
            <div className="connections-list">
                {connections.length > 0 ? (
                    connections.map(({ userId, state }) => (
                        <div key={userId} className="peer-connection">
                            <h4>Connection to {userId}</h4>
                            <span className={`connection-state ${state}`}>
                                {state}
                            </span>
                        </div>
                    ))
                ) : (
                    <p>No peer connections</p>
                )}
            </div>
        </div>
    );
};

export default PeerConnections;