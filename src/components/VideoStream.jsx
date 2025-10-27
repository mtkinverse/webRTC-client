import { useEffect, useRef } from "react";

const VideoStream = ({ stream, isLocal, userId, onStart, onStop }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            console.log(`🎥 Setting ${isLocal ? 'local' : 'remote'} stream:`, stream);
            videoRef.current.srcObject = stream;
        }
    }, [stream, isLocal]);

    return (
        <div className="video-box">
            <h3>{isLocal ? 'Local Video' : `Remote Video (${userId})`}</h3>
            <video
                ref={videoRef}
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