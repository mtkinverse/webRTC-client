const VideoStream = ({ stream, isLocal, userId, onStart, onStop }) => {
    return (
        <div className="video-box">
            <h3>{isLocal ? 'Local Video' : `Remote Video (${userId})`}</h3>
            <video
                ref={node => {
                    if (node) node.srcObject = stream;
                }}
                autoPlay
                playsInline
                muted={isLocal}
            />
            {isLocal && (
                <div className="video-controls">
                    <button onClick={onStart} disabled={!!stream}>
                        Start Video
                    </button>
                    <button onClick={onStop} disabled={!stream}>
                        Stop Video
                    </button>
                </div>
            )}
        </div>
    );
};

export default VideoStream;